'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const experiments = require('../lib/benchmark-experiments.js');
const blindPage = require('../benchmark-review.js');

const ROOT = path.resolve(__dirname, '..');
const suiteDirectory = path.join(ROOT, 'data', 'genre-lab', 'benchmark-suite');
const suite = JSON.parse(fs.readFileSync(path.join(suiteDirectory, 'suite.json'), 'utf8'));
const regression = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'genre-lab', 'regression-prompts.json'), 'utf8'));
const provenance = JSON.parse(fs.readFileSync(path.join(suiteDirectory, 'control-provenance.json'), 'utf8'));
const prompt = fs.readFileSync(path.join(suiteDirectory, 'control-prompt.txt'), 'utf8').replace(/\r\n/g, '\n').trim();
const config = {
  model: 'test-model-private-identity', pipelineVersion: 'fixture-v2',
  parameters: { temperature: 0.8, maxRounds: 2, maxTokens: null, topP: null, seed: null },
  control: { ...provenance, prompt, promptHash: experiments.hashValue(prompt) }
};

function planFor(phase = 'P3', count = 2) {
  const plan = experiments.buildExperimentPlan(suite, regression, phase);
  return { ...plan, tasks: plan.tasks.slice(0, count), expectedTasks: count,
    expectedPairs: phase === 'P3' ? count : 0, expectedGenerations: count * plan.arms.length };
}

