'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createLocalRuntime } = require('./helpers/local-runtime');

createLocalRuntime();
const app = require('../server');
app.initDB();

test('legacy /api/chat writing handoff requires idempotency, replays safely, and enforces project ACL', async () => {
  const previousGenerationFlag = process.env.MOLAN_GENERATION_V2;
  process.env.MOLAN_GENERATION_V2 = 'true';
  const owner = { email: 'legacy-chat-owner@example.com', name: '旧版兼容作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  const outsider = { email: 'legacy-chat-outsider@example.com', name: '无权协作者', role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0 };
  app.saveUser(owner);
  app.saveUser(outsider);
  const ownerToken = crypto.randomBytes(32).toString('hex');
  const outsiderToken = crypto.randomBytes(32).toString('hex');
  app.sessions.set(app.hashSessionToken(ownerToken), { email: owner.email, scope: 'client', expiresAt: Date.now() + 60000 });
  app.sessions.set(app.hashSessionToken(outsiderToken), { email: outsider.email, scope: 'client', expiresAt: Date.now() + 60000 });
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

  try {
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
    app.sessions.delete(app.hashSessionToken(ownerToken));
    app.sessions.delete(app.hashSessionToken(outsiderToken));
    app.server.closeAllConnections();
    await new Promise(resolve => app.server.close(resolve));
    if (previousGenerationFlag === undefined) delete process.env.MOLAN_GENERATION_V2;
    else process.env.MOLAN_GENERATION_V2 = previousGenerationFlag;
  }
});
