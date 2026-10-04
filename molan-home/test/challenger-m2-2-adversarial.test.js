'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { auditSemantics, screenDeterministicSemantics, verifyQuoteInText, SEMANTIC_AUDIT_STATUS } = require('../lib/generation/semantic-audit');

test('Challenger M2 Stress 1: Tri-state activation triggers & routing invariants', async () => {
  const sampleText = '陆羽缓步走入书房，窗外竹影摇曳。桌案上放着一卷泛黄的古籍。';

  // 1.1 所有关闭标志下均为 NOT_REQUESTED
  const disabledConfigs = [
    {},
    { enableModelJudge: false },
    { enableSemanticJudge: false },
    { judgeModelId: '' },
    { judgeModelId: null },
    { request: {} },
    { request: { judgeModelId: '', enableSemanticJudge: false } }
  ];

  for (const cfg of disabledConfigs) {
    const res = await auditSemantics({ draft: sampleText, ...cfg });
    assert.equal(res.status, SEMANTIC_AUDIT_STATUS.NOT_REQUESTED);
    assert.equal(res.passed, true);
    assert.equal(res.blockerCount, 0);
    assert.equal(res.evaluationError, null);
    assert.equal(res.dimensions.causality.status, 'NOT_MEASURED');
    assert.equal(res.dimensions.characterConsistency.status, 'NOT_MEASURED');
  }

  // 1.2 各种正向开关均能触发模型审校逻辑 (request.judgeModelId, request.enableSemanticJudge, etc.)
  const enablingConfigs = [
    { enableModelJudge: true },
    { enableSemanticJudge: true },
    { judgeModelId: 'gpt-4o-mini' },
    { request: { judgeModelId: 'claude-3-5-sonnet' } },
    { request: { enableSemanticJudge: true } }
  ];

  for (const cfg of enablingConfigs) {
    let called = false;
    const res = await auditSemantics({
      draft: sampleText,
      ...cfg,
      callModel: async () => {
        called = true;
        return { json: { issues: [] } };
      },
      auth: { token: 'valid' }
    });
    assert.equal(called, true, `配置应激活 callModel: ${JSON.stringify(cfg)}`);
    assert.equal(res.status, SEMANTIC_AUDIT_STATUS.MEASURED);
    assert.equal(res.passed, true);
    assert.equal(res.dimensions.causality.status, 'MEASURED');
    assert.equal(res.dimensions.characterConsistency.status, 'MEASURED');
  }
});

