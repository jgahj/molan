'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const SUB2API_SMTP_KEYS = [
  'smtp_host',
  'smtp_port',
  'smtp_username',
  'smtp_password',
  'smtp_from',
  'smtp_from_name',
  'smtp_use_tls'
];

const DEFAULT_DIAL_TIMEOUT_MS = 10000;
const DEFAULT_IO_TIMEOUT_MS = 20000;
const DEFAULT_SUB2API_CACHE_TTL_MS = 60000;
const DEFAULT_SUB2API_NEG_CACHE_TTL_MS = 15000;
const DEFAULT_SUB2API_QUERY_TIMEOUT_MS = 3000;
const DEFAULT_FROM_NAME = '墨阑 AI 小说';

function sanitizeHeaderValue(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function assertNoLineBreak(value, fieldName) {
  const raw = String(value || '');
  if (/[\r\n]/.test(raw)) {
    throw new Error(`Invalid SMTP ${fieldName}: contains line break`);
  }
  return raw.trim();
}

function parseEmailAddress(value, fieldName) {
  const cleaned = assertNoLineBreak(value, fieldName);
  if (!cleaned) {
    throw new Error(`Invalid SMTP ${fieldName}: address is empty`);
  }
  const angleMatch = cleaned.match(/^(?:"?([^"]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>$/);
  const address = (angleMatch ? angleMatch[2] : cleaned).trim();
  const displayName = angleMatch ? sanitizeHeaderValue(angleMatch[1]) : '';
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)) {
    throw new Error(`Invalid SMTP ${fieldName}: malformed email address`);
  }
  return { address, displayName };
}

function encodeMimeWord(text) {
  const clean = sanitizeHeaderValue(text);
  if (!clean) return '';
  if (/^[\x20-\x7E]+$/.test(clean) && !/[=?]/.test(clean)) {
    return clean;
  }
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function formatAddressHeader(address, displayName) {
  const cleanName = sanitizeHeaderValue(displayName);
  if (!cleanName) return `<${address}>`;
  const encoded = encodeMimeWord(cleanName);
  if (encoded.startsWith('=?UTF-8?')) {
    return `${encoded} <${address}>`;
  }
  const escaped = cleanName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}" <${address}>`;
}

