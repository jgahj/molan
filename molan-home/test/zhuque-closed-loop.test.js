'use strict';
// 朱雀闭环服务：多候选真实生成、真值择优、纯诊断改写（不注入抽取的真人片段）。

const test = require('node:test');
const assert = require('node:assert');
const {
  parseTemperatures,
  parseRounds,
  createZhuqueClosedLoopService
} = require('../services/zhuque-closed-loop-service');

function report(aiScore, green, label, conf) {
  return {
    ok: true,
    status: 'success',
    aiScore,
    greenRatio: green,
    riskConfidence: aiScore / 100,
    segments: [{ index: 1, label, aigc: conf, green: label === 0 && conf < 0.5, text: 'x'.repeat(400), position: [0, 400] }],
    usage: { makersTokens: 700 }
  };
}

function buildService(detectImpl) {
  const humanizeCalls = [];
  const compileCalls = [];
  const service = createZhuqueClosedLoopService({
    compileDraftPrompt: options => { compileCalls.push(options); return { systemPrompt: 'sys', userPrompt: 'user' }; },
    buildDraftRequest: options => ({
      renderedPromptPackage: { messages: [{ role: 'user', content: 'draft-' + options.temperature }] },
      maxTokens: 3200
    }),
    buildHumanizePassMessages: (text, meta) => {
      humanizeCalls.push({ text, meta });
      return [{ role: 'user', content: 'rewrite-' + text }];
    },
    detectZhuque: detectImpl || (async text => {
      if (text === 'candidate-0.95') return report(30.3, 0.697, 2, 0.72);
      if (text === 'candidate-1.05') return report(31.4, 0.686, 2, 0.56);
      if (text === 'rewrite-1') return report(0, 1, 0, 0.27);
      return report(100, 0, 2, 0.9);
    }),
    zhuqueGateReached: r => Boolean(r && r.ok && r.greenRatio >= 0.99 && r.segments.every(s => s.green && s.aigc < 0.5))
  });
  return { service, humanizeCalls, compileCalls };
}

test('温度与轮数解析有安全边界', () => {
  assert.deepEqual(parseTemperatures('0.8, 1.0, bad, 3'), [0.8, 1]);
  assert.deepEqual(parseTemperatures(null), [0.82, 0.95, 1.05]);
  assert.equal(parseRounds('9'), 4);
  assert.equal(parseRounds('-1'), 0);
  assert.equal(parseRounds(undefined), 2);
});

test('闭环：多候选择优 + 纯诊断改写后达到全绿', async () => {
  const { service, humanizeCalls, compileCalls } = buildService();
  const modelCalls = [];
  const result = await service.run({
    authToken: 't',
    user: { email: 'a@b.c' },
    input: { modelId: 'gpt-6-luna', novelGenre: '传统玄幻', userInstruction: '写正文', targetChars: 1600 },
    callModel: async (_token, _user, options) => {
      modelCalls.push(options);
      const text = options.messages[0].content.startsWith('draft-')
        ? 'candidate-' + options.temperature
        : 'rewrite-1';
      return { text, usage: { totalTokens: 100 } };
    },
    env: {}
  });
  assert.equal(modelCalls.length, 4, '三候选 + 一次诊断改写');
  assert.equal(modelCalls.every(c => /^req_[a-f0-9]{40}$/.test(c.requestId)), true, '内部模型调用必须携带合法幂等键');
  assert.equal(new Set(modelCalls.map(c => c.requestId)).size, modelCalls.length, '每次模型调用的幂等键必须唯一');
  assert.equal(modelCalls.every(c => c.requireComplete === true), true, '必须走内部路由，避免被普通写章入口拦截');
  assert.equal(modelCalls.every(c => c.disableBenchmarkProtocol === true), true, '闭环提示词不能被 benchmark 协议污染');
  assert.deepEqual(modelCalls.map(c => c.temperature), [0.82, 0.95, 1.05, 1]);
  assert.equal(compileCalls.every(c => c.request.disableLivingExemplars === true), true, '起草不得注入抽取真人片段');
  assert.equal(humanizeCalls.length, 1);
  assert.equal(humanizeCalls[0].meta.includeLivingExemplars, false, '改写不得注入抽取真人片段');
  assert.ok(humanizeCalls[0].meta.zhuqueReport, '诊断必须含朱雀真值');
  assert.equal(result.ok, true);
  assert.equal(result.allGreen, true);
  assert.equal(result.selected.phase, 'rewrite');
  assert.equal(result.text, 'rewrite-1');
  assert.equal(result.candidates.length, 3);
  assert.equal(result.rewrites.length, 1);
});

