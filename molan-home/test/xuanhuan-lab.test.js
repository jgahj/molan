'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const quality = require('../lib/xuanhuan-quality');
const { createLab, publicJob, validateVote, METHODS } = require('../lib/xuanhuan-lab');
const { tasks, sequenceTasks } = require('../lib/xuanhuan-tasks');

function fixtureCorpus() {
  const text = '这是自动化测试专用参考文本，求助者没有银子，管事不愿交易。'.repeat(60);
  const holdouts = Array.from({ length: 6 }, (_, index) => ({
    id: index === 0 ? 'holdout' : `holdout-${index + 1}`,
    bookId: `holdout-book-${index + 1}`,
    title: `留出书${index + 1}`,
    chapter: '第一章',
    author: `乙${index + 1}`,
    split: 'holdout',
    text: `留出书${index + 1}中的独特测试证据。`.repeat(100),
    functions: ['求助与交易'],
    techniques: ['不得被检索']
  }));
  return { version: quality.VERSION, splitPolicy: 'test-author-split', books: [{ title: '测试书', split: 'reference' }, ...holdouts.map(scene => ({ title: scene.title, split: 'holdout' }))], scenes: [{ id: 'reference', bookId: 'reference-book', author: '甲', split: 'reference', text, functions: ['求助与交易'], techniques: ['通过付款选择表现取舍'] }, ...holdouts] };
}

function scores(value = 3) {
  return Object.fromEntries(quality.DIMENSIONS.map(dimension => [dimension, value]));
}

function vote(winner = 'A') {
  return { winner, scores: Object.fromEntries(['A', 'B', 'C', 'D'].map(label => [label, scores()])), reason: '自动化测试评分，不是真人评价' };
}

function harness(context, model, corpusValue = fixtureCorpus()) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'xh-test-'));
  fs.mkdirSync(path.join(directory, 'xuanhuan-lab'));
  if (corpusValue !== null) fs.writeFileSync(path.join(directory, 'xuanhuan-lab', 'corpus.json'), JSON.stringify(corpusValue));
  let owner = 'test@example.com';
  let calls = 0;
  const lab = createLab({ dataDir: directory, wait: async () => {}, getAuthUser: () => owner ? { token: 'test-only-secret', user: { email: owner } } : null, readBody: async request => request.body || {}, json: (response, status, body) => ({ status, body }), callModel: async (auth, options) => {
    calls += 1;
    if (model) return model(options, calls);
    if (options.system.includes('比较两份')) return { text: '{}', json: { winner: 'A', evidenceA: '甲稿有效原句', evidenceB: '乙稿有效原句' } };
    if (options.system.includes('阅读体验')) return { text: '{}', json: { scores: scores(), issues: [], summary: '测试' } };
    if (options.system.includes('三本账')) return { text: '{}', json: { worldFacts: ['测试分支事实'], characterKnowledge: [], readerPromises: [] } };
    if (options.jsonMode) return { text: '{}', json: { beats: [{ goal: '测试目标', change: '测试变化' }], techniques: [] } };
    return { text: '仅供自动化测试的原创输出段落。'.repeat(80), usage: { totalTokens: 10 } };
  } });
  context.after(() => { lab.close(); const resolved = fs.realpathSync(directory); assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true }); });
  return { lab, directory, owner: value => { owner = value; }, calls: () => calls, request: (route, body, method) => lab.handle({ url: '/api/xuanhuan-lab' + route, method: method || (body ? 'POST' : 'GET'), body }, {}) };
}

async function completed(harness, id) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await harness.request('/jobs/' + id);
    if (result.body.status !== 'running') return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('测试任务未结束');
}

test('章节解析覆盖中文章名、数字顿号和无分隔符章名', () => {
  const body = '正文测试。'.repeat(200);
  for (const title of ['第一章 试验', '1、归零', '001觉醒']) assert.equal(quality.chapterRanges(title + '\n' + body).length, 1);
});

