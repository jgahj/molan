'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

test('真实 PG 主入口禁用 SQLite 驱动后启动、健康检查及重启保持账户与会话', {
  skip: process.env.MOLAN_PG_MAIN_ACCEPTANCE !== '1',
  timeout: 60000
}, async () => {
  assert.match(process.env.MOLAN_PG_DATABASE || '', /test|acceptance/i);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-pg-main-'));
  const modelResult = {
    primary: '男频', secondary: '悬疑', tags: ['寻找账本'],
    overview: { summary: '人物甲在渡口寻找账本。' },
    framework: { mainConflict: '失落账本与渡口线索之间的冲突。' },
    dissectionMap: { mainLine: '寻找账本并辨认渡口线索。' },
    architecture: { structure: '线索出现、调查推进、账本找到。' },
    opening: { hook: '渡口失落的账本引出调查。' },
    goldenFinger: { exists: false, description: '依靠调查技巧，不存在超自然能力。' },
    emotion: { emotionCurve: [{ position: '第一章', intensity: 6, type: '悬念' }] },
    characters: [{ name: '人物甲', goal: '寻找账本', conflict: '渡口线索残缺' }]
  };
  let providerCalls = 0;
  let unknownUsage = false;
  const upstream = http.createServer((req, res) => {
    req.resume();
    req.once('end', () => {
      providerCalls++;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify(modelResult) } }] }) + '\n\n');
      if (!unknownUsage) res.write('data: ' + JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }) + '\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({
    deepseekApiKey: 'synthetic-local-only',
    platformModels: [{
      id: 'deepseek-v4-flash', name: '有限合成模型', group: 'deepseek', provider: 'deepseek',
      model: 'deepseek-v4-flash', supportsThinking: true, creditsPer1k: 0.5
    }],
    modelPolicy: { defaultModel: 'deepseek-v4-flash' }
  }), 'utf8');
  const preload = [
    "import Module from 'node:module';",
    'const load = Module._load;',
    "Module._load = function(name, ...args) { if (/^(?:node:sqlite|sqlite3|better-sqlite3)$|(?:^|\\/)(?:pure-js-database|sqlite-store)(?:\\.js)?$/.test(name)) throw new Error('LEGACY_STORAGE_FORBIDDEN'); return load.call(this, name, ...args); };",
    "process.stdin.setEncoding('utf8');",
    "process.stdin.on('data', command => { if (command.trim() === 'shutdown') { process.stdin.pause(); process.stdin.unref?.(); process.emit('SIGTERM'); } });"
  ].join('\n');
  let running;
  async function start() {
    const reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const child = spawn(process.execPath, [
      '--no-warnings', '--import', 'data:text/javascript,' + encodeURIComponent(preload), 'server.js'
    ], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env, NODE_ENV: 'production', PORT: String(port), HOST: '127.0.0.1',
        MOLAN_DATA_DIR: directory, MOLAN_CONFIG_DIR: directory, MOLAN_LOCAL_ONLY: '1',
        MOLAN_APP_STORE: '', MOLAN_GENERATION_STORE: '', MOLAN_STYLE_STORE: '',
        DEEPSEEK_URL: `http://127.0.0.1:${upstream.address().port}/chat/completions`,
        DEEPSEEK_API_KEY: 'synthetic-local-only', MOLAN_ALLOW_LOCAL_MODELS: '1'
      },
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    let output = '';
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const ready = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.on('data', data => {
        output = (output + data.toString('utf8')).slice(-6000);
        const address = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (address) resolve(`http://127.0.0.1:${address[1]}`);
      });
      child.stderr.on('data', data => { output = (output + data.toString('utf8')).slice(-6000); });
      child.once('exit', code => reject(new Error(`PG main exited before listening: ${code}; ${output.slice(-1200)}`)));
    });
    running = { child, exited };
    const address = await ready;
    return async (route, options = {}) => {
      const response = await fetch(address + route, {
        method: options.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(10000)
      });
      return { status: response.status, body: await response.json() };
    };
  }
  async function stop() {
    running.child.stdin.write('shutdown\n');
    const result = await running.exited;
    running = null;
    assert.equal(result.code, 0);
  }
  try {
    let request = await start();
    const health = await request('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.body.db, 'ready');
    assert.equal(health.body.postgres.available, true);
    const registered = await request('/api/auth/register', {
      method: 'POST',
      body: { email: `main-${crypto.randomBytes(8).toString('hex')}@example.test`, password: crypto.randomBytes(24).toString('hex'), name: '主入口验收' }
    });
    assert.equal(registered.status, 200);
    const token = registered.body.token;
    assert.equal(typeof token, 'string');
    const suffix = crypto.randomBytes(6).toString('hex');
    const novelId = 'n_main' + suffix;
    const novel = await request('/api/novels', {
      method: 'POST', token, body: { id: novelId, state: { title: '主入口作品', volumes: [] } }
    });
    assert.equal(novel.status, 200, JSON.stringify(novel.body));
    const skill = await request('/api/skills/import', {
      method: 'POST', token, body: { name: '主入口技能', instruction: '有限合成指令，不调用模型。' }
    });
    assert.equal(skill.status, 200);
    const dissection = await request('/api/dissections', {
      method: 'POST', token,
      body: { requestId: 'create_' + suffix, text: '第一章 开始\n人物甲在渡口寻找账本。', title: '主入口拆书', run: false }
    });
    assert.equal(dissection.status, 202);
    assert.equal(dissection.body.task.status, 'queued');
    const dissectionId = dissection.body.task.id;
    const capabilities = await request('/api/generation-runs/capabilities', { token });
    assert.equal(capabilities.status, 200);
    assert.equal(capabilities.body.storageMode, 'postgres');
    assert.equal(capabilities.body.pauseResume, true);
    assert.equal(capabilities.body.recovery, true);
    const completed = await request('/api/dissections', {
      method: 'POST', token,
      body: { text: '第一章 渡口\n人物甲在渡口寻找丢失账本。\n第二章 线索\n人物甲沿着脚印找到藏匿账本的石阶。', depth: 'quick', model: 'deepseek-v4-flash' }
    });
    assert.equal(completed.status, 202);
    async function waitForTask(id) {
      for (let attempt = 0; attempt < 100; attempt++) {
        const response = await request('/api/dissections/' + id, { token });
        assert.equal(response.status, 200);
        const task = response.body.task || response.body.dissection || response.body;
        if (['completed', 'failed', 'cancelled', 'needs_review'].includes(task.status)) return task;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('Finite synthetic dissection did not reach a terminal state');
    }
    const finished = await waitForTask(completed.body.task.id);
    assert.equal(finished.status, 'completed', finished.error);
    assert.ok(providerCalls >= 4);
    const callsBeforeUnknown = providerCalls;
    unknownUsage = true;
    const uncertain = await request('/api/dissections', {
      method: 'POST', token,
      body: { text: '第一章 未知用量\n人物乙寻找不同的账本线索。', depth: 'quick', model: 'deepseek-v4-flash' }
    });
    assert.equal(uncertain.status, 202);
    const stopped = await waitForTask(uncertain.body.task.id);
    assert.notEqual(stopped.status, 'completed');
    assert.equal(stopped.actualCredits, null);
    assert.equal(providerCalls - callsBeforeUnknown, 1);
    unknownUsage = false;
    const profile = await request('/api/auth/profile', { method: 'PATCH', token, body: { name: '重启持久化' } });
    assert.equal(profile.status, 200);
    await stop();
    request = await start();
    const me = await request('/api/auth/me', { token });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.name, '重启持久化');
    assert.equal((await request('/api/novels/' + novelId, { token })).status, 200);
    assert.equal((await request('/api/skills', { token })).status, 200);
    assert.equal((await request('/api/dissections/' + dissectionId, { token })).status, 200);
    assert.equal((await request('/api/dissections/' + dissectionId + '/units', { token })).status, 200);
    assert.equal((await request('/api/auth/logout', { method: 'POST', token })).status, 200);
    assert.equal((await request('/api/auth/me', { token })).status, 401);
    await stop();
  } finally {
    if (running) {
      running.child.kill();
      await running.exited;
    }
    await new Promise(resolve => upstream.close(resolve));
  }
});