test('短黄段由按位置定点修补清除', async () => {
  const longText = '甲'.repeat(1200);
  const humanizeCalls = [];
  const service = createZhuqueClosedLoopService({
    compileDraftPrompt: () => ({ systemPrompt: 's', userPrompt: 'u' }),
    buildDraftRequest: options => ({ renderedPromptPackage: { messages: [{ role: 'user', content: 'draft-' + options.temperature }] }, maxTokens: 3200 }),
    buildHumanizePassMessages: (_text, meta) => {
      const focused = meta.zhuqueReport && meta.zhuqueReport.aiScore === 13.4;
      humanizeCalls.push({ focused, meta });
      return [{ role: 'user', content: (focused ? 'repair-' : 'rewrite-') + 'x' }];
    },
    detectZhuque: async text => {
      if (text === 'candidate-0.9') return report(100, 0, 2, 0.9);
      if (text.includes('REPAIR')) return report(0, 1, 0, 0.2);
      if (text.includes('REWRITE')) {
        return {
          ok: true, status: 'success', aiScore: 13.4, greenRatio: 0.7, riskConfidence: 0.33,
          segments: [
            { index: 1, label: 2, aigc: 0.56, green: false, text: '乙'.repeat(267), position: [0, 267] },
            { index: 2, label: 0, aigc: 0.27, green: true, text: '丙'.repeat(1000), position: [267, 1000] }
          ]
        };
      }
      return report(0, 1, 0, 0.2);
    },
    zhuqueGateReached: r => Boolean(r && r.ok && r.greenRatio >= 0.99 && r.segments.every(s => s.green && s.aigc < 0.5))
  });
  const modelCalls = [];
  const result = await service.run({
    authToken: 't', user: {},
    input: { temperatures: [0.9], rewriteRounds: 1, segmentRepairRounds: 2 },
    callModel: async (_t, _u, options) => {
      modelCalls.push(options);
      const prefix = options.messages[0].content.slice(0, 8);
      if (prefix.startsWith('draft-')) return { text: 'candidate-0.9' };
      if (prefix.startsWith('repair-')) return { text: longText + 'REPAIR' };
      return { text: longText + 'REWRITE' };
    },
    env: {}
  });
  assert.equal(modelCalls.length, 3, '候选 + 整段改写 + 定点修补');
  assert.equal(humanizeCalls.some(c => c.focused), true, '应触发带 focused 诊断的定点修补');
  assert.equal(humanizeCalls.find(c => c.focused).meta.includeLivingExemplars, false);
  assert.equal(result.allGreen, true);
  assert.equal(result.text.includes('REPAIR'), true, '下发的应是修补后版本');
  assert.equal(result.segmentRepairs.length, 1);
});

test('首轮候选已全绿时跳过改写', async () => {
  const { service, humanizeCalls } = buildService(async () => report(0, 1, 0, 0.2));
  let calls = 0;
  const result = await service.run({
    authToken: 't',
    user: {},
    input: { temperatures: [0.9], rewriteRounds: 2 },
    callModel: async () => { calls += 1; return { text: 'draft0.9' }; },
    env: {}
  });
  assert.equal(calls, 1);
  assert.equal(humanizeCalls.length, 0);
  assert.equal(result.allGreen, true);
  assert.equal(result.selected.phase, 'candidate');
});
