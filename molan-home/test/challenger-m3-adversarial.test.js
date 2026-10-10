'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { selectRelevantPlans, compileContext } = require('../lib/memory-context');
const {
  formatStoryPlansMarkdown,
  assembleContext
} = require('../lib/generation/context');

// ============================================================================
// 1. targetChapterRange 极限对抗测试
// ============================================================================

test('ADV-M3-01: targetChapterRange 反向区间 (如 "20-10") 行为探针', () => {
  const plans = [
    { id: 'p-inverted', targetChapterRange: '20-10', title: '反向区间计划' }
  ];

  // 1.1 当章节为 10 时，不属于 [20, 10]，排除为 chapter_out_of_range
  const resCh10 = selectRelevantPlans(plans, { chapterNo: 10 });
  assert.equal(resCh10.selectedPlans.length, 0);
  assert.equal(resCh10.excludedReasons[0].reason, 'chapter_out_of_range');

  // 1.2 当章节为 15 时，处于中间，但在 [20, 10] 逻辑下 15 >= 20 为 false，排除为 chapter_out_of_range
  const resCh15 = selectRelevantPlans(plans, { chapterNo: 15 });
  assert.equal(resCh15.selectedPlans.length, 0);
  assert.equal(resCh15.excludedReasons[0].reason, 'chapter_out_of_range');

  // 1.3 当章节为 19 时，触发 currentChapter === start - 1 (19 === 20 - 1)，命中 chapter_upcoming_horizon
  const resCh19 = selectRelevantPlans(plans, { chapterNo: 19 });
  assert.equal(resCh19.selectedPlans.length, 1);
  assert.equal(resCh19.decisions[0].reason, 'chapter_upcoming_horizon');

  // 1.4 当章节为 20 时，20 <= 10 为 false，排除为 chapter_out_of_range
  const resCh20 = selectRelevantPlans(plans, { chapterNo: 20 });
  assert.equal(resCh20.selectedPlans.length, 0);
  assert.equal(resCh20.excludedReasons[0].reason, 'chapter_out_of_range');
});

test('ADV-M3-02: targetChapterRange 非数值与负数畸形输入平稳降级探针', () => {
  const plans = [
    { id: 'p-prefix', targetChapterRange: 'ch5', title: '带英文字头' },
    { id: 'p-cn', targetChapterRange: '第5章', title: '中文格式' },
    { id: 'p-neg', targetChapterRange: '-5', title: '负数章节' },
    { id: 'p-neg-range', targetChapterRange: '-5-10', title: '负数范围' },
    { id: 'p-float', targetChapterRange: '5.5-10', title: '浮点数' },
    { id: 'p-empty', targetChapterRange: '', title: '空字符串' },
    { id: 'p-null', targetChapterRange: null, title: 'null值' },
    { id: 'p-spaces', targetChapterRange: '   ', title: '纯空格' },
    { id: 'p-tilde', targetChapterRange: '10～20', title: '全角波浪号' }
  ];

  for (const plan of plans) {
    const res = selectRelevantPlans([plan], { chapterNo: 5 });
    assert.equal(res.selectedPlans.length, 1, `ID ${plan.id} 应平稳降级选入`);
    assert.equal(res.decisions[0].reason, 'general_scope_plan', `ID ${plan.id} 应降级为 general_scope_plan`);
    assert.equal(res.decisions[0].score, 2, `ID ${plan.id} 基础分应为 2`);
  }
});

test('ADV-M3-03: targetChapterRange 包含 0 章 (序章) 边界测试', () => {
  const plans = [
    { id: 'p-ch0', targetChapterRange: '0', title: '序章专属规划' },
    { id: 'p-ch0-5', targetChapterRange: '0-5', title: '序章至五章规划' }
  ];

  const res = selectRelevantPlans(plans, { chapterNo: 0 });
  assert.equal(res.selectedPlans.length, 2);
  assert.equal(res.decisions[0].reason, 'chapter_target_match');
  assert.equal(res.decisions[1].reason, 'chapter_target_match');
});

