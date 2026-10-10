'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const {
  detectOutlineCompletenessTier,
  validateAndEnforceFullScenePlan,
  deriveScenesFromEventChain,
  inferLightweightScenePlan,
  verifyCausalInvariants,
  planScenesTiered,
  compileSceneDirectives,
  CausalInvariantViolationError
} = require('../lib/scene-planner');

// ============================================================================
// Group 1: detectOutlineCompletenessTier 畸形与降级测试
// ============================================================================

test('ADV-M2-01: detectOutlineCompletenessTier 对根参数非对象/空输入具备防崩降级能力', () => {
  const primitives = [undefined, null, {}, '', 'invalid', 12345, true, false, [], () => {}, NaN];
  for (const input of primitives) {
    assert.doesNotThrow(() => {
      const res = detectOutlineCompletenessTier(input);
      assert.equal(res, 'goal_only');
    }, `Input ${input} should not throw and degrade to goal_only`);

    const detailed = detectOutlineCompletenessTier(input, {}, { asObject: true });
    assert.equal(detailed.tier, 'goal_only');
    assert.equal(detailed.mode, 'lightweight_inferred');
  }
});

test('ADV-M2-02: detectOutlineCompletenessTier 5维节拍门禁阈值严格判定 (>=2 字段为 event_chain, <2 为 goal_only)', () => {
  // 0 字段
  assert.equal(detectOutlineCompletenessTier({}), 'goal_only');

  // 1 字段 (不足 2 个)
  assert.equal(detectOutlineCompletenessTier({ protagonistAction: '踏入云岚宗' }), 'goal_only');

  // 2 字段 (满足门禁)
  assert.equal(detectOutlineCompletenessTier({
    protagonistAction: '踏入云岚宗',
    opposition: '遭到云岚宗执事阻拦'
  }), 'event_chain');

  // 全空白 5 维字段 -> 降级为 goal_only
  assert.equal(detectOutlineCompletenessTier({
    protagonistAction: '   ',
    opposition: '\t\n',
    informationChange: '',
    result: '  '
  }), 'goal_only');
});

test('ADV-M2-03 [BUG-FIXED-1]: detectOutlineCompletenessTier 对 beats 数组中的 null/undefined/空字符串过滤降级为 goal_only，且 deriveScenesFromEventChain 具备防崩防御', () => {
  // 1. beats 数组中仅有空字符串或空白字符时：
  // 预期：由于没有任何实质事件节拍，降级为 goal_only
  const emptyStrBeatsTier = detectOutlineCompletenessTier({ beats: ['   ', ''] });
  assert.equal(emptyStrBeatsTier, 'goal_only', 'beats with empty strings cleanly degrades to goal_only');

  // 2. beats 数组包含 null 元素：
  const nullBeatsTier = detectOutlineCompletenessTier({ beats: [null] });
  assert.equal(nullBeatsTier, 'goal_only', 'beats with null elements cleanly degrades to goal_only');

  // 3. 当向下传递执行 deriveScenesFromEventChain([null]) 时：
  // 防御性跳过空节拍，不抛出异常
  assert.doesNotThrow(() => {
    const res = deriveScenesFromEventChain([null]);
    assert.ok(res);
    assert.equal(res.tier, 'event_chain');
  }, 'deriveScenesFromEventChain([null]) 具备防御性检查，不抛出异常');

  // 4. 同样当向下传递执行 deriveScenesFromEventChain([undefined]) 时：
  assert.doesNotThrow(() => {
    const res = deriveScenesFromEventChain([undefined]);
    assert.ok(res);
    assert.equal(res.tier, 'event_chain');
  }, 'deriveScenesFromEventChain([undefined]) 具备防御性检查，不抛出异常');

  // 5. 统一入口 planScenesTiered 在 beats 包含 null 时降级并安全执行
  assert.doesNotThrow(() => {
    const plan = planScenesTiered({ contract: { beats: [null] } });
    assert.ok(plan);
    assert.equal(plan.tier, 'goal_only');
  }, 'planScenesTiered({ contract: { beats: [null] } }) 安全降级不崩溃');
});

// ============================================================================
// Group 2: deriveScenesFromEventChain 100 次重复执行确定性
// ============================================================================