test('Challenger M2 Stress 2: Quote verification edge cases, regex immunity & demotion', async () => {
  const textWithRegexChars = '林冲喝道：“此间事了，(谁敢再动一草一木)*？！”李四心中一颤[1]。';

  // 2.1 引文包含正则表达式特殊字符 (如 (, ), *, ?, [, ], +, ^, $)
  // 必须使用纯文本 includes 匹配，绝不能触发正则编译异常
  const regexQuote = '(谁敢再动一草一木)*？！';
  assert.equal(verifyQuoteInText(textWithRegexChars, regexQuote), true);

  const mockCallModelWithSpecialChars = async () => ({
    json: {
      issues: [
        {
          category: 'causality',
          severity: 'blocker',
          quote: regexQuote,
          problem: '语气过于激烈',
          fixHint: '平复语气'
        }
      ]
    }
  });

  const res1 = await auditSemantics({
    draft: textWithRegexChars,
    enableModelJudge: true,
    callModel: mockCallModelWithSpecialChars,
    auth: { token: 'valid' }
  });

  assert.equal(res1.status, 'MEASURED');
  assert.equal(res1.passed, false, '存在真实引文的 blocker 必须阻断');
  assert.equal(res1.blockerCount, 1);
  assert.equal(res1.issues[0].status, 'verified');
  assert.equal(res1.issues[0].severity, 'blocker');

  // 2.2 引文字符数过短 (长度 < 4 字符) -> 视为无法定位，降级为 warning
  const shortQuoteCall = async () => ({
    json: {
      issues: [
        {
          category: 'causality',
          severity: 'blocker',
          quote: '喝道', // 2 个字符 < 4
          problem: '动词不当'
        }
      ]
    }
  });

  const resShort = await auditSemantics({
    draft: textWithRegexChars,
    enableModelJudge: true,
    callModel: shortQuoteCall,
    auth: { token: 'valid' }
  });

  assert.equal(resShort.status, 'MEASURED');
  assert.equal(resShort.passed, true, '短于4字符引文应降级为 warning，不阻断');
  assert.equal(resShort.blockerCount, 0);
  assert.equal(resShort.issues[0].status, 'unverified');
  assert.equal(resShort.issues[0].severity, 'warning');

  // 2.3 引文为 null / undefined / 空字符串 / 非字符串类型
  const invalidQuoteCall = async () => ({
    json: {
      issues: [
        { category: 'character', severity: 'blocker', quote: null, problem: 'null quote' },
        { category: 'character', severity: 'blocker', quote: undefined, problem: 'undefined quote' },
        { category: 'character', severity: 'blocker', quote: '', problem: 'empty quote' },
        { category: 'character', severity: 'blocker', quote: 12345, problem: 'numeric quote' }
      ]
    }
  });

  const resInvalid = await auditSemantics({
    draft: textWithRegexChars,
    enableModelJudge: true,
    callModel: invalidQuoteCall,
    auth: { token: 'valid' }
  });

  assert.equal(resInvalid.status, 'MEASURED');
  assert.equal(resInvalid.passed, true, '全部非法引文 blocker 必须降级为 warning');
  assert.equal(resInvalid.blockerCount, 0);
  for (const iss of resInvalid.issues) {
    assert.equal(iss.status, 'unverified');
    assert.equal(iss.severity, 'warning');
  }
});

