'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { auditSemantics, screenDeterministicSemantics, verifyQuoteInText, SEMANTIC_AUDIT_STATUS } = require('../lib/generation/semantic-audit');
const { preservesMeaning, applyLocalRevision } = require('../lib/generation/revision');

test('P4 真实语义审计: 第一人称视点全知越界拦截并绑定真实 Quote', async () => {
  const badText = `我握紧手中的短刀，看着前方的黑衣人。他心里暗想我其实早已体力不支，嘴角露出一丝冷笑。`;

  const result = await auditSemantics({
    draft: badText,
    contract: {
      pov: 'first-person',
      viewpointCharacter: '我',
      chapterGoal: '突围'
    }
  });

  assert.equal(result.passed, false, '全知越界必须判定审计不通过');
  assert.equal(result.blockerCount, 1, '必须准确记录1个阻断项');
  assert.equal(result.issues[0].category, 'pov');
  assert.equal(result.issues[0].severity, 'blocker');
  assert.equal(result.issues[0].status, 'verified');
  assert.ok(badText.includes(result.issues[0].quote), 'Quote 必须在正文中逐字存在');
  assert.equal(result.dimensions.povBoundary.value < 0.5, true, '视点越界后 povBoundary 维度分值必须降低');
});

test('P4 真实语义审计: 禁载知识泄露精准拦截', async () => {
  const leakText = `陆羽站在古井边，沉思片刻。传国玉玺在古井下，这一点他早已心知肚明。`;

  const result = await auditSemantics({
    draft: leakText,
    contract: {
      pov: 'third-limited',
      viewpointCharacter: '陆羽',
      forbiddenKnowledge: [{ id: 'k1', fact: '传国玉玺在古井下' }]
    }
  });

  assert.equal(result.passed, false);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.issues[0].category, 'knowledge');
  assert.ok(result.issues[0].quote.includes('传国玉玺在古井下'));
});

test('P4 真实语义审计: 正常合格正文通过审计并生成真实依据', async () => {
  const goodText = `陆羽站在古井旁，冷雨打湿了石栏。
“少爷，我们要找的东西真在这里？”老仆提着风灯，低声问道。
陆羽没有回答，只是伸手探入冰冷的井水，指尖触到了一块凸起的石砖。`;

  const result = await auditSemantics({
    draft: goodText,
    contract: {
      pov: 'third-limited',
      viewpointCharacter: '陆羽',
      chapterGoal: '探寻古井暗记'
    }
  });

  assert.equal(result.passed, true);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.dimensions.povBoundary.status, 'MEASURED');
  assert.equal(result.dimensions.dialogue.status, 'MEASURED');
  assert.ok(result.dimensions.dialogue.evidence[0].includes('对白字数占比'));
});

test('P4 局修 Invariant Snapshot: 严厉拦截否定极性反转（反“他没有杀她”改“他杀了她”）', () => {
  // 案例 1: 否定变肯定 -> 致命剧情反转，必须拒绝
  const flipped = preservesMeaning({
    before: '他没有杀她，只是拿走了她身上的玉佩。',
    after: '他杀了她，只是拿走了她身上的玉佩。',
    protectedTerms: ['玉佩']
  });

  assert.equal(flipped.passed, false, '否定极性反转必须判定未通过');
  assert.ok(flipped.missing.some(m => m.includes('否定极性反转')));

  // 案例 2: 保留否定极性的正常词汇替换 -> 放行
  const preserved = preservesMeaning({
    before: '他没有杀她，只是拿走了她身上的玉佩。',
    after: '他并未伤害她，只是取走了她身上的玉佩。',
    protectedTerms: ['玉佩']
  });

  assert.equal(preserved.passed, true, '保持否定极性与受保护词应放行');

  // 案例 3: 数字丢失 -> 拒绝
  const numberLost = preservesMeaning({
    before: '他从怀中取出 3 枚银针。',
    after: '他从怀中取出银针。',
    protectedTerms: []
  });

  assert.equal(numberLost.passed, false, '数字丢失必须拦截');
  assert.ok(numberLost.missing.includes('3'));
});

