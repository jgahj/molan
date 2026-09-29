'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReplayManifest } = require('../lib/evolution/replay-manifest');
const { runSoakTask, contentHash } = require('../lib/evolution/soak-runner');
const { SOAK_MILESTONES, SOAK_CHECKPOINT_METRICS, buildSoakPlan, evaluateSoakRun } = require('../lib/evolution/soak-test');
const { createFaultInjector, FAULT_TYPES } = require('../lib/evolution/fault-injector');

const replayManifest = buildReplayManifest({
  sourceGenerationId: 'p7-soak-source',
  pipelineVersion: 'pipe-v2.1',
  promptVersion: 'writer-v2',
  genreProfileVersion: 'genre-v1',
  styleVersion: 'style-v1',
  model: 'claude-3-5-sonnet',
  parameters: { temperature: 0.7 },
  artifacts: {
    bible: { ref: 'bible:1', snapshot: { id: 'bible' } },
    outline: { ref: 'outline:1', snapshot: { id: 'outline' } },
    chapterContract: { ref: 'contract:1', snapshot: { id: 'contract' } },
    contextSnapshot: { ref: 'context:1', snapshot: { id: 'context' } }
  }
});

function makeStore() {
  const states = new Map();
  let nextToken = 0;
  const active = new Set();
  return {
    async load(taskId) { return states.has(taskId) ? structuredClone(states.get(taskId)) : null; },
    async save(taskId, state, { fencingToken }) {
      assert.ok(Number(fencingToken) <= nextToken);
      states.set(taskId, structuredClone(state));
    },
    async withLease(taskId, work) {
      if (active.has(taskId)) throw new Error('lease already held');
      active.add(taskId);
      try { return await work({ fencingToken: String(++nextToken) }); }
      finally { active.delete(taskId); }
    },
    inspect(taskId) { return states.get(taskId); }
  };
}

function validChapter(chapterIndex) {
  const text = `第${chapterIndex}章：正文文本内容测试段落。刀光破开夜雨，风雷之势已成。`;
  return {
    status: 'completed',
    text,
    output_hash: contentHash(text),
    evidence_ref: `evidence:chapter:${chapterIndex}`
  };
}

function passingAudit({ chapterIndex }) {
  return { passed: true, status: 'passed', evidence_ref: `audit:${chapterIndex}` };
}

function measuredCheckpoint({ chapterIndex }) {
  return {
    evidence_ref: `checkpoint:${chapterIndex}`,
    metrics: Object.fromEntries(SOAK_CHECKPOINT_METRICS.map(metric => [metric, 0]))
  };
}

test('P7: 200章超长程压测计划与检查点完整支持', () => {
  assert.ok(SOAK_MILESTONES.includes(200));
  const plan = buildSoakPlan({ replayManifest, milestone: 200 });
  assert.equal(plan.target_chapters, 200);
  assert.equal(plan.checkpoints.length, 20); // 每10章一个检查点
  assert.equal(plan.checkpoints[0], 10);
  assert.equal(plan.checkpoints[19], 200);
});

test('P7 故障注入: Provider 超时 (MODEL_TIMEOUT) 触发 provider_unknown 且严禁盲目重试', async () => {
  const store = makeStore();
  const injector = createFaultInjector();
  injector.addRule({
    fault: 'MODEL_TIMEOUT',
    matchChapter: 2,
    maxInjections: 1
  });

  let generateCallCount = 0;
  const common = {
    taskId: 'soak-fault-timeout',
    replayManifest,
    milestone: 3,
    store,
    generateChapter: injector.wrapModelCaller(async ({ chapterIndex }) => {
      generateCallCount += 1;
      return validChapter(chapterIndex);
    }),
    auditChapter: async input => passingAudit(input)
  };

  // 第1次运行：第1章成功，第2章注入超时
  const run1 = await runSoakTask(common);
  assert.equal(run1.execution_status, 'provider_unknown');
  assert.equal(generateCallCount, 1); // 第1章成功进入底层caller，第2章在门禁拦截抛错

  // 第2次尝试（无对账前）：应直接保持 provider_unknown，严禁重复生成第2章
  const run2 = await runSoakTask(common);
  assert.equal(run2.execution_status, 'provider_unknown');
  assert.equal(generateCallCount, 1); // 次数严禁增加！

  // 第3次尝试（通过 recoverUnknown 对账恢复后）：第2章恢复，第3章正常生成
  const run3 = await runSoakTask({
    ...common,
    recoverUnknown: async ({ chapterIndex }) => {
      assert.equal(chapterIndex, 2);
      return { resolved: true, chapter: validChapter(chapterIndex) };
    }
  });

  assert.equal(run3.status, 'PASS');
  assert.equal(run3.execution_status, 'completed');
  assert.equal(generateCallCount, 2); // 第3章生成，总调用数增加到 2
  assert.equal(injector.getInjectedCount('MODEL_TIMEOUT'), 1);
});