test('ADV-M3-04: query.chapterNo 畸形输入 (NaN/字符串/null) 防御测试', () => {
  const plans = [
    { id: 'p-1', targetChapterRange: '5-10', title: '正常规划' }
  ];

  // 4.1 query.chapterNo 为非数值字符串 "invalid"
  const resStr = selectRelevantPlans(plans, { chapterNo: 'invalid' });
  assert.equal(resStr.selectedPlans.length, 1);
  assert.equal(resStr.decisions[0].reason, 'chapter_target_match'); // currentChapter 为 null 时 targetRangeStr 走 else 分支

  // 4.2 query.chapterNo 为 NaN
  const resNaN = selectRelevantPlans(plans, { chapterNo: NaN });
  assert.equal(resNaN.selectedPlans.length, 1);

  // 4.3 query 为空对象
  const resEmpty = selectRelevantPlans(plans, {});
  assert.equal(resEmpty.selectedPlans.length, 1);
});

// ============================================================================
// 2. participantIds 畸形与崩溃向量探针
// ============================================================================

test('ADV-M3-05: participantIds 常规畸形输入 (非法JSON/非数组基元/循环对象) 平稳降级', () => {
  const circ = { name: 'circular' };
  circ.self = circ;

  const plans = [
    { id: 'p-bad-json', participant_ids_json: '{broken json', title: '损坏的JSON' },
    { id: 'p-number', participantIds: 12345, title: '数字基元' },
    { id: 'p-bool', participantIds: true, title: '布尔基元' },
    { id: 'p-null', participantIds: null, title: 'null值' },
    { id: 'p-circ-root', participantIds: circ, title: '根对象为循环对象' }
  ];

  // 不崩溃，均安全降级为 participants = []
  const res = selectRelevantPlans(plans, { chapterNo: 1 });
  assert.equal(res.selectedPlans.length, 3);
  for (const p of res.selectedPlans) {
    assert.deepEqual(p.participantIds, []);
  }
});

test('ADV-M3-06: [修复验证] participantIds 内包含数字ID对象平稳提取且不崩溃', () => {
  const plans = [
    { id: 'p-numeric-id', participantIds: [{ id: 1001 }], title: '数字人物ID' }
  ];

  assert.doesNotThrow(() => {
    const res = selectRelevantPlans(plans, { chapterNo: 1 });
    assert.equal(res.selectedPlans.length, 1);
    assert.deepEqual(res.selectedPlans[0].participantIds, ['1001']);
  }, '修复后：participantIds 包含 { id: 1001 } 应平稳转换为字符串并不抛出 TypeError');
});

test('ADV-M3-07: [修复验证] query.castIds 内包含数字ID对象平稳提取且不崩溃', () => {
  assert.doesNotThrow(() => {
    const resEmpty = selectRelevantPlans([], { castIds: [{ id: 2002 }] });
    assert.equal(resEmpty.selectedPlans.length, 0);

    const res = selectRelevantPlans([
      { id: 'p-char-match', participantIds: ['2002'], title: '匹配人物' }
    ], { castIds: [{ id: 2002 }] });
    assert.equal(res.selectedPlans.length, 1);
    assert.equal(res.decisions[0].score, 7); // 2 (general_scope_plan) + 5 (participant_character_match)
  }, '修复后：query.castIds 包含 { id: 2002 } 应正常加入集合并不抛出异常');
});

test('ADV-M3-08: [修复验证] formatStoryPlansMarkdown 在数字ID对象下安全格式化且不崩溃', () => {
  assert.doesNotThrow(() => {
    const md = formatStoryPlansMarkdown([{ title: '测试', participantIds: [{ id: 3003 }] }]);
    assert.ok(md.includes('涉及人物: 3003'));
  }, '修复后：formatStoryPlansMarkdown 遇到 { id: 3003 } 时应正常渲染涉及人物');
});

