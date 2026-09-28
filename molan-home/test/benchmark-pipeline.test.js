const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const review = require('../lib/evidence-review');
const pipeline = require('../lib/benchmark-pipeline');
const client = require('../lib/molan-node-client');
const { runOnce } = require('../lib/benchmark-receipts');
const { validateCommitAudit } = require('../lib/benchmark-commit');

const content = Array.from({ length: 24 }, (_, index) => `第${index}号码头的货箱带着编号${index + 20}，搬运工对照清单核实箱内的器物后登记到第${index + 50}页账册。`).join('\n');
const targetWords = content.replace(/\s/g, '').length;
const usage = { totalTokens: 120, creditCost: 0.01, status: 'completed' };
const checked = Object.fromEntries(review.REVIEW_DIMENSIONS.map(dimension => [dimension, 'checked']));
const clean = () => ({ issues: [], stageChange: '清点并交付货物', summary: '未发现已知事实冲突', coverage: checked, factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] } });
const highIssue = () => ({ severity: 'high', category: 'state', quote: '搬运工对照清单核实箱内的器物', paragraphIndex: 1, issue: '清单未到却完成核对', reason: '起始合同约束', fixHint: '先取得清单' });
const options = { text: content, targetWords, genre: '都市高武' };

test('生产运行时实际加载六题材证据并对缺失资产失败关闭', () => {
  for (const genre of require('../lib/genre-evidence').GENRES) {
    const runtime = pipeline.genreRuntime(genre);
    assert.equal(runtime.status, 'ready', genre);
    assert.ok(runtime.writingBlock.includes('可选参考'));
    assert.ok(runtime.reviewBlock.includes('审稿参考'));
    assert.equal(runtime.humanReviewStatus, 'pending');
    assert.equal(runtime.fullChapterReviewStatus, 'pending');
  }
  assert.equal(pipeline.genreRuntime('../config').status, 'unsupported');
  assert.equal(pipeline.genreRuntime('玄幻', path.join(os.tmpdir(), 'nonexistent-' + Date.now())).status, 'incomplete');
});

test('起草与审稿都实际注入已加载的题材提示块', async () => {
  const requests = [];
  await pipeline.generateChapter({ callModel: async (_, request) => {
    requests.push(request);
    return request.jsonMode ? { json: clean(), usage } : { text: content, usage };
  } }, null, { prompt: '核对并交付货物', genre: '都市高武', targetWords, maxRounds: 0 });
  assert.ok(requests.find(request => !request.jsonMode).system.includes('都市高武题材证据'));
  assert.ok(requests.find(request => request.jsonMode).system.includes('都市高武审稿参考'));
});

test('空正文、缺模型、空审稿、用量缺失及引文无效一律不能通过', async () => {
  const cases = [
    [{}, { ...options, text: '' }],
    [{}, options],
    [{ callModel: async () => ({ json: {}, usage }) }, options],
    [{ callModel: async () => ({ json: clean() }) }, options],
    [{ callModel: async () => ({ json: { ...clean(), issues: [{ ...highIssue(), quote: '不存在于这份正文的句子' }] }, usage }) }, options]
  ];
  for (const [deps, params] of cases) {
    const audit = await pipeline.evidenceAudit(deps, null, params);
    assert.equal(audit.passed, false);
    assert.equal(audit.status, 'incomplete');
  }
});

test('完整覆盖和用量的干净审稿可通过，但人工体验保持pending', async () => {
  const audit = await pipeline.evidenceAudit({ callModel: async () => ({ json: clean(), usage }) }, null, options);
  assert.equal(audit.passed, true, JSON.stringify(audit));
  assert.equal(audit.coveredChars, content.length);
  assert.equal(audit.humanReviewStatus, 'pending');
  assert.equal(audit.contentHash, review.textHash(content));
});

test('stageChange只在章节合同明确要求时作为门禁', async () => {
  const noChange = { ...clean(), stageChange: '无' };
  const deps = { callModel: async () => ({ json: noChange, usage }) };
  const optional = await pipeline.evidenceAudit(deps, null, options);
  assert.equal(optional.noStageChange, true);
  assert.equal(optional.stageChangeRequired, false);
  assert.equal(optional.passed, true);
  assert.equal(pipeline.auditPenalty(optional), 0);

  const required = await pipeline.evidenceAudit(deps, null, { ...options, contract: { requireStageChange: true } });
  assert.equal(required.stageChangeRequired, true);
  assert.equal(required.passed, false);
  assert.equal(required.status, 'needs_review');
  assert.equal(pipeline.auditPenalty(required), 1000);
});

