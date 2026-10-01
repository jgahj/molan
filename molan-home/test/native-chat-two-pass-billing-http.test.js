'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

test('two-pass chat never charges partial usage as a complete provider total', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-two-pass-billing-'));
  let calls = 0;
  const provider = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      // First request: only the draft has usage. Second: only the rewrite has usage.
      const hasUsage = calls === 1 || calls === 4;
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: '正文测试。' }, finish_reason: 'stop' }] }) + '\n\n' +
        (hasUsage ? 'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\n' : '') +
        'data: [DONE]\n\n');
    });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { MOLAN_DATA_DIR: directory, MOLAN_CONFIG_DIR: directory, MOLAN_APP_STORE: 'json',
    MOLAN_PG_ENABLED: '0', MOLAN_ALLOW_LOCAL_MODELS: '1', MOLAN_LOCAL_ONLY: '1', MOLAN_GENERATION_V2: '0' });
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ modelPolicy: { defaultModel: 'partial-model' },
    platformModels: [{ id: 'partial-model', model: 'partial-model', provider: 'openai-compat', apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${provider.address().port}/v1`, creditsPer1k: 1 }] }));
  const app = require('../server');
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'partial-http@example.test', password: 'test-password' }) });
    const account = await registration.json();
    assert.equal(registration.status, 200);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(base + '/api/chat', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + account.token },
        body: JSON.stringify({ stage: 'writing', twoPassHumanize: true, forceHumanizePass: true,
          max_tokens: 100, messages: [{ role: 'user', content: '写一段短正文。' }] }), signal: AbortSignal.timeout(5000) });
      const text = await response.text();
      assert.equal(response.status, 200, text);
      assert.match(text, /"billingStatus":"pending"/);
      assert.doesNotMatch(text, /"billingStatus":"exact"/);
    }
    assert.equal(calls, 4);
    const rows = await app.appRepository().summarizeTokenUsage({ userId: account.user.userId });
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.actualCost, null);
      assert.equal(row.usage.totalTokens, 15);
      assert.equal(row.usage.providerUsageIncomplete, true);
    }
  } finally {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