test('ADV-M2-04: deriveScenesFromEventChain 100 次重复执行具有 100% 物理哈希一致性 (Zero-Drift Oracle)', () => {
  const fiveBeats = {
    protagonistAction: '萧炎身着黑袍独闯加列家族药坊',
    opposition: '加列毕族长携三名大斗师长老当街围堵',
    informationChange: '雅妃携拍卖行护卫队现身，亮出城主府禁制令',
    result: '加列家族被迫退让并割让坊市三成收益',
    hook: '魂殿黑雾在坊市阴影处悄然凝聚'
  };

  const options = { targetWordCount: 3000, contract: { viewpointCharacter: '萧炎' } };
  const baseline = deriveScenesFromEventChain(fiveBeats, options);
  const baselineJson = JSON.stringify(baseline);
  const baselineHash = crypto.createHash('sha256').update(baselineJson).digest('hex');

  assert.equal(baseline.freePlayPlot, false);
  assert.equal(baseline.creativeLicense, false);
  assert.equal(baseline.tier, 'event_chain');

  for (let i = 1; i <= 100; i++) {
    const run = deriveScenesFromEventChain(fiveBeats, options);
    const runJson = JSON.stringify(run);
    const runHash = crypto.createHash('sha256').update(runJson).digest('hex');
    assert.equal(runHash, baselineHash, `Run ${i}/100: sha256 hash must be identical to baseline`);
  }
});

// ============================================================================
// Group 3: inferLightweightScenePlan 不变性约束
// ============================================================================

test('ADV-M2-05: inferLightweightScenePlan 始终保证 freePlayPlot: true 与 creativeLicense: true 即使入参对抗篡改', () => {
  const adversarialOptions = [
    {},
    { freePlayPlot: false },
    { creativeLicense: false },
    { freePlayPlot: false, creativeLicense: false, tier: 'full_scenes' }
  ];

  for (const opt of adversarialOptions) {
    const plan = inferLightweightScenePlan('突破斗宗瓶颈', opt);
    assert.equal(plan.tier, 'goal_only');
    assert.equal(plan.freePlayPlot, true, 'freePlayPlot 必须恒为 true');
    assert.equal(plan.creativeLicense, true, 'creativeLicense 必须恒为 true');
    assert.deepEqual(plan.creativeLicenseScope, [
      'scene_progression',
      'micro_conflict',
      'inferred_beats',
      'dialogue_expansion'
    ]);
  }
});

// ============================================================================
// Group 4: verifyCausalInvariants 因果硬围栏与 autoPrune 深度对抗
// ============================================================================

test('ADV-M2-06: verifyCausalInvariants 严密物理拦截五大因果违规 (POV/mustNot/秘密/债务/终局反向)', () => {
  const contract = {
    viewpointCharacter: '萧炎',
    mustNot: ['使用骨灵冷火'],
    forbiddenKnowledge: ['药老灵魂体'],
    requiredPayoff: ['debt_herb_market'],
    irreversibleResult: '失败受挫退回萧家'
  };

  const offendingScenes = [
    { sceneIndex: 1, viewpointCharacter: '纳兰嫣然', goal: '冷眼俯视' }, // POV
    { sceneIndex: 2, viewpointCharacter: '萧炎', goal: '使用骨灵冷火对决' }, // mustNot
    { sceneIndex: 3, viewpointCharacter: '萧炎', goal: '识破药老灵魂体的奥秘' }, // secret leak
    { sceneIndex: 4, viewpointCharacter: '萧炎', goal: '顺手平账', resolvesDebt: 'debt_forbidden_heir' }, // unauthorized debt
    { sceneIndex: 5, viewpointCharacter: '萧炎', goal: '大获全胜彻底击溃敌酋秒杀全场' } // outcome reversal
  ];

  // 1. 常规验证返回 valid: false 且记录全部 5 处违规
  const check = verifyCausalInvariants(offendingScenes, contract);
  assert.equal(check.valid, false);
  assert.equal(check.violations.length, 5);

  // 2. throwOnViolation 必须抛出 CausalInvariantViolationError
  assert.throws(() => {
    verifyCausalInvariants(offendingScenes, contract, { throwOnViolation: true });
  }, err => {
    assert.ok(err instanceof CausalInvariantViolationError);
    assert.equal(err.code, 'CAUSAL_INVARIANT_VIOLATION');
    assert.equal(err.status, 422);
    assert.equal(err.violations.length, 5);
    return true;
  });
});

test('ADV-M2-07: autoPrune: true 在标准场景下成功剪除 mustNot 且不腐蚀合规剧情文本', () => {
  const contract = {
    viewpointCharacter: '林动',
    mustNot: ['施展大荒囚天指']
  };

  const scene = [
    {
      sceneIndex: 1,
      viewpointCharacter: '林动',
      goal: '林动施展纯阳拳迎敌，盛怒之下施展大荒囚天指击破掌印',
      rawNodeText: '林动施展纯阳拳迎敌，施展大荒囚天指'
    }
  ];

  const res = verifyCausalInvariants(scene, contract, { autoPrune: true });
  assert.equal(res.autoPruned, true);
  assert.ok(res.scenes[0].goal.includes('[已剪枝禁忌动作]'));
  assert.ok(!res.scenes[0].goal.includes('施展大荒囚天指'));
  // 合规文本必须完好无损保留
  assert.ok(res.scenes[0].goal.includes('林动施展纯阳拳迎敌'));

  // 剪枝后再次校验通过
  const checkAgain = verifyCausalInvariants(res.scenes, contract);
  assert.equal(checkAgain.valid, true);
});

