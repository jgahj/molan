'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const IPV4_BLOCKED = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
];

function ipv4BigInt(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n);
}

function ipv6BigInt(value) {
  let text = String(value).toLowerCase().split('%')[0];
  const ipv4 = text.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (ipv4) {
    const tail = ipv4BigInt(ipv4[1]);
    if (tail == null) return null;
    text = text.slice(0, -ipv4[1].length) + Number((tail >> 16n) & 0xffffn).toString(16) + ':' + Number(tail & 0xffffn).toString(16);
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right]
    : left;
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function cidrContains(address, network, prefix) {
  const bits = 32n;
  const ip = ipv4BigInt(address);
  const base = ipv4BigInt(network);
  if (ip == null || base == null) return false;
  const shift = bits - BigInt(prefix);
  return (ip >> shift) === (base >> shift);
}

function ipv4IsPublic(address, options = {}) {
  if (net.isIP(address) !== 4) return false;
  const allowTunFakeIp = options.allowTunFakeIp === true;
  const allowLocal = options.allowLocal === true;
  return !IPV4_BLOCKED.some(([network, prefix]) => {
    if (allowTunFakeIp && network === '198.18.0.0' && prefix === 15) return false;
    if (allowLocal && network === '127.0.0.0' && prefix === 8) return false;
    return cidrContains(address, network, prefix);
  });
}

function ipv6IsPublic(address, options = {}) {
  if (net.isIP(address) !== 6) return false;
  const allowLocal = options.allowLocal === true;
  const value = ipv6BigInt(address);
  if (value == null) return false;
  if (allowLocal && (address === '::1' || address === '0:0:0:0:0:0:0:1')) return true;
  const contains = (network, prefix) => {
    const base = ipv6BigInt(network);
    const shift = 128n - BigInt(prefix);
    return base != null && (value >> shift) === (base >> shift);
  };
  const mappedPrefix = (value >> 32n) === 0xffffn;
  if (mappedPrefix) {
    const embedded = value & 0xffffffffn;
    const ipv4 = [24n, 16n, 8n, 0n].map(shift => Number((embedded >> shift) & 255n)).join('.');
    return ipv4IsPublic(ipv4, options);
  }
  if (!contains('2000::', 3)) return false;
  return ![
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
    ['3fff::', 20], ['64:ff9b::', 96], ['64:ff9b:1::', 48]
  ].some(([network, prefix]) => contains(network, prefix));
}

function addressIsPublic(address, options = {}) {
  const family = net.isIP(String(address || '').replace(/^\[|\]$/g, ''));
  if (family === 4) return ipv4IsPublic(address, options);
  if (family === 6) return ipv6IsPublic(String(address).replace(/^\[|\]$/g, ''), options);
  return false;
}

function makePinnedLookup(addresses) {
  const pinned = addresses.map(item => ({ address: String(item.address), family: Number(item.family) || net.isIP(String(item.address)) }));
  return (hostname, options, callback) => {
    const opts = typeof options === 'function' ? {} : options || {};
    const done = typeof options === 'function' ? options : callback;
    const candidates = opts.family ? pinned.filter(item => item.family === Number(opts.family)) : pinned;
    if (!candidates.length) {
      const error = new Error('已校验 Provider 地址族不可用');
      error.code = 'EAI_ADDRFAMILY';
      done(error);
      return;
    }
    if (opts.all) return done(null, candidates.map(item => ({ ...item })));
    const selected = candidates[0];
    return done(null, selected.address, selected.family);
  };
}

/** 校验 Provider endpoint 并返回固定 DNS 解析结果供 socket lookup 使用。 */
async function validateProviderTarget(input, options = {}) {
  let url;
  try { url = new URL(String(input || '')); }
  catch (_) { throw Object.assign(new Error('Provider endpoint URL 无效'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 }); }
  const allowLocal = Boolean(options.allowLocal || process.env.MOLAN_ALLOW_LOCAL_MODELS === '1');
  const allowedProtocols = ['https:', 'http:'];
  if (!allowedProtocols.includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw Object.assign(new Error('Provider endpoint 必须使用无凭据的 HTTP/HTTPS URL'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 });
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLocalHost = hostname === 'localhost' || hostname.endsWith('.localhost');
  if (!allowLocal && isLocalHost) {
    throw Object.assign(new Error('Provider endpoint 主机名不允许访问本地或内部网络'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 });
  }
  if (!hostname || hostname.includes('%') ||
    hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname === 'metadata.google.internal') {
    throw Object.assign(new Error('Provider endpoint 主机名不允许访问本地或内部网络'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 });
  }
  const literalFamily = net.isIP(hostname);
  let records;
  if (literalFamily) {
    if (!allowLocal && !addressIsPublic(hostname)) {
      throw Object.assign(new Error('Provider endpoint 解析到非公网地址，已拒绝连接'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 });
    }
    records = [{ address: hostname, family: literalFamily }];
  } else {
    let timer;
    try {
      const timeoutMs = Math.max(100, Math.min(10000, Number(options.timeoutMs) || 3000));
      records = await Promise.race([
        (options.lookup || dns.lookup)(hostname, { all: true, verbatim: true }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Provider DNS 查询超时')), timeoutMs); })
      ]);
    } catch (_) {
      throw Object.assign(new Error('Provider endpoint DNS 查询失败'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 });
    } finally { if (timer) clearTimeout(timer); }
  }
  const allowTunFakeIp = !literalFamily && (options.allowTunFakeIp !== false) && (process.env.MOLAN_ALLOW_TUN_FAKE_IP !== '0');
  const checkOptions = { allowTunFakeIp, allowLocal };

  if (!Array.isArray(records) || !records.length || records.some(item => !item || !addressIsPublic(item.address, checkOptions))) {
    throw Object.assign(new Error('Provider endpoint 解析到非公网地址，已拒绝连接'), { code: 'PROVIDER_ENDPOINT_BLOCKED', status: 503 });
  }
  return Object.freeze({
    url,
    hostname,
    port: Number(url.port) || (url.protocol === 'https:' ? 443 : 80),
    addresses: Object.freeze(records.map(item => Object.freeze({ address: String(item.address), family: Number(item.family) || net.isIP(String(item.address)) }))),
    lookup: makePinnedLookup(records)
  });
}

module.exports = {
  validateProviderTarget,
  addressIsPublic,
  makePinnedLookup,
  ipv4IsPublic,
  ipv6IsPublic
};
