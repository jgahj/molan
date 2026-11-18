'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'molan-local-open-'));
}

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address())));
}

function closeServer(server) {
  return new Promise(resolve => (server ? server.close(() => resolve()) : resolve()));
}

async function loadServerWithEnv(envOverrides) {
  const keys = [
    'MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_LOCAL_ONLY', 'MOLAN_PUBLIC_MODE',
    'MOLAN_LOCAL_OPEN_ACCESS', 'MOLAN_LOCAL_ACCOUNT_EMAIL', 'MOLAN_LOCAL_ACCOUNT_NAME',
    'MOLAN_PG_ENABLED', 'MOLAN_PG_URL', 'MOLAN_PG_DATABASE', 'MOLAN_CLOUD_API_BASE'
  ];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  const dir = tempDir();
  process.env.MOLAN_DATA_DIR = dir;
  process.env.MOLAN_CONFIG_DIR = dir;
  process.env.MOLAN_LOCAL_ONLY = '1';
  process.env.MOLAN_PG_ENABLED = '0';
  delete process.env.MOLAN_PG_URL;
  delete process.env.MOLAN_PG_DATABASE;
  delete process.env.MOLAN_CLOUD_API_BASE;
  for (const [k, v] of Object.entries(envOverrides || {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const serverPath = require.resolve('../server');
  delete require.cache[serverPath];
  const mod = require('../server');
  const addr = await listen(mod.server);
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    mod,
    baseUrl,
    cleanup: async () => {
      await closeServer(mod.server);
      delete require.cache[serverPath];
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

test('MOLAN_LOCAL_OPEN_ACCESS=1 opens auth, admin, metrics, models, and local-session without login', async () => {
  const ctx = await loadServerWithEnv({ MOLAN_PUBLIC_MODE: '0', MOLAN_LOCAL_OPEN_ACCESS: '1' });
  try {
    const syncRes = await fetch(`${ctx.baseUrl}/api/local-sync/status`);
    assert.equal(syncRes.status, 200);
    const syncBody = await syncRes.json();
    assert.equal(syncBody.localOpenAccess, true);

    const modelsRes = await fetch(`${ctx.baseUrl}/api/models`);
    assert.equal(modelsRes.status, 200);
    const modelsBody = await modelsRes.json();
    assert.equal(modelsBody.access.canChooseModel, true);
    assert.equal(modelsBody.access.role, 'admin');

    const sessionRes = await fetch(`${ctx.baseUrl}/api/auth/local-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(sessionRes.status, 200);
    const sessionBody = await sessionRes.json();
    assert.equal(sessionBody.ok, true);
    assert.equal(sessionBody.localOpenAccess, true);
    assert.ok(sessionBody.token);
    assert.ok(sessionBody.adminToken);
    assert.equal(sessionBody.user.role, 'admin');
    assert.equal(sessionBody.user.unlimitedCredits, true);
    assert.equal(sessionBody.user.email, 'local@molan.local');

    const meRes = await fetch(`${ctx.baseUrl}/api/auth/me`);
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.user.email, 'local@molan.local');
    assert.equal(meBody.user.isAdmin, true);

    const adminMeRes = await fetch(`${ctx.baseUrl}/api/admin/auth/me`);
    assert.equal(adminMeRes.status, 200);
    const adminMeBody = await adminMeRes.json();
    assert.equal(adminMeBody.user.isAdmin, true);

    const metricsRes = await fetch(`${ctx.baseUrl}/api/metrics`);
    assert.equal(metricsRes.status, 200);

    // Chat without Authorization header must pass auth (hits validation 400 rather than 401)
    const chatRes = await fetch(`${ctx.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [] })
    });
    assert.notEqual(chatRes.status, 401);
    assert.equal(chatRes.status, 400);

    // Normal user helper still gets full model selection when MOLAN_LOCAL_OPEN_ACCESS=1
    assert.equal(ctx.mod.canChooseModel({ email: 'reader@example.com', role: 'normal' }), true);
  } finally {
    await ctx.cleanup();
  }
});

test('strict auth remains enforced when MOLAN_LOCAL_OPEN_ACCESS is disabled or PUBLIC_MODE=1', async () => {
  for (const env of [
    { MOLAN_PUBLIC_MODE: '0', MOLAN_LOCAL_OPEN_ACCESS: '0' },
    { MOLAN_PUBLIC_MODE: '1', MOLAN_LOCAL_OPEN_ACCESS: '1' }
  ]) {
    const ctx = await loadServerWithEnv(env);
    try {
      const syncBody = await (await fetch(`${ctx.baseUrl}/api/local-sync/status`)).json();
      assert.equal(syncBody.localOpenAccess, false);

      const sessionRes = await fetch(`${ctx.baseUrl}/api/auth/local-session`, { method: 'POST', body: '{}' });
      assert.equal(sessionRes.status, 404);

      const modelsBody = await (await fetch(`${ctx.baseUrl}/api/models`)).json();
      assert.equal(modelsBody.access.canChooseModel, false);
      assert.equal(modelsBody.access.role, 'guest');

      assert.equal((await fetch(`${ctx.baseUrl}/api/auth/me`)).status, 401);
      assert.equal((await fetch(`${ctx.baseUrl}/api/admin/auth/me`)).status, 401);
      assert.equal((await fetch(`${ctx.baseUrl}/api/metrics`)).status, 403);
      assert.equal((await fetch(`${ctx.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [] })
      })).status, 401);

      assert.equal(ctx.mod.canChooseModel({ email: 'reader@example.com', role: 'normal' }), false);
    } finally {
      await ctx.cleanup();
    }
  }
});
