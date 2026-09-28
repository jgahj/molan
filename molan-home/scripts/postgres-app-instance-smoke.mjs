import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

function acceptanceDatabase() {
  const url = String(process.env.MOLAN_PG_URL || '').trim();
  if (url) {
    try { return decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch (_) {}
  }
  return String(process.env.MOLAN_PG_DATABASE || '').trim();
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function startApp(port, dataDirectory) {
  const child = spawn(process.execPath, ['--experimental-sqlite', '--no-warnings', path.join(root, 'server.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      MOLAN_HOST: '127.0.0.1',
      MOLAN_DATA_DIR: dataDirectory,
      MOLAN_CONFIG_DIR: dataDirectory,
      MOLAN_PUBLIC_MODE: '0',
      MOLAN_LOCAL_ONLY: '1',
      MOLAN_REQUIRE_SQLITE: '0',
      MOLAN_DB_BACKEND: 'postgres'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = { stdout: '', stderr: '' };
  child.stdout.on('data', chunk => { output.stdout = (output.stdout + chunk.toString()).slice(-3000); });
  child.stderr.on('data', chunk => { output.stderr = (output.stderr + chunk.toString()).slice(-3000); });
  return { child, port, baseUrl: `http://127.0.0.1:${port}`, output };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForHealth(app) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (app.child.exitCode !== null) break;
    try {
      const response = await fetch(`${app.baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      const body = await response.json();
      if (response.ok && body.ok && body.postgres && body.postgres.available) return body;
    } catch (_) {}
    await delay(250);
  }
  throw new Error(`HTTP 实例未就绪 (${app.port})：${app.output.stderr || app.output.stdout}`);
}

async function requestJson(app, pathname, { method = 'GET', token = '', body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${app.baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000)
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = text; }
  return { status: response.status, payload };
}

async function waitForStatus(app, pathname, token, status) {
  const deadline = Date.now() + 5000;
  let result;
  while (Date.now() < deadline) {
    result = await requestJson(app, pathname, { token });
    if (result.status === status) return result;
    await delay(150);
  }
  throw new Error(`${pathname} 未在时限内返回 HTTP ${status}，最后状态为 ${result && result.status}`);
}

async function stopApp(app) {
  if (!app || app.child.exitCode !== null || app.child.signalCode !== null) return true;
  const closed = new Promise(resolve => app.child.once('close', () => resolve(true)));
  app.child.kill('SIGTERM');
  const stopped = await Promise.race([closed, delay(8000).then(() => false)]);
  if (stopped) return true;
  app.child.kill();
  return Promise.race([closed, delay(3000).then(() => false)]);
}

async function main() {
  const database = acceptanceDatabase();
  if (!/(?:acceptance|test)/i.test(database)) {
    throw new Error('拒绝启动：请将 MOLAN_PG_DATABASE 或 MOLAN_PG_URL 指向名称含 acceptance/test 的隔离库。');
  }

  const firstPort = await freePort();
  let secondPort = await freePort();
  while (secondPort === firstPort) secondPort = await freePort();
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-app-instances-'));
  fs.writeFileSync(path.join(dataDirectory, 'users.json'), '[]', 'utf8');
  fs.writeFileSync(path.join(dataDirectory, 'config.json'), JSON.stringify({
    platformModels: [{ id: 'local-test-model', model: 'local-test-model', provider: 'openai-compat', baseURL: 'http://127.0.0.1:1/v1' }],
    modelPolicy: { defaultModel: 'local-test-model' }
  }), 'utf8');

  let first = null;
  let second = null;
  const checks = [];
  try {
    first = startApp(firstPort, dataDirectory);
    await waitForHealth(first);
    second = startApp(secondPort, dataDirectory);
    await waitForHealth(second);
    checks.push('two-independent-http-app-processes-ready-on-postgres');

    const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    const email = `pg-ha-${suffix}@example.com`;
    const password = crypto.randomBytes(18).toString('base64url');
    const registered = await requestJson(first, '/api/auth/register', {
      method: 'POST', body: { email, password, name: 'PG多实例验收' }
    });
    if (registered.status !== 200) {
      throw new Error(`instance A registration: ${JSON.stringify(registered.payload)}; stdout=${first.output.stdout}; stderr=${first.output.stderr}`);
    }
    assert.equal(registered.payload && registered.payload.ok, true, `instance A registration response: ${JSON.stringify(registered.payload)}`);
    const tokenA = registered.payload.token;
    assert.ok(tokenA, 'instance A returned a session token');

    const login = await requestJson(second, '/api/auth/login', {
      method: 'POST', body: { email, password }
    });
    assert.equal(login.status, 200, `instance B login against shared account store: ${JSON.stringify(login.payload)}`);
    assert.equal(login.payload && login.payload.ok, true, `instance B login response: ${JSON.stringify(login.payload)}`);
    const tokenB = login.payload.token;
    assert.ok(tokenB, 'instance B returned a session token');
    assert.equal((await requestJson(second, '/api/auth/me', { token: tokenA })).status, 200,
      'session created on A is recognized by B');
    checks.push('cross-instance-login-and-shared-sessions');

    const novelId = `n_pgha${suffix}`;
    const state = { title: 'PG多实例接管作品', volumes: [] };
    const created = await requestJson(first, '/api/novels', {
      method: 'POST', token: tokenA,
      body: { id: novelId, title: state.title, state }
    });
    assert.equal(created.status, 200, 'novel creation status');
    assert.equal(created.payload && created.payload.ok, true, 'novel creation response');
    const crossInstanceRead = await requestJson(second, `/api/novels/${encodeURIComponent(novelId)}`, { token: tokenB });
    assert.equal(crossInstanceRead.status, 200, 'instance B reads PG project created by A');
    assert.equal(crossInstanceRead.payload && crossInstanceRead.payload.novel && crossInstanceRead.payload.novel.state.title, state.title);

    const otherEmail = `pg-ha-other-${suffix}@example.com`;
    const other = await requestJson(second, '/api/auth/register', {
      method: 'POST', body: { email: otherEmail, password, name: '隔离对照' }
    });
    assert.equal(other.status, 200, 'second tenant registration');
    const denied = await requestJson(second, `/api/novels/${encodeURIComponent(novelId)}`, { token: other.payload.token });
    assert.equal(denied.status, 404, 'other tenant cannot read the project through instance B');
    checks.push('cross-instance-project-read-and-tenant-isolation');

    const logout = await requestJson(first, '/api/auth/logout', { method: 'POST', token: tokenA });
    assert.equal(logout.status, 200, 'logout on instance A');
    await waitForStatus(second, '/api/auth/me', tokenA, 401);
    assert.equal((await requestJson(second, '/api/auth/me', { token: tokenB })).status, 200,
      'revoking one session does not revoke a separate active session');
    checks.push('cross-instance-session-revocation');

    assert.equal((await requestJson(second, `/api/novels/${encodeURIComponent(novelId)}`, { token: tokenB })).status, 200);
    assert.equal(await stopApp(first), true, 'instance A stop');
    first = null;
    assert.equal((await requestJson(second, `/api/novels/${encodeURIComponent(novelId)}`, { token: tokenB })).status, 200,
      'instance B serves project after A stops');
    checks.push('single-instance-failover');

    first = startApp(firstPort, dataDirectory);
    await waitForHealth(first);
    await waitForStatus(first, '/api/auth/me', tokenB, 200);
    assert.equal((await requestJson(first, `/api/novels/${encodeURIComponent(novelId)}`, { token: tokenB })).status, 200,
      'restarted instance A restores B session and reads shared project');
    checks.push('restart-session-restoration');

    assert.equal(await stopApp(second), true, 'instance B stop');
    second = null;
    assert.equal((await requestJson(first, `/api/novels/${encodeURIComponent(novelId)}`, { token: tokenB })).status, 200,
      'restarted instance A serves project after B stops');
    checks.push('reverse-failover-after-restart');

    process.stdout.write(JSON.stringify({ ok: true, database, checks }) + '\n');
  } finally {
    const stopped = await Promise.all([stopApp(first), stopApp(second)]);
    if (stopped.every(Boolean)) fs.rmSync(dataDirectory, { recursive: true, force: true });
    else process.stderr.write(`验收进程未全部退出，保留临时数据目录：${dataDirectory}\n`);
  }
}

main().catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, code: 'postgres_app_instance_smoke_failed', error: String(error && error.message || error) }) + '\n');
  process.exitCode = 1;
});
