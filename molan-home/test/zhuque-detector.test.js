'use strict';
// 朱雀官方检测服务：配置开关、响应归一化、全绿判定、缓存与失败降级。

const test = require('node:test');
const assert = require('node:assert');
const {
  MIN_TEXT_CHARS,
  isZhuqueConfigured,
  normalizeResponse,
  zhuqueGateReached,
  detectZhuque,
  resetZhuqueCache
} = require('../services/zhuque-detector-service');

const LONG_TEXT = '她把碗放回案几，窗外竹影还在晃。'.repeat(24);

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function successPayload(green) {
  return {
    status: 'success',
    softmax_confidence: green ? 0.04 : 0.72,
    ratio_confidence: 0,
    labels_ratio: green ? { '0': 0.995, '1': 0.002, '2': 0.003 } : { '0': 0.14, '1': 0.02, '2': 0.84 },
    segment_labels: [{
      text: LONG_TEXT,
      label: green ? 0 : 2,
      conf: green ? 0.18 : 0.86,
      order: 1,
      position: [0, LONG_TEXT.length]
    }],
    usage: { total_tokens: LONG_TEXT.length },
    msg: '',
    makers_models_usage: { total_tokens: Math.round(LONG_TEXT.length * 1.67) }
  };
}

test('未配置 MAKERS_MODELS_KEY 时不启用，也不发起请求', async () => {
  resetZhuqueCache();
  assert.equal(isZhuqueConfigured({}), false);
  assert.equal(isZhuqueConfigured({ MAKERS_MODELS_KEY: '  ' }), false);
  assert.equal(isZhuqueConfigured({ MAKERS_MODELS_KEY: 'key' }), true);
  let called = false;
  const result = await detectZhuque(LONG_TEXT, {
    env: {},
    fetchImpl: async () => { called = true; return response(successPayload(true)); }
  });
  assert.equal(result, null);
  assert.equal(called, false);
});

test('响应归一化：人工/AI/疑似占比、片段 AIGC 值与扣费 token', () => {
  const report = normalizeResponse(successPayload(false));
  assert.equal(report.ok, true);
  assert.equal(report.greenRatio, 0.14);
  assert.equal(report.aiLikeRatio, 0.86);
  assert.equal(report.aiScore, 86);
  assert.equal(report.segments.length, 1);
  assert.equal(report.segments[0].label, 2);
  assert.equal(report.segments[0].aigc, 0.86);
  assert.equal(report.usage.makersTokens, Math.round(LONG_TEXT.length * 1.67));
  assert.equal(report.usage.modelTokens, LONG_TEXT.length);
});

test('全绿判定：所有片段为人工且 AIGC 值不超阈值', () => {
  const green = normalizeResponse(successPayload(true));
  const yellow = normalizeResponse(successPayload(false));
  assert.equal(zhuqueGateReached(green), true);
  assert.equal(zhuqueGateReached(yellow), false);
  assert.equal(zhuqueGateReached(null), false);
  assert.equal(zhuqueGateReached({ ...green, ok: false }), false);
  assert.equal(zhuqueGateReached(green, { minGreenRatio: 0.999, maxSegmentAigc: 0.001 }), false);
});

test('短文本直接拒绝，不发请求', async () => {
  resetZhuqueCache();
  let called = false;
  const result = await detectZhuque('太短了', {
    env: { MAKERS_MODELS_KEY: 'key' },
    fetchImpl: async () => { called = true; return response(successPayload(true)); }
  });
  assert.equal(result.status, 'too_short');
  assert.equal(called, false);
  assert.ok(MIN_TEXT_CHARS >= 350);
});

test('相同文本命中缓存，不重复扣费', async () => {
  resetZhuqueCache();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(successPayload(true)); };
  const env = { MAKERS_MODELS_KEY: 'key' };
  const first = await detectZhuque(LONG_TEXT, { env, fetchImpl });
  const second = await detectZhuque(LONG_TEXT, { env, fetchImpl });
  assert.equal(first.cached, undefined);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test('HTTP 错误与网络异常均返回可降级结果，不抛出', async () => {
  resetZhuqueCache();
  const env = { MAKERS_MODELS_KEY: 'key' };
  const httpError = await detectZhuque(LONG_TEXT, { env, fetchImpl: async () => response({}, 503) });
  assert.equal(httpError.ok, false);
  assert.equal(httpError.status, 'http_error');
  const networkError = await detectZhuque(`${LONG_TEXT}变体`, {
    env,
    fetchImpl: async () => { throw new Error('ECONNRESET'); }
  });
  assert.equal(networkError.ok, false);
  assert.equal(networkError.status, 'network_error');
});