test('M2 语义审计三态: NOT_REQUESTED 状态（未启用模型审校）', async () => {
  const goodText = `陆羽站在古井旁，冷雨打湿了石栏。
“少爷，我们要找的东西真在这里？”老仆提着风灯，低声问道。
陆羽没有回答，只是伸手探入冰冷的井水，指尖触到了一块凸起的石砖。`;

  // 1. 合格正文在未请求模型审校时，判定为 NOT_REQUESTED 并正常通过确定性初筛
  const result = await auditSemantics({
    draft: goodText,
    contract: {
      pov: 'third-limited',
      viewpointCharacter: '陆羽',
      chapterGoal: '探寻古井暗记'
    },
    enableModelJudge: false
  });

  assert.equal(result.status, 'NOT_REQUESTED');
  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.NOT_REQUESTED);
  assert.equal(result.passed, true);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.evaluationError, null);
  assert.equal(result.audit.status, 'NOT_REQUESTED');
  assert.equal(result.audit.passed, true);
  assert.equal(result.dimensions.causality.status, 'NOT_MEASURED');
  assert.equal(result.dimensions.characterConsistency.status, 'NOT_MEASURED');

  // 2. 存在确定性硬缺陷时，即使 NOT_REQUESTED 也必须如实阻断
  const badPovText = `我握紧手中的短刀。他心里暗想我其实早已体力不支。`;
  const badResult = await auditSemantics({
    draft: badPovText,
    contract: { pov: 'first-person', viewpointCharacter: '我' },
    enableModelJudge: false
  });
  assert.equal(badResult.status, 'NOT_REQUESTED');
  assert.equal(badResult.passed, false);
  assert.ok(badResult.blockerCount >= 1);
  assert.equal(badResult.audit.passed, false);
});

test('M2 语义审计三态: MEASURED 状态 - 模型审校成功通过且无违规 (Clean Passage)', async () => {
  const goodText = `陆羽站在古井旁，冷雨打湿了石栏。
“少爷，我们要找的东西真在这里？”老仆提着风灯，低声问道。
陆羽没有回答，只是伸手探入冰冷的井水，指尖触到了一块凸起的石砖。`;

  let callCount = 0;
  const mockCallModel = async (auth, options) => {
    callCount++;
    assert.equal(auth.token, 'test-auth-token');
    assert.equal(options.stage, 'semantic_judge');
    return {
      json: {
        issues: []
      }
    };
  };

  const result = await auditSemantics({
    draft: goodText,
    contract: {
      pov: 'third-limited',
      viewpointCharacter: '陆羽'
    },
    enableModelJudge: true,
    callModel: mockCallModel,
    auth: { token: 'test-auth-token' }
  });

  assert.equal(callCount, 1, '必须真实调用 callModel');
  assert.equal(result.status, 'MEASURED');
  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.MEASURED);
  assert.equal(result.passed, true);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.evaluationError, null);
  assert.equal(result.audit.status, 'MEASURED');
  assert.equal(result.audit.passed, true);
  assert.equal(result.audit.blockerCount, 0);
  assert.equal(result.dimensions.causality.status, 'MEASURED');
  assert.equal(result.dimensions.characterConsistency.status, 'MEASURED');
});