function wrapBase64(buffer) {
  const raw = Buffer.from(buffer).toString('base64');
  const lines = [];
  for (let i = 0; i < raw.length; i += 76) {
    lines.push(raw.slice(i, i + 76));
  }
  return lines.join('\r\n');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildSMTPMessage(config, to, subject, htmlBody) {
  if (!config || !config.host) {
    throw new Error('Missing SMTP configuration');
  }
  const fromRaw = config.from || config.username;
  const fromAddr = parseEmailAddress(fromRaw, 'from');
  const toAddr = parseEmailAddress(to, 'recipient');
  const fromName = sanitizeHeaderValue(config.fromName || fromAddr.displayName || DEFAULT_FROM_NAME);
  const domain = (fromAddr.address.split('@')[1] || sanitizeHeaderValue(config.host) || 'localhost').replace(/[\[\]<>]/g, '');
  const messageId = `<${crypto.randomBytes(16).toString('hex')}@${domain}>`;
  const dateHeader = new Date().toUTCString();
  const subjectHeader = encodeMimeWord(subject);

  const headers = [
    `From: ${formatAddressHeader(fromAddr.address, fromName)}`,
    `To: ${formatAddressHeader(toAddr.address, toAddr.displayName)}`,
    `Date: ${dateHeader}`,
    `Message-ID: ${messageId}`,
    `Subject: ${subjectHeader}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64'
  ].join('\r\n');

  const bodyEncoded = wrapBase64(Buffer.from(String(htmlBody || ''), 'utf8'));
  const rawMessage = `${headers}\r\n\r\n${bodyEncoded}\r\n`;

  return {
    envelopeFrom: fromAddr.address,
    envelopeTo: toAddr.address,
    data: rawMessage
  };
}

function buildVerifyCodeEmailHtml({ code, siteName = DEFAULT_FROM_NAME, expiresMinutes = 15 }) {
  const safeSite = escapeHtml(siteName);
  const safeCode = escapeHtml(code);
  const safeMinutes = escapeHtml(String(expiresMinutes));
  return [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>',
    '<body style="margin:0;padding:24px;background-color:#f3f3f0;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#0a0a0a;">',
    '  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e7e2;border-radius:8px;overflow:hidden;">',
    '    <tr>',
    '      <td style="padding:24px 28px;background:#0a0a0a;color:#ffffff;">',
    '        <table role="presentation" cellspacing="0" cellpadding="0"><tr>',
    '          <td style="width:32px;height:32px;border-radius:6px;background:#ffffff;color:#0a0a0a;text-align:center;vertical-align:middle;font-family:\'Noto Serif SC\',\'Songti SC\',serif;font-weight:700;font-size:17px;">墨</td>',
    `          <td style="padding-left:12px;font-family:\'Noto Serif SC\',\'Songti SC\',serif;font-size:18px;font-weight:700;letter-spacing:0.04em;color:#ffffff;">${safeSite}</td>`,
    '        </tr></table>',
    '      </td>',
    '    </tr>',
    '    <tr>',
    '      <td style="padding:32px 28px 24px;">',
    '        <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#74746e;font-weight:700;">EMAIL VERIFICATION</p>',
    '        <h1 style="margin:0 0 14px;font-family:\'Noto Serif SC\',\'Songti SC\',serif;font-size:22px;line-height:1.35;color:#0a0a0a;">注册邮箱验证码</h1>',
    '        <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#52524e;">你正在注册墨阑创作工作台账号。请在页面中输入下方 6 位数字验证码以完成注册：</p>',
    '        <div style="margin:0 0 22px;padding:18px 24px;background:#fbfbf9;border:1px solid #d6d6d0;border-radius:8px;text-align:center;">',
    `          <span style="display:inline-block;font-family:Consolas,\'SFMono-Regular\',monospace;font-size:34px;font-weight:700;letter-spacing:0.35em;color:#0a0a0a;padding-left:0.35em;">${safeCode}</span>`,
    '        </div>',
    `        <p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:#52524e;">验证码有效期为 <strong style="color:#0a0a0a;">${safeMinutes} 分钟</strong>，单次验证后失效。</p>`,
    '        <p style="margin:0;font-size:12px;line-height:1.65;color:#74746e;">如果这不是你本人发起的操作，请直接忽略此邮件，你的邮箱不会被注册。</p>',
    '      </td>',
    '    </tr>',
    '    <tr>',
    '      <td style="padding:16px 28px;background:#fbfbf9;border-top:1px solid #e7e7e2;font-size:11px;color:#a5a59f;">',
    `        此邮件由 ${safeSite} 系统自动发送，请勿直接回复。`,
    '      </td>',
    '    </tr>',
    '  </table>',
    '</body>',
    '</html>'
  ].join('\r\n');
}

function createLineReader(socket) {
  let buffer = '';
  const waiters = [];
  let closed = false;
  let closeError = null;

  function flushWaiters() {
    while (waiters.length > 0) {
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        waiters.shift().resolve(line);
      } else if (closed) {
        waiters.shift().reject(closeError || new Error('SMTP connection closed unexpectedly'));
      } else {
        break;
      }
    }
  }

  function onData(chunk) {
    buffer += chunk.toString('utf8');
    flushWaiters();
  }

  function onError(err) {
    closed = true;
    closeError = err;
    flushWaiters();
  }

  function onClose() {
    closed = true;
    flushWaiters();
  }

  socket.on('data', onData);
  socket.on('error', onError);
  socket.on('close', onClose);
  socket.on('end', onClose);

  return {
    readLine() {
      const idx = buffer.indexOf('\n');
      if (idx >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        return Promise.resolve(line);
      }
      if (closed) {
        return Promise.reject(closeError || new Error('SMTP connection closed unexpectedly'));
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject });
      });
    },
    detach() {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
      socket.removeListener('end', onClose);
    }
  };
}

