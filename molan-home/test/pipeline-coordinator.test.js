'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PIPELINE_STATES,
  PipelineCoordinator,
  RETRY_POLICIES,
  classifyError,
  parseDecoupledStream,
  applyHunkPatch
} = require('../lib/pipeline-coordinator');

test('OPT-ARCH-001: 流式计费控制帧与心跳多路解耦 (DEF-PIPE-001)', () => {
  const mixedSseStream = [
    ': ping',
    '',
    'data: {"molan_billing":{"cost":0.035,"balance":120.5}}',
    '',
    'data: {"choices":[{"delta":{"content":"寒风拂面，"}}]}',
    '',
    ': keep-alive',
    '',
    'data: {"molan_billing":{"event":"metering"}}',
    '',
    'data: {"choices":[{"delta":{"content":"神殿大门被狂暴的力量震碎。"}}]}',
    '',
    'data: [DONE]'
  ].join('\n');

  const result = parseDecoupledStream(mixedSseStream);

  assert.equal(result.removedHeartbeats, 2, '心跳帧必须全部被过滤');
  assert.equal(result.removedBillingEvents, 2, '计费控制帧必须全部被多路隔离');
  assert.equal(result.content, '寒风拂面，神殿大门被狂暴的力量震碎。');
  assert.equal(result.streamErrors.length, 0);
});

test('OPT-ARCH-001: Pipeline Coordinator 状态机生命周期流转', () => {
  const coordinator = new PipelineCoordinator({ id: 'test-ch-001' });

  assert.equal(coordinator.getState(), PIPELINE_STATES.INIT);

  // INIT -> GENERATING
  coordinator.transitionTo(PIPELINE_STATES.GENERATING);
  assert.equal(coordinator.getState(), PIPELINE_STATES.GENERATING);

  // GENERATING -> VALIDATING
  coordinator.chapterContent = '初始生成正文：张若尘走入神殿。';
  coordinator.transitionTo(PIPELINE_STATES.VALIDATING);
  assert.equal(coordinator.getState(), PIPELINE_STATES.VALIDATING);

  // 非法状态跃迁必须被拦截
  assert.throws(() => {
    coordinator.transitionTo(PIPELINE_STATES.GENERATING);
  }, /非法状态迁移/);

  // VALIDATING -> COMMITTED
  const commitRes = coordinator.commit({ passed: true });
  assert.equal(commitRes.state, PIPELINE_STATES.COMMITTED);
  assert.equal(coordinator.getState(), PIPELINE_STATES.COMMITTED);
});

test('OPT-ARCH-001: 增量 Diff 补丁修订 (Hunk Patching) 代替全量重写', () => {
  const coordinator = new PipelineCoordinator();
  coordinator.transitionTo(PIPELINE_STATES.GENERATING);
  coordinator.chapterContent = '神灵威压落下。张若尘笑了笑，自称是地姥女婿，随后离开。';
  coordinator.transitionTo(PIPELINE_STATES.VALIDATING);

  // 针对缺陷进行精准局部增量修补
  const patchResult = coordinator.applyRevisionPatch({
    searchSnippet: '自称是地姥女婿',
    replacementSnippet: '神威如天柱倾覆，张若尘骨骼微鸣，强行稳住心神自嘲道：“天阁目的夫婿可不是好当的。”'
  });

  assert.equal(patchResult.success, true);
  assert.ok(coordinator.chapterContent.includes('天阁目的夫婿'));
  assert.ok(!coordinator.chapterContent.includes('地姥女婿'));
  assert.equal(coordinator.getState(), PIPELINE_STATES.VALIDATING);

  coordinator.commit({ passed: true });
  assert.equal(coordinator.getState(), PIPELINE_STATES.COMMITTED);
});

test('OPT-ARCH-001: 指数退避重试网络韧性', async () => {
  const coordinator = new PipelineCoordinator({ maxRetries: 3, initialBackoffMs: 10 });
  let attempts = 0;

  // 模拟前 2 次失败，第 3 次成功的网络请求
  const res = await coordinator.executeWithRetry('fetchStreamChunk', async (attempt) => {
    attempts = attempt;
    if (attempt < 2) {
      throw new Error('网络瞬态抖动 ETIMEDOUT');
    }
    return { status: 200, data: 'OK' };
  });

  assert.equal(attempts, 2);
  assert.equal(res.data, 'OK');
});

