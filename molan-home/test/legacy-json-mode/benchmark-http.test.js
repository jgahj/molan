const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

/** 只使用回环模拟供应商，验证真实HTTP主链路，不消耗外部推理额度。 */
test('本地生成HTTP管线具备用量、审稿、幂等和失败边界', async () => {
  const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
  let upstreamCalls = 0;
  const upstreamMessages = [];
  const text = Array.from({ length: 30 }, (_, index) => `第${index}号码头的货箱标着编号${index + 20}，搬运工对照清单核实器物，然后把这批货物登记到第${index + 50}页账册。`).join('\n');
  const mock = http.createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw);
    upstreamMessages.push(body.messages);
    upstreamCalls++;
    const audit = { issues: [], coverage: Object.fromEntries(['state', 'knowledge', 'payoff', 'relation', 'reasoning', 'redundancy', 'continuity'].map(dimension => [dimension, 'checked'])), stageChange: '清点交付货物', summary: '模拟审稿结果，非真人评审', factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] }, stateDelta: { timeline: [], relations: [], characters: [], world: [] }, outlineImpact: { status: 'unplanned', addressed: [], deferred: [] } };
    const output = JSON.stringify(body.messages).includes('证据驱动的小说审稿人') ? JSON.stringify(audit) : text;
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 800, total_tokens: 1300 } }) + '\n\ndata: [DONE]\n\n');
  });
  const upstreamPort = await listen(mock);
  // 本测试的 Provider 固定为本地 HTTP mock；公网 HTTPS 与 SSRF 规则由 provider-url-guard 单测覆盖。
  const providerUrlGuard = require('../lib/provider-url-guard');
  const originalValidateProviderTarget = providerUrlGuard.validateProviderTarget;
  providerUrlGuard.validateProviderTarget = async value => {
    const url = new URL(value);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(Number(url.port), upstreamPort);
    return {
      url,
      hostname: '127.0.0.1',
      port: upstreamPort,
      addresses: [{ address: '127.0.0.1', family: 4 }],
      lookup: (_hostname, _options, callback) => callback(null, '127.0.0.1', 4)
    };
  };
  const https = require('node:https');
  const originalHttpsRequest = https.request;
  https.request = function (options, ...args) {
    if (options && options.hostname === '127.0.0.1' && Number(options.port) === upstreamPort) {
      return http.request(options, ...args);
    }
    return originalHttpsRequest.call(this, options, ...args);
  };
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise(resolve => probe.close(resolve));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-benchmark-http-'));
  const envKeys = ['PORT', 'MOLAN_HOST', 'MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_LOCAL_ONLY',
    'MOLAN_PUBLIC_MODE', 'MOLAN_REQUIRE_SQLITE', 'MOLAN_APP_STORE'];
  const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  process.env.PORT = String(port);
  process.env.MOLAN_HOST = '127.0.0.1';
  process.env.MOLAN_DATA_DIR = directory;
  process.env.MOLAN_CONFIG_DIR = directory;
  process.env.MOLAN_LOCAL_ONLY = '1';
  process.env.MOLAN_PUBLIC_MODE = '0';
  process.env.MOLAN_REQUIRE_SQLITE = '0';
  process.env.MOLAN_APP_STORE = 'json';
  fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify({ platformModels: [{ id: 'benchmark-mock', provider: 'openai-compat', model: 'benchmark-mock', baseURL: 'http://127.0.0.1:' + upstreamPort + '/v1', apiKey: 'local-test-placeholder', creditsPer1k: 0.1, contextWindowTokens: 64000 }], modelPolicy: { defaultModel: 'benchmark-mock' } }));
  const app = require('../server');
  const repository = app.appRepository();
  const creationRepository = new (require('../lib/repositories/json-creation-repository').JsonCreationRepository)(repository);
  const token = crypto.randomBytes(32).toString('hex');
  const email = 'benchmark-http-test@example.com';
  const user = await repository.saveAccount({ email, role: 'normal', level: 'normal', plan: 'normal', credits: 100, spent: 0, createdAt: new Date().toISOString() }, 0);
  await repository.createAuthSession({ userId: user.userId, tokenHash: app.hashSessionToken(token), scope: 'client', expiresAt: Date.now() + 60000 });
  const novel = await repository.create({ user, id: 'n_benchmarkHttp', title: '基准测试小说', state: { title: '基准测试小说', volumes: [] } });
  await creationRepository.create({ projectId: novel.id, userId: user.userId, bookId: 'test_book', title: '基准测试小说',
    payload: { genre: '都市高武', taskConstraints: { chapterWordTarget: text.replace(/\s/g, '').length } }, plan: { budgetLimit: 100 } });
  const bookScope = { projectId: novel.id, userId: user.userId, bookId: 'test_book' };
  const setBudgetLimit = budgetLimit => creationRepository.repository.transaction([novel.id], tx => {
    const { row: book } = creationRepository.book(tx, bookScope, true);
    tx.put(novel.id, 'novels', { ...book, budgetLimit, updatedAt: Date.now() }, book.revision);
  });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + port;
  const post = body => fetch(base + '/api/benchmark/generate', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const capabilities = await (await fetch(base + '/api/benchmark/capabilities')).json();
    assert.equal(capabilities.localStorage, true);
    assert.equal(capabilities.cloudProxy, false);
    const body = { requestId: 'http-test-request', prompt: '原创测试章节', genre: '都市高武', modelId: 'benchmark-mock', targetWords: text.replace(/\s/g, '').length };
    const response = await post(body);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.audit.status, 'passed', JSON.stringify(result.audit));
    assert.equal(result.status, 'passed');
    assert.equal(result.text, text);
    assert.equal(result.usage.complete, true);
    assert.deepEqual(require('../lib/benchmark-experiments').generationEvidence(result, body), []);
    assert.ok(result.calls.every(call => call.parameters.maxTokens > 0 && call.parameters.seed === null));
    assert.ok(upstreamMessages.every(messages => !JSON.stringify(messages).includes('最高指示（默认禁止')));
    assert.equal(result.humanReviewStatus, 'pending');
    const count = upstreamCalls;
    const repeated = await (await post(body)).json();
    assert.equal(repeated.text, text);
    assert.equal(upstreamCalls, count);
    assert.equal((await post({ ...body, prompt: 'changed' })).status, 409);
    assert.equal((await post({ ...body, requestId: '../unsafe' })).status, 400);
    assert.equal((await fetch(base + '/api/benchmark/generate', { method: 'POST' })).status, 401);
    const creationPost = (action, payload) => fetch(base + '/api/creation-books/test_book/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const contentHash = crypto.createHash('sha256').update(text).digest('hex');
    let commitBody = { content: text, contentHash, chapterNo: 1, baseStateVersion: 0, auditStatus: 'passed', actualCost: result.usage.creditCost + 1000 };
    assert.equal((await creationPost('commit', commitBody)).status, 409);
    const audited = await (await creationPost('audit', { content: text, generationRequestId: body.requestId, chapterNo: 1, genre: body.genre, modelId: body.modelId, contract: { goal: '清点货物', protagonistAction: '核对清单', opposition: '编号易混', informationChange: '确认登记页', irreversibleResult: '货物交付' } })).json();
    assert.equal(audited.audit.passed, true, JSON.stringify(audited.audit));
    assert.equal(audited.audit.contentHash, contentHash);
    assert.equal(audited.audit.draftCostNotIncluded, false);
    assert.equal(audited.audit.draftCost, result.usage.creditCost);
    commitBody = { ...commitBody, bibleVersion: audited.audit.bibleVersion, stateVersion: audited.audit.stateVersion,
      planHash: audited.audit.planHash, contextHash: audited.audit.contextHash, deltaHash: audited.audit.deltaHash };
    assert.equal((await creationRepository.snapshots({ projectId: novel.id, userId: user.userId, bookId: 'test_book' })).length, 0);
    const bible = await creationRepository.readBible({ projectId: novel.id, userId: user.userId, bookId: 'test_book' });
    await creationRepository.saveBibleCAS({ projectId: novel.id, userId: user.userId, bookId: 'test_book',
      expectedVersion: bible.version, payload: bible.payload, changeSummary: 'CAS stale-audit fixture' });
    assert.equal((await creationPost('commit', commitBody)).status, 409);
    const reaudited = await (await creationPost('audit', { content: text, generationRequestId: body.requestId, chapterNo: 1, genre: body.genre, modelId: body.modelId, contract: { goal: '清点货物', protagonistAction: '核对清单', opposition: '编号易混', informationChange: '确认登记页', irreversibleResult: '货物交付' } })).json();
    assert.equal(reaudited.audit.bibleVersion, 2);
    commitBody = { ...commitBody, bibleVersion: reaudited.audit.bibleVersion, stateVersion: reaudited.audit.stateVersion,
      planHash: reaudited.audit.planHash, contextHash: reaudited.audit.contextHash, deltaHash: reaudited.audit.deltaHash };
    await repository.saveCAS({ userId: user.userId, projectId: novel.id, state: novel.state, expectedRevision: 0 });
    assert.equal((await creationPost('commit', commitBody)).status, 409);
    const finalAudit = await (await creationPost('audit', { content: text, generationRequestId: body.requestId, chapterNo: 1, genre: body.genre, modelId: body.modelId, contract: { goal: '清点货物', protagonistAction: '核对清单', opposition: '编号易混', informationChange: '确认登记页', irreversibleResult: '货物交付' } })).json();
    assert.equal(finalAudit.audit.projectRevision, 1);
    commitBody = { ...commitBody, bibleVersion: finalAudit.audit.bibleVersion, stateVersion: finalAudit.audit.stateVersion,
      planHash: finalAudit.audit.planHash, contextHash: finalAudit.audit.contextHash, deltaHash: finalAudit.audit.deltaHash };
    const chapterCost = result.usage.creditCost + finalAudit.usage.creditCost;
    assert.ok(result.usage.creditCost > 0 && finalAudit.usage.creditCost > 0);
    const previousOnNovelChanged = repository.onNovelChanged;
    repository.onNovelChanged = () => { throw new Error('Injected novel change hook failure'); };
    try { assert.ok((await creationPost('commit', commitBody)).status >= 400); }
    finally { repository.onNovelChanged = previousOnNovelChanged; }
    assert.equal((await creationRepository.snapshots(bookScope)).length, 0);
    assert.equal((await repository.listResources({ userId: user.userId, projectId: novel.id, kind: 'manuscript' })).length, 0);
    assert.equal((await creationRepository.read(bookScope)).currentStateVersion, 0);
    assert.equal((await repository.read({ userId: user.userId, projectId: novel.id })).revision, 1);
    assert.equal(await repository.repository.ledger.get(novel.id, 'creation-commit-receipt:test_book:1'), null);
    assert.equal(await repository.repository.ledger.get(novel.id, 'creation-debt-outbox:snap_test_book_1_1'), null);
    await setBudgetLimit(chapterCost / 2);
    assert.equal((await creationPost('commit', commitBody)).status, 402);
    assert.equal((await creationRepository.snapshots(bookScope)).length, 0);
    assert.equal((await creationRepository.read(bookScope)).currentStateVersion, 0);
    assert.equal((await repository.read({ userId: user.userId, projectId: novel.id })).revision, 1);
    assert.equal(await repository.repository.ledger.get(novel.id, 'creation-commit-receipt:test_book:1'), null);
    await setBudgetLimit(100);
    const committed = await (await creationPost('commit', commitBody)).json();
    assert.equal(committed.ok, true, JSON.stringify(committed));
    assert.equal(committed.spentCost, chapterCost);
    assert.equal(committed.debtStatus.status, 'pending');
    const retry = await (await creationPost('commit', commitBody)).json();
    assert.equal(retry.replayed, true);
    assert.equal(retry.snapshotId, committed.snapshotId);
    assert.equal(retry.spentCost, committed.spentCost);
    assert.equal((await creationRepository.snapshots({ projectId: novel.id, userId: user.userId, bookId: 'test_book' })).length, 1);
    const committedBook = await creationRepository.read({ projectId: novel.id, userId: user.userId, bookId: 'test_book' });
    assert.equal(committedBook.currentStateVersion, 1);
    assert.equal(committedBook.currentChapterNo, 1);
    assert.equal(committedBook.spentCost, committed.spentCost);
    const manuscript = (await repository.listResources({ userId: user.userId, projectId: novel.id, kind: 'manuscript' }))[0];
    assert.equal(manuscript.payload.text, text);
    assert.equal(manuscript.payload.hash, contentHash);
    const committedNovel = await repository.read({ userId: user.userId, projectId: novel.id });
    assert.equal(committedNovel.revision, committed.projectRevision);
    assert.equal(committedNovel.state.projectResources.find(resource => resource.kind === 'manuscript').payload.text, text);
    assert.equal((await creationPost('commit', { ...commitBody, content: text + '手改' })).status, 409);
    const publicChat = await fetch(base + '/api/chat', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'x-molan-internal-model-route': 'untrusted' }, body: JSON.stringify({ model: body.modelId, benchmarkProtocol: 'benchmark-local-v2', stage: 'single', messages: [{ role: 'user', content: '写货物清点场景' }] }) });
    assert.equal(publicChat.status, 200);
    const publicResult = require('../lib/molan-node-client').parseChatStream(await publicChat.text());
    assert.equal(publicResult.usage.skillAudit.correctionPolicy.version, require('../correction-policy').UNIVERSAL_CORRECTION_POLICY_VERSION);
  } finally {
    providerUrlGuard.validateProviderTarget = originalValidateProviderTarget;
    https.request = originalHttpsRequest;
    app.server.closeAllConnections();
    mock.closeAllConnections();
    await Promise.all([new Promise(resolve => app.server.close(resolve)), new Promise(resolve => mock.close(resolve))]);
    await app.closeStorageStores();
    await repository.close();
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