async function readSmtpResponse(reader) {
  const lines = [];
  while (true) {
    const line = await reader.readLine();
    lines.push(line);
    const match = line.match(/^(\d{3})([ -])(.*)$/);
    if (!match) {
      throw new Error(`Unexpected SMTP response: ${line}`);
    }
    if (match[2] === ' ') {
      return {
        code: Number(match[1]),
        lines,
        message: lines.join('\n')
      };
    }
  }
}

function writeRaw(socket, text) {
  return new Promise((resolve, reject) => {
    socket.write(text, 'utf8', err => (err ? reject(err) : resolve()));
  });
}

function isTlsPlaintextGreetingError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  const msg = String(err.message || '');
  return (
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    code === 'ERR_SSL_PACKET_LENGTH_TOO_LONG' ||
    /wrong version number|packet length too long|unknown protocol/i.test(msg)
  );
}

function dialTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`SMTP TCP dial timeout (${host}:${port})`));
    }, timeoutMs);

    socket.once('connect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function dialTls(host, port, timeoutMs, tlsOptions) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      minVersion: 'TLSv1.2',
      ...tlsOptions
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`SMTP TLS dial timeout (${host}:${port})`));
    }, timeoutMs);

    socket.once('secureConnect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function upgradeStartTls(plainSocket, host, timeoutMs, tlsOptions) {
  return new Promise((resolve, reject) => {
    const tlsSocket = tls.connect({
      socket: plainSocket,
      servername: net.isIP(host) ? undefined : host,
      minVersion: 'TLSv1.2',
      ...tlsOptions
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      tlsSocket.destroy();
      reject(new Error(`SMTP STARTTLS timeout (${host})`));
    }, timeoutMs);

    tlsSocket.once('secureConnect', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(tlsSocket);
    });
    tlsSocket.once('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

function parseEhloExtensions(lines) {
  const extensions = new Map();
  for (const line of lines.slice(1)) {
    const body = line.slice(4).trim();
    if (!body) continue;
    const [name, ...rest] = body.split(/\s+/);
    extensions.set(name.toUpperCase(), rest.join(' '));
  }
  return extensions;
}

function dotStuffMessage(raw) {
  return String(raw || '')
    .replace(/\r?\n/g, '\r\n')
    .replace(/(^|\r\n)\./g, '$1..');
}

async function sendSmtpEmailWithConfig(config, to, subject, htmlBody, options = {}) {
  const message = buildSMTPMessage(config, to, subject, htmlBody);
  const host = assertNoLineBreak(config.host, 'host');
  const port = Number(config.port) || 587;
  const useTLS = Boolean(config.useTLS);
  const dialTimeoutMs = Number(options.dialTimeoutMs) || DEFAULT_DIAL_TIMEOUT_MS;
  const ioTimeoutMs = Number(options.ioTimeoutMs) || DEFAULT_IO_TIMEOUT_MS;
  const tlsOptions = options.tlsOptions || {};
  const ehloHost = sanitizeHeaderValue(options.ehloHost || 'molan.local') || 'molan.local';

  let socket = null;
  let reader = null;
  let ioTimer = null;

  const armIoTimeout = currentSocket => {
    if (ioTimer) clearTimeout(ioTimer);
    ioTimer = setTimeout(() => {
      try {
        currentSocket.destroy(new Error(`SMTP I/O timeout (${host}:${port})`));
      } catch (_) {}
    }, ioTimeoutMs);
  };

  async function sendCmd(cmd, expectedCodes) {
    await writeRaw(socket, `${cmd}\r\n`);
    const resp = await readSmtpResponse(reader);
    if (!expectedCodes.includes(resp.code)) {
      throw new Error(`SMTP command failed (${cmd.split(' ')[0]}): ${resp.code} ${resp.message}`);
    }
    return resp;
  }

  async function openStartTlsConnection(mandatoryTls) {
    socket = await dialTcp(host, port, dialTimeoutMs);
    armIoTimeout(socket);
    reader = createLineReader(socket);
    const greeting = await readSmtpResponse(reader);
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting rejected: ${greeting.code} ${greeting.message}`);
    }
    const ehlo = await sendCmd(`EHLO ${ehloHost}`, [250]);
    const extensions = parseEhloExtensions(ehlo.lines);
    if (extensions.has('STARTTLS')) {
      await sendCmd('STARTTLS', [220]);
      reader.detach();
      socket = await upgradeStartTls(socket, host, dialTimeoutMs, tlsOptions);
      armIoTimeout(socket);
      reader = createLineReader(socket);
      const ehloTls = await sendCmd(`EHLO ${ehloHost}`, [250]);
      return parseEhloExtensions(ehloTls.lines);
    }
    if (mandatoryTls) {
      throw new Error('SMTP server does not support STARTTLS');
    }
    return extensions;
  }

  try {
    let extensions;
    if (useTLS) {
      try {
        socket = await dialTls(host, port, dialTimeoutMs, tlsOptions);
        armIoTimeout(socket);
        reader = createLineReader(socket);
        const greeting = await readSmtpResponse(reader);
        if (greeting.code !== 220) {
          throw new Error(`SMTP greeting rejected: ${greeting.code} ${greeting.message}`);
        }
        const ehlo = await sendCmd(`EHLO ${ehloHost}`, [250]);
        extensions = parseEhloExtensions(ehlo.lines);
      } catch (tlsErr) {
        if (socket) {
          try { socket.destroy(); } catch (_) {}
          socket = null;
        }
        if (!isTlsPlaintextGreetingError(tlsErr)) {
          throw new Error(`SMTP TLS connect failed: ${tlsErr.message}`);
        }
        // 与 sub2api 一致：UseTLS=true 遇到明文问候（如 587 端口）时自动升级为强制 STARTTLS
        extensions = await openStartTlsConnection(true);
      }
    } else {
      extensions = await openStartTlsConnection(false);
    }

    const username = String(config.username || '').trim();
    const password = String(config.password || '').trim();
    if (username || password) {
      const authCaps = String(extensions.get('AUTH') || '').toUpperCase();
      if (authCaps.includes('LOGIN') && !authCaps.includes('PLAIN')) {
        await sendCmd('AUTH LOGIN', [334]);
        await sendCmd(Buffer.from(username, 'utf8').toString('base64'), [334]);
        await sendCmd(Buffer.from(password, 'utf8').toString('base64'), [235]);
      } else {
        const plainToken = Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString('base64');
        try {
          await sendCmd(`AUTH PLAIN ${plainToken}`, [235]);
        } catch (plainErr) {
          if (!authCaps.includes('LOGIN')) throw plainErr;
          await sendCmd('AUTH LOGIN', [334]);
          await sendCmd(Buffer.from(username, 'utf8').toString('base64'), [334]);
          await sendCmd(Buffer.from(password, 'utf8').toString('base64'), [235]);
        }
      }
    }

    await sendCmd(`MAIL FROM:<${message.envelopeFrom}>`, [250]);
    await sendCmd(`RCPT TO:<${message.envelopeTo}>`, [250, 251]);
    await sendCmd('DATA', [354]);
    const stuffed = dotStuffMessage(message.data);
    await writeRaw(socket, `${stuffed}\r\n.\r\n`);
    const dataResp = await readSmtpResponse(reader);
    if (dataResp.code !== 250) {
      throw new Error(`SMTP DATA rejected: ${dataResp.code} ${dataResp.message}`);
    }
    try {
      await writeRaw(socket, 'QUIT\r\n');
    } catch (_) {
      // Ignore QUIT errors once DATA succeeded (matches sub2api behavior)
    }
    const cleanSocket = socket;
    socket = null;
    try {
      cleanSocket.end();
      cleanSocket.unref();
    } catch (_) {}
    return {
      ok: true,
      envelopeFrom: message.envelopeFrom,
      envelopeTo: message.envelopeTo
    };
  } finally {
    if (ioTimer) clearTimeout(ioTimer);
    if (reader) {
      try { reader.detach(); } catch (_) {}
    }
    if (socket) {
      try { socket.destroy(); } catch (_) {}
    }
  }
}

function parseBoolFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  const norm = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(norm)) return true;
  if (['0', 'false', 'no', 'off'].includes(norm)) return false;
  return defaultValue;
}

function parseEnvFile(filePath) {
  const map = {};
  if (!filePath) return map;
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return map;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map[key] = val;
  }
  return map;
}

function normalizeSmtpConfig(raw, source) {
  if (!raw || typeof raw !== 'object') return null;
  const host = String(raw.host || '').trim();
  if (!host) return null;
  const portNum = Number(raw.port);
  const port = Number.isInteger(portNum) && portNum > 0 && portNum <= 65535 ? portNum : 587;
  const username = String(raw.username || '').trim();
  const password = String(raw.password || '').trim();
  const from = String(raw.from || username || '').trim();
  if (!from) return null;
  const rawFromName = String(raw.fromName || '').trim();
  const fromName = (!rawFromName || /^sub2api$/i.test(rawFromName)) ? DEFAULT_FROM_NAME : rawFromName;
  const useTLS = raw.useTLS === undefined || raw.useTLS === ''
    ? port === 465
    : parseBoolFlag(raw.useTLS, port === 465);
  return {
    host,
    port,
    username,
    password,
    from,
    fromName,
    useTLS,
    source
  };
}

function readSub2ApiPgConnectionConfig(env, defaultEnvPaths) {
  if (parseBoolFlag(env.MOLAN_SUB2API_PG_DISABLE, false)) return null;

  const databaseUrl = String(env.MOLAN_SUB2API_DATABASE_URL || '').trim();
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      connectionTimeoutMillis: Number(env.MOLAN_SUB2API_PG_TIMEOUT_MS) || DEFAULT_SUB2API_QUERY_TIMEOUT_MS,
      statement_timeout: Number(env.MOLAN_SUB2API_PG_TIMEOUT_MS) || DEFAULT_SUB2API_QUERY_TIMEOUT_MS
    };
  }

  let envFileData = {};
  const explicitEnvFile = String(env.MOLAN_SUB2API_ENV_FILE || '').trim();
  const candidateEnvFiles = explicitEnvFile ? [explicitEnvFile] : (defaultEnvPaths || []);
  for (const candidate of candidateEnvFiles) {
    if (candidate && fs.existsSync(candidate)) {
      envFileData = parseEnvFile(candidate);
      break;
    }
  }

  const host = String(env.MOLAN_SUB2API_PG_HOST || (Object.keys(envFileData).length ? '127.0.0.1' : '')).trim();
  const password = String(env.MOLAN_SUB2API_PG_PASSWORD || envFileData.POSTGRES_PASSWORD || '').trim();
  if (!host || !password) return null;

  const port = Number(env.MOLAN_SUB2API_PG_PORT || 25432) || 25432;
  const user = String(env.MOLAN_SUB2API_PG_USER || envFileData.POSTGRES_USER || 'sub2api').trim();
  const database = String(env.MOLAN_SUB2API_PG_DATABASE || envFileData.POSTGRES_DB || 'sub2api').trim();
  const timeoutMs = Number(env.MOLAN_SUB2API_PG_TIMEOUT_MS) || DEFAULT_SUB2API_QUERY_TIMEOUT_MS;

  return {
    host,
    port,
    user,
    password,
    database,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs
  };
}

function createSmtpMailService({
  env = process.env,
  configFile = '',
  sub2apiEnvFiles,
  pgClientFactory = null,
  sendTransport = sendSmtpEmailWithConfig,
  logger = console,
  now = () => Date.now(),
  cacheTtlMs = DEFAULT_SUB2API_CACHE_TTL_MS,
  negativeCacheTtlMs = DEFAULT_SUB2API_NEG_CACHE_TTL_MS
} = {}) {
  let sub2Cache = null; // { expiresAt, config }

  const resolvedSub2EnvFiles = Array.isArray(sub2apiEnvFiles)
    ? sub2apiEnvFiles
    : [
        '/opt/sub2api/deploy/.env',
        '/root/sub2api/deploy/.env',
        path.resolve(__dirname, '..', '..', '..', 'sub2api', 'deploy', '.env')
      ];

  function readEnvSmtpConfig() {
    const host = String(env.MOLAN_SMTP_HOST || '').trim();
    if (!host) return null;
    return normalizeSmtpConfig({
      host,
      port: env.MOLAN_SMTP_PORT,
      username: env.MOLAN_SMTP_USERNAME || env.MOLAN_SMTP_USER,
      password: env.MOLAN_SMTP_PASSWORD || env.MOLAN_SMTP_PASS,
      from: env.MOLAN_SMTP_FROM,
      fromName: env.MOLAN_SMTP_FROM_NAME,
      useTLS: env.MOLAN_SMTP_USE_TLS
    }, 'env');
  }

  function readFileSmtpConfig() {
    if (!configFile) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || !parsed.smtp) return null;
      return normalizeSmtpConfig(parsed.smtp, 'config');
    } catch (_) {
      return null;
    }
  }

  async function readSub2ApiDatabaseSmtpConfig() {
    const ts = now();
    if (sub2Cache && sub2Cache.expiresAt > ts) {
      return sub2Cache.config;
    }

    const pgConfig = readSub2ApiPgConnectionConfig(env, resolvedSub2EnvFiles);
    if (!pgConfig) {
      sub2Cache = { expiresAt: ts + negativeCacheTtlMs, config: null };
      return null;
    }

    let client = null;
    try {
      if (typeof pgClientFactory === 'function') {
        client = pgClientFactory(pgConfig);
      } else {
        const { Client } = require('pg');
        client = new Client(pgConfig);
      }
      await client.connect();
      const result = await client.query(
        'SELECT key, value FROM settings WHERE key = ANY($1::text[])',
        [SUB2API_SMTP_KEYS]
      );
      const map = {};
      for (const row of (result && Array.isArray(result.rows) ? result.rows : [])) {
        map[String(row.key || '')] = String(row.value || '');
      }
      const config = normalizeSmtpConfig({
        host: map.smtp_host,
        port: map.smtp_port,
        username: map.smtp_username,
        password: map.smtp_password,
        from: map.smtp_from,
        fromName: env.MOLAN_SMTP_FROM_NAME || map.smtp_from_name,
        useTLS: map.smtp_use_tls
      }, 'sub2api-pg');

      sub2Cache = {
        expiresAt: ts + (config ? cacheTtlMs : negativeCacheTtlMs),
        config
      };
      return config;
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn('[smtp] 无法从 sub2api PostgreSQL 读取 SMTP 配置：' + String(error && error.message || 'unavailable'));
      }
      sub2Cache = { expiresAt: ts + negativeCacheTtlMs, config: null };
      return null;
    } finally {
      if (client && typeof client.end === 'function') {
        try { await client.end(); } catch (_) {}
      }
    }
  }

  async function resolveSmtpConfig() {
    const fromEnv = readEnvSmtpConfig();
    if (fromEnv) return fromEnv;
    const fromFile = readFileSmtpConfig();
    if (fromFile) return fromFile;
    return readSub2ApiDatabaseSmtpConfig();
  }

  async function isConfigured() {
    return Boolean(await resolveSmtpConfig());
  }

  async function sendVerificationCodeEmail({ to, code, siteName = DEFAULT_FROM_NAME, expiresMinutes = 15 }) {
    const config = await resolveSmtpConfig();
    if (!config) {
      const err = new Error('邮件服务尚未配置，请先配置 SMTP 或确认 sub2api 邮箱配置可用');
      err.status = 503;
      err.code = 'EMAIL_NOT_CONFIGURED';
      throw err;
    }
    const effectiveSiteName = String(siteName || config.fromName || DEFAULT_FROM_NAME).trim();
    const subject = `[${effectiveSiteName}] 注册邮箱验证码：${code}`;
    const htmlBody = buildVerifyCodeEmailHtml({ code, siteName: effectiveSiteName, expiresMinutes });
    await sendTransport(config, to, subject, htmlBody);
    return {
      ok: true,
      source: config.source,
      from: config.from
    };
  }

  function resetCache() {
    sub2Cache = null;
  }

  return {
    resolveSmtpConfig,
    isConfigured,
    sendVerificationCodeEmail,
    resetCache
  };
}

module.exports = {
  SUB2API_SMTP_KEYS,
  buildSMTPMessage,
  buildVerifyCodeEmailHtml,
  sendSmtpEmailWithConfig,
  createSmtpMailService
};