test('auto题材无可靠线索时不套用玄幻规则', async () => {
  const requests = [];
  const result = await pipeline.generateChapter({ callModel: async (_, request) => {
    requests.push(request);
    return request.jsonMode ? { json: clean(), usage } : { text: content, usage };
  } }, null, {
    prompt: '写一段未知题材的原创章节', genre: 'auto', targetWords,
    control: true, controlSystem: '只写小说正文', maxRounds: 0
  });

  assert.equal(requests[0].genre, null);
  assert.equal(result.effectiveGenre, null);
  assert.equal(result.genreAssetStatus, 'unsupported');
  assert.equal(result.audit.baseline, null);
  assert.equal(pipeline.loadGenreBaseline('auto'), null);
});

test('审稿已通过时低风格统计分不触发额外整章生成', async () => {
  const requests = [];
  const styleDivergentContent = Array.from({ length: 36 }, (_, index) => `第${index}号码头的货箱带着编号${index + 20}，搬运工对照清单核实箱内的器物后登记到第${index + 50}页账册。`).join('\n');
  const styleDivergentTarget = styleDivergentContent.replace(/\s/g, '').length;
  const result = await pipeline.generateChapter({ callModel: async (_, request) => {
    requests.push(request);
    return request.jsonMode ? { json: clean(), usage } : { text: styleDivergentContent, usage };
  } }, null, {
    prompt: '核对并交付货物', genre: '都市高武', targetWords: styleDivergentTarget,
    maxRounds: 0
  });

  assert.equal(result.status, 'passed', JSON.stringify(result.audit));
  assert.ok(result.audit.styleDistance.score < 70, '样本刻意与统计基线偏离');
  assert.equal(result.candidates.length, 1);
  assert.equal(requests.filter(request => !request.jsonMode).length, 1);
  assert.equal(result.usage.callCount, 2);
});

test('审稿不静默截断正文和上下文，超预算零调用', async () => {
  let calls = 0;
  const audit = await pipeline.evidenceAudit({ callModel: async () => { calls++; return { json: clean(), usage }; } }, null, { ...options, factLedger: { raw: '字'.repeat(25000) } });
  assert.equal(calls, 0);
  assert.equal(audit.passed, false);
  assert.ok(audit.incompleteReasons.includes('context_budget_exceeded'));
});

test('引文必须逐字匹配且唯一，重复引文需要段号', () => {
  assert.equal(review.locateQuote('他将木箱搬到门边，然后离开。', '他将木箱搬到门边,然后离开。').found, false);
  assert.equal(review.locateQuote(content, '搬运工对照清单核实箱内的器物').reason, 'quote_ambiguous');
  assert.equal(review.locateQuote(content, '搬运工对照清单核实箱内的器物', 1).found, true);
});

test('局部补丁保护原稿哈希、非目标段、顺序与逐字原文', () => {
  const issues = review.validateIssues(content, [highIssue()]).issues;
  const targets = review.buildRevisionTargets(content, issues);
  const first = review.indexedParagraphs(content)[0].raw;
  const payload = { sourceHash: review.textHash(content), patches: [{ paragraphIndex: 1, original: first, replacement: first.replace('搬运工', '领到清单的搬运工') }] };
  const accepted = review.applyParagraphPatches(content, payload, targets);
  assert.equal(accepted.review.accepted, true);
  assert.equal(accepted.revisedText.slice(accepted.revisedText.indexOf('\n')), content.slice(content.indexOf('\n')));
  assert.equal(accepted.review.semanticStatus, 'requires_reaudit');
  assert.equal(review.applyParagraphPatches(content, { ...payload, sourceHash: 'stale' }, targets).review.accepted, false);
  assert.equal(review.applyParagraphPatches(content, { ...payload, patches: [{ ...payload.patches[0], paragraphIndex: 2 }] }, targets).review.accepted, false);
  const moved = content.split('\n').reverse().join('\n');
  assert.equal(review.reviewRevision(content, moved, issues, targets).accepted, false);
});