test('检索绝不返回留出作品并按作者去重', () => {
  const corpus = fixtureCorpus();
  corpus.scenes.push({ ...corpus.scenes[0], id: 'same-author' });
  const result = quality.retrieve(corpus, '没有银子，求管事帮忙交易');
  assert.equal(result.length, 1);
  assert.equal(result[0].split, 'reference');
  assert.ok(!quality.techniqueBlock(result).includes('留出书'));
});

test('引用证据必须存在于正文，评分越界不能伪装为正常审核', () => {
  const result = quality.normalizeReview({ scores: scores(), issues: [{ evidence: '正文中没有这句话' }, { evidence: '原稿确实存在的句子', reason: '测试' }] }, '原稿确实存在的句子。');
  assert.equal(result.issues.length, 1);
  assert.equal(result.rejectedEvidence, 1);
  assert.throws(() => quality.normalizeReview({ scores: scores(9), issues: [] }, '测试'));
});

test('重合门禁识别来源36字符连续复用，并明确覆盖范围', () => {
  const text = '甲乙丙丁天地山川日月星河风雨江海云雾草木春夏秋冬东西南北金银铜铁石土沙尘';
  const result = quality.deterministicChecks(text, 50, [{ id: 'source', text }]);
  assert.equal(result.passed, false);
  assert.equal(result.originalityCoverage, 'indexed-scenes-only');
});

test('来源语料缺失或为空时，重合检查必须返回未完成而非通过', () => {
  const text = '这是足够长的测试正文，用来确认没有可用原文语料时不能被当作原创检查通过，而且文本长度必须达到重合扫描要求。';
  const missing = quality.deterministicChecks(text, 50, []);
  assert.equal(missing.available, false);
  assert.equal(missing.passed, false);
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.reason, 'source_corpus_unavailable');
  assert.throws(() => quality.sourceOverlapIssues(text, []), { code: 'SOURCE_CORPUS_UNAVAILABLE' });
  const tooShort = quality.deterministicChecks('短正文', 50, [{ id: 'source', text }]);
  assert.equal(tooShort.passed, false);
  assert.equal(tooShort.status, 'incomplete');
  assert.equal(tooShort.reason, 'source_text_too_short');
  assert.throws(() => quality.sourceOverlapIssues('短正文', [{ id: 'source', text }]), { code: 'SOURCE_TEXT_TOO_SHORT' });
});

test('测试集包含30个不同任务和10个连续章节', () => {
  assert.equal(tasks.length, 30);
  assert.equal(new Set(tasks.map(item => item.prompt)).size, 30);
  assert.equal(sequenceTasks.length, 10);
});

test('盲测序列化不泄露方案、模型、原文来源或私有错误', () => {
  const item = { id: 'test', order: METHODS, outputs: Object.fromEntries(METHODS.map(method => [method, { text: '稿件', sourceIds: ['private-source'], checks: {} }])) };
  const job = { id: 'job', modelId: 'private-model', judgeModelId: 'private-judge', privateError: 'secret-error', cases: [item], votes: {}, usage: ['private-usage'] };
  const json = JSON.stringify(publicJob(job));
  for (const secret of ['private-model', 'private-source', 'private-judge', 'secret-error', 'private-usage', 'baseline', 'revised']) assert.ok(!json.includes(secret));
  assert.equal(publicJob(job, true).revealed, false);
  job.votes.test = vote();
  assert.equal(publicJob(job, true).cases[0].candidates[0].method, 'baseline');
});

test('评分必须填完六维四稿，支持平局与都不满意', () => {
  assert.equal(validateVote(vote('tie')).winner, 'tie');
  assert.equal(validateVote(vote('neither')).winner, 'neither');
  assert.throws(() => validateVote({ winner: 'A', scores: {} }));
});

