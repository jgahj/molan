'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CircuitBreaker,
  CIRCUIT_STATES,
  isBreakerTriggeringError
} = require('../lib/stability/circuit-breaker');
const { ConcurrencyManager } = require('../lib/stability/concurrency');
const { DeadlineTracker } = require('../lib/stability/deadline');
const {
  ERROR_CATALOG,
  ALL_ERROR_CODES,
  getErrorDefinition,
  isRetryable,
  formatApiError
} = require('../lib/stability/error-catalog');
const { GenerationError } = require('../lib/generation/errors');

test('P1 Guardrails - CircuitBreaker transitions and fast-fails', async () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    resetTimeoutMs: 50,
    halfOpenMaxSuccesses: 2,
    windowSizeMs: 1000
  });

  const provider = 'mock-llm';
  assert.equal(breaker.canExecute(provider), true);
  assert.equal(breaker.getState(provider).state, CIRCUIT_STATES.CLOSED);

  // 模拟普通非触发错误 (如 422)，不计入熔断
  breaker.recordFailure(provider, new GenerationError('CONTRACT_INVALID', 'format error', { status: 422 }));
  assert.equal(breaker.getState(provider).failureCount, 0);

  // 记录连续 3 次 5xx 故障
  breaker.recordFailure(provider, new GenerationError('MODEL_5XX', 'upstream down', { status: 502 }));
  breaker.recordFailure(provider, new GenerationError('MODEL_TIMEOUT', 'timeout', { status: 504 }));
  breaker.recordFailure(provider, new GenerationError('PROVIDER_UNKNOWN', 'unknown', { status: 502 }));

  // 此时应当转为 OPEN
  assert.equal(breaker.canExecute(provider), false);
  assert.equal(breaker.getState(provider).state, CIRCUIT_STATES.OPEN);

  // 在 OPEN 状态下 execute 应当快速失败，抛出 CIRCUIT_BREAKER_OPEN
  await assert.rejects(
    async () => breaker.execute(provider, async () => 'hello'),
    err => {
      assert.equal(err.code, 'CIRCUIT_BREAKER_OPEN');
      assert.equal(err.status, 503);
      return true;
    }
  );

  // 等待冷却时间后转入 HALF_OPEN
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(breaker.getState(provider).state, CIRCUIT_STATES.HALF_OPEN);
  assert.equal(breaker.canExecute(provider), true);

  // 在 HALF_OPEN 下完成 2 次成功试探
  await breaker.execute(provider, async () => 'probe-1');
  assert.equal(breaker.getState(provider).state, CIRCUIT_STATES.HALF_OPEN);
  await breaker.execute(provider, async () => 'probe-2');

  // 试探成功，恢复为 CLOSED
  assert.equal(breaker.getState(provider).state, CIRCUIT_STATES.CLOSED);
  assert.equal(breaker.canExecute(provider), true);
});

test('P1 Guardrails - ConcurrencyManager enforces single run and revision lock per project', () => {
  const manager = new ConcurrencyManager();
  const projectId = 'p_test_101';
  const run1 = 'run_alpha';
  const run2 = 'run_beta';

  // 1. 获取 run1 锁成功
  const lock1 = manager.acquireRunLock(projectId, run1, { ttlMs: 5000 });
  assert.equal(lock1.acquired, true);

  // 2. run2 尝试获取同一项目锁被拒绝 (抛出 CONCURRENCY_LOCKED)
  assert.throws(
    () => manager.acquireRunLock(projectId, run2),
    err => {
      assert.equal(err.code, 'CONCURRENCY_LOCKED');
      assert.equal(err.status, 409);
      assert.equal(err.details.activeRunId, run1);
      return true;
    }
  );

  // 3. run1 续期成功
  const renewed = manager.acquireRunLock(projectId, run1, { ttlMs: 10000 });
  assert.equal(renewed.acquired, true);
  assert.equal(renewed.renewed, true);

  // 4. 其他任务无权释放活跃锁
  assert.equal(manager.releaseRunLock(projectId, run2), false);

  // 5. run1 正确释放锁后，run2 可以获取
  assert.equal(manager.releaseRunLock(projectId, run1), true);
  const lock2 = manager.acquireRunLock(projectId, run2, { ttlMs: 5000 });
  assert.equal(lock2.acquired, true);
  assert.equal(lock2.runId, run2);

  // 6. 修订锁独立管理
  const rev1 = 'rev_gamma';
  const revLock1 = manager.acquireRevisionLock(projectId, rev1);
  assert.equal(revLock1.acquired, true);
  assert.throws(() => manager.acquireRevisionLock(projectId, 'rev_delta'));
  assert.equal(manager.releaseRevisionLock(projectId, rev1), true);
});

test('P1 Guardrails - DeadlineTracker monitors stage timeouts and global limit', async () => {
  const tracker = new DeadlineTracker({
    totalTimeoutMs: 100, // 全局 100ms
    stageTimeouts: {
      writer: 40 // 阶段 40ms
    }
  });

  // 测试阶段超时
  await assert.rejects(
    async () => tracker.withTimeout('writer', () => new Promise(resolve => setTimeout(resolve, 80))),
    err => {
      assert.equal(err.code, 'STAGE_TIMEOUT');
      assert.equal(err.status, 504);
      return true;
    }
  );

  // 等待超出全局死线
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.throws(
    () => tracker.checkTotalDeadline(),
    err => {
      assert.equal(err.code, 'RUN_TIMEOUT');
      assert.equal(err.status, 504);
      return true;
    }
  );
});

test('P1 Guardrails - ErrorCatalog mappings and API format', () => {
  assert.ok(ALL_ERROR_CODES.length >= 25);
  assert.ok(ALL_ERROR_CODES.includes('CIRCUIT_BREAKER_OPEN'));
  assert.ok(ALL_ERROR_CODES.includes('CONCURRENCY_LOCKED'));
  assert.ok(ALL_ERROR_CODES.includes('STAGE_TIMEOUT'));
  assert.ok(ALL_ERROR_CODES.includes('RUN_TIMEOUT'));
  assert.ok(ALL_ERROR_CODES.includes('QUALITY_UNMEASURED'));
  assert.ok(ALL_ERROR_CODES.includes('DUAL_JUDGE_DISCREPANCY'));

  const cbDef = getErrorDefinition('CIRCUIT_BREAKER_OPEN');
  assert.equal(cbDef.httpStatus, 503);
  assert.equal(cbDef.retryable, false);

  const lockDef = getErrorDefinition('CONCURRENCY_LOCKED');
  assert.equal(lockDef.httpStatus, 409);
  assert.equal(lockDef.retryable, true);

  const apiErr = formatApiError('STAGE_TIMEOUT', '子任务耗时过长', { stage: 'writer' });
  assert.equal(apiErr.error.code, 'STAGE_TIMEOUT');
  assert.equal(apiErr.error.message, '子任务耗时过长');
  assert.equal(apiErr.error.details.stage, 'writer');
});