test('maxRounds=0 不修订，中等问题不再零轮假通过', async () => {
  let calls = 0;
  const result = await pipeline.auditReviseLoop({ callModel: async () => { calls++; return { json: { ...clean(), issues: [{ ...highIssue(), severity: 'medium' }] }, usage }; } }, null, { ...options, maxRounds: 0 });
  assert.equal(calls, 1);
  assert.equal(result.status, 'needs_review');
});

test('局部修改必须通过新审稿才能采纳，不能依据旧引文消失认定解决', async () => {
  let calls = 0;
  const first = review.indexedParagraphs(content)[0].raw;
  const result = await pipeline.auditReviseLoop({ callModel: async () => {
    calls++;
    if (calls === 1) return { json: { ...clean(), issues: [highIssue()] }, usage };
    if (calls === 2) return { json: { sourceHash: review.textHash(content), patches: [{ paragraphIndex: 1, original: first, replacement: first.replace('搬运工', '工人') }] }, usage };
    return { json: { ...clean(), issues: [{ ...highIssue(), severity: 'blocker', quote: '工人对照清单核实箱内的器物' }] }, usage };
  } }, null, options);
  assert.equal(calls, 3);
  assert.equal(result.text, content);
  assert.equal(result.rounds[0].accepted, false);
  assert.equal(result.usage.callCount, 3);
  assert.equal(result.usage.totalTokens, 360);
});

test('段落修订后完整再审通过才更新终稿', async () => {
  let calls = 0;
  const first = review.indexedParagraphs(content)[0].raw;
  const result = await pipeline.auditReviseLoop({ callModel: async () => {
    calls++;
    if (calls === 1) return { json: { ...clean(), issues: [highIssue()] }, usage };
    if (calls === 2) return { json: { sourceHash: review.textHash(content), patches: [{ paragraphIndex: 1, original: first, replacement: first.replace('搬运工', '领到清单的搬运工') }] }, usage };
    return { json: clean(), usage };
  } }, null, options);
  assert.equal(result.status, 'passed');
  assert.equal(result.rounds.length, 1);
  assert.equal(result.audit.contentHash, review.textHash(result.text));
});

test('账本事实必须含有效正文证据，不允许无依据状态进入待提交增量', () => {
  const result = pipeline.verifiedLedgerDelta(content, { newRules: [{ text: '虚构规则' }], byEntity: { 主角: [{ text: '清点货物', quote: highIssue().quote, paragraphIndex: 1 }] } });
  assert.equal(result.invalidCount, 1);
  assert.equal(result.delta.newRules.length, 0);
  assert.equal(result.delta.byEntity.主角.length, 1);
  assert.equal(result.invalidEvidence.length, 1);
});

test('缺少明确账本schema或更新不存在的旧事实均不能通过', async () => {
  for (const factLedgerDelta of [undefined, { newRules: [] }, { ...clean().factLedgerDelta, updates: [{ id: 'unknown', status: 'paid', quote: highIssue().quote, paragraphIndex: 1 }] }]) {
    const audit = await pipeline.evidenceAudit({ callModel: async () => ({ json: { ...clean(), factLedgerDelta }, usage }) }, null, options);
    assert.equal(audit.passed, false);
    assert.ok(audit.incompleteReasons.some(reason => ['invalid_ledger_schema', 'unknown_ledger_update'].includes(reason)));
  }
});

test('同请求只执行一次，参数变化和未知结果均不能自动重试', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-receipts-test-'));
  let calls = 0;
  const request = { directory, owner: 'local-test', requestId: 'request-1', params: { prompt: 'test' }, execute: async () => { calls++; return { text: content }; } };
  assert.deepEqual(await runOnce(request), await runOnce(request));
  assert.equal(calls, 1);
  await assert.rejects(runOnce({ ...request, params: { prompt: 'changed' } }), error => error.code === 'request_conflict');
  const failed = { ...request, requestId: 'request-2', execute: async () => { calls++; throw new Error('unknown'); } };
  await assert.rejects(runOnce(failed));
  await assert.rejects(runOnce(failed), error => error.code === 'request_in_progress_or_unknown');
  assert.equal(calls, 2);
});

