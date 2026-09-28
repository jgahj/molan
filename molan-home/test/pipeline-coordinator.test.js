'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PIPELINE_STATES,
  PipelineCoordinator,
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
