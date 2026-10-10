'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { selectRelevantPlans, compileContext } = require('../lib/memory-context');
const {
  BLOCK_TO_LAYER,
  PRIORITY,
  BLOCK_ORDER,
  formatStoryPlansMarkdown,
  assembleContext
} = require('../lib/generation/context');

// ============================================================================
// Group 1: selectRelevantPlans 边界与对抗挑战
// ============================================================================

test('ADV-M3-01: selectRelevantPlans 面对非数组/null/undefined/空参数优雅防御不崩溃', () => {
  const badInputs = [null, undefined, 123, 'not an array', {}, true, false, NaN];
  for (const input of badInputs) {
    assert.doesNotThrow(() => {
      const res = selectRelevantPlans(input, { chapterNo: 1 });
      assert.ok(res);
      assert.deepEqual(res.selectedPlans, []);
      assert.deepEqual(res.decisions, []);
      assert.deepEqual(res.includedReasons, []);
      assert.deepEqual(res.excludedReasons, []);
    });
  }

  // 数组内包含 null, undefined, 非对象
  const dirtyPlans = [null, undefined, 42, 'invalid', { id: 'valid-1', targetChapterRange: '1', title: '有效' }];
  const res = selectRelevantPlans(dirtyPlans, { chapterNo: 1 });
  assert.equal(res.selectedPlans.length, 1);
  assert.equal(res.selectedPlans[0].id, 'valid-1');
});

test('ADV-M3-01B [FINDING-M3-001]: 嵌套数组与完全空白对象在 selectRelevantPlans 中的行为表征', () => {
  // 当 plans 中混入空数组 [] 或空对象 {} 时：
  // 增加 Array.isArray(raw) 过滤后，空数组被安全跳过，仅空白对象 {} 被纳入
  const emptyArrayPlan = [];
  const emptyObjPlan = {};
  const res = selectRelevantPlans([emptyArrayPlan, emptyObjPlan], { chapterNo: 1 });
  
  // 记录此行为表征：空数组已被跳过，空白对象被纳入
  assert.equal(res.selectedPlans.length, 1);
  assert.equal(res.selectedPlans[0].id, '');
});

test('ADV-M3-02: selectRelevantPlans 状态门禁对大小写状态与异常状态的严格判定', () => {
  const plans = [
    { id: 'p-upper-comp', status: 'COMPLETED', title: '大写已完成', targetChapterRange: '5' },
    { id: 'p-mixed-aban', status: 'Abandoned', title: '混合已废弃', targetChapterRange: '5' },
    { id: 'p-upper-plan', status: 'PLANNED', title: '大写已计划', targetChapterRange: '5' },
    { id: 'p-upper-act', status: 'ACTIVE', title: '大写执行中', targetChapterRange: '5' },
    { id: 'p-unknown-status', status: 'custom_state', title: '未知状态', targetChapterRange: '5' }
  ];

  const { selectedPlans, excludedReasons } = selectRelevantPlans(plans, { chapterNo: 5 });
  const selectedIds = selectedPlans.map(p => p.id);

  assert.ok(!selectedIds.includes('p-upper-comp'), 'COMPLETED 必须被一票否决');
  assert.ok(!selectedIds.includes('p-mixed-aban'), 'Abandoned 必须被一票否决');
  assert.ok(selectedIds.includes('p-upper-plan'));
  assert.ok(selectedIds.includes('p-upper-act'));
  assert.ok(selectedIds.includes('p-unknown-status'), '非 completed/abandoned 状态应作为候选');

  assert.ok(excludedReasons.some(r => r.id === 'p-upper-comp' && r.reason === 'plan_status_completed'));
  assert.ok(excludedReasons.some(r => r.id === 'p-mixed-aban' && r.reason === 'plan_status_abandoned'));
});