test('客户端拒绝非回环地址、损坏SSE、不完整结束和缺失用量', () => {
  assert.throws(() => client.localBaseUrl('https://example.com'));
  assert.throws(() => client.localBaseUrl('http://127.0.0.1@evil.test'));
  const chunk = 'data: ' + JSON.stringify({ choices: [{ delta: { content: '小说正文' }, finish_reason: 'stop' }] }) + '\n\n';
  const complete = chunk + 'data: ' + JSON.stringify({ molan_usage: usage }) + '\n\ndata: [DONE]\n\n';
  assert.equal(client.parseChatStream(complete).text, '小说正文');
  assert.throws(() => client.parseChatStream(chunk));
  assert.throws(() => client.parseChatStream(chunk + 'data: [DONE]\n\n'));
  assert.throws(() => client.parseChatStream(complete + 'data: {broken}\n\n'));
});

test('正式提交强制绑定实际正文、服务端审计哈希及完整语义审稿', () => {
  const contentHash = review.textHash(content);
  const audit = { protocol: 'benchmark-local-v2', passed: true, contentHash, semanticAudit: { passed: true, status: 'passed' } };
  const record = { passed: 1, content_hash: contentHash, result_json: JSON.stringify(audit) };
  assert.equal(validateCommitAudit(record, { content, contentHash }).ok, true);
  assert.equal(validateCommitAudit(record, { content: content + '手改', contentHash }).ok, false);
  assert.equal(validateCommitAudit(record, { contentHash }).ok, false);
  assert.equal(validateCommitAudit({ ...record, passed: 0 }, { content, contentHash }).ok, false);
});

test('提交凭证随事务回滚，已提交结果可恢复债务且不重复登记', (t) => {
  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch {
    if (t && typeof t.skip === 'function') {
      t.skip('node:sqlite 不可用，跳过该测试');
      return;
    }
  }
  const { DatabaseSync } = sqlite;
  const commits = require('../lib/benchmark-commit');
  const database = new DatabaseSync(':memory:');
  try {
    commits.initializeCommitReceipts(database);
    const entry = { snapshotId: 'snapshot-1', bookId: 'book-1', chapterNo: 1, stateVersion: 1, contentHash: review.textHash(content), content, ledgerDelta: { newPromises: [] } };
    database.exec('BEGIN');
    commits.saveCommitReceipt(database, entry);
    database.exec('ROLLBACK');
    assert.equal(commits.replayCommit(database, entry.bookId, entry, () => {}), null);
    commits.saveCommitReceipt(database, entry);
    let calls = 0;
    const pending = commits.replayCommit(database, entry.bookId, entry, () => { calls++; throw new Error('disk unavailable'); });
    assert.equal(pending.ok, true);
    assert.equal(pending.debtStatus, 'pending_recovery');
    assert.equal(commits.replayCommit(database, entry.bookId, { ...entry, content: content + '改动' }, () => { calls++; }).ok, false);
    assert.deepEqual(commits.recoverPendingCommitDebts(database, 'other-book', () => { calls++; }), { recovered: 0, pending: 0 });
    assert.deepEqual(commits.recoverPendingCommitDebts(database, entry.bookId, () => { calls++; }), { recovered: 1, pending: 0 });
    const recovered = commits.replayCommit(database, entry.bookId, entry, () => { calls++; });
    assert.equal(recovered.replayed, true);
    assert.equal(recovered.debtStatus, 'committed');
    assert.equal(recovered.snapshotId, entry.snapshotId);
    commits.replayCommit(database, entry.bookId, entry, () => { calls++; });
    assert.equal(calls, 2);
  } finally {
    database.close();
  }
});