test('M2 语义审计三态: MEASURED 状态 - 模型审校检出逐字引文验证的阻断项 (Verified Blocker)', async () => {
  const text = `陆羽看着前方的绝壁，突然从怀中拿出了早已在上一章被烧毁的青铜残卷。
“这残卷怎么还在？”陆羽心中自语。`;

  const mockCallModel = async () => ({
    json: {
      issues: [
        {
          category: 'causality',
          severity: 'blocker',
          quote: '拿出了早已在上一章被烧毁的青铜残卷',
          problem: '道具已被烧毁，此处凭空复现，因果严重断裂',
          fixHint: '修改为从储物戒中取出备用拓印卷轴'
        }
      ]
    }
  });

  const result = await auditSemantics({
    draft: text,
    contract: { viewpointCharacter: '陆羽' },
    enableModelJudge: true,
    callModel: mockCallModel,
    auth: { token: 'valid-token' }
  });

  assert.equal(result.status, 'MEASURED');
  assert.equal(result.passed, false, '存在 verified blocker 时必须判定未通过');
  assert.equal(result.blockerCount, 1);
  assert.equal(result.evaluationError, null);
  assert.equal(result.audit.status, 'MEASURED');
  assert.equal(result.audit.passed, false);

  const causalityBlocker = result.issues.find(i => i.category === 'causality' && i.severity === 'blocker');
  assert.ok(causalityBlocker, '必须记录因果 blocker issue');
  assert.equal(causalityBlocker.status, 'verified', '逐字存在于正文中的引文必须标为 verified');
  assert.ok(text.includes(causalityBlocker.quote));
  assert.equal(result.dimensions.causality.status, 'MEASURED');
  assert.ok(result.dimensions.causality.value < 0.7);
});

test('M2 语义审计证据刚性: 模型虚构引文/无法定位引文降级为 warning 不阻断', async () => {
  const text = `陆羽缓步走入大厅，四下寂静无声。`;

  const mockCallModel = async () => ({
    json: {
      issues: [
        {
          category: 'causality',
          severity: 'blocker',
          quote: '陆羽一掌击碎了面前的汉白玉石柱', // 正文中完全不存在的原句
          problem: '战力超纲',
          fixHint: '删除此句'
        }
      ]
    }
  });

  const result = await auditSemantics({
    draft: text,
    contract: { viewpointCharacter: '陆羽' },
    enableModelJudge: true,
    callModel: mockCallModel,
    auth: { token: 'valid-token' }
  });

  assert.equal(result.status, 'MEASURED');
  assert.equal(result.passed, true, '无正文依据的假 blocker 严禁阻断提交');
  assert.equal(result.blockerCount, 0);
  assert.equal(result.issues[0].status, 'unverified');
  assert.equal(result.issues[0].severity, 'warning');
});