test('真实任务状态机持久化、评分锁定、揭晓与偏好导出', async context => {
  const host = harness(context);
  const created = await host.request('/jobs', { count: 1, targetLength: 800, modelId: 'test-model' });
  assert.equal(created.status, 202);
  const id = created.body.id;
  const done = await completed(host, id);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.cases[0].candidates.length, 4);
  assert.equal((await host.request('/jobs/' + id + '/reveal')).status, 409);
  const submitted = await host.request('/jobs/' + id + '/vote', { caseId: done.body.cases[0].id, ...vote() });
  assert.equal(submitted.body.canReveal, true);
  assert.equal((await host.request('/jobs/' + id + '/vote', { caseId: done.body.cases[0].id, ...vote() })).status, 400);
  const exported = await host.request('/jobs/' + id + '/export');
  assert.equal(exported.body.preferencePairs.length, 0);
  assert.equal(exported.body.revealed, true);
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(path.join(host.directory, 'xuanhuan-lab', 'blind.db'), { readOnly: true });
  const payload = database.prepare('SELECT payload FROM jobs').get().payload;
  database.close();
  assert.ok(!payload.includes('test-only-secret'));
});

test('账号隔离及未登录请求拒绝', async context => {
  const host = harness(context);
  const created = await host.request('/jobs', { count: 1, modelId: 'test-model' });
  await completed(host, created.body.id);
  host.owner('other@example.com');
  assert.equal((await host.request('/jobs/' + created.body.id)).status, 404);
  host.owner(null);
  assert.equal((await host.request('/status')).status, 401);
});

test('模型中断后可恢复且不重生成已保存阶段', async context => {
  let failed = false;
  const host = harness(context, async options => {
    if (!failed && options.unitId.includes(':lean:')) { failed = true; throw new Error('模拟断线'); }
    if (options.system.includes('阅读体验')) return { text: '{}', json: { scores: scores(), issues: [] } };
    if (options.jsonMode) return { text: '{}', json: { beats: [{ goal: 'test' }] } };
    return { text: '自动化恢复测试的占位正文。'.repeat(100) };
  });
  const created = await host.request('/jobs', { count: 1, modelId: 'test-model' });
  const id = created.body.id;
  assert.equal((await completed(host, id)).body.status, 'interrupted');
  const before = host.calls();
  await host.request('/jobs/' + id + '/resume', {});
  assert.equal((await completed(host, id)).body.status, 'completed');
  assert.equal(host.calls() - before, 4);
});

test('三题小样本跨场景功能抽样，不全部抽到同一类', async context => {
  const host = harness(context);
  const created = await host.request('/jobs', { count: 3, modelId: 'test-model' });
  const done = await completed(host, created.body.id);
  assert.equal(new Set(done.body.cases.map(item => item.title.split(' ')[0])).size, 3);
});

test('连续十章的A/B标签固定、各分支账本独立落盘', async context => {
  const host = harness(context);
  const created = await host.request('/jobs', { kind: 'serial', modelId: 'test-model', targetLength: 800 });
  const done = await completed(host, created.body.id);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.completed, 10);
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(path.join(host.directory, 'xuanhuan-lab', 'blind.db'), { readOnly: true });
  const job = JSON.parse(database.prepare('SELECT payload FROM jobs').get().payload);
  database.close();
  for (const item of job.cases) { assert.deepEqual(item.order, job.cases[0].order); for (const method of METHODS) assert.ok(item.outputs[method].ledger); }
});

test('双位置裁判意见不一致时保留平局', async context => {
  const host = harness(context, async options => {
    const normal = options.userPrompt.indexOf('稿A：甲稿') >= 0;
    return { text: '{}', json: { winner: 'A', evidenceA: normal ? '甲稿有效原句' : '乙稿有效原句', evidenceB: normal ? '乙稿有效原句' : '甲稿有效原句' } };
  });
  const result = await host.request('/compare', { a: '甲稿有效原句'.repeat(15), b: '乙稿有效原句'.repeat(15) });
  assert.equal(result.body.winner, 'tie');
});