test('ADV-M2-08 [BUG-FIXED-2]: autoPrune: true 全字段清洗盲区闭环，二次因果审计 100% 真实通过 (Complete Scrubbing Oracle)', () => {
  const contract = {
    viewpointCharacter: '萧炎',
    mustNot: ['破坏丹鼎'],
    forbiddenKnowledge: ['药老附身'],
    requiredPayoff: ['debt_pass']
  };

  // 1. 秘密泄露若出现在 rawNodeText 中，autoPrune 全字段替换清洗
  const sceneWithSecretInRawNode = [
    {
      sceneIndex: 1,
      goal: '与雅妃商谈合作',
      rawNodeText: '雅妃察觉异状，提前识破药老附身的秘密'
    }
  ];

  const resSecret = verifyCausalInvariants(sceneWithSecretInRawNode, contract, { autoPrune: true });
  assert.equal(resSecret.autoPruned, true);
  // 验证: rawNodeText 中的秘密已被剪除替换为 [保密信息]
  assert.ok(
    !resSecret.scenes[0].rawNodeText.includes('药老附身'),
    'autoPrune scrubs secret from rawNodeText'
  );
  assert.ok(
    resSecret.scenes[0].rawNodeText.includes('[保密信息]'),
    'rawNodeText masked with [保密信息]'
  );
  // 二次因果校验必须 100% 通过
  const reAuditSecret = verifyCausalInvariants(resSecret.scenes, contract);
  assert.equal(
    reAuditSecret.valid,
    true,
    'Re-audit passes because secret in rawNodeText was scrubbed'
  );

  // 2. mustNot 出现在 action / description / summary 字段中，autoPrune 全字段剪枝
  const sceneWithForbiddenInAction = [
    {
      sceneIndex: 1,
      goal: '炼制聚气丹',
      rawNodeText: '控火炼丹',
      action: '炼制失控怒而破坏丹鼎'
    }
  ];

  const resMustNot = verifyCausalInvariants(sceneWithForbiddenInAction, contract, { autoPrune: true });
  assert.equal(resMustNot.autoPruned, true);
  assert.ok(
    !resMustNot.scenes[0].action.includes('破坏丹鼎'),
    'autoPrune scrubs forbidden act from action property'
  );
  assert.ok(
    resMustNot.scenes[0].action.includes('[已剪枝禁忌动作]'),
    'action masked with [已剪枝禁忌动作]'
  );
  const reAuditMustNot = verifyCausalInvariants(resMustNot.scenes, contract);
  assert.equal(
    reAuditMustNot.valid,
    true,
    'Re-audit passes because mustNot in action field was scrubbed'
  );

  // 3. 未排期因果债务投机核销 resolvesDebt 被 autoPrune 彻底移除自愈
  const sceneWithUnauthorizedDebt = [
    {
      sceneIndex: 1,
      goal: '常规买药',
      resolvesDebt: 'debt_unauthorized_999'
    }
  ];

  const resDebt = verifyCausalInvariants(sceneWithUnauthorizedDebt, contract, { autoPrune: true });
  assert.equal(resDebt.autoPruned, true);
  assert.equal(resDebt.scenes[0].resolvesDebt, undefined, 'unauthorized debt removed from scene');
  const reAuditDebt = verifyCausalInvariants(resDebt.scenes, contract);
  assert.equal(
    reAuditDebt.valid,
    true,
    'Re-audit passes because unauthorized debt was deleted'
  );
});

test('ADV-M2-09: 正则元字符免疫与特殊字符串安全测试', () => {
  const specialChars = '元字符[.*+?^${}()|\\/]?测试(安全)';
  const contract = {
    viewpointCharacter: '楚阳',
    mustNot: [specialChars],
    forbiddenKnowledge: [specialChars]
  };

  const scene = [
    {
      sceneIndex: 1,
      goal: '楚阳挥剑尝试' + specialChars + '，并察觉' + specialChars + '之秘'
    }
  ];

  assert.doesNotThrow(() => {
    const res = verifyCausalInvariants(scene, contract);
    assert.equal(res.valid, false);
    assert.ok(res.violations.some(v => v.type === 'MUST_NOT_VIOLATION'));
    assert.ok(res.violations.some(v => v.type === 'FORBIDDEN_KNOWLEDGE_LEAK'));
  });

  assert.doesNotThrow(() => {
    const pruned = verifyCausalInvariants(scene, contract, { autoPrune: true });
    assert.equal(pruned.autoPruned, true);
  });
});