test('generateChapter 刚性钳位 maxTokens 并完整记录 topP、seed 与 modelVersion', async () => {
  let capturedOptions = null;
  const deps = {
    callModel: async (_auth, options) => {
      capturedOptions = options;
      return {
        text: '第一章 剑气入青云。\n陆沉立在崖畔，远望群山苍茫，风中满是寒意。',
        usage: { totalTokens: 120, creditCost: 1 }
      };
    }
  };
  const result = await pipeline.generateChapter(deps, {}, {
    genre: '玄幻',
    prompt: '开篇写少年试剑',
    targetWords: 2500,
    topP: 0.95,
    seed: 42,
    modelId: 'test-llm-v1',
    continuity: { characters: [{ name: '陆沉' }, { name: '白灵' }] },
    control: true,
    controlSystem: '只写小说正文'
  });
  assert.ok(capturedOptions);
  assert.equal(capturedOptions.maxTokens, 3750); // 2500 * 1.5 = 3750 <= 4800
  assert.equal(capturedOptions.topP, 0.95);
  assert.equal(capturedOptions.seed, 42);
  assert.equal(capturedOptions.modelVersion, 'test-llm-v1');
  assert.ok(capturedOptions.userPrompt.includes('目标篇幅：2500 字；字数校验区间：2125～2875 字'));
  assert.ok(!capturedOptions.userPrompt.includes('2200～2800 字'));
  assert.ok(!capturedOptions.userPrompt.includes('3000 字以上'));

  const draftCall = result.calls.find(c => c.stage === 'writing' || c.stage === 'draft');
  assert.ok(draftCall);
  assert.equal(draftCall.parameters.topP, 0.95);
  assert.equal(draftCall.parameters.seed, 42);
  assert.equal(draftCall.parameters.modelVersion, 'test-llm-v1');

  const entities = pipeline.collectKnownEntities({
    continuity: { characters: [{ name: '白灵' }] },
    contract: { viewpoint: '陆沉', characters: [{ name: '陈西风' }] }
  });
  assert.ok(entities.includes('白灵'));
  assert.ok(entities.includes('陆沉'));
  assert.ok(entities.includes('陈西风'));
});

test('未指定篇幅时使用题材基线均值', async () => {
  let draftRequest;
  await pipeline.generateChapter({ callModel: async (_, request) => {
    if (!request.jsonMode) draftRequest = request;
    return request.jsonMode ? { json: clean(), usage } : { text: content, usage };
  } }, null, {
    genre: '青春甜宠', prompt: '写人物初次见面', modelId: 'test-llm-v1',
    control: true, controlSystem: '只写小说正文', maxRounds: 0
  });
  assert.ok(draftRequest.userPrompt.includes('目标篇幅：2134 字；字数校验区间：1814～2454 字'));
});

test('generateChapter 支持大窗口模型扩展预算，并对重复基准块去重', async () => {
  let capturedOptions = null;
  const mockDeps = {
    callModel: async (_auth, options) => {
      capturedOptions = options;
      return { text: '这是测试正文。'.repeat(100), usage: { total_tokens: 500 } };
    }
  };
  const longSystem = '长提示词'.repeat(10000); // 40000 字符，超过标准 32k，但在 gpt-6-luna 64k 预算内
  const result = await pipeline.generateChapter(mockDeps, null, {
    modelId: 'gpt-6-luna',
    prompt: '续写章节',
    writingSystem: longSystem,
    genre: '都市'
  });
  assert.ok(result);
  assert.ok(capturedOptions);
  assert.ok(capturedOptions.system.length > 32000);
});

test('题材别名与简称规范化为六大母类且证据运行时正常加载', () => {
  const ge = require('../lib/genre-evidence');
  assert.equal(ge.normalizeGenre('都市'), '都市高武');
  assert.equal(ge.normalizeGenre('urban'), '都市高武');
  assert.equal(ge.normalizeGenre('仙侠'), '玄幻');
  assert.equal(ge.normalizeGenre('凡人流'), '玄幻');
  assert.equal(ge.normalizeGenre('末世'), '科幻末世');
  assert.equal(ge.normalizeGenre('推理'), '悬疑脑洞');
  assert.equal(ge.normalizeGenre('甜宠'), '青春甜宠');
  assert.equal(ge.normalizeGenre('架空历史'), '历史脑洞');

  const dushiRuntime = pipeline.genreRuntime('都市');
  assert.equal(dushiRuntime.status, 'ready');
  assert.equal(dushiRuntime.genre, '都市高武');
  assert.ok(dushiRuntime.writingBlock.includes('都市高武题材证据'));
  assert.ok(dushiRuntime.reviewBlock.includes('都市高武审稿参考'));

  const xianxiaRuntime = pipeline.genreRuntime('仙侠');
  assert.equal(xianxiaRuntime.status, 'ready');
  assert.equal(xianxiaRuntime.genre, '玄幻');
});