test('ADV-M3-03: selectRelevantPlans 目标章节跨度极端畸形格式分流', () => {
  const plans = [
    { id: 'p-spaces', targetChapterRange: '  5  -  8  ', title: '带大量空格的跨度' },
    { id: 'p-inverted', targetChapterRange: '10-5', title: '倒置跨度 start > end' },
    { id: 'p-multi-dash', targetChapterRange: '5-8-12', title: '多连字符非法跨度' },
    { id: 'p-non-numeric', targetChapterRange: '卷三·决战', title: '中文卷名非数字跨度' },
    { id: 'p-zero', targetChapterRange: '0', title: '第0章' }
  ];

  // 1. 查询第 6 章
  const resCh6 = selectRelevantPlans(plans, { chapterNo: 6 });
  const idsCh6 = resCh6.selectedPlans.map(p => p.id);
  assert.ok(idsCh6.includes('p-spaces'), '带空格有效区间 "5-8" 在第6章必须命中 (+10)');
  assert.ok(!idsCh6.includes('p-inverted'), '倒置区间 10-5 在第6章必须被排除');
  // 非正则匹配的非数字跨度降级为全局计划 (+2 分)，且得分 > 0 可作为保底
  assert.ok(idsCh6.includes('p-non-numeric'), '非正则跨度降级为全局保底计划');

  // 2. 查询第 0 章
  const resCh0 = selectRelevantPlans(plans, { chapterNo: 0 });
  const idsCh0 = resCh0.selectedPlans.map(p => p.id);
  assert.ok(idsCh0.includes('p-zero'), '第0章应能精确匹配 targetChapterRange: "0"');
});

test('ADV-M3-04: selectRelevantPlans 角色在场性支持对象结构与畸形 JSON 容错', () => {
  const plans = [
    { id: 'p-obj-id', targetChapterRange: '5', participantIds: [{ id: 'char_hero' }, { name: 'char_mentor' }] },
    { id: 'p-bad-json', targetChapterRange: '5', participant_ids_json: '{invalid_json', title: '损坏的JSON' },
    { id: 'p-plain-arr', targetChapterRange: '5', participantIds: ['char_rival'] }
  ];

  // 1. 损坏的 JSON 不会造成抛错
  assert.doesNotThrow(() => {
    selectRelevantPlans(plans, { chapterNo: 5, povId: 'char_hero' });
  });

  // 2. 对象数组中包含 id 或 name 的在场角色成功提取并加分
  const res = selectRelevantPlans(plans, { chapterNo: 5, povId: 'char_hero' });
  const pObj = res.selectedPlans.find(p => p.id === 'p-obj-id');
  assert.ok(pObj);
  assert.ok(pObj.participantIds.includes('char_hero'));
  assert.ok(pObj.participantIds.includes('char_mentor'));
});

test('ADV-M3-05: selectRelevantPlans 必保指令与状态门禁因果硬围栏优先级断言', () => {
  const plans = [
    { id: 'p-req-completed', status: 'completed', targetChapterRange: '5', title: '已完成的必保计划' },
    { id: 'p-req-abandoned', status: 'abandoned', targetChapterRange: '5', title: '已废弃的必保计划' },
    { id: 'p-req-out-range', status: 'planned', targetChapterRange: '99', title: '超范围的必保计划' }
  ];

  const query = {
    chapterNo: 5,
    requiredPlanIds: ['p-req-completed', 'p-req-abandoned', 'p-req-out-range']
  };

  const { selectedPlans, excludedReasons } = selectRelevantPlans(plans, query);
  const selectedIds = selectedPlans.map(p => p.id);

  // 因果硬逻辑：已完成与已废弃绝不可被必保指令强行复活
  assert.ok(!selectedIds.includes('p-req-completed'), '已完成计划即使被标记必保也必须被拦截');
  assert.ok(!selectedIds.includes('p-req-abandoned'), '已废弃计划即使被标记必保也必须被拦截');
  // 超范围的未完成计划则可被必保指令穿透
  assert.ok(selectedIds.includes('p-req-out-range'), '超范围的 planned 计划可被必保指令强穿透');
});

test('ADV-M3-06: selectRelevantPlans 时空/世界线隔离门禁硬拦截', () => {
  const plans = [
    { id: 'p-t0-c0', timelineId: 't0', cycleId: 'c0', targetChapterRange: '1', title: '主时间线主周期' },
    { id: 'p-t1-c0', timelineId: 't1', cycleId: 'c0', targetChapterRange: '1', title: '平行世界线1' },
    { id: 'p-t0-c1', timelineId: 't0', cycleId: 'c1', targetChapterRange: '1', title: '第2轮回周期' }
  ];

  const res = selectRelevantPlans(plans, { chapterNo: 1, timelineId: 't0', cycleId: 'c0' });
  assert.equal(res.selectedPlans.length, 1);
  assert.equal(res.selectedPlans[0].id, 'p-t0-c0');

  assert.ok(res.excludedReasons.some(r => r.id === 'p-t1-c0' && r.reason === 'timeline_mismatch'));
  assert.ok(res.excludedReasons.some(r => r.id === 'p-t0-c1' && r.reason === 'cycle_mismatch'));
});

