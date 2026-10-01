'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCloudApiConfigService } = require('../services/cloud-api-config-service');

function createService({ env = {}, config = {}, port = 3000, warnings = [] } = {}) {
  return createCloudApiConfigService({
    fs: { readFileSync: () => JSON.stringify(config) },
    configFile: 'config.json',
    port,
    env,
    logger: { warn: message => warnings.push(message) }
  });
}

test('cloud API config prefers the environment and accepts only an HTTP(S) origin', () => {
  const service = createService({ env: { MOLAN_CLOUD_API_BASE: ' https://cloud.example:8443/ ' },
    config: { cloudApiBase: 'https://file.example' } });
  assert.equal(service.loadCloudApiBase(), 'https://cloud.example:8443');
  assert.equal(service.getErrorMessage(), '');
  assert.throws(() => service.normalizeCloudApiBase('https://user:pass@cloud.example'), /不能包含账号/);
  assert.throws(() => service.normalizeCloudApiBase('https://cloud.example/api'), /不能包含账号/);
});

test('cloud API config reads the persisted base when the environment is unset', () => {
  const service = createService({ config: { cloudApiBase: 'http://file.example:8080/' } });
  assert.equal(service.loadCloudApiBase(), 'http://file.example:8080');
  assert.equal(service.getErrorMessage(), '');
});

test('cloud API config falls back on self-proxy and exposes the existing warning state', () => {
  const warnings = [];
  const service = createService({ config: { cloudApiBase: 'http://127.0.0.1:3000/' }, warnings });
  assert.equal(service.loadCloudApiBase(), '');
  assert.equal(service.getErrorMessage(), '云端同步地址不能指向当前本地服务，避免请求循环');
  assert.match(warnings[0], /已回退本地数据模式/);
});
