'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { addressIsPublic, validateProviderTarget } = require('../lib/provider-url-guard');

test('Provider URL 校验拒绝本机、私网、link-local、metadata 和保留地址', () => {
  for (const address of [
    '0.0.0.0', '10.2.3.4', '100.64.1.1', '127.0.0.1', '169.254.169.254',
    '172.20.1.5', '192.168.1.5', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1',
    '::ffff:127.0.0.1', '64:ff9b::a00:1'
  ]) assert.equal(addressIsPublic(address), false, address);
  assert.equal(addressIsPublic('8.8.8.8'), true);
  assert.equal(addressIsPublic('2606:4700:4700::1111'), true);
});

test('Provider endpoint 只接受无凭据 HTTPS 和完全公网 DNS 解析', async () => {
  const lookup = async () => [{ address: '203.0.113.4', family: 4 }];
  await assert.rejects(validateProviderTarget('http://api.example.com/v1', { lookup }), { code: 'PROVIDER_ENDPOINT_BLOCKED' });
  await assert.rejects(validateProviderTarget('https://user:secret@api.example.com/v1', { lookup }), { code: 'PROVIDER_ENDPOINT_BLOCKED' });
  await assert.rejects(validateProviderTarget('https://localhost/v1', { lookup }), { code: 'PROVIDER_ENDPOINT_BLOCKED' });
  await assert.rejects(validateProviderTarget('https://api.example.com/v1', {
    lookup: async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '169.254.169.254', family: 4 }
    ]
  }), { code: 'PROVIDER_ENDPOINT_BLOCKED' });
});

test('Provider 连接复用校验后的固定 DNS 地址，不再次解析主机名', async () => {
  const checked = await validateProviderTarget('https://api.example.com/v1', {
    lookup: async hostname => {
      assert.equal(hostname, 'api.example.com');
      return [{ address: '1.1.1.1', family: 4 }];
    }
  });
  const result = await new Promise((resolve, reject) => {
    checked.lookup('api.example.com', { family: 4 }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: '1.1.1.1', family: 4 });
});
