'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateBenchmarkCallTimeoutMs } = require('../lib/benchmark-call-timeout');

test('短模型调用保留三分钟默认时限', () => {
  assert.equal(calculateBenchmarkCallTimeoutMs({ stage: 'single', maxTokens: 2000 }, {}), 180000);
});

test('长正文时限随输出 token 预算延长', () => {
  assert.equal(calculateBenchmarkCallTimeoutMs({ stage: 'writing', maxTokens: 8000 }, {}), 713334);
});

test('显式长调用也使用 token 预算并限制在十五分钟内', () => {
  assert.equal(calculateBenchmarkCallTimeoutMs({ stage: 'single', maxTokens: 5000, disableTimeout: true }, {}), 513334);
  assert.equal(calculateBenchmarkCallTimeoutMs({ stage: 'writing', maxTokens: 16000 }, {}), 900000);
});

test('环境变量优先并限制在允许范围', () => {
  assert.equal(calculateBenchmarkCallTimeoutMs({ stage: 'writing', maxTokens: 8000 }, { MOLAN_BENCHMARK_CALL_TIMEOUT_MS: '42000' }), 42000);
  assert.equal(calculateBenchmarkCallTimeoutMs({}, { MOLAN_BENCHMARK_CALL_TIMEOUT_MS: '10000' }), 30000);
  assert.equal(calculateBenchmarkCallTimeoutMs({}, { MOLAN_BENCHMARK_CALL_TIMEOUT_MS: '1200000' }), 900000);
});