// ============================================================================
// 3. 状态门禁完整性与大小写 / 空格注入测试
// ============================================================================

test('ADV-M3-09: 状态门禁严格大小写无关排除 (COMPLETED / Completed / ABANDONED / Abandoned)', () => {
  const plans = [
    { id: 'p-upper-c', status: 'COMPLETED', title: '大写完成' },
    { id: 'p-cap-c', status: 'Completed', title: '首字母大写完成' },
    { id: 'p-upper-a', status: 'ABANDONED', title: '大写废弃' },
    { id: 'p-cap-a', status: 'Abandoned', title: '首字母大写废弃' },
    { id: 'p-valid-planned', status: 'PLANNED', title: '大写计划中' },
    { id: 'p-valid-active', status: 'Active', title: '首字母大写进行中' }
  ];

  const res = selectRelevantPlans(plans, { chapterNo: 1 });
  const selectedIds = res.selectedPlans.map(p => p.id);
  assert.deepEqual(selectedIds.sort(), ['p-valid-active', 'p-valid-planned'].sort());

  const excludedCompleted = res.excludedReasons.filter(r => r.reason === 'plan_status_completed');
  assert.equal(excludedCompleted.length, 2);

  const excludedAbandoned = res.excludedReasons.filter(r => r.reason === 'plan_status_abandoned');
  assert.equal(excludedAbandoned.length, 2);
});

test('ADV-M3-10: 状态门禁硬隔离性：requiredPlanIds 无法穿透已完成/已废弃门禁', () => {
  const plans = [
    { id: 'p-done-req', status: 'completed', title: '强行要求的已完成计划' },
    { id: 'p-aban-req', status: 'abandoned', title: '强行要求的已废弃计划' }
  ];

  const res = selectRelevantPlans(plans, {
    chapterNo: 1,
    requiredPlanIds: ['p-done-req', 'p-aban-req']
  });

  assert.equal(res.selectedPlans.length, 0, '状态门禁必须优先于 requiredPlanIds 拦截');
  assert.equal(res.excludedReasons.length, 2);
});

test('ADV-M3-11: [修复验证] 状态字符串周围含空格 (如 " completed ") 严格拦截不可逃逸门禁', () => {
  const plans = [
    { id: 'p-space-completed', status: ' completed ', title: '带空格完成' },
    { id: 'p-space-abandoned', status: ' abandoned\n', title: '带换行废弃' }
  ];

  const res = selectRelevantPlans(plans, { chapterNo: 1 });
  const selectedIds = res.selectedPlans.map(p => p.id);

  assert.ok(!selectedIds.includes('p-space-completed'), '带首尾空格的 completed 必须被拦截');
  assert.ok(!selectedIds.includes('p-space-abandoned'), '带换行的 abandoned 必须被拦截');
  assert.equal(res.excludedReasons.filter(r => r.reason === 'plan_status_completed').length, 1);
  assert.equal(res.excludedReasons.filter(r => r.reason === 'plan_status_abandoned').length, 1);
});

// ============================================================================
// 4. 100 并发匹配计划与 Top-N 容量 / Token 上限防爆测试
// ============================================================================