test('ADV-M3-07: selectRelevantPlans 平分时的确定性与稳定性排序验证', () => {
  // 5 个得分完全一致的计划，颠倒输入顺序，必须产生完全一致且稳定的输出
  const pA = { id: 'plan-alpha', targetChapterRange: '5', title: 'A' };
  const pB = { id: 'plan-beta', targetChapterRange: '5', title: 'B' };
  const pC = { id: 'plan-gamma', targetChapterRange: '5', title: 'C' };

  const resOrder1 = selectRelevantPlans([pC, pA, pB], { chapterNo: 5 });
  const resOrder2 = selectRelevantPlans([pB, pC, pA], { chapterNo: 5 });
  const resOrder3 = selectRelevantPlans([pA, pB, pC], { chapterNo: 5 });

  const ids1 = resOrder1.selectedPlans.map(p => p.id);
  const ids2 = resOrder2.selectedPlans.map(p => p.id);
  const ids3 = resOrder3.selectedPlans.map(p => p.id);

  assert.deepEqual(ids1, ['plan-alpha', 'plan-beta', 'plan-gamma']);
  assert.deepEqual(ids2, ['plan-alpha', 'plan-beta', 'plan-gamma']);
  assert.deepEqual(ids3, ['plan-alpha', 'plan-beta', 'plan-gamma']);
});

test('ADV-M3-08: selectRelevantPlans 针对冻结对象 (Object.freeze) 零副作用纯函数检验', () => {
  const plans = Object.freeze([
    Object.freeze({ id: 'p-2', targetChapterRange: '5', title: '2' }),
    Object.freeze({ id: 'p-1', targetChapterRange: '5', title: '1' })
  ]);
  const query = Object.freeze({ chapterNo: 5, castIds: Object.freeze(['c1']) });

  assert.doesNotThrow(() => {
    const res = selectRelevantPlans(plans, query);
    assert.equal(res.selectedPlans.length, 2);
    assert.equal(res.selectedPlans[0].id, 'p-1');
  });
});

test('ADV-M3-09: selectRelevantPlans Top-N 截断容量上界与下界限制', () => {
  const plans = Array.from({ length: 10 }, (_, i) => ({
    id: `plan-${String(i).padStart(2, '0')}`,
    targetChapterRange: '5',
    title: `计划 ${i}`
  }));

  // 1. 请求 100 条 -> 必须被硬卡上限为 5
  const resMax = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: 100 });
  assert.equal(resMax.selectedPlans.length, 5);

  // 2. 请求 0 条 -> 必须优雅保底为 3 (因 0 为 falsy fallback)
  const resZero = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: 0 });
  assert.equal(resZero.selectedPlans.length, 3);

  // 3. 请求负数条 -> 必须保底为 1 条
  const resNeg = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: -10 });
  assert.equal(resNeg.selectedPlans.length, 1);
});

// ============================================================================
// Group 2: compileContext 与写作包提升对抗测试
// ============================================================================

test('ADV-M3-10: compileContext 蒸馏计划防膨胀截断 (超长内容自动截断至 300 字符)', () => {
  const giantContent = 'A'.repeat(2000);
  const source = {
    bookId: 'book-adv',
    branchId: 'main',
    version: 1,
    facts: [],
    cognitions: [],
    policies: [],
    profiles: [],
    plans: [
      { id: 'plan-huge', targetChapterRange: '1', title: '巨型计划', content: giantContent, status: 'planned' }
    ],
    sourceCurrent: () => true
  };

  const manifest = compileContext(source, { chapterNo: 1, budgetTokens: 8000 });
  const writingPlan = manifest.writingPackage.plans[0];
  assert.ok(writingPlan);
  assert.equal(writingPlan.content.length, 300, '蒸馏计划内容必须被硬截断至 300 字符以内');
  assert.equal(writingPlan.summary.length, 80, '无独立 summary 时保守裁剪至 80 字符');
});

test('ADV-M3-11: compileContext 可重放哈希稳定性与敏感度验证', () => {
  const sourceA = {
    bookId: 'book-hash',
    branchId: 'main',
    version: 1,
    facts: [],
    cognitions: [],
    policies: [],
    profiles: [],
    plans: [{ id: 'plan-1', targetChapterRange: '1', title: '计划', revision: 1 }],
    sourceCurrent: () => true
  };

  const sourceB = {
    ...sourceA,
    plans: [{ id: 'plan-1', targetChapterRange: '1', title: '计划已修改', revision: 2 }]
  };

  const query = { chapterNo: 1, budgetTokens: 5000 };
  const res1 = compileContext(sourceA, query);
  const res2 = compileContext(sourceA, query);
  const resChanged = compileContext(sourceB, query);

  // 幂等一致性
  assert.equal(res1.inputHash, res2.inputHash);
  assert.equal(res1.compiledContext, res2.compiledContext);

  // 计划篡改雪崩敏感性
  assert.notEqual(res1.inputHash, resChanged.inputHash, 'plans 内容变化必须引起 inputHash 改变');
});

