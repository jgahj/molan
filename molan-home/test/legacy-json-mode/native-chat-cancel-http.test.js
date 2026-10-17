'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');

test('disconnect cancels upstream, releases the actor slot and preserves unresolved billing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-native-chat-cancel-'));
  let calls = 0;
  let firstRequestId;
  let upstreamClosed;
  const closed = new Promise(resolve => { upstreamClosed = resolve; });
  const provider = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      calls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (calls === 1) {
        res.on('close', upstreamClosed);
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial' } }] }) + '\n\n');
        return;
      }
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'second response' }, finish_reason: 'stop' }] }) + '\n\n' +
        'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  Object.assign(process.env, { MOLAN_DATA_DIR: directory, MOLAN_CONFIG_DIR: directory, MOLAN_APP_STORE: 'json',
    MOLAN_PG_ENABLED: '0', MOLAN_ALLOW_LOCAL_MODELS: '1', MOLAN_LOCAL_ONLY: '1', MOLAN_MAX_CHAT_INFLIGHT_PER_USER: '1' });
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({ modelPolicy: { defaultModel: 'cancel-model' },
    platformModels: [{ id: 'cancel-model', model: 'cancel-model', provider: 'openai-compat', apiKey: 'test-key',
      baseURL: `http://127.0.0.1:${provider.address().port}/v1`, creditsPer1k: 1 }] }));
  const app = require('../server');
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'cancel@example.test', password: 'test-password' }) });
    const account = await registration.json();
    assert.equal(registration.status, 200);
    const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + account.token };
    const body = requestId => JSON.stringify({ stage: 'single', requestId, max_tokens: 100, messages: [{ role: 'user', content: 'Reply briefly' }] });
    await new Promise((resolve, reject) => {
      const req = http.request(base + '/api/chat', { method: 'POST', headers }, res => {
        assert.equal(res.statusCode, 200);
        firstRequestId = res.headers['x-molan-request-id'];
        let received = '';
        res.on('data', chunk => {
          received += chunk;
          if (received.includes('partial')) { res.destroy(); resolve(); }
        });
        res.on('error', reject);
      });
      req.setTimeout(5000, () => req.destroy(new Error('Chat did not stream before timeout')));
      req.on('error', reject);
      req.end(body('cancel-first'));
    });
    let closeTimeout;
    try {
      await Promise.race([closed, new Promise((_, reject) => {
        closeTimeout = setTimeout(() => reject(new Error('Upstream did not close after cancellation')), 5000);
      })]);
    } finally {
      clearTimeout(closeTimeout);
    }
    const response = await fetch(base + '/api/chat', { method: 'POST', headers, body: body('cancel-second'), signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    assert.match(text, /second response/);
    assert.equal(calls, 2);
    const ledger = await app.appRepository().summarizeTokenUsage({ userId: account.user.userId });
    assert.equal(ledger.length, 2);
    const cancelled = ledger.find(row => row.requestId === firstRequestId);
    assert.ok(cancelled);
    assert.equal(cancelled.outcome, 'aborted');
    assert.equal(cancelled.actualCost, null);
    assert.ok(cancelled.reservedCost > 0);
  } finally {
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    await app.closeStorageStores();
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
