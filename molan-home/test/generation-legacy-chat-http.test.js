'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-legacy-chat-native-'));
const dataDirectory = path.join(runtimeRoot, 'app-data');
const configDirectory = path.join(runtimeRoot, 'config');
fs.mkdirSync(dataDirectory, { recursive: true });
fs.mkdirSync(configDirectory, { recursive: true });
const environmentKeys = [
  'MOLAN_APP_STORE', 'MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_REQUIRE_SQLITE',
  'MOLAN_PUBLIC_MODE', 'MOLAN_LOCAL_ONLY', 'MOLAN_PG_ENABLED'
];
const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
Object.assign(process.env, {
  MOLAN_APP_STORE: 'json',
  MOLAN_DATA_DIR: dataDirectory,
  MOLAN_CONFIG_DIR: configDirectory,
  MOLAN_REQUIRE_SQLITE: '0',
  MOLAN_PUBLIC_MODE: '0',
  MOLAN_LOCAL_ONLY: '1',
  MOLAN_PG_ENABLED: '0'
});
const platformModels = ['gpt-5.6-luna', 'deepseek-v4-flash'].map(id => ({
  id, model: id, provider: 'openai-compat', baseURL: 'http://127.0.0.1:1/v1', creditsPer1k: 0.18
}));
fs.writeFileSync(path.join(configDirectory, 'config.json'), JSON.stringify({
  cloudApiBase: '', platformModels,
  pricing: { fallbackCreditsPer1k: 0.18 }, modelPolicy: { defaultModel: 'gpt-5.6-luna' }
}), 'utf8');
const app = require('../server');

test('legacy /api/chat writing handoff requires idempotency, replays safely, and enforces project ACL', async t => {
  const repository = app.appRepository();
  const issuedTokens = [];
  t.after(async () => {
    if (app.server.listening) {
      app.server.closeAllConnections();
      await new Promise(resolve => app.server.close(resolve));
    }
    await app.closeStorageStores();
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  const previousGenerationFlag = process.env.MOLAN_GENERATION_V2;
  process.env.MOLAN_GENERATION_V2 = 'true';
  const owner = { email: 'legacy-chat-owner@example.com', name: '旧版兼容作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  const outsider = { email: 'legacy-chat-outsider@example.com', name: '无权协作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  try {
    const ownerAccount = await repository.saveAccount(owner, 0);
    const outsiderAccount = await repository.saveAccount(outsider, 0);
    const auth = app.nativeAuthService();
    const ownerToken = await auth.issueToken(ownerAccount);
    issuedTokens.push(ownerToken);
    const outsiderToken = await auth.issueToken(outsiderAccount);
    issuedTokens.push(outsiderToken);
    assert.equal((await repository.listAuthSessions()).length, 2);

    const port = await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port));
    });
    const base = `http://127.0.0.1:${port}`;
    const request = (token, options = {}) => fetch(base + '/api/chat', {
      ...options,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const projectId = 'n_legacychat1';
    const projectState = {
      title: '旧接口幂等测试',
      volumes: [{ id: 'volume-1', title: '第一卷', chapters: [{ id: 'chapter_1', title: '第一章', scenes: [{ id: 'scene-1', content: '' }] }] }]
    };
    const writeRequest = prompt => ({
      projectId, chapterId: 'chapter_1', creationMode: true, stage: 'writing',
      genre: '玄幻', prompt
    });

    const created = await (await fetch(base + '/api/novels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: projectId, title: projectState.title, state: projectState })
    })).json();
    assert.equal(created.ok, true, JSON.stringify(created));

    const missingKey = await request(ownerToken, { method: 'POST', body: JSON.stringify(writeRequest('写第一章')) });
    assert.equal(missingKey.status, 428);
    assert.equal((await missingKey.json()).code, 'IDEMPOTENCY_KEY_REQUIRED');

    const forbidden = await request(outsiderToken, {
      method: 'POST', headers: { 'Idempotency-Key': 'legacy-chat-outsider-key' },
      body: JSON.stringify(writeRequest('写第一章'))
    });
    assert.equal(forbidden.status, 404);

    const optionsFor = prompt => ({
      method: 'POST', headers: { 'Idempotency-Key': 'legacy-chat-stable-key' },
      body: JSON.stringify(writeRequest(prompt))
    });
    const first = await request(ownerToken, optionsFor('写第一章'));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('content-type') || '', /text\/event-stream/i);
    const firstBody = await first.text();
    const firstDataLine = firstBody.split(/\r?\n/).find(line => line.startsWith('data: '));
    assert.ok(firstDataLine);
    const firstEvent = JSON.parse(firstDataLine.slice(6));
    assert.equal(firstEvent.idempotent, false);
    const firstRunId = first.headers.get('x-molan-generation-id');
    assert.ok(firstRunId);

    const replay = await request(ownerToken, optionsFor('写第一章'));
    assert.equal(replay.status, 200, await replay.clone().text());
    const replayBody = await replay.text();
    const replayDataLine = replayBody.split(/\r?\n/).find(line => line.startsWith('data: '));
    assert.ok(replayDataLine);
    assert.equal(JSON.parse(replayDataLine.slice(6)).idempotent, true);
    assert.equal(replay.headers.get('x-molan-generation-id'), firstRunId);

    const conflict = await request(ownerToken, optionsFor('写一份不同正文'));
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).code, 'IDEMPOTENCY_KEY_REUSED');
  } finally {
    for (const token of issuedTokens) await repository.revokeAuthSession(app.hashSessionToken(token));
    assert.equal((await repository.listAuthSessions()).length, 0);
    if (app.server.listening) {
      app.server.closeAllConnections();
      await new Promise(resolve => app.server.close(resolve));
    }
    if (previousGenerationFlag === undefined) delete process.env.MOLAN_GENERATION_V2;
    else process.env.MOLAN_GENERATION_V2 = previousGenerationFlag;
  }
});