test('Challenger M2 Stress 3: Comprehensive EVALUATION_FAILED matrix and zero self-certification', async () => {
  const draft = '清风拂过松林，琴声悠扬。陆羽闭目聆听，神色安详。';

  const failureScenarios = [
    {
      title: 'callModel 为空或非函数类型',
      callModel: 'not_a_function',
      auth: { token: 'valid' },
      expectedCode: 'CALL_MODEL_NOT_A_FUNCTION'
    },
    {
      title: 'callModel 为布尔值',
      callModel: true,
      auth: { token: 'valid' },
      expectedCode: 'CALL_MODEL_NOT_A_FUNCTION'
    },
    {
      title: 'auth 缺失为 undefined',
      callModel: async () => ({ json: { issues: [] } }),
      auth: undefined,
      expectedCode: 'AUTH_MISSING'
    },
    {
      title: 'auth 缺失为空对象 (falsy check: null / undefined / false / empty)',
      callModel: async () => ({ json: { issues: [] } }),
      auth: null,
      expectedCode: 'AUTH_MISSING'
    },
    {
      title: 'callModel 返回 null',
      callModel: async () => null,
      auth: { token: 'valid' },
      expectedCode: 'MODEL_EMPTY_RESPONSE'
    },
    {
      title: 'callModel 返回 undefined',
      callModel: async () => undefined,
      auth: { token: 'valid' },
      expectedCode: 'MODEL_EMPTY_RESPONSE'
    },
    {
      title: 'callModel 返回非 JSON 格式文本',
      callModel: async () => ({ text: 'Internal Server Error 500' }),
      auth: { token: 'valid' },
      expectedCode: 'JSON_PARSE_ERROR'
    },
    {
      title: 'callModel 返回非对象 JSON (如数字)',
      callModel: async () => ({ text: '12345' }),
      auth: { token: 'valid' },
      expectedCode: 'INVALID_MODEL_OUTPUT'
    },
    {
      title: 'callModel 返回结构缺少 issues 数组',
      callModel: async () => ({ json: { status: 'success' } }),
      auth: { token: 'valid' },
      expectedCode: 'INVALID_MODEL_SCHEMA'
    },
    {
      title: 'callModel 抛出原生 Error',
      callModel: async () => {
        const err = new Error('Connection refused to AI Gateway');
        err.code = 'ECONNREFUSED';
        throw err;
      },
      auth: { token: 'valid' },
      expectedCode: 'ECONNREFUSED'
    },
    {
      title: 'callModel 抛出纯字符串异常',
      callModel: async () => { throw 'Process interrupted by SIGTERM'; },
      auth: { token: 'valid' },
      expectedCode: 'SEMANTIC_EVALUATION_FAILED'
    },
    {
      title: 'callModel 抛出自定义对象异常',
      callModel: async () => { throw { message: 'Quota limit exceeded', code: 'RATE_LIMIT' }; },
      auth: { token: 'valid' },
      expectedCode: 'RATE_LIMIT'
    }
  ];

  for (const sc of failureScenarios) {
    const res = await auditSemantics({
      draft,
      enableModelJudge: true,
      callModel: sc.callModel,
      auth: sc.auth
    });

    // 刚性不变式检验
    assert.equal(res.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED, `[${sc.title}] status 必须为 EVALUATION_FAILED`);
    assert.equal(res.passed, false, `[${sc.title}] passed 必须绝对为 false`);
    assert.ok(res.blockerCount >= 1, `[${sc.title}] blockerCount 必须 >= 1`);
    assert.ok(res.evaluationError, `[${sc.title}] evaluationError 必须存在`);
    assert.equal(typeof res.evaluationError.message, 'string');
    assert.equal(res.evaluationError.code, sc.expectedCode, `[${sc.title}] code 必须匹配期望`);

    // 阻断项存在性校验
    const evalFailIssue = res.issues.find(i => i.issueId === 'semantic_eval_failure');
    assert.ok(evalFailIssue, `[${sc.title}] 必须存在 semantic_eval_failure 阻断项`);
    assert.equal(evalFailIssue.severity, 'blocker');
    assert.equal(evalFailIssue.status, 'verified');

    // 未测量维度必须保持 NOT_MEASURED
    assert.equal(res.dimensions.causality.status, 'NOT_MEASURED', `[${sc.title}] 因果维度不可在失败时假装测量`);
    assert.equal(res.dimensions.characterConsistency.status, 'NOT_MEASURED');

    // audit 子对象镜像一致性
    assert.equal(res.audit.status, SEMANTIC_AUDIT_STATUS.EVALUATION_FAILED);
    assert.equal(res.audit.passed, false);
    assert.equal(res.audit.blockerCount, res.blockerCount);
  }
});

test('Challenger M2 Stress 4: Return schema field integrity and textHash SHA256 authenticity', async () => {
  const customDraft = '天地玄黄，宇宙洪荒。日月盈昃，辰宿列张。寒来暑往，秋收冬藏。';
  const expectedHash = crypto.createHash('sha256').update(customDraft, 'utf8').digest('hex');

  const res = await auditSemantics({
    draft: customDraft,
    enableModelJudge: true,
    callModel: async () => ({
      text: '```json\n{"issues":[{"category":"causality","severity":"warning","quote":"日月盈昃，辰宿列张","problem":"节奏稍显突兀"}]}\n```'
    }),
    auth: { token: 'valid' }
  });

  // 1. textHash 真实性
  assert.equal(res.textHash, expectedHash, 'textHash 必须精确等于正文真实 SHA256');

  // 2. 返回根对象顶层所有契约字段
  const requiredKeys = ['passed', 'status', 'blockerCount', 'textHash', 'issues', 'dimensions', 'evaluationError', 'audit'];
  for (const k of requiredKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(res, k), `顶层必须包含字段: ${k}`);
  }

  // 3. dimensions 四大维度结构及不可空字段
  const dimensionKeys = ['povBoundary', 'dialogue', 'causality', 'characterConsistency'];
  for (const dk of dimensionKeys) {
    assert.ok(res.dimensions[dk], `dimensions 必须包含维度: ${dk}`);
    assert.ok(['MEASURED', 'NOT_MEASURED'].includes(res.dimensions[dk].status), `维度 ${dk} status 必须为 MEASURED 或 NOT_MEASURED`);
    assert.equal(typeof res.dimensions[dk].confidence, 'number', `维度 ${dk} confidence 必须为 number`);
    assert.equal(typeof res.dimensions[dk].source, 'string', `维度 ${dk} source 必须为 string`);
    assert.ok(Array.isArray(res.dimensions[dk].evidence), `维度 ${dk} evidence 必须为 array`);
  }

  // 4. Markdown 代码块包裹的 JSON 能够被正确解析
  assert.equal(res.status, 'MEASURED');
  assert.equal(res.passed, true);
  assert.equal(res.issues.length, 1);
  assert.equal(res.issues[0].status, 'verified');
  assert.equal(res.issues[0].severity, 'warning');
});

