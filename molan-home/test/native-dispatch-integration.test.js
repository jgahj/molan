'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { JsonAppRepository } = require('../lib/repositories/json-app-repository');
const { buildUsageSummary } = require('../server');

test('native dispatch integration: link-novel routing, durable dispatch attempt wiring, and startup recovery', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'molan-native-dispatch-'));
  let child = null;
  let serverBase = '';
  let upstreamCalls = [];

  const mockUpstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      upstreamCalls.push({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '你好，我是模拟本地模型。' } }] }) + '\n\n');
      res.write('data: ' + JSON.stringify({
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
      }) + '\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });

  await new Promise(resolve => mockUpstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = mockUpstream.address().port;
  const upstreamUrl = `http://127.0.0.1:${upstreamPort}/chat/completions`;

  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    deepseekApiKey: 'mock-test-key',
    platformModels: [{
      id: 'deepseek-v4-flash',
      name: 'DeepSeek V4',
      group: 'deepseek',
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      supportsThinking: true,
      creditsPer1k: 0.5
    }],
    modelPolicy: { defaultModel: 'deepseek-v4-flash' }
  }), 'utf8');

  async function startServer() {
    child = spawn(process.execPath, [path.resolve(__dirname, '../server.js')], {
      env: {
        ...process.env,
        MOLAN_DATA_DIR: directory,
        MOLAN_APP_STORE: 'json',
        PORT: '0',
        HOST: '127.0.0.1',
        NODE_ENV: 'test',
        DEEPSEEK_URL: upstreamUrl,
        DEEPSEEK_API_KEY: 'mock-test-key',
        MOLAN_ALLOW_LOCAL_MODELS: '1'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server startup timeout: ' + output)), 15000);
      child.on('exit', code => {
        clearTimeout(timer);
        reject(new Error('Server exited with code ' + code + ': ' + output));
      });
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) {
          serverBase = match[0];
          clearTimeout(timer);
          resolve();
        }
      });
      child.stderr.on('data', data => { output += data; });
    });
  }

  async function stopServer() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await exited;
    child = null;
  }

  async function request(method, urlPath, body, token) {
    const response = await fetch(serverBase + urlPath, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    return { status: response.status, data };
  }

  t.after(async () => {
    await stopServer();
    await new Promise(resolve => mockUpstream.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });

  await startServer();

  // 1. 用户注册与凭证获取
  const reg = await request('POST', '/api/auth/register', {
    email: 'dispatch-test@example.test',
    password: 'password-12345'
  });
  assert.equal(reg.status, 200);
  const token = reg.data.token;
  assert.ok(token);

  // 2. 创建目标小说项目
  const novel = await request('POST', '/api/novels', {
    id: 'n_target1',
    state: { title: '派发接线验证作品', volumes: [] }
  }, token);
  assert.equal(novel.status, 200);
  assert.equal(novel.data.id, 'n_target1');

  // 3. 创建独立创作书
  const book = await request('POST', '/api/creation-books', {
    creationBookId: 'cb_dispatch1',
    title: '独立书未关联',
    bible: {
      bookPremise: { title: '派发接线测试' },
      characters: [
        { name: '林原', function: '主角' },
        { name: '苏清', function: '女主' },
        { name: '黑影', function: '反派' }
      ],
      map: {
        nodes: [
          { name: '青云门' },
          { name: '黑风林' },
          { name: '无尽海' }
        ]
      },
      goldenFinger: { type: '系统面板' },
      worldRules: [{ rule: '因果自洽' }]
    }
  }, token);
  assert.equal(book.status, 200);
  assert.equal(book.data.book.id, 'cb_dispatch1');
  assert.equal(book.data.book.projectId, undefined);

  // 4. 验证真实 HTTP POST /api/creation-books/:id/link-novel
  const linkRes = await request('POST', '/api/creation-books/cb_dispatch1/link-novel', {
    novelId: 'n_target1'
  }, token);
  assert.equal(linkRes.status, 200);
  assert.equal(linkRes.data.ok, true);
  assert.equal(linkRes.data.idempotent, false);
  assert.equal(linkRes.data.book.id, 'cb_dispatch1');
  assert.equal(linkRes.data.book.projectId, 'n_target1');

  // 5. 验证同项目重链幂等
  const relinkRes = await request('POST', '/api/creation-books/cb_dispatch1/link-novel', {
    novelId: 'n_target1'
  }, token);
  assert.equal(relinkRes.status, 200);
  assert.equal(relinkRes.data.ok, true);
  assert.equal(relinkRes.data.idempotent, true);

  // 6. 验证不支持路径严格阻断（不扩大 allowlist）
  const unsupportedAction = await request('POST', '/api/creation-books/cb_dispatch1/plan-expand', {}, token);
  assert.equal(unsupportedAction.status, 503);
  assert.equal(unsupportedAction.data.code, 'NATIVE_DOMAIN_UNAVAILABLE');

  const unsupportedCoreJobs = await request('POST', '/api/creation-books/core-jobs', {}, token);
  assert.equal(unsupportedCoreJobs.status, 503);
  assert.equal(unsupportedCoreJobs.data.code, 'NATIVE_DOMAIN_UNAVAILABLE');

  // 7. 测试真实持久派发接线：调用 /api/chat，验证派发尝试被写入且上游成功响应
  upstreamCalls = [];
  const chatResponse = await fetch(serverBase + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '测试派发接线' }]
    })
  });
  assert.equal(chatResponse.status, 200);
  const chatText = await chatResponse.text();
  assert.ok(chatText.includes('你好，我是模拟本地模型。'));
  assert.equal(upstreamCalls.length, 1);

  // 8. 停止服务，获取本地仓储锁后检查用量与持久派发记录
  await stopServer();

  let testUserId = '';
  const activeOtherRequestId = 'req_active_other_instance_1';
  const appRepo = new JsonAppRepository(path.join(directory, 'app-json'));
  try {
    const accounts = await appRepo.listAccounts();
    const testAccount = accounts.find(a => a.email === 'dispatch-test@example.test');
    assert.ok(testAccount);
    testUserId = testAccount.userId;
    const usages = await appRepo.summarizeTokenUsage({ userId: testUserId });
    assert.ok(usages.length > 0);
    const lastUsage = usages[0];
    assert.equal(lastUsage.kind, 'usage-settlement');

    const genRow = await appRepo.lookupTokenUsage({ userId: testUserId, requestId: lastUsage.requestId });
    assert.ok(genRow);
    assert.equal(genRow.status, 'settled');
    assert.equal(genRow.dispatched, true);
    assert.ok(Array.isArray(genRow.attempts));
    assert.ok(genRow.attempts.length >= 1);
    assert.equal(genRow.attempts[0].pass, 1);
    assert.equal(genRow.attempts[0].stage, 'single_pass');

    // 9. 模拟进程中断 / 服务重启：构造一个处于 dispatched 状态的悬挂用量
    const orphanRequestId = 'req_interrupted_test_1';
    await appRepo.reserveTokenUsage({
      userId: testUserId,
      requestId: orphanRequestId,
      reservedCost: 2
    });
    await appRepo.recordDispatchAttempt({
      userId: testUserId,
      requestId: orphanRequestId,
      pass: 1,
      stage: 'single_pass'
    });

    await appRepo.reserveTokenUsage({
      userId: testUserId,
      requestId: activeOtherRequestId,
      reservedCost: 2
    });
    await appRepo.recordDispatchAttempt({
      userId: testUserId,
      requestId: activeOtherRequestId,
      pass: 1,
      stage: 'single_pass'
    });

    const scope = `__molan_usage_${crypto.createHash('sha256').update(String(testUserId)).digest('hex')}`;
    await appRepo.repository.transaction([scope], tx => {
      const orphanRow = tx.get(scope, 'generation', `reservation:${orphanRequestId}`);
      tx.put(scope, 'generation', {
        ...orphanRow,
        updatedAt: Date.now() - 600000,
        leaseUntil: Date.now() - 600000
      }, orphanRow.revision);

      const activeOtherRow = tx.get(scope, 'generation', `reservation:${activeOtherRequestId}`);
      tx.put(scope, 'generation', {
        ...activeOtherRow,
        instanceId: 'remote-worker-instance',
        updatedAt: Date.now() - 600000,
        leaseUntil: Date.now() + 600000
      }, activeOtherRow.revision);
    });

    const beforeRestart = await appRepo.lookupTokenUsage({
      userId: testUserId,
      requestId: orphanRequestId
    });
    assert.ok(beforeRestart);
    assert.equal(beforeRestart.dispatched, true);
  } finally {
    await appRepo.close();
  }

  // 10. 重启服务，验证启动时 recoverInterruptedUsage 在流量与 reaper 之前执行
  await startServer();

  // 11. 调用 HTTP GET /api/usage?limit=20 验证委托后的 buildUsageSummary 口径
  const usageQuery = await request('GET', '/api/usage?limit=20', null, token);
  assert.equal(usageQuery.status, 200);
  assert.ok(usageQuery.data.ok);
  const summary = usageQuery.data.usage;

  // preciseRequestCount 绝不计入未知 / partial 用量
  assert.equal(summary.preciseRequestCount, 1);
  assert.ok(summary.usageUnavailableCount >= 1);
  // actualCost 不得伪造为 0，未知项的 creditCost 保持 null
  const unknownRecent = summary.recent.find(r => r.requestId === 'req_interrupted_test_1');
  assert.ok(unknownRecent);
  assert.equal(unknownRecent.creditCost, null);
  assert.equal(unknownRecent.status, 'provider_unknown');

  // 12. 停止服务后验证已恢复记录及 reaper 行为
  await stopServer();
  const reloadedRepo = new JsonAppRepository(path.join(directory, 'app-json'));
  try {
    const recoveredUsage = await reloadedRepo.lookupTokenUsage({
      userId: testUserId,
      requestId: 'req_interrupted_test_1'
    });
    assert.equal(recoveredUsage.status, 'provider_unknown');
    assert.ok(recoveredUsage.actualCost === undefined || recoveredUsage.actualCost === null);
    const usageRows = await reloadedRepo.summarizeTokenUsage({ userId: testUserId });
    const pendingLedger = usageRows.find(r => r.requestId === 'req_interrupted_test_1');
    assert.ok(pendingLedger);
    assert.equal(pendingLedger.actualCost, null);
    assert.equal(pendingLedger.usage.billingStatus, 'pending');

    // 验证 reaper 不会错误退款 provider_unknown 状态的记录
    const released = await reloadedRepo.releaseStaleTokenUsage({ before: Date.now() + 100000 });
    assert.equal(released.released, 0);

    const activeOtherUsage = await reloadedRepo.lookupTokenUsage({
      userId: testUserId,
      requestId: activeOtherRequestId
    });
    assert.ok(activeOtherUsage);
    assert.equal(activeOtherUsage.status, 'dispatched');
    assert.equal(activeOtherUsage.dispatched, true);
    assert.equal(activeOtherUsage.reservedCost, 2);
    assert.ok(Number(activeOtherUsage.leaseUntil) > Date.now());
  } finally {
    await reloadedRepo.close();
  }
});

