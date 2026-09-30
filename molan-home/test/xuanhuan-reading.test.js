'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { BOOKS, parseBook, validateNotes, validateReading, validateReview, citationRepairProblems, applyCitationRepairs, createReadingLab } = require('../lib/xuanhuan-reading');

const manuscript = '\r\r\n------------\r\r\n第一章 起因\r\r\n    第一段人物要过河却没有船。\r\r\n    第二段守桥人拒绝借出钥匙。\r\r\n第二章 后果\r\r\n    第三段人物绕路发现桥已断。\r\r\n    第四段他不再相信昨日的承诺。\r\r\n第三章 变化\r\r\n    第五段守桥人拿出了修桥的图。\r\r\n    第六段二人决定先向村民求助。\r\r\n第四章 尚未阅读\r\r\n    这里的未来事实不得进入前三章。';
function notes(paragraphs) { return { summary: '测试专用笔记：人物行动改变了处境，仍有待确认的问题。', claims: Array.from({ length: 6 }, (_, index) => ({ id: `claim-${index}`, kind: index % 2 ? 'inference' : 'fact', topic: '人物行动', statement: '仅供测试的具体判断', evidence: paragraphs.filter((_, offset) => offset === 0 || offset === paragraphs.length - 1).map(paragraph => ({ paragraphId: paragraph.id, quote: paragraph.text })), reasoning: '测试证据关系', alternative: '仍需后文验证', application: '迁移方法而非专名', limits: '依赖人物当前知识' })) }; }
function model(options) {
  const paragraphs = [...options.userPrompt.matchAll(/^\[([^\]]+)\] ([^\n]+)$/gm)].map(match => ({ id: match[1], text: match[2] }));
  if (options.unitId.endsWith(':review')) { const source = JSON.parse(options.userPrompt.split('待复核笔记：')[1].split('\n本章完整原文：')[0]); return { json: { checks: source.claims.map(claim => ({ claimId: claim.id, verdict: 'supported', reason: '已逐条比对测试原文' })), notes: source }, usage: { totalTokens: 100, creditCost: 0 } }; }
  const value = notes(paragraphs);
  if (options.unitId.includes(':read:')) value.coveredParagraphIds = paragraphs.map(paragraph => paragraph.id);
  return { json: value, usage: { totalTokens: 100, creditCost: 0 } };
}
function harness(context, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-reading-test-'));
  for (const book of BOOKS) fs.writeFileSync(path.join(directory, book.filename), manuscript);
  let owner = 'reader@example.com', calls = 0, lab;
  const deps = { dataDir: directory, sourceDirectory: directory, getAuthUser: async () => owner ? { token: 'test-token-not-real', user: { email: owner } } : null, readBody: async req => req.body, json: (res, status, body) => ({ status, body }), preflight: async () => ({ model: { id: 'test-model', contextWindowTokens: 131072 }, estimate: { modelId: 'test-model', estimatedCredits: 0 } }), callModel: async (auth, options) => { calls += 1; return overrides.model ? overrides.model(options, calls) : model(options); }, ...overrides.deps };
  lab = createReadingLab(deps);
  const instance = { directory, calls: () => calls, owner: value => { owner = value; }, request: (route, body) => lab.handle({ url: '/api/xuanhuan-reading' + route, method: body ? 'POST' : 'GET', body }, {}), restart: async mutate => {
    await lab.close();
    if (mutate) {
      const storage = new (require('../lib/repositories/json-file-repository').JsonFileRepository)(path.join(directory, 'lab-jobs-json'));
      try { await mutate(new (require('../lib/repositories/json-lab-job-repository').JsonLabJobRepository)(storage)); } finally { await storage.close(); }
    }
    lab = createReadingLab(deps);
  } };
  context.after(async () => { await lab.close(); const resolved = fs.realpathSync(directory); assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir()) + path.sep)); fs.rmSync(resolved, { recursive: true, force: true }); });
  return instance;
}
const consent = { modelId: 'test-model', consent: true, maxCalls: 38, maxCredits: 0, chapterCount: 3 };
test('旧 reading.db 明确拒绝，不创建新空仓储', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reading-legacy-'));
  try {
    fs.mkdirSync(path.join(directory, 'xuanhuan-lab'));
    fs.writeFileSync(path.join(directory, 'xuanhuan-lab/reading.db'), 'legacy');
    assert.throws(() => createReadingLab({ dataDir: directory }), error => error.code === 'LEGACY_READING_STORE_PRESENT');
    assert.equal(fs.existsSync(path.join(directory, 'lab-jobs-json')), false);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
async function settled(instance, id) { for (let attempt = 0; attempt < 300; attempt += 1) { const response = await instance.request('/jobs/' + id); if (!['running', 'queued'].includes(response.body.status)) return response.body; await new Promise(resolve => setTimeout(resolve, 5)); } throw new Error('Test job did not settle'); }

test('章节解析完整保留正文，准确定位双CRLF和缩进，不读取后文', () => {
  const parsed = parseBook(Buffer.from(manuscript), BOOKS[0]);
  assert.equal(parsed.chapters.length, 3); assert.equal(parsed.totalChapters, 4);
  for (const chapter of parsed.chapters) { assert.deepEqual(chapter.segments.flat(), chapter.paragraphs.map(paragraph => paragraph.id)); for (const paragraph of chapter.paragraphs) assert.equal(manuscript.slice(paragraph.start, paragraph.end), paragraph.text); }
  assert.ok(!JSON.stringify(parsed.chapters).includes('未来事实'));
});
test('宣传不作序章，未知前言必须人工确认，短章节不得静默丢弃', () => {
  const prefix = '欢迎收藏\n作者大大正努力存稿中，喜欢的宝宝先收藏回家，一起期待后续呀～\n';
  assert.match(parseBook(Buffer.from(prefix + manuscript), BOOKS[0]).excludedPreamble, /宣传/);
  assert.throws(() => parseBook(Buffer.from('真正的故事序言\n' + manuscript), BOOKS[0]), /人工确认/);
  assert.throws(() => parseBook(Buffer.from('第一章\n很短'), BOOKS[0]), /不足/);
});
test('序章纳入顺序阅读，长章按连续段落切分且无重复遗漏', () => {
  const text = '序章\n' + '这是一个完整而连续的原文段落。'.repeat(400) + '\n' + '另一段正文具有后续的因果联系。'.repeat(400) + '\n' + manuscript;
  const parsed = parseBook(Buffer.from(text), BOOKS[0]); assert.equal(parsed.chapters[0].title, '序章'); assert.equal(parsed.chapters[0].segments.length, 2);
  assert.deepEqual(parsed.chapters[0].segments.flat(), parsed.chapters[0].paragraphs.map(paragraph => paragraph.id));
  assert.throws(() => parseBook(Buffer.from('序章\n' + '字'.repeat(9001) + manuscript), BOOKS[0]), /单段过长/);
});
test('笔记必须有准确证据、事实推断分层、完整覆盖回执', () => {
  const paragraphs = parseBook(Buffer.from(manuscript), BOOKS[0]).chapters[0].paragraphs;
  const value = notes(paragraphs); validateNotes(value, paragraphs);
  assert.throws(() => validateReading(value, paragraphs), /覆盖/);
  value.coveredParagraphIds = paragraphs.map(paragraph => paragraph.id); validateReading(value, paragraphs);
  value.claims[0].evidence[0].quote = '原文不存在的伪造引文'; assert.throws(() => validateNotes(value, paragraphs), /证据/);
});
test('作者附言保留位置但不作为正文，短对白只能补充长证据', () => {
  const text = manuscript.replace('第二章 后果', 'PS：更新说明\n不是故事的宣传内容\n第二章 后果');
  const parsed = parseBook(Buffer.from(text), BOOKS[0]); assert.equal(parsed.chapters[0].excludedAppendix.length, 2); assert.equal(parsed.chapters[0].paragraphs.length, 2);
  const paragraphs = parsed.chapters[0].paragraphs, value = notes(paragraphs);
  value.claims[0].evidence.push({ paragraphId: paragraphs[0].id, quote: '没有船' }); validateNotes(value, paragraphs);
  value.claims[0].evidence = [{ paragraphId: paragraphs[0].id, quote: '没有船。' }]; assert.throws(() => validateNotes(value, paragraphs), /支撑引文/);
});
test('复核不能遗漏判断，不确定结论不能仍作为事实', () => {
  const paragraphs = parseBook(Buffer.from(manuscript), BOOKS[0]).chapters[0].paragraphs; const value = notes(paragraphs);
  const review = { checks: value.claims.map(claim => ({ claimId: claim.id, verdict: 'supported', reason: '比对原文' })), notes: value }; validateReview(review, value, paragraphs);
  review.checks[0].verdict = 'uncertain'; assert.throws(() => validateReview(review, value, paragraphs), /不确定/);
  review.checks.pop(); assert.throws(() => validateReview(review, value, paragraphs), /逐条/);
});
test('只允许同章唯一逐字引文纠正段号，不跨章、不模糊匹配且保留原标号', () => {
  const paragraphs = parseBook(Buffer.from(manuscript), BOOKS[0]).chapters[0].paragraphs;
  const value = notes(paragraphs); value.claims[0].evidence[0].paragraphId = paragraphs[1].id;
  validateNotes(value, paragraphs); assert.equal(value.claims[0].evidence[0].paragraphId, paragraphs[0].id); assert.equal(value.claims[0].evidence[0].reportedParagraphId, paragraphs[1].id);
  const forged = notes(paragraphs); forged.claims[0].evidence[0].quote += '伪造'; assert.throws(() => validateNotes(forged, paragraphs), /证据/);
  const otherChapter = notes(paragraphs); otherChapter.claims[0].evidence[0].paragraphId = 'yuanshi-c2-p1'; assert.throws(() => validateNotes(otherChapter, paragraphs), /证据/);
  const ambiguous = notes(paragraphs); ambiguous.claims[0].evidence[0].paragraphId = paragraphs[1].id; assert.throws(() => validateNotes(ambiguous, [...paragraphs, { ...paragraphs[0], id: 'yuanshi-c1-p3' }]), /证据/);
});
test('20次顺序调用完成六章及两次复盘；两书上下文隔离；重复启动不重复生成', async context => {
  const instance = harness(context, { model: options => { if (options.unitId.startsWith('yuanshi')) assert.ok(!options.userPrompt.includes('jianzhu-')); else assert.ok(!options.userPrompt.includes('yuanshi-')); return model(options); } });
  const response = await instance.request('/jobs', consent); assert.equal(response.status, 202);
  const job = await settled(instance, response.body.id); assert.equal(job.status, 'completed', job.error); assert.equal(job.completedChapters, 6); assert.equal(job.callCount, 20); assert.equal(job.usage.length, 20); assert.ok(job.books.every(book => book.retrospective));
  assert.equal(job.awaitingExpansionApproval, true); assert.equal(job.sourceVersionValid, true); assert.ok(!JSON.stringify(job).includes('test-token-not-real'));
  const repeated = await instance.request('/jobs', consent); assert.equal(repeated.body.id, job.id); assert.equal(instance.calls(), 20);
});
test('未登录、跨账户、扩展30章和缺失预算均不能执行', async context => {
  const instance = harness(context); instance.owner(null); assert.equal((await instance.request('/status')).status, 401); instance.owner('reader@example.com');
  assert.equal((await instance.request('/jobs', { ...consent, chapterCount: 30 })).status, 400); assert.equal((await instance.request('/jobs', { ...consent, consent: false })).status, 400);
  const response = await instance.request('/jobs', consent); const job = await settled(instance, response.body.id); instance.owner('another@example.com'); assert.equal((await instance.request('/jobs/' + job.id)).status, 404);
});
test('未知计费或上下文不足时零模型调用', async context => {
  const instance = harness(context, { deps: { preflight: async () => ({ model: { id: 'test-model', contextWindowTokens: 131072 }, estimate: {} }) } });
  assert.equal((await instance.request('/jobs', consent)).status, 400); assert.equal(instance.calls(), 0);
  const short = harness(context, { deps: { preflight: async () => ({ model: { id: 'test-model', contextWindowTokens: 32768 }, estimate: { modelId: 'test-model', estimatedCredits: 0 } }) } });
  assert.equal((await short.request('/jobs', consent)).status, 400); assert.equal(short.calls(), 0);
});
test('无效输出不缓存为完成；失败用量保留；恢复复用已完成阶段', async context => {
  const instance = harness(context, { model: (options, calls) => calls === 2 ? { json: {}, usage: { totalTokens: 77, creditCost: 0 } } : model(options) });
  const response = await instance.request('/jobs', consent); let job = await settled(instance, response.body.id); assert.equal(job.status, 'interrupted'); assert.equal(job.callCount, 11); assert.equal(job.usage.length, 11); assert.equal(job.completedChapters, 3); assert.deepEqual(job.attempts[1].rejectedResponse, {});
  await instance.restart(); await instance.request('/jobs/' + job.id + '/resume', {}); job = await settled(instance, job.id); assert.equal(job.status, 'completed', job.error); assert.equal(job.callCount, 21);
});
test('原文变更使历史笔记标记失效并阻止恢复', async context => {
  const instance = harness(context, { model: () => { throw new Error('模拟网络中断'); } }); const response = await instance.request('/jobs', consent); const job = await settled(instance, response.body.id);
  fs.appendFileSync(path.join(instance.directory, BOOKS[0].filename), '\n变化'); assert.equal((await instance.request('/jobs/' + job.id)).body.sourceVersionValid, false); assert.equal((await instance.request('/jobs/' + job.id + '/resume', {})).status, 409); assert.equal(instance.calls(), 2);
});
test('并发启动互斥，取消保存返回用量但不标记完成', async context => {
  const releases = []; let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const instance = harness(context, { model: async options => { entered(); await new Promise(resolve => { releases.push(resolve); }); return model(options); } });
  const response = await instance.request('/jobs', consent); await started;
  assert.equal((await instance.request('/jobs', consent)).status, 409); await instance.request('/jobs/' + response.body.id + '/cancel', {}); releases.forEach(resolve => resolve()); const job = await settled(instance, response.body.id); assert.equal(job.status, 'cancelled'); assert.equal(job.completedChapters, 0); assert.equal(job.usage.length, 2);
});
test('失败尝试计入38次硬上限，耗尽后恢复不再调用', async context => {
  const instance = harness(context, { model: () => { throw new Error('429 测试中断'); } }); const response = await instance.request('/jobs', consent); let job = await settled(instance, response.body.id);
  for (let attempt = 1; attempt < 38; attempt += 1) { await instance.request('/jobs/' + job.id + '/resume', {}); job = await settled(instance, job.id); }
  assert.equal(job.callCount, 38); assert.equal((await instance.request('/jobs/' + job.id + '/resume', {})).status, 400); assert.equal(instance.calls(), 38);
});
test('服务重启标记在途尝试为中断，不伪造扣费或完成状态', async context => {
  const instance = harness(context); const response = await instance.request('/jobs', consent); const job = await settled(instance, response.body.id);
  await instance.restart(async repository => {
    const row = await repository.load({ owner: 'reader@example.com', kind: 'reading', id: job.id });
    row.job.status = 'running'; row.job.attempts[0].status = 'running';
    await repository.save({ owner: row.job.owner, kind: 'reading', job: row.job, expectedRevision: row.revision });
  });
  const restored = (await instance.request('/jobs/' + job.id)).body;
  assert.equal(restored.status, 'needs_review'); assert.equal(restored.attempts[0].status, 'provider_unknown'); assert.deepEqual(restored.runningStages, []); assert.equal(restored.usage.length, 20); assert.equal(instance.calls(), 20);
  assert.equal((await instance.request('/jobs/' + job.id + '/resume', {})).status, 409);
});
test('当前积分预估超过授权上限时不发起模型调用', async context => {
  const instance = harness(context, { deps: { preflight: async () => ({ model: { id: 'test-model', contextWindowTokens: 131072 }, estimate: { modelId: 'test-model', estimatedCredits: 100 } }) } });
  const response = await instance.request('/jobs', consent); assert.equal(response.status, 400); assert.match(response.body.error, /预算/); assert.equal(instance.calls(), 0);
});
test('引文之外的摘要或推理乱码也不能冒充有效精读', () => {
  const paragraphs = parseBook(Buffer.from(manuscript), BOOKS[0]).chapters[0].paragraphs; const value = notes(paragraphs);
  value.claims[0].reasoning = '推理中出现损坏字符\uFFFD'; assert.throws(() => validateNotes(value, paragraphs), /Unicode/);
});
test('引用局部修复不改写判断或其他证据，保存旧引文，拒绝不支持与伪造引文', () => {
  const paragraphs = parseBook(Buffer.from(manuscript), BOOKS[0]).chapters[0].paragraphs; const original = notes(paragraphs);
  original.claims[0].evidence[0].quote = '被误记的原句'; const problems = citationRepairProblems(original, paragraphs); assert.equal(problems.length, 1);
  const response = { repairs: [{ claimId: original.claims[0].id, evidenceIndex: 0, paragraphId: paragraphs[0].id, supported: true, quote: paragraphs[0].text, reason: '原文确实写了没有船' }] };
  const repaired = applyCitationRepairs(original, response, problems, 9); validateNotes(repaired, paragraphs);
  assert.equal(repaired.claims[0].statement, original.claims[0].statement); assert.deepEqual(repaired.claims[1], original.claims[1]); assert.equal(original.claims[0].evidence[0].quote, '被误记的原句'); assert.equal(repaired.claims[0].evidence[0].quoteRepair.attempt, 9);
  response.repairs[0].supported = false; assert.throws(() => applyCitationRepairs(original, response, problems, 10), /不足以支持/);
  response.repairs[0].supported = true; response.repairs[0].quote = '继续捏造引文'; assert.throws(() => applyCitationRepairs(original, response, problems, 10), /原文连续/);
});
test('作者提到第六章写了什么不应误认成新章标题', () => {
  const text = manuscript.replace('第二章 后果', '第六章写了的，这里只是讨论文字。\n第二章 后果');
  const parsed = parseBook(Buffer.from(text), BOOKS[0]); assert.equal(parsed.totalChapters, 4); assert.ok(parsed.chapters[0].paragraphs.some(paragraph => paragraph.text.startsWith('第六章写了的')));
});
test('真实阶段调度在引用失败后只做受限修复，修复调用仍计入总预算', async context => {
  let damaged = false;
  const instance = harness(context, { model: options => {
    if (options.system.includes('原文引用核查编辑')) { const problems = JSON.parse(options.userPrompt.split('保留所有编号：\n')[1]); return { json: { repairs: problems.map(problem => ({ claimId: problem.claimId, evidenceIndex: problem.evidenceIndex, paragraphId: problem.paragraphId, supported: true, quote: problem.originalParagraph, reason: '测试原段落支持对应判断' })) }, usage: { totalTokens: 30, creditCost: 0 } }; }
    const output = model(options); if (!damaged && options.unitId === 'yuanshi-c1:read:0') { damaged = true; output.json.claims[0].evidence[0].quote = '误写的引文'; } return output;
  } });
  const response = await instance.request('/jobs', consent); let job = await settled(instance, response.body.id); assert.equal(job.status, 'interrupted');
  await instance.request('/jobs/' + job.id + '/resume', {}); job = await settled(instance, job.id); assert.equal(job.status, 'completed', job.error); assert.equal(job.callCount, 21); assert.equal(job.attempts.filter(attempt => attempt.mode === 'citation-repair').length, 1);
});

test('精读完成后可解除只读限制并激活双路线创作，且提供完整叙事路线定义', async context => {
  const instance = harness(context);
  const routesRes = await instance.request('/narrative-routes');
  assert.equal(routesRes.status, 200);
  assert.ok(routesRes.body.routes.yuanshi);
  assert.ok(routesRes.body.routes.jianzhu);
  assert.ok(routesRes.body.routes.yuanshi.corePrinciples.length >= 3);
  assert.ok(routesRes.body.routes.jianzhu.corePrinciples.length >= 3);

  const response = await instance.request('/jobs', consent);
  const job = await settled(instance, response.body.id);
  assert.equal(job.status, 'completed');
  assert.equal(job.awaitingExpansionApproval, true);

  const activateRes = await instance.request('/jobs/' + job.id + '/activate', {});
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.body.job.activated, true);
  assert.equal(activateRes.body.job.awaitingExpansionApproval, false);
});