test('M2 语义审计异常纪律: EVALUATION_FAILED - callModel 抛出异常 (Exception Thrown)', async () => {
  const text = `陆羽站在风雪中，手中的剑锋凝着寒霜。
“前面的路已经断了。”风声中传来低沉的警告。`;

  const mockCallModel = async () => {
    const error = new Error('Gateway Timeout 504: LLM inference cluster connection aborted');
    error.code = 'ETIMEDOUT';
    throw error;
  };

  const result = await auditSemantics({
    draft: text,
    contract: { viewpointCharacter: '陆羽' },
    enableModelJudge: true,
    callModel: mockCallModel,
    auth: { token: 'valid-token' }
  });

  // 1. 状态与不变式断言
  assert.equal(result.status, 'EVALUATION_FAILED', '调用异常必须进入 EVALUATION_FAILED 状态');
  assert.equal(result.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
  assert.equal(result.passed, false, 'EVALUATION_FAILED 状态下 passed 必须严格为 false，严禁静默自证通过');
  assert.ok(result.blockerCount >= 1, '必须生成至少 1 个 verified blocker');

  // 2. 结构化 evaluationError 断言
  assert.ok(result.evaluationError, '必须包含结构化 evaluationError 对象');
  assert.equal(result.evaluationError.name, 'Error');
  assert.ok(result.evaluationError.message.includes('Gateway Timeout 504'));
  assert.equal(result.evaluationError.code, 'ETIMEDOUT');

  // 3. 注入的 blocker issue 断言
  const failureIssue = result.issues.find(i => i.issueId === 'semantic_eval_failure');
  assert.ok(failureIssue, '必须注入 semantic_eval_failure 阻断项');
  assert.equal(failureIssue.category, 'semantic_audit');
  assert.equal(failureIssue.severity, 'blocker');
  assert.equal(failureIssue.status, 'verified');
  assert.ok(failureIssue.problem.includes('语义模型审计执行失败'));
  assert.ok(failureIssue.problem.includes('Gateway Timeout 504'));

  // 4. audit 子对象断言
  assert.ok(result.audit, '必须输出 audit 子对象');
  assert.equal(result.audit.status, 'EVALUATION_FAILED');
  assert.equal(result.audit.passed, false);
  assert.ok(result.audit.blockerCount >= 1);
});

test('M2 语义审计异常纪律: EVALUATION_FAILED - 模型输出无法解析为 JSON (Unparseable Output)', async () => {
  const text = `陆羽走下石阶。`;

  const mockCallModel = async () => ({
    text: '502 Bad Gateway: <html>nginx error</html>' // 非 JSON 文本
  });

  const result = await auditSemantics({
    draft: text,
    enableModelJudge: true,
    callModel: mockCallModel,
    auth: { token: 'valid-token' }
  });

  assert.equal(result.status, 'EVALUATION_FAILED');
  assert.equal(result.passed, false, '无法解析时绝不可判定通过');
  assert.ok(result.blockerCount >= 1);
  assert.equal(result.evaluationError.code, 'JSON_PARSE_ERROR');
  assert.ok(result.evaluationError.message.includes('语义模型输出无法解析为 JSON'));
  assert.equal(result.audit.status, 'EVALUATION_FAILED');
  assert.equal(result.audit.passed, false);
});

test('M2 语义审计异常纪律: EVALUATION_FAILED - 返回空响应或结构缺失 (Invalid Schema)', async () => {
  const text = `陆羽在庭院中沉思。`;

  // 1. 返回 null 响应
  const resultNull = await auditSemantics({
    draft: text,
    enableModelJudge: true,
    callModel: async () => null,
    auth: { token: 'valid-token' }
  });
  assert.equal(resultNull.status, 'EVALUATION_FAILED');
  assert.equal(resultNull.passed, false);
  assert.ok(resultNull.blockerCount >= 1);
  assert.equal(resultNull.evaluationError.code, 'MODEL_EMPTY_RESPONSE');

  // 2. 返回缺少 issues 数组的 JSON
  const resultMissingIssues = await auditSemantics({
    draft: text,
    enableModelJudge: true,
    callModel: async () => ({ json: { success: true, count: 0 } }),
    auth: { token: 'valid-token' }
  });
  assert.equal(resultMissingIssues.status, 'EVALUATION_FAILED');
  assert.equal(resultMissingIssues.passed, false);
  assert.ok(resultMissingIssues.blockerCount >= 1);
  assert.equal(resultMissingIssues.evaluationError.code, 'INVALID_MODEL_SCHEMA');
});

test('M2 刚性不变式: EVALUATION_FAILED 严禁自证通过与配置缺失拦截 (Zero Self-Certification)', async () => {
  // 无瑕疵纯净正文：无任何确定性规则阻断
  const pristineText = `夜幕低垂，窗外的细雨淅淅沥沥。
“今夜或许有客来访。”苏明放下手中的茶杯，望向庭院深处。
门廊下的风铃轻轻晃动，发出一声清脆的声响。`;

  // 1. 请求了模型审校但未提供 callModel 函数 -> 必须为 EVALUATION_FAILED 且 passed: false
  const missingCallModel = await auditSemantics({
    draft: pristineText,
    enableModelJudge: true,
    callModel: null,
    auth: { token: 'valid-token' }
  });
  assert.equal(missingCallModel.status, 'EVALUATION_FAILED');
  assert.equal(missingCallModel.passed, false, '缺失 callModel 时绝不可静默放行');
  assert.ok(missingCallModel.blockerCount >= 1);
  assert.equal(missingCallModel.evaluationError.code, 'CALL_MODEL_NOT_A_FUNCTION');

  // 2. 请求了模型审校但未提供 auth 凭据 -> 必须为 EVALUATION_FAILED 且 passed: false
  const missingAuth = await auditSemantics({
    draft: pristineText,
    enableModelJudge: true,
    callModel: async () => ({ json: { issues: [] } }),
    auth: null
  });
  assert.equal(missingAuth.status, 'EVALUATION_FAILED');
  assert.equal(missingAuth.passed, false, '缺失 auth 时绝不可静默放行');
  assert.ok(missingAuth.blockerCount >= 1);
  assert.equal(missingAuth.evaluationError.code, 'AUTH_MISSING');

  // 3. 抛出非标准异常（例如字符串或被中断任务）
  const stringError = await auditSemantics({
    draft: pristineText,
    enableModelJudge: true,
    callModel: async () => { throw 'Worker process killed unexpectedly'; },
    auth: { token: 'valid-token' }
  });
  assert.equal(stringError.status, 'EVALUATION_FAILED');
  assert.equal(stringError.passed, false);
  assert.ok(stringError.blockerCount >= 1);
  assert.ok(stringError.evaluationError.message.includes('Worker process killed unexpectedly'));
});

test('M2 返回契约完整性: 清晰暴露全部规定字段与 audit 子对象', async () => {
  const draft = `林峰推开厚重的石门，里面的景象让他微微一怔。`;

  // 测试所有三种状态的返回字段结构
  const cases = [
    {
      name: 'NOT_REQUESTED',
      options: { draft, enableModelJudge: false }
    },
    {
      name: 'MEASURED',
      options: {
        draft,
        enableModelJudge: true,
        callModel: async () => ({ json: { issues: [] } }),
        auth: { token: 'valid' }
      }
    },
    {
      name: 'EVALUATION_FAILED',
      options: {
        draft,
        enableModelJudge: true,
        callModel: async () => { throw new Error('Simulated failure'); },
        auth: { token: 'valid' }
      }
    }
  ];

  for (const tc of cases) {
    const res = await auditSemantics(tc.options);

    // 核心契约字段完整性校验
    assert.equal(typeof res.passed, 'boolean', `${tc.name}: passed 必须为 boolean`);
    assert.equal(typeof res.status, 'string', `${tc.name}: status 必须为 string`);
    assert.ok(['NOT_REQUESTED', 'MEASURED', 'EVALUATION_FAILED'].includes(res.status), `${tc.name}: status 必须为有效三态`);
    assert.equal(typeof res.blockerCount, 'number', `${tc.name}: blockerCount 必须为 number`);
    assert.equal(typeof res.textHash, 'string', `${tc.name}: textHash 必须为 string`);
    assert.ok(Array.isArray(res.issues), `${tc.name}: issues 必须为 array`);
    assert.equal(typeof res.dimensions, 'object', `${tc.name}: dimensions 必须为 object`);

    // evaluationError 语义
    if (tc.name === 'EVALUATION_FAILED') {
      assert.ok(res.evaluationError && typeof res.evaluationError === 'object', `${tc.name}: evaluationError 必须为 object`);
      assert.equal(typeof res.evaluationError.name, 'string');
      assert.equal(typeof res.evaluationError.message, 'string');
      assert.equal(typeof res.evaluationError.code, 'string');
      assert.equal(res.passed, false, `${tc.name}: passed 必须为 false`);
    } else {
      assert.equal(res.evaluationError, null, `${tc.name}: 正常状态下 evaluationError 必须为 null`);
    }

    // audit 子对象完整性
    assert.ok(res.audit && typeof res.audit === 'object', `${tc.name}: audit 子对象必须存在`);
    assert.equal(res.audit.passed, res.passed, `${tc.name}: audit.passed 必须与顶层一致`);
    assert.equal(res.audit.status, res.status, `${tc.name}: audit.status 必须与顶层一致`);
    assert.equal(res.audit.blockerCount, res.blockerCount, `${tc.name}: audit.blockerCount 必须与顶层一致`);
    assert.deepEqual(res.audit.issues, res.issues, `${tc.name}: audit.issues 必须与顶层一致`);
  }
});