test('buildUsageSummary unit: delegates to native-billing-service, preserves aggregate param and excludes partials from precise count', () => {
  const directSummary = buildUsageSummary([
    { promptTokens: 100, completionTokens: 50, totalTokens: 150, status: 'succeeded' },
    { promptTokens: 30, completionTokens: 10, totalTokens: 40, providerUsageIncomplete: true, status: 'aborted' },
    { promptTokens: 50, completionTokens: 0, totalTokens: 50, status: 'provider_unknown', billingStatus: 'pending' },
    { promptTokens: null, completionTokens: null, totalTokens: null, status: 'usage_unavailable' }
  ]);

  assert.equal(directSummary.requestCount, 4);
  assert.equal(directSummary.preciseRequestCount, 1);
  assert.equal(directSummary.usageUnavailableCount, 3);
  assert.equal(directSummary.totalTokens, 240);

  const aggregateSummary = buildUsageSummary(
    [{ totalTokens: 500, promptTokens: 300, completionTokens: 200 }],
    { requestCount: 10, preciseRequestCount: 8, usageUnavailableCount: 2 }
  );
  assert.equal(aggregateSummary.requestCount, 10);
  assert.equal(aggregateSummary.preciseRequestCount, 8);
  assert.equal(aggregateSummary.usageUnavailableCount, 2);
  assert.equal(aggregateSummary.totalTokens, 500);
});