test('P1 收敛约束: classifyError 严格区分 retryable / non_retryable / unknown', () => {
  // Retryable
  assert.equal(classifyError({ status: 429 }), RETRY_POLICIES.RETRYABLE);
  assert.equal(classifyError({ status: 503 }), RETRY_POLICIES.RETRYABLE);
  assert.equal(classifyError({ code: 'RATE_LIMIT_EXCEEDED' }), RETRY_POLICIES.RETRYABLE);
  assert.equal(classifyError({ code: 'ECONNRESET' }), RETRY_POLICIES.RETRYABLE);
  assert.equal(classifyError({ code: 'ETIMEDOUT' }), RETRY_POLICIES.RETRYABLE);
  assert.equal(classifyError({ retryable: true }), RETRY_POLICIES.RETRYABLE);

  // Unknown (绝对不可重试)
  assert.equal(classifyError({ code: 'PROVIDER_UNKNOWN' }), RETRY_POLICIES.UNKNOWN);
  assert.equal(classifyError({ unknown: true }), RETRY_POLICIES.UNKNOWN);
  assert.equal(classifyError(new Error('Provider 调用结果未知')), RETRY_POLICIES.UNKNOWN);

  // Non-retryable
  assert.equal(classifyError({ status: 400 }), RETRY_POLICIES.NON_RETRYABLE);
  assert.equal(classifyError({ status: 403 }), RETRY_POLICIES.NON_RETRYABLE);
  assert.equal(classifyError({ status: 409 }), RETRY_POLICIES.NON_RETRYABLE);
  assert.equal(classifyError({ status: 413 }), RETRY_POLICIES.NON_RETRYABLE);
  assert.equal(classifyError({ code: 'CONTRACT_INVALID' }), RETRY_POLICIES.NON_RETRYABLE);
  assert.equal(classifyError({ code: 'STATE_CONFLICT' }), RETRY_POLICIES.NON_RETRYABLE);
  assert.equal(classifyError({ retryable: false }), RETRY_POLICIES.NON_RETRYABLE);
});

test('P1 收敛约束: executeWithRetry 对 non_retryable 错误立即阻断且零重试', async () => {
  const coordinator = new PipelineCoordinator({ maxRetries: 3, initialBackoffMs: 5 });
  let callCount = 0;

  await assert.rejects(
    async () => {
      await coordinator.executeWithRetry('contractValidation', async () => {
        callCount += 1;
        const err = new Error('参数校验未通过');
        err.status = 422;
        err.code = 'CONTRACT_INVALID';
        throw err;
      });
    },
    err => {
      assert.equal(err.code, 'CONTRACT_INVALID');
      assert.equal(err.retryPolicy, RETRY_POLICIES.NON_RETRYABLE);
      return true;
    }
  );

  assert.equal(callCount, 1, '不可重试错误必须在首次尝试失败后立即阻断，调用次数必须为 1');
});

test('P1 收敛约束: executeWithRetry 对 unknown Provider 结果绝对禁止自动重试', async () => {
  const coordinator = new PipelineCoordinator({ maxRetries: 3, initialBackoffMs: 5 });
  let providerCalls = 0;

  await assert.rejects(
    async () => {
      await coordinator.executeWithRetry('providerStreamCall', async () => {
        providerCalls += 1;
        const err = new Error('模型服务调用超时且连接中断，结果未知');
        err.code = 'PROVIDER_UNKNOWN';
        err.unknown = true;
        throw err;
      });
    },
    err => {
      assert.equal(err.code, 'PROVIDER_UNKNOWN');
      assert.equal(err.unknown, true);
      assert.equal(err.retryPolicy, RETRY_POLICIES.UNKNOWN);
      return true;
    }
  );

  assert.equal(providerCalls, 1, '未知结果的 Provider 调用严禁自动重试，调用次数必须严格为 1');
});

test('P1 收敛约束: 生产生成主入口隔离 (旧版 Pipeline 不得被生产主链直接调用)', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  // 1. 验证 server.js 生产链路没有 require 旧版 pipeline-coordinator 或 generation-pipeline-coordinator
  assert.doesNotMatch(
    serverCode,
    /require\s*\(\s*['"][^'"]*pipeline-coordinator['"]\s*\)/,
    'server.js 严禁引用旧版 pipeline-coordinator'
  );

  // 2. 验证唯一生产生成入口为 orchestrator.js
  assert.match(
    serverCode,
    /require\s*\(\s*['"]\.\/lib\/generation\/orchestrator['"]\s*\)/,
    'server.js 必须且仅引用 lib/generation/orchestrator'
  );

  // 3. 验证 orchestrator 严格依赖唯一业务状态机 state-machine.js
  const orchestratorCode = fs.readFileSync(path.join(__dirname, '../lib/generation/orchestrator.js'), 'utf8');
  assert.match(
    orchestratorCode,
    /require\s*\(\s*['"]\.\/state-machine['"]\s*\)/,
    'orchestrator 必须严格依赖 state-machine.js 业务状态机'
  );
});