test('ADV-M3-12: compileContext 预算溢出防御 - 提升的 plans 正确参与 estimate(writingPackage) 门禁', () => {
  const source = {
    bookId: 'book-overflow',
    branchId: 'main',
    version: 1,
    facts: [],
    cognitions: [],
    policies: [],
    profiles: [],
    plans: Array.from({ length: 5 }, (_, i) => ({
      id: `p-${i}`,
      targetChapterRange: '1',
      title: `标题 ${i}`,
      content: 'C'.repeat(250),
      status: 'planned'
    })),
    sourceCurrent: () => true
  };

  // 5 条 300 字符计划序列化后字符数 > 2000，estimate 估算 > 4000 tokens
  // 给定极其严苛的 500 tokens 预算，必须拦截并抛出 CONTEXT_BUDGET_EXCEEDED
  assert.throws(() => {
    compileContext(source, { chapterNo: 1, budgetTokens: 500 });
  }, { code: 'CONTEXT_BUDGET_EXCEEDED' });
});

// ============================================================================
// Group 3: generation/context.js 契约与 Markdown 渲染对抗
// ============================================================================

test('ADV-M3-13: formatStoryPlansMarkdown 极限对抗输入容错', () => {
  assert.equal(formatStoryPlansMarkdown(null), '');
  assert.equal(formatStoryPlansMarkdown(undefined), '');
  assert.equal(formatStoryPlansMarkdown(''), '');
  assert.equal(formatStoryPlansMarkdown([]), '');
  assert.equal(formatStoryPlansMarkdown('已格式化的 Markdown 文本'), '已格式化的 Markdown 文本');

  // plans 属性封装
  const wrapped = {
    plans: [
      { title: '单项', content: '要求' }
    ]
  };
  const rendered = formatStoryPlansMarkdown(wrapped);
  assert.ok(rendered.includes('【单项】'));
  assert.ok(rendered.includes('规划要求: 要求'));
});

test('ADV-M3-14: assembleContext 在极限预算下优先保留 P0 必保大纲而裁剪/省略 P1 storyPlans', () => {
  const input = {
    currentTask: '即时任务',
    storyPlans: [
      {
        id: 'plan-p1',
        title: '长篇规划',
        content: '在预算极其吃紧时该块应先于 P0 块被降级裁剪或省略。'.repeat(100)
      }
    ]
  };

  // 1. 当预算较为紧凑时，storyPlans 支持平滑边界裁剪 (truncated)
  const resTruncated = assembleContext(input, { model: 'default', hardLimit: 300, outputReserve: 0, reservedInputTokens: 0 });
  assert.ok(resTruncated.contextPlan.includedBlocks.includes('currentTask'));
  assert.ok(resTruncated.contextPlan.truncatedBlocks.includes('storyPlans'), 'P1 计划在适度预算吃紧时平滑裁剪');

  // 2. 当预算极度严苛时，storyPlans 被直接移出 (omitted)
  const resOmitted = assembleContext(input, { model: 'default', hardLimit: 120, outputReserve: 0, reservedInputTokens: 0 });
  assert.ok(resOmitted.contextPlan.includedBlocks.includes('currentTask'));
  assert.ok(resOmitted.contextPlan.omittedBlocks.includes('storyPlans'), 'P1 计划在极端紧缺时被安全省略');
  assert.ok(!resOmitted.text.includes('[storyPlans]'));
});

test('ADV-M3-15: assembleContext 确认 L2_chapter 与 Priority 1 契约不可被污染', () => {
  assert.equal(BLOCK_TO_LAYER.storyPlans, 'L2_chapter');
  assert.equal(PRIORITY.storyPlans, 1);
  assert.ok(BLOCK_ORDER.includes('storyPlans'));
  
  const cpIndex = BLOCK_ORDER.indexOf('chapterPlan');
  const spIndex = BLOCK_ORDER.indexOf('storyPlans');
  assert.equal(spIndex, cpIndex + 1);
});