test('P7 故障注入: Provider 空正文 (MODEL_EMPTY) 正确被捕获且标记 blocked/interrupted', async () => {
  const store = makeStore();
  const injector = createFaultInjector();
  injector.addRule({
    fault: 'MODEL_EMPTY',
    matchChapter: 2,
    maxInjections: 1
  });

  const report = await runSoakTask({
    taskId: 'soak-fault-empty',
    replayManifest,
    milestone: 3,
    store,
    generateChapter: injector.wrapModelCaller(async ({ chapterIndex }) => {
      return validChapter(chapterIndex);
    }),
    auditChapter: async input => passingAudit(input)
  });

  assert.equal(report.status, 'BLOCKED');
  assert.equal(report.execution_status, 'interrupted');
  assert.equal(injector.getInjectedCount('MODEL_EMPTY'), 1);
});

test('P7 故障注入: 质检门禁多次拒绝 (AUDIT_REJECTED) 终止流水线并记录失败状态', async () => {
  const store = makeStore();
  const injector = createFaultInjector();
  injector.addRule({
    fault: 'AUDIT_REJECTED',
    matchChapter: 2,
    maxInjections: 1
  });

  const report = await runSoakTask({
    taskId: 'soak-fault-audit',
    replayManifest,
    milestone: 3,
    store,
    generateChapter: async ({ chapterIndex }) => validChapter(chapterIndex),
    auditChapter: injector.wrapAuditor(async input => passingAudit(input))
  });

  assert.equal(report.status, 'FAIL');
  assert.equal(report.execution_status, 'audit_failed');
  assert.equal(injector.getInjectedCount('AUDIT_REJECTED'), 1);
});

test('P7 故障注入: 存储层锁超时 (SQLITE_BUSY) 安全中断且不破坏已持久化状态', async () => {
  const store = makeStore();
  const injector = createFaultInjector();
  injector.addRule({
    fault: 'SQLITE_BUSY',
    maxInjections: 1
  });

  const wrappedStore = injector.wrapStore(store);

  // 抛出 SQLITE_BUSY 时工作区退出
  await assert.rejects(async () => {
    await runSoakTask({
      taskId: 'soak-fault-busy',
      replayManifest,
      milestone: 3,
      store: wrappedStore,
      generateChapter: async ({ chapterIndex }) => validChapter(chapterIndex),
      auditChapter: async input => passingAudit(input)
    });
  }, /database is locked/);

  // 锁释放后重新执行，可正常恢复
  const resumed = await runSoakTask({
    taskId: 'soak-fault-busy',
    replayManifest,
    milestone: 3,
    store,
    generateChapter: async ({ chapterIndex }) => validChapter(chapterIndex),
    auditChapter: async input => passingAudit(input)
  });

  assert.equal(resumed.status, 'PASS');
  assert.equal(resumed.execution_status, 'completed');
});

test('P7: 10章压测演练模拟执行 (模拟生成与全套检查点验证)', async () => {
  const store = makeStore();
  const checkpointCalls = [];

  const report = await runSoakTask({
    taskId: 'soak-10-run',
    replayManifest,
    milestone: 10,
    store,
    generateChapter: async ({ chapterIndex }) => validChapter(chapterIndex),
    auditChapter: async input => passingAudit(input),
    measureCheckpoint: async ({ chapterIndex }) => {
      checkpointCalls.push(chapterIndex);
      return measuredCheckpoint({ chapterIndex });
    }
  });

  assert.equal(report.status, 'PASS');
  assert.equal(report.completed_chapters, 10);
  assert.deepEqual(checkpointCalls, [10]);
  assert.ok(report.checkpoints['10']);
});