test('跨云端会话通过真实账户接口验证而非信任客户端邮箱', async context => {
  const http = require('node:http');
  const { authenticateCloud } = require('../lib/xuanhuan-lab');
  const server = http.createServer((request, response) => {
    assert.equal(request.url, '/api/auth/me');
    if (request.headers.authorization !== 'Bearer test-cloud-token') { response.writeHead(401); response.end('{}'); return; }
    response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ user: { email: 'verified@example.com' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = await authenticateCloud({ headers: { authorization: 'Bearer test-cloud-token' } }, base);
  assert.equal(auth.user.email, 'verified@example.com');
  assert.equal(await authenticateCloud({ headers: { authorization: 'Bearer wrong-token' } }, base), null);
  assert.equal(await authenticateCloud({ headers: {} }, base), null);
});

test('留出参照评分独立保存，全部完成前隐藏来源', async context => {
  const host = harness(context);
  const before = await host.request('/benchmarks');
  assert.equal(before.body.samples.length, 6);
  assert.equal(before.body.samples[0].id, 'holdout');
  assert.equal(before.body.finished, false);
  const saved = await host.request('/benchmarks/vote', { id: 'holdout', scores: scores() });
  assert.equal(saved.body.finished, false);
  assert.equal((await host.request('/benchmarks/vote', { id: 'holdout', scores: scores() })).status, 400);
  let latest = saved.body;
  for (const sample of before.body.samples.slice(1)) latest = (await host.request('/benchmarks/vote', { id: sample.id, scores: scores() })).body;
  assert.equal(latest.finished, true);
});

test('缺失玄幻语料时状态与检查明确返回未完成，不能创建或误报完成的盲测', async context => {
  const host = harness(context, null, null);
  const status = await host.request('/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.corpus, null);
  assert.equal(status.body.corpusStatus.available, false);
  const inspection = await host.request('/inspect', { text: '足够长的待检查正文'.repeat(20) });
  assert.equal(inspection.status, 200);
  assert.equal(inspection.body.passed, false);
  assert.equal(inspection.body.status, 'incomplete');
  const benchmarks = await host.request('/benchmarks');
  assert.equal(benchmarks.body.finished, false);
  assert.equal(benchmarks.body.samples.length, 0);
  const create = await host.request('/jobs', { count: 1, modelId: 'test-model' });
  assert.equal(create.status, 503);
});

test('留出样本不足六本时，即使全部评分也不标记基准完成', async context => {
  const corpus = fixtureCorpus();
  corpus.books = corpus.books.slice(0, 2);
  corpus.scenes = corpus.scenes.filter(scene => scene.split === 'reference' || scene.id === 'holdout');
  const host = harness(context, null, corpus);
  const before = await host.request('/benchmarks');
  assert.equal(before.body.status, 'incomplete');
  assert.equal(before.body.availableSamples, 1);
  assert.equal(before.body.finished, false);
  const after = await host.request('/benchmarks/vote', { id: 'holdout', scores: scores() });
  assert.equal(after.body.finished, false);
  assert.match(after.body.message, /需要6本/);
});

test('正文与来源的36字重合在索引步长各偏移均被识别', () => {
  const base = Array.from({ length: 160 }, (_, index) => String.fromCharCode(0x4e00 + index)).join('');
  const scenes = [{ id: 'unique', text: base }];
  for (let offset = 0; offset < 24; offset += 1) assert.equal(quality.sourceOverlapIssues('前缀' + base.slice(offset, offset + 36) + '后缀', scenes).length, 1);
});

test('尚在生成时已完成题的评分不会被后台保存覆盖', async context => {
  let resume;
  const pause = new Promise(resolve => { resume = resolve; });
  const host = harness(context, async options => {
    if (options.unitId.startsWith('xh-21:')) await pause;
    if (options.system.includes('阅读体验')) return { text: '{}', json: { scores: scores(), issues: [] } };
    if (options.jsonMode) return { text: '{}', json: { beats: [{ goal: 'test' }] } };
    return { text: '后台评分合并专用的测试正文。'.repeat(100) };
  });
  const created = await host.request('/jobs', { count: 3, modelId: 'test-model' });
  const id = created.body.id;
  let partial;
  for (let attempt = 0; attempt < 50; attempt += 1) { partial = await host.request('/jobs/' + id); if (partial.body.cases.length) break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(partial.body.status, 'running');
  const caseId = partial.body.cases[0].id;
  assert.equal((await host.request('/jobs/' + id + '/vote', { caseId, ...vote() })).status, 200);
  resume();
  const done = await completed(host, id);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.voted, 1);
  assert.ok(done.body.cases.find(item => item.id === caseId).vote);
});

test('模型评审结构错误不落入永久复用的失败缓存', async context => {
  let failed = false;
  const host = harness(context, async options => {
    if (options.system.includes('阅读体验')) { if (!failed) { failed = true; return { text: '{}', json: { scores: {}, issues: [] } }; } return { text: '{}', json: { scores: scores(), issues: [] } }; }
    if (options.jsonMode) return { text: '{}', json: { beats: [{ goal: 'test' }] } };
    return { text: '缓存验证专用的测试正文。'.repeat(100) };
  });
  const created = await host.request('/jobs', { count: 1, modelId: 'test-model' });
  const id = created.body.id;
  assert.equal((await completed(host, id)).body.status, 'interrupted');
  await host.request('/jobs/' + id + '/resume', {});
  assert.equal((await completed(host, id)).body.status, 'completed');
});

test('短期限流等待后继续且每次尝试计入预算', async context => {
  const host = harness(context, async (options, calls) => {
    if (calls === 1) throw new Error('当前 AI 并发较高，请稍后再试');
    if (options.system.includes('阅读体验')) return { text: '{}', json: { scores: scores(), issues: [] } };
    if (options.jsonMode) return { text: '{}', json: { beats: [{ goal: 'test' }] } };
    return { text: '限流重试专用的自动化正文。'.repeat(100) };
  });
  const created = await host.request('/jobs', { count: 1, modelId: 'test-model' });
  const done = await completed(host, created.body.id);
  assert.equal(done.body.status, 'completed');
  assert.equal(done.body.callCount, 6);
});

test('持续限流最多尝试四次，不无限重发', async context => {
  const host = harness(context, async () => { throw new Error('当前 AI 并发较高，请稍后再试'); });
  const created = await host.request('/jobs', { count: 1, modelId: 'test-model' });
  const done = await completed(host, created.body.id);
  assert.equal(done.body.status, 'interrupted');
  assert.equal(done.body.callCount, 4);
});

test('正文检查覆盖留出场景但不调用模型或向检索泄漏留出文本', async context => {
  const host = harness(context);
  const text = fixtureCorpus().scenes[1].text;
  const result = await host.request('/inspect', { text });
  assert.equal(result.body.passed, false);
  assert.equal(host.calls(), 0);
  assert.equal((await host.request('/inspect', { text: '' })).status, 400);
});

test('支持指定双书精读叙事路线，在规划与起草注入路线机理，揭晓前保持盲态', async context => {
  let capturedSystems = [];
  const host = harness(context, async (options, callIndex) => {
    capturedSystems.push(options.system || '');
    if (options.system.includes('阅读体验')) return { text: '{}', json: { scores: scores(), issues: [], summary: '测试' } };
    if (options.jsonMode) return { text: '{}', json: { beats: [{ goal: '测试目标', change: '测试变化' }], techniques: [] } };
    return { text: '仅供自动化测试的原创输出段落。'.repeat(80), usage: { totalTokens: 10 } };
  });
  const created = await host.request('/jobs', { count: 1, modelId: 'test-model', narrativeRoute: 'jianzhu' });
  const done = await completed(host, created.body.id);
  assert.equal(done.body.status, 'completed');
  // 盲态下不暴露 narrativeRoute
  assert.equal(done.body.narrativeRoute, undefined);
  // 生成过程中应注入剑烛大荒路线的叙事机理
  assert.ok(capturedSystems.some(s => s.includes('剑烛大荒') && s.includes('对白即博弈与人情')));
  // 全部打分后揭晓，返回 narrativeRoute
  const voted = await host.request(`/jobs/${created.body.id}/vote`, { caseId: done.body.cases[0].id, ...vote('A') });
  assert.equal(voted.status, 200);
  const revealed = await host.request(`/jobs/${created.body.id}/reveal`);
  assert.equal(revealed.body.revealed, true);
  assert.equal(revealed.body.narrativeRoute, 'jianzhu');
});