function temporaryDirectory(context) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'molan-benchmark-test-'));
  context.after(() => {
    const resolved = path.resolve(directory);
    const parent = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(parent) && path.basename(resolved).startsWith('molan-benchmark-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

function generated(params, overrides = {}) {
  const text = `正文证据第${params.chapterIndex}章。${params.control ? '记下水额并承担工钱损失。' : '清点余量后共同签署新约。'}`;
  const parameters = { temperature: params.temperature, maxTokens: 6300, topP: null, seed: null };
  return {
    protocol: 'benchmark-local-v2', status: 'passed', text, humanReviewStatus: 'pending',
    audit: {
      passed: true, status: 'passed', contentHash: experiments.hashValue(text),
      coverage: Object.fromEntries(['state', 'knowledge', 'payoff', 'relation', 'reasoning', 'redundancy', 'continuity'].map(dimension => [dimension, 'checked'])),
      summary: '损失已入账', stageChange: '获得有限授权',
      factLedgerDelta: { newRules: [], newPromises: [], byEntity: {}, updates: [] }
    },
    usage: { totalTokens: 30, complete: true, callCount: 1 },
    calls: [{
      status: 'completed', modelId: params.modelId, parameters,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      requestHash: experiments.hashValue(params), outputHash: experiments.hashValue(text)
    }],
    candidates: [],
    ...overrides
  };
}

async function runFixture(plan = planFor(), options = {}, generator = generated) {
  const checkpoints = [];
  const state = await experiments.runExperiment({ plan, config, dryRun: false, experimentId: 'fixture-run', ...options }, {
    generateChapter: generator,
    saveCheckpoint: state => checkpoints.push(state),
    now: () => '2026-09-10T08:00:00.000Z'
  });
  return { state, checkpoints };
}

function completeReview(packet) {
  return {
    schemaVersion: 1, kind: 'molan-human-review', packetId: packet.packetId, packetHash: packet.packetHash,
    reviewer: 'test-human-fixture-not-real-review', reviewedAt: '2026-09-10T09:00:00.000Z',
    items: packet.items.map(item => ({
      itemId: item.itemId, preference: 'tie', reason: '这是测试夹具，不是真人评审结论',
      candidates: Object.fromEntries(['A', 'B'].map(label => [label, {
        textHash: item.candidates[label].textHash,
        scores: Object.fromEntries(experiments.REVIEW_DIMENSIONS.map(dimension => [dimension, 3])),
        stateChecks: Object.fromEntries(experiments.STATE_DIMENSIONS.map(dimension => [dimension, {
          status: 'pass', evidence: item.candidates[label].text.slice(0, 8)
        }]))
      }]))
    }))
  };
}

test('固定P0单control36、P3原创双臂36输出、P4单candidate20章', () => {
  assert.equal(experiments.validateSuite(suite, regression), true);
  for (const [phase, tasks, outputs] of [['P0', 36, 36], ['P3', 18, 36], ['P4', 20, 20]]) {
    const plan = experiments.buildExperimentPlan(suite, regression, phase);
    assert.equal(plan.expectedTasks, tasks);
    assert.equal(plan.expectedPairs, phase === 'P3' ? tasks : 0);
    assert.equal(plan.expectedGenerations, outputs);
    assert.equal(plan.plannedStatus, 'not_executed');
    assert.equal(plan.tasks.length, new Set(plan.tasks.map(item => item.id)).size);
  }
  assert.equal(new Set(regression.map(item => item.prompt)).size, 18);
  assert.equal(new Set(suite.genres.flatMap(item => item.routes.map(route => route.id))).size, 12);
});

test('P3拒绝已知原作专名和不完整题集', () => {
  const copy = structuredClone(regression);
  copy[0].prompt += '孟奇与真慧';
  assert.throws(() => experiments.validateSuite(suite, copy), /专名/);
  assert.throws(() => experiments.validateSuite(suite, regression.slice(1)), /18/);
});

test('固定manifest哈希锁定全部三阶段且不包含实跑/真人结论', async () => {
  const { loadFixedInputs } = await import('../scripts/run-benchmark-experiments.mjs');
  const manifest = JSON.parse(fs.readFileSync(path.join(suiteDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.status, 'not_executed');
  assert.equal(manifest.executed, false);
  assert.equal(manifest.historicalPipelineReplay, false);
  for (const phase of ['P0', 'P3', 'P4']) {
    const { plan } = loadFixedInputs(phase);
    assert.equal(experiments.hashValue(plan), manifest.plans[phase].planHash);
    assert.deepEqual(plan.arms, manifest.plans[phase].arms);
    assert.equal(plan.expectedGenerations, manifest.plans[phase].generations);
  }
});

test('固定prompt逐字对应记录的git提交，不冒充完整历史链路', t => {
  if (spawnSync('git', ['cat-file', '-e', provenance.sourceCommit], { cwd: ROOT }).status !== 0) {
    t.skip(`来源提交 ${provenance.sourceCommit} 不在当前 Git 克隆中`);
    return;
  }
  const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const sourcePath = path.relative(repositoryRoot, path.join(ROOT, provenance.sourcePath)).split(path.sep).join('/');
  const source = execFileSync('git', ['show', `${provenance.sourceCommit}:${sourcePath}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  const snapshot = source.match(/const baseWritingDirectives = `([\s\S]*?)`;/);
  assert.ok(snapshot);
  assert.equal(prompt, snapshot[1].replace(/\r\n/g, '\n').trim());
  assert.equal(provenance.kind, 'fixed_control_prompt');
  assert.equal(provenance.historicalPipelineReplay, false);
});

test('dry-run零调用零持久化，绝非pass', async () => {
  const result = await experiments.runExperiment({ plan: planFor(), config }, {
    generateChapter: () => assert.fail('dry-run不调用'),
    saveCheckpoint: () => assert.fail('dry-run不写执行凭证')
  });
  assert.equal(result.status, 'not_executed');
  assert.equal(result.executed, false);
  assert.equal(result.records.length, 0);
  assert.throws(() => experiments.makeBlindReview(result), /未执行/);
});

test('同条件双臂、合法稳定requestId、完整哈希用量、人工pending不是失败', async () => {
  const { state, checkpoints } = await runFixture();
  assert.equal(state.status, 'pending_review');
  assert.equal(state.records.length, 4);
  for (const task of state.plan.tasks) {
    const records = state.records.filter(record => record.taskId === task.id);
    const [first, second] = records.map(record => record.params);
    for (const field of ['prompt', 'genre', 'modelId', 'targetWords', 'temperature', 'maxRounds', 'contract', 'factLedger', 'previousEnding', 'continuity']) {
      assert.deepEqual(first[field], second[field]);
    }
    assert.notEqual(first.control, second.control);
    for (const record of records) {
      assert.match(record.params.requestId, /^[A-Za-z0-9_-]{8,100}$/);
      assert.equal(record.params.localStorage, true);
      assert.equal(record.params.persist, false);
      assert.equal(record.requestHash, experiments.hashValue(record.params));
      assert.equal(record.textHash, experiments.hashValue(record.text));
      assert.deepEqual(record.missingEvidence, []);
      assert.equal(record.reviewStatus, 'pending_review');
    }
  }
  assert.equal(checkpoints[0].records[0].status, 'in_flight');
  assert.equal(checkpoints[0].records[0].text, undefined);
});

test('执行前持久化失败不得调用；响应保存失败保留in_flight供人工核对', async () => {
  let calls = 0;
  await assert.rejects(experiments.runExperiment({ plan: planFor(), config, dryRun: false }, {
    generateChapter: () => { calls += 1; },
    saveCheckpoint: () => { throw new Error('disk full'); }
  }), /disk full/);
  assert.equal(calls, 0);
  const snapshots = [];
  await assert.rejects(experiments.runExperiment({ plan: planFor(), config, dryRun: false }, {
    generateChapter: params => { calls += 1; return generated(params); },
    saveCheckpoint: state => { if (snapshots.length) throw new Error('disk full'); snapshots.push(state); }
  }), /disk full/);
  assert.equal(calls, 1);
  assert.equal(snapshots[0].records[0].status, 'in_flight');
});

test('暂停续跑只执行缺项，稳定请求不重发，参数/计划变动拒绝', async () => {
  const plan = planFor();
  const first = await runFixture(plan, { maxCalls: 1 });
  assert.equal(first.state.status, 'paused');
  let calls = 0;
  const resumed = await runFixture(plan, { checkpoint: first.state }, params => { calls += 1; return generated(params); });
  assert.equal(calls, 3);
  assert.equal(resumed.state.records[0].params.requestId, first.state.records[0].params.requestId);
  await runFixture(plan, { checkpoint: resumed.state }, () => assert.fail('完整运行不得再次调用'));
  await assert.rejects(experiments.runExperiment({ plan, config: { ...config, model: 'other' }, checkpoint: first.state }), /改变/);
  const changed = structuredClone(plan);
  changed.tasks[0].prompt += '变更';
  await assert.rejects(experiments.runExperiment({ plan: changed, config, checkpoint: first.state }), /改变/);
});

test('网络未知和进程中断均不自动重试；错误文本不保存凭据', async () => {
  let calls = 0;
  const { state } = await runFixture(planFor(), {}, () => { calls += 1; throw new Error('secret-password-test'); });
  assert.equal(state.status, 'blocked_uncertain');
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(state).includes('secret-password-test'));
  const resumed = await runFixture(state.plan, { checkpoint: state }, () => assert.fail('不得重试'));
  assert.equal(resumed.state.status, 'blocked_uncertain');
  const good = await runFixture();
  const interrupted = good.checkpoints[0];
  const stopped = await runFixture(interrupted.plan, { checkpoint: interrupted }, () => assert.fail('不得重试'));
  assert.equal(stopped.state.records[0].status, 'uncertain');
});

test('管线内部不确定调用即使返回正文也停止', async () => {
  const { state } = await runFixture(planFor(), {}, params => {
    const response = generated(params);
    response.calls[0].status = 'failed_or_unknown';
    return response;
  });
  assert.equal(state.status, 'blocked_uncertain');
  assert.ok(state.records[0].text);
});

test('审计不通过停止且保留结果和usage，绝不提交ledger', async () => {
  let calls = 0;
  const { state } = await runFixture(planFor(), {}, params => {
    calls += 1;
    return generated(params, { status: 'needs_review', audit: { passed: false, status: 'incomplete' } });
  });
  assert.equal(calls, 1);
  assert.equal(state.status, 'audit_failed');
  assert.ok(state.records[0].text);
  assert.ok(state.records[0].usage);
  assert.equal(state.records[0].ledgerAfter, undefined);
  await runFixture(state.plan, { checkpoint: state }, () => assert.fail('审计未通过不能续写'));
});

test('起草无正文：明确needs_review保留真实失败，不确定调用另标unknown且不重试', async () => {
  for (const unknown of [false, true]) {
    const { state } = await runFixture(planFor('P0', 1), {}, params => {
      const response = generated(params);
      response.text = '';
      response.status = 'needs_review';
      response.audit = { passed: false, status: 'incomplete', incompleteReasons: [unknown ? 'draft_call_failed_or_unknown' : 'draft_or_usage_missing'] };
      response.usage.complete = false;
      response.calls[0].status = unknown ? 'failed_or_unknown' : 'usage_missing';
      return response;
    });
    assert.equal(state.records.length, 1);
    assert.equal(state.records[0].text, '');
    assert.equal(state.records[0].response.status, 'needs_review');
    assert.equal(state.records[0].usage.complete, false);
    assert.equal(state.records[0].calls.length, 1);
    assert.equal(state.status, unknown ? 'blocked_uncertain' : 'audit_failed');
    assert.ok(state.records[0].missingEvidence.includes('usage_complete'));
    await runFixture(state.plan, { checkpoint: state }, () => assert.fail('失败不重试'));
  }
});

test('audit.coverage直接读取且完整保存，不臆造audit.semantic', async () => {
  const { state } = await runFixture(planFor('P0', 1));
  assert.equal(state.status, 'pending_review');
  assert.equal(state.records[0].audit.coverage.relation, 'checked');
  assert.equal(state.records[0].audit.semantic, undefined);
  assert.equal(state.records[0].response.humanReviewStatus, 'pending');
  const missing = await runFixture(planFor('P0', 1), {}, params => {
    const response = generated(params);
    delete response.audit.coverage.knowledge;
    return response;
  });
  assert.equal(missing.state.status, 'missing_evidence');
  assert.ok(missing.state.records[0].missingEvidence.includes('audit.coverage.knowledge'));
});

test('P0仅control且pilot一请求即暂停，P0/P4不可伪造AB盲评', async () => {
  const { state } = await runFixture(planFor('P0', 3), { maxCalls: 1 });
  assert.equal(state.records.length, 1);
  assert.equal(state.records[0].arm, 'control');
  assert.equal(state.status, 'paused');
  for (const phase of ['P0', 'P4']) {
    const complete = await runFixture(planFor(phase, 1));
    assert.equal(complete.state.records.length, 1);
    assert.throws(() => experiments.makeBlindReview(complete.state), /仅开放P3/);
  }
});

test('缺逐调用参数或input/output用量必须missing_evidence', async () => {
  const { state } = await runFixture(planFor('P3', 1), {}, params => {
    const response = generated(params);
    delete response.calls[0].parameters;
    response.calls[0].usage = { totalTokens: 30 };
    return response;
  });
  assert.equal(state.status, 'missing_evidence');
  assert.ok(state.records[0].missingEvidence.length);
});

test('P4按各臂已确认章节累积ledger，延续知识与伏笔，未确认不混入', async () => {
  const seen = [];
  const { state } = await runFixture(planFor('P4', 3), {}, params => {
    seen.push(structuredClone(params));
    const response = generated(params);
    response.audit.factLedgerDelta.newPromises = [{ id: `promise-${params.control}-${params.chapterIndex}`, text: '须公开水账', quote: '正文证据', kind: '伏笔' }];
    if (params.chapterIndex === 2) response.audit.factLedgerDelta.updates = [{ id: `promise-${params.control}-1`, status: 'paid', quote: '正文证据' }];
    return response;
  });
  assert.equal(state.status, 'pending_review');
  for (const params of seen.filter(item => item.chapterIndex === 3)) {
    assert.equal(params.factLedger.lastFactChapter, 2);
    assert.equal(params.factLedger.promises.length, 2);
    assert.equal(params.factLedger.promises[0].status, 'paid');
    assert.ok(params.factLedger.promises.every(item => item.id.includes(String(params.control))));
    assert.equal(params.continuity.confirmedChapters.length, 2);
  }
  assert.equal(seen.length, 3);
  assert.ok(seen.every(item => item.control === false));
  assert.ok(seen.find(item => item.chapterIndex === 2).previousEnding.includes('共同签署'));
});

test('ledger拒绝编造引用与不存在的更新目标', async () => {
  for (const factLedgerDelta of [
    { newRules: [{ text: '虚构', quote: '正文没有这个引用' }], newPromises: [], byEntity: {}, updates: [] },
    { newRules: [], newPromises: [], byEntity: {}, updates: [{ id: 'unknown', status: 'paid', quote: '正文证据' }] }
  ]) {
    const { state } = await runFixture(planFor(), {}, params => {
      const response = generated(params);
      response.audit.factLedgerDelta = factLedgerDelta;
      return response;
    });
    assert.equal(state.status, 'audit_failed');
    assert.equal(state.records.length, 1);
  }
});

test('P4跨series重置ledger，按各自章序生成不交叉污染', async () => {
  const plan = experiments.buildExperimentPlan(suite, regression, 'P4');
  const observed = [];
  const { state } = await runFixture(plan, { maxCalls: 11 }, params => {
    observed.push(params);
    const response = generated(params);
    response.audit.factLedgerDelta.newRules = [{ text: `${params.genre}第${params.chapterIndex}章新增事实`, quote: '正文证据' }];
    return response;
  });
  assert.equal(state.records.length, 11);
  assert.deepEqual(observed.slice(0, 10).map(params => params.chapterIndex), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(observed[9].factLedger.rules.length, 9);
  assert.equal(observed[10].chapterIndex, 1);
  assert.equal(observed[10].factLedger.rules.length, 0);
  assert.equal(observed[10].previousEnding, '');
  assert.notEqual(observed[9].genre, observed[10].genre);
});

test('篡改正文、请求或审计阻止续跑', async () => {
  const { state } = await runFixture();
  for (const mutate of [
    record => { record.text += '改'; },
    record => { record.params.prompt += '改'; },
    record => { record.audit.summary += '改'; }
  ]) {
    const modified = structuredClone(state);
    mutate(modified.records[0]);
    await assert.rejects(runFixture(state.plan, { checkpoint: modified }), /哈希|凭证/);
  }
});

test('仅本机HTTP+capabilities确认localStorage且禁止重定向', async () => {
  for (const endpoint of [
    'https://example.com/api/benchmark/generate', 'http://example.com/api/benchmark/generate',
    'http://127.0.0.1.evil.test/api/benchmark/generate', 'http://user:pass@127.0.0.1/api/benchmark/generate',
    'http://127.0.0.1/api/chat', 'http://127.0.0.1/api/benchmark/generate?proxy=1'
  ]) assert.throws(() => experiments.createLocalGenerator({ endpoint }), /回环/);
  const calls = [];
  const generator = experiments.createLocalGenerator({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => calls.length === 1
      ? { protocol: 'benchmark-local-v2', localStorage: true, cloudProxy: false }
      : { text: '结果', status: 'passed' } };
  } });
  await generator({ localStorage: true, persist: false });
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.endsWith('/capabilities'));
  assert.ok(calls.every(call => call.options.redirect === 'error'));
  assert.deepEqual(JSON.parse(calls[1].options.body), { localStorage: true, persist: false });
});

test('cloudProxy preflight失败零生成POST，不自动重试HTTP错误', async () => {
  let calls = 0;
  const generator = experiments.createLocalGenerator({ fetchImpl: async () => {
    calls += 1;
    return { ok: true, json: async () => ({ protocol: 'benchmark-local-v2', localStorage: true, cloudProxy: true }) };
  } });
  await assert.rejects(generator({ localStorage: true, persist: false }), /仅本地/);
  assert.equal(calls, 1);
  const failing = experiments.createLocalGenerator({ fetchImpl: async url => {
    calls += 1;
    return url.endsWith('capabilities')
      ? { ok: true, json: async () => ({ protocol: 'benchmark-local-v2', localStorage: true, cloudProxy: false }) }
      : { ok: false, status: 502 };
  } });
  await assert.rejects(failing({ localStorage: true, persist: false }), /502/);
  assert.equal(calls, 3);
});

test('追加式checkpoint链可恢复、冲突不覆盖、损坏拒绝', async context => {
  const directory = temporaryDirectory(context);
  const { createCheckpointStore } = await import('../scripts/run-benchmark-experiments.mjs');
  const first = createCheckpointStore(directory);
  const competing = createCheckpointStore(directory);
  const fixture = await runFixture(planFor(), { maxCalls: 1 });
  first.saveCheckpoint(fixture.state);
  const original = fs.readFileSync(path.join(directory, 'checkpoint-000001.json'), 'utf8');
  assert.throws(() => competing.saveCheckpoint(fixture.state), /EEXIST/);
  assert.equal(fs.readFileSync(path.join(directory, 'checkpoint-000001.json'), 'utf8'), original);
  const resumed = createCheckpointStore(directory);
  assert.deepEqual(resumed.state, fixture.state);
  resumed.saveCheckpoint(fixture.state);
  const filename = path.join(directory, 'checkpoint-000002.json');
  const changed = JSON.parse(fs.readFileSync(filename, 'utf8'));
  changed.state.status = 'passed';
  fs.writeFileSync(filename, JSON.stringify(changed));
  assert.throws(() => createCheckpointStore(directory), /损坏/);
});

test('P3匿名包不含模型、调用或私钥，每题A/B完整', async () => {
  const { state } = await runFixture(planFor('P3', 3));
  const { packet, mapping } = experiments.makeBlindReview(state, { salt: 'fixture-salt' });
  await blindPage.validatePacket(packet);
  assert.ok(!JSON.stringify(packet).includes(config.model));
  assert.ok(!JSON.stringify(packet).includes('requestHash'));
  assert.ok(!JSON.stringify(packet).includes('controlSystem'));
  assert.ok(!JSON.stringify(packet).includes('private-blind-key'));
  assert.ok(mapping.items.every(item => item.candidates.A.arm !== item.candidates.B.arm));
  assert.equal(new Set(packet.items.map(item => item.seriesId)).size, 3);
  assert.equal(packet.items[0].candidates.A.scores, undefined);
  await assert.rejects(blindPage.validatePacket({ ...packet, model: config.model }), /额外身份/);
  const changed = structuredClone(packet);
  changed.items[0].candidates.A.text += '改';
  await assert.rejects(blindPage.validatePacket(changed), /哈希/);
});

test('正文自报身份阻止盲评，不静默改写原始正文', async () => {
  const { state } = await runFixture(planFor('P3', 1), {}, params => {
    const response = generated(params);
    response.text += ' 我是ChatGPT。';
    response.audit.contentHash = experiments.hashValue(response.text);
    return response;
  });
  assert.throws(() => experiments.makeBlindReview(state), /身份线索/);
  assert.ok(state.records[0].text.includes('ChatGPT'));
});

test('人工无预填；双方全维度+状态逐字证据+理由完整才可绑定', async () => {
  const { state } = await runFixture();
  const { packet, mapping } = experiments.makeBlindReview(state);
  const review = completeReview(packet);
  assert.equal(blindPage.validateReview(packet, { items: [] }).valid, false);
  assert.equal(experiments.validateHumanReview(packet, review).valid, true);
  assert.equal(blindPage.validateReview(packet, review).valid, true);
  const bound = experiments.bindHumanReview(state, packet, mapping, review);
  assert.equal(bound.entries.length, state.records.length);
  for (const mutate of [
    value => { value.reviewer = ''; },
    value => { value.items.pop(); },
    value => { value.items[0].reason = ''; },
    value => { value.items[0].candidates.A.scores.originality = null; },
    value => { value.items[0].candidates.B.stateChecks.knowledge.evidence = '原文没有'; },
    value => { value.items[0].candidates.A.stateChecks.relations.status = ''; },
    value => { value.items[0].candidates.A.textHash = '0'.repeat(64); },
    value => { value.packetHash = '0'.repeat(64); }
  ]) {
    const incomplete = structuredClone(review);
    mutate(incomplete);
    assert.equal(experiments.validateHumanReview(packet, incomplete).valid, false);
    assert.equal(blindPage.validateReview(packet, incomplete).valid, false);
    assert.throws(() => experiments.bindHumanReview(state, packet, mapping, incomplete));
  }
  const wrongMapping = structuredClone(mapping);
  wrongMapping.items[0].candidates.A.key = mapping.items[0].candidates.B.key;
  assert.throws(() => experiments.bindHumanReview(state, packet, wrongMapping, review), /映射/);
});

function chapterText(chapterIndex) {
  return Array.from({ length: 40 }, (_, paragraphIndex) =>
    `稿件${chapterIndex}段落${String(paragraphIndex).padStart(3, '0')}记载：河岸修契的人逐一核验各户交来的用水凭据，把尚未取得见证的条目单列，不替任何人承诺。账页上的修改经过当事人确认，船队据此调整下一班的出发时刻。`).join('\n\n');
}

function writeChapters(directory, count = 10) {
  const chapters = [];
  for (let chapterIndex = 1; chapterIndex <= count; chapterIndex += 1) {
    const text = chapterText(chapterIndex);
    fs.writeFileSync(path.join(directory, `ch${String(chapterIndex).padStart(2, '0')}.md`), text);
    chapters.push({ chapterIndex, text, textHash: experiments.hashValue(text) });
  }
  return chapters;
}

function chapterReviews(chapters) {
  return {
    status: 'reviewed',
    entries: chapters.map(chapter => ({
      chapterIndex: chapter.chapterIndex, textHash: chapter.textHash, status: 'reviewed',
      reviewer: 'test-fixture-not-real', reviewedAt: '2026-09-10T10:00:00.000Z',
      preference: 'tie', reason: '测试用完整结构，不是真人结果',
      scores: Object.fromEntries(experiments.REVIEW_DIMENSIONS.map(dimension => [dimension, 4])),
      stateChecks: Object.fromEntries(experiments.STATE_DIMENSIONS.map(dimension => [dimension, {
        status: 'pass', evidence: chapter.text.slice(0, 15)
      }]))
    }))
  };
}

test('长篇纯指标全部达标仍pending_review；有语义无真人也不能pass', async context => {
  const directory = temporaryDirectory(context);
  const chapters = writeChapters(directory);
  const { runLongformEvaluation } = await import('../scripts/run-longform-eval.mjs');
  const result = runLongformEvaluation(directory);
  assert.equal(result.summary.statusBreakdown.fail, 0);
  assert.equal(result.summary.mechanicalPassRate, '100%');
  assert.equal(result.summary.overallVerdict, 'pending_review');
  assert.equal(result.summary.passRate, null);
  assert.ok(result.summary.missingEvidence.length >= 20);
  const partial = runLongformEvaluation(directory, '玄幻', { semanticAudit: chapterReviews(chapters) });
  assert.equal(partial.summary.overallVerdict, 'pending_review');
});

test('缺章、不足十章、重复章号和重复正文均显式失败', async context => {
  const directory = temporaryDirectory(context);
  writeChapters(directory, 9);
  const { runLongformEvaluation } = await import('../scripts/run-longform-eval.mjs');
  let report = runLongformEvaluation(directory);
  assert.equal(report.summary.overallVerdict, 'failed');
  assert.ok(report.summary.structuralFailures.includes('missing_chapter:10'));
  assert.ok(report.summary.structuralFailures.some(item => item.startsWith('insufficient_chapters')));
  fs.writeFileSync(path.join(directory, 'ch10.md'), chapterText(9));
  fs.writeFileSync(path.join(directory, 'ch01-copy.md'), chapterText(1));
  report = runLongformEvaluation(directory);
  assert.ok(report.summary.structuralFailures.some(item => item.startsWith('duplicate_chapter_number')));
  assert.ok(report.summary.structuralFailures.some(item => item.startsWith('duplicate_chapter_text')));
  assert.throws(() => runLongformEvaluation(directory, '玄幻', { expectedChapters: 9 }), /至少/);
});

test('空目录返回明确缺章失败而不是通过', async context => {
  const directory = temporaryDirectory(context);
  const { runLongformEvaluation } = await import('../scripts/run-longform-eval.mjs');
  const { summary } = runLongformEvaluation(directory);
  assert.equal(summary.overallVerdict, 'failed');
  assert.equal(summary.totalChapters, 0);
  assert.ok(summary.missingEvidence.includes('semantic_and_human_reviews'));
});

test('关系/知识/伏笔逐项缺审或陈旧哈希pending；负面审查failed', async context => {
  const directory = temporaryDirectory(context);
  const chapters = writeChapters(directory);
  const { runLongformEvaluation } = await import('../scripts/run-longform-eval.mjs');
  const semanticAudit = chapterReviews(chapters);
  const humanReview = chapterReviews(chapters);
  const complete = runLongformEvaluation(directory, '玄幻', { semanticAudit, humanReview });
  assert.equal(complete.summary.overallVerdict, 'passed');
  for (const dimension of experiments.STATE_DIMENSIONS) {
    const missing = structuredClone(semanticAudit);
    delete missing.entries[0].stateChecks[dimension];
    const report = runLongformEvaluation(directory, '玄幻', { semanticAudit: missing, humanReview });
    assert.equal(report.summary.overallVerdict, 'pending_review');
    assert.ok(report.summary.missingEvidence.some(item => item.endsWith(dimension)));
  }
  const stale = structuredClone(humanReview);
  stale.entries[0].textHash = '0'.repeat(64);
  assert.equal(runLongformEvaluation(directory, '玄幻', { semanticAudit, humanReview: stale }).summary.overallVerdict, 'pending_review');
  const failed = structuredClone(semanticAudit);
  failed.entries[0].stateChecks.knowledge.status = 'fail';
  assert.equal(runLongformEvaluation(directory, '玄幻', { semanticAudit: failed, humanReview }).summary.overallVerdict, 'failed');
});

test('改标题/空白不能逃过重复章检测', () => {
  const text = chapterText(1);
  assert.equal(experiments.textContentHash(`# 第一章 水账\n${text}`),
    experiments.textContentHash(`# 第二章 改标题\n${text.replace(/\n/g, '\n  ')}`));
});

test('CLI dryrun与长篇覆盖保护仅用临时目录；不访问生产推理', async context => {
  const directory = temporaryDirectory(context);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/run-benchmark-experiments.mjs'),
    '--phase', 'P4', '--out', path.join(directory, 'dryrun')], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not_executed/);
  assert.match(result.stdout, /"executed": false/);
  const files = fs.readdirSync(path.join(directory, 'dryrun'));
  assert.equal(files.length, 2);
  assert.ok(files.includes('manifest.json'));
  const reportPath = path.join(directory, 'old-report.json');
  fs.writeFileSync(reportPath, '{"historical":true}');
  const chaptersDirectory = path.join(directory, 'chapters');
  fs.mkdirSync(chaptersDirectory);
  writeChapters(chaptersDirectory);
  const overwrite = spawnSync(process.execPath, [path.join(ROOT, 'scripts/run-longform-eval.mjs'),
    '--dir', chaptersDirectory, '--output', reportPath], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(overwrite.status, 0);
  assert.equal(fs.readFileSync(reportPath, 'utf8'), '{"historical":true}');
});

test('CLI模拟pilot执行前冻结manifest，--max-calls 1仅P0 control并可续跑', async context => {
  const directory = temporaryDirectory(context);
  const output = path.join(directory, 'run');
  const adapter = path.join(directory, 'adapter.mjs');
  const response = generated({ chapterIndex: 1, control: true, modelId: config.model, temperature: 0.8 });
  fs.writeFileSync(adapter, [
    "import fs from 'node:fs';",
    `export async function generateChapter(params) {
      const manifest = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(output, 'manifest.json'))}, 'utf8'));
      if (manifest.plan.expectedGenerations !== 36 || !params.control || !manifest.fixedSnapshots['control-prompt.txt']) throw new Error('manifest未冻结或范围错误');
      return ${JSON.stringify(response)};
    }`
  ].join('\n'));
  const command = [path.join(ROOT, 'scripts/run-benchmark-experiments.mjs'), '--phase', 'P0', '--execute',
    '--model', config.model, '--pipeline-version', 'fixture-v2', '--max-calls', '1', '--adapter', adapter, '--out', output];
  const first = spawnSync(process.execPath, command, { cwd: directory, encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /"recorded": 1/);
  assert.match(first.stdout, /"status": "paused"/);
  const manifestBytes = fs.readFileSync(path.join(output, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.status, 'not_executed_at_manifest_creation');
  assert.equal(manifest.plan.expectedPairs, 0);
  assert.equal(manifest.fixedSnapshots['control-prompt.txt'].content.trim(), prompt);
  const resumed = spawnSync(process.execPath, [...command, '--resume'], { cwd: directory, encoding: 'utf8' });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.match(resumed.stdout, /"recorded": 2/);
  assert.equal(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'), manifestBytes);
});

test('静态盲评无网络代码、无innerHTML、无预填人工分数', () => {
  const html = fs.readFileSync(path.join(ROOT, 'benchmark-review.html'), 'utf8');
  const script = fs.readFileSync(path.join(ROOT, 'benchmark-review.js'), 'utf8');
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|innerHTML|document\.write/.test(script));
  assert.ok(!/<(?:script|link)[^>]+https?:/.test(html));
  assert.ok(!/selected\s*=|checked\s*=/.test(html));
});