test('Challenger M2 Stress 5: Dual Failure (Deterministic issue + Model failure co-existence)', async () => {
  // 构造同时存在第一人称全知越界，且模型执行失败的极端正文
  const dualBadText = '我握紧短剑。他心里暗想我其实已经毫无退路。';

  const res = await auditSemantics({
    draft: dualBadText,
    contract: {
      pov: 'first-person',
      viewpointCharacter: '我'
    },
    enableModelJudge: true,
    callModel: async () => {
      throw new Error('Upstream model rate limit reached');
    },
    auth: { token: 'valid' }
  });

  // 必须同时记录确定性 blocker 与流程性 blocker
  assert.equal(res.status, 'EVALUATION_FAILED');
  assert.equal(res.passed, false);
  assert.ok(res.blockerCount >= 2, '必须同时捕获确定性视点越界与模型故障双重 blocker');

  const povIssue = res.issues.find(i => i.category === 'pov' && i.severity === 'blocker');
  const modelIssue = res.issues.find(i => i.issueId === 'semantic_eval_failure');
  assert.ok(povIssue, '必须记录 POV 越界阻断');
  assert.ok(modelIssue, '必须记录模型异常阻断');
  assert.equal(povIssue.status, 'verified');
  assert.equal(modelIssue.status, 'verified');
});

test('Challenger M2 Stress 6: Empty, whitespace-only and malformed options robustness', async () => {
  // 6.1 纯空或纯空白正文
  const emptyRes = await auditSemantics({ draft: '   \n\t  ' });
  assert.equal(emptyRes.passed, false);
  assert.equal(emptyRes.status, 'NOT_REQUESTED');
  assert.equal(emptyRes.blockerCount, 1);
  assert.equal(emptyRes.issues[0].issueId, 'empty_content');
  assert.equal(emptyRes.evaluationError, null);

  // 6.2 无任何参数调用 auditSemantics()
  const noArgsRes = await auditSemantics();
  assert.equal(noArgsRes.passed, false);
  assert.equal(noArgsRes.status, 'NOT_REQUESTED');
  assert.equal(noArgsRes.blockerCount, 1);

  // 6.3 畸形 contract (contract.characters 为非数组或包含非对象项，forbiddenKnowledge 为包含 null 项)
  const malformedContract = {
    pov: 'third-limited',
    viewpointCharacter: '陆羽',
    characters: [null, undefined, 123, { name: '赵六' }, { name: null }],
    forbiddenKnowledge: [null, undefined, { fact: null }, { fact: '机密宝藏' }]
  };

  const cleanText = '陆羽缓步走入内厅。赵六正在擦拭宝剑。机密宝藏的线索就藏在刀鞘之中。';
  const malformedRes = await auditSemantics({
    draft: cleanText,
    contract: malformedContract,
    enableModelJudge: false
  });

  // 应当健壮执行并不崩溃，准确识别出 forbiddenKnowledge 泄露
  assert.equal(malformedRes.status, 'NOT_REQUESTED');
  assert.equal(malformedRes.passed, false);
  assert.equal(malformedRes.blockerCount, 1);
  assert.equal(malformedRes.issues[0].category, 'knowledge');
  assert.ok(malformedRes.issues[0].quote.includes('机密宝藏'));
});