test('ADV-M3-12: 100 项并发匹配计划严格 Top-N 截断与无泄漏测试', () => {
  const plans = Array.from({ length: 100 }, (_, i) => ({
    id: `plan_${String(i).padStart(3, '0')}`,
    title: `第 ${i} 项核心剧情计划`,
    content: `详细规划要求内容：第 ${i} 项剧情展开需要触发关键转折。`,
    targetChapterRange: '1-10'
  }));

  // 12.1 默认 Top 3 截断测试
  const resDefault = selectRelevantPlans(plans, { chapterNo: 5 });
  assert.equal(resDefault.selectedPlans.length, 3, '默认必须严格截断为 Top 3');
  assert.equal(resDefault.excludedReasons.filter(r => r.reason === 'plan_budget_capped').length, 97);

  // 12.2 maxPlans: 5 最大容量测试
  const resMax5 = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: 5 });
  assert.equal(resMax5.selectedPlans.length, 5, '上限必须为 5');
  assert.equal(resMax5.excludedReasons.filter(r => r.reason === 'plan_budget_capped').length, 95);

  // 12.3 尝试传入 maxPlans: 50 突破上限，应被 Math.min(5, ...) 物理锁定在 5
  const resOverMax = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: 50 });
  assert.equal(resOverMax.selectedPlans.length, 5, '超额配额必须被强制锁死为 5');

  // 12.4 负数配额 maxPlans: -10 被 Math.max(1, ...) 钳位至 1
  const resNegative = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: -10 });
  assert.equal(resNegative.selectedPlans.length, 1, '负数配额必须钳位为 1');

  // 12.5 畸形配额 maxPlans: "invalid" 导致 NaN
  const resNaN = selectRelevantPlans(plans, { chapterNo: 5, maxPlans: 'invalid' });
  // Number('invalid') 为 NaN，0 < NaN 为 false，产出 0 个选中计划但不崩溃
  assert.equal(resNaN.selectedPlans.length, 0);
  assert.equal(resNaN.excludedReasons.filter(r => r.reason === 'plan_budget_capped').length, 100);
});

test('ADV-M3-13: 100 项大计划在 compileContext 与 assembleContext 闭环中无上下文爆炸', () => {
  const plans = Array.from({ length: 100 }, (_, i) => ({
    id: `p_${String(i).padStart(3, '0')}`,
    title: `计划标题_${i}`,
    content: `这是很长的规划要求文本_${i}_`.repeat(10), // 每条约 200 字符
    targetChapterRange: '5',
    participantIds: ['hero']
  }));

  const source = {
    bookId: 'book-adv',
    branchId: 'main',
    version: 1,
    facts: [],
    cognitions: [],
    policies: [],
    profiles: [],
    plans,
    sourceCurrent: () => true
  };

  const query = {
    chapterNo: 5,
    budgetTokens: 12000,
    modelId: 'default'
  };

  const manifest = compileContext(source, query);

  // 1. writingPackage.plans 严格受控为 3
  assert.equal(manifest.writingPackage.plans.length, 3);

  // 2. 验证内容被 .slice(0, 300) 严格截断
  for (const p of manifest.writingPackage.plans) {
    assert.ok(p.content.length <= 300);
    assert.ok(p.summary.length <= 300);
  }

  // 3. auditPackage.plans 完整保留 100 项供法医回溯
  assert.equal(manifest.auditPackage.plans.length, 100);

  // 4. assembleContext 生成的文本中只渲染选中的 3 项
  assert.ok(manifest.compiledContext.includes('[storyPlans]'));
  assert.ok(manifest.compiledContext.includes('计划 1:'));
  assert.ok(manifest.compiledContext.includes('计划 2:'));
  assert.ok(manifest.compiledContext.includes('计划 3:'));
  assert.ok(!manifest.compiledContext.includes('计划 4:'));
});

// ============================================================================
// 5. 数据结构边界与怪异对象测试
// ============================================================================

test('ADV-M3-14: plans 输入非数组与怪异对象防御探针', () => {
  // 5.1 plans 为 null / undefined / 字符串
  assert.deepEqual(selectRelevantPlans(null).selectedPlans, []);
  assert.deepEqual(selectRelevantPlans(undefined).selectedPlans, []);
  assert.deepEqual(selectRelevantPlans('not an array').selectedPlans, []);

  // 5.2 plans 包含非对象基元 [null, undefined, 123, "text", false]
  const resMixed = selectRelevantPlans([null, undefined, 123, 'text', false], { chapterNo: 1 });
  assert.deepEqual(resMixed.selectedPlans, []);

  // 5.3 [修复验证] plans 包含空数组 [[]]：Array.isArray 过滤后不再产生空计划
  const resArrayElem = selectRelevantPlans([[]], { chapterNo: 1 });
  assert.equal(resArrayElem.selectedPlans.length, 0);
});
