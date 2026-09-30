'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

test('native contract HTTP calls local provider, persists both usages and exposes debts', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-contract-http-'));
  let calls = 0;
  const provider = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      calls++;
      const json = calls === 1 ? { goal: 'too short' } : { goal: '林青找到失踪商队留下的密信', protagonistAction: '林青潜入仓库抢走被藏起的账本',
        opposition: '守卫封锁出口并追查被盗账本', informationChange: '账本揭露商队被城主扣押', irreversibleResult: '林青公开账本后失去潜伏身份', foreshadowActions: [] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(json) } }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_APP_STORE = 'json';
  process.env.MOLAN_ALLOW_LOCAL_MODELS = '1';
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  process.env.PORT = String(probe.address().port);
  await new Promise(resolve => probe.close(resolve));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ modelPolicy: { defaultModel: 'test-model' },
    platformModels: [{ id: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://127.0.0.1:' + provider.address().port + '/v1', creditsPer1k: 1 }] }));
  const app = require('../server');
  await new Promise(resolve => app.server.listen(Number(process.env.PORT), '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  let token;
  async function call(url, method = 'GET', body) {
    const response = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  try {
    const registration = await call('/api/auth/register', 'POST', { email: 'contract@example.test', password: 'test-password' });
    token = registration.body.token;
    const user = registration.body.user;
    const native = app.appRepository();
    const novel = await native.create({ user, id: 'n_contract', state: { volumes: [] } });
    const repository = new (require('../lib/repositories/json-creation-repository').JsonCreationRepository)(native);
    const scope = { userId: user.userId, projectId: novel.id, workspaceId: novel.workspaceId, bookId: 'cb_contract' };
    await repository.create({ ...scope, payload: { characters: [], creationPlan: {} } });
    const result = await call('/api/creation-books/cb_contract/chapter-contract', 'POST', { projectId: novel.id, modelId: 'test-model', chapterNo: 1 });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.retried, true);
    assert.equal(calls, 2);
    assert.equal(result.body.providerAttempts.length, 2);
    assert.ok(result.body.providerAttempts.every(attempt => attempt.usage.totalTokens === 15));
    const saved = await native.repository.ledger.get(novel.id, result.body.contractId);
    assert.equal(saved.auditStatus, 'unaudited');
    assert.equal(saved.providerAttempts.length, 2);
    const debts = await call('/api/creation-books/cb_contract/debts?projectId=n_contract');
    assert.equal(debts.status, 200);
    assert.ok(Array.isArray(debts.body.active));
    const usage = await native.summarizeTokenUsage({ userId: user.userId });
    assert.equal(usage.length, 2);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
