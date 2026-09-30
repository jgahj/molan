'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

test('native chat calls a local provider and persists exact token billing in shared JSON storage', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-native-chat-'));
  let calls = 0;
  const provider = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Test response' } }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_APP_STORE = 'json';
  process.env.MOLAN_ALLOW_LOCAL_MODELS = '1';
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ modelPolicy: { defaultModel: 'test-model' },
    platformModels: [{ id: 'test-model', model: 'test-model', provider: 'openai-compat', apiKey: 'test-key', baseURL: 'http://127.0.0.1:' + provider.address().port + '/v1', creditsPer1k: 1 }] }));
  const app = require('../server');
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'chat@example.test', password: 'test-password' }) });
    const account = await registration.json();
    assert.equal(registration.status, 200);
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + account.token },
      body: JSON.stringify({ stage: 'single', requestId: 'native-chat-one', max_tokens: 100, messages: [{ role: 'user', content: 'Reply briefly' }] }) });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    assert.match(text, /Test response/);
    assert.match(text, /"billingStatus":"exact"/);
    assert.equal(calls, 1);
    const rows = await app.appRepository().summarizeTokenUsage({ userId: account.user.userId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].usage.totalTokens, 15);
    assert.ok(rows[0].actualCost > 0);
  } finally {
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