test('Challenger M2 Stress 7: Primitive responses, null issues, and toxic array elements', async () => {
  const text = '陆羽缓步走入内厅。窗外微风吹动帘幕。';

  // 7.1 callModel 返回原始非对象 (例如直接返回数字 200、布尔值或字符串)
  for (const primitiveResp of [200, true, false, 'SUCCESS']) {
    const res = await auditSemantics({
      draft: text,
      enableModelJudge: true,
      callModel: async () => primitiveResp,
      auth: { token: 'valid' }
    });
    assert.equal(res.status, 'EVALUATION_FAILED');
    assert.equal(res.passed, false);
    assert.ok(res.blockerCount >= 1);
    assert.ok(
      ['MODEL_EMPTY_RESPONSE', 'INVALID_MODEL_OUTPUT'].includes(res.evaluationError.code),
      `原始类型必须识别为响应无效或为空: ${res.evaluationError.code}`
    );
  }

  // 7.2 issues 为 null、数字、字符串等非数组类型
  for (const nonArrayIssues of [null, 123, 'not-an-array', {}]) {
    const res = await auditSemantics({
      draft: text,
      enableModelJudge: true,
      callModel: async () => ({ json: { issues: nonArrayIssues } }),
      auth: { token: 'valid' }
    });
    assert.equal(res.status, 'EVALUATION_FAILED');
    assert.equal(res.passed, false);
    assert.ok(res.blockerCount >= 1);
    assert.equal(res.evaluationError.code, 'INVALID_MODEL_SCHEMA');
  }

  // 7.3 issues 包含 null, undefined, primitive, 以及畸形 issue 对象
  const dirtyIssuesCall = async () => ({
    json: {
      issues: [
        null,
        undefined,
        42,
        'bad-issue-string',
        {},
        { category: 'unknown', severity: 'invalid_severity', quote: '完全不存在的引文' },
        { category: 'causality', severity: 'blocker', quote: '窗外微风吹动帘幕', problem: '真实阻断' }
      ]
    }
  });

  const resDirty = await auditSemantics({
    draft: text,
    enableModelJudge: true,
    callModel: dirtyIssuesCall,
    auth: { token: 'valid' }
  });

  assert.equal(resDirty.status, 'MEASURED');
  assert.equal(resDirty.passed, false);
  assert.equal(resDirty.blockerCount, 1);
  const realBlocker = resDirty.issues.find(i => i.severity === 'blocker' && i.status === 'verified');
  assert.ok(realBlocker);
  assert.equal(realBlocker.quote, '窗外微风吹动帘幕');
});

test('Challenger M2 Stress 8: Large scale prose (50K+ chars) and non-string draft inputs', async () => {
  // 8.1 超长正文 (50,000+ 字符)
  const paragraph = '陆羽站在庭院中，仔细观察着四周的每一处痕迹。夜色渐浓，寒意愈发逼人。\n';
  const largeDraft = paragraph.repeat(1000) + '密道入口就在假山石后。'; // >50,000 chars

  const largeRes = await auditSemantics({
    draft: largeDraft,
    contract: { viewpointCharacter: '陆羽' },
    enableModelJudge: true,
    callModel: async (auth, { userPrompt }) => {
      // 验证截断机制 text.slice(0, 4000)
      const promptObj = JSON.parse(userPrompt);
      assert.ok(promptObj.draftExcerpt.length <= 4000, '大文本进入 prompt 必须受到 4000 字限制截断');
      return {
        json: {
          issues: [
            {
              category: 'causality',
              severity: 'blocker',
              quote: '密道入口就在假山石后',
              problem: '未交代线索来源'
            }
          ]
        }
      };
    },
    auth: { token: 'valid' }
  });

  assert.equal(largeRes.status, 'MEASURED');
  assert.equal(largeRes.passed, false);
  assert.equal(largeRes.blockerCount, 1);
  assert.equal(largeRes.issues.find(i => i.severity === 'blocker').status, 'verified');

  // 8.2 非字符串 draft (数字、布尔值)
  const numDraftRes = await auditSemantics({ draft: 123456789 });
  assert.equal(numDraftRes.status, 'NOT_REQUESTED');
  assert.equal(typeof numDraftRes.textHash, 'string');
  assert.equal(numDraftRes.textHash.length, 64);
});

