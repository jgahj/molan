'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { selectRelevantPlans, compileContext } = require('../lib/memory-context');
const {
  BLOCK_TO_LAYER,
  PRIORITY,
  BLOCK_ORDER,
  formatStoryPlansMarkdown,
  assembleContext
} = require('../lib/generation/context');

test('M3-01: selectRelevantPlans 状态门禁硬拦截已完成与已废弃计划', () => {
  const plans = [
    { id: 'p-completed', status: 'completed', title: '破阵', targetChapterRange: '5' },
    { id: 'p-abandoned', status: 'abandoned', title: '救师', targetChapterRange: '5' },
    { id: 'p-planned', status: 'planned', title: '炼丹', targetChapterRange: '5' },
    { id: 'p-active', status: 'active', title: '夺宝', targetChapterRange: '5' },
    { id: 'p-default', title: '探秘', targetChapterRange: '5' }
  ];

  const query = { chapterNo: 5 };
  const { selectedPlans, decisions, includedReasons, excludedReasons } = selectRelevantPlans(plans, query);

  const selectedIds = selectedPlans.map(p => p.id);
  assert.deepEqual(selectedIds.sort(), ['p-active', 'p-default', 'p-planned'].sort());

  const completedDecision = decisions.find(d => d.id === 'p-completed');
  assert.ok(completedDecision);
  assert.equal(completedDecision.included, false);
  assert.equal(completedDecision.reason, 'plan_status_completed');

  const abandonedDecision = decisions.find(d => d.id === 'p-abandoned');
  assert.ok(abandonedDecision);
  assert.equal(abandonedDecision.included, false);
  assert.equal(abandonedDecision.reason, 'plan_status_abandoned');

  assert.ok(excludedReasons.some(r => r.id === 'p-completed' && r.reason === 'plan_status_completed'));
  assert.ok(excludedReasons.some(r => r.id === 'p-abandoned' && r.reason === 'plan_status_abandoned'));
});

test('M3-02: selectRelevantPlans 目标章节跨度打分与当章/下章/超范围精确分流', () => {
  const plans = [
    { id: 'p-exact', targetChapterRange: '5', title: '当章单章规划' },
    { id: 'p-range', targetChapterRange: '4-7', title: '当章跨度规划' },
    { id: 'p-upcoming', targetChapterRange: '6-8', title: '紧邻下章视野' },
    { id: 'p-far', targetChapterRange: '10-15', title: '远期超范围规划' },
    { id: 'p-general', title: '无范围全局规划' }
  ];

  const query = { chapterNumber: 5 };
  const { selectedPlans, decisions, includedReasons, excludedReasons } = selectRelevantPlans(plans, query);

  const selectedIds = selectedPlans.map(p => p.id);
  // 当章命中(+10)、跨度命中(+10)、紧邻下章(+3)、全局保底(+2)；远期远早于当前章应被排除
  assert.ok(selectedIds.includes('p-exact'));
  assert.ok(selectedIds.includes('p-range'));
  assert.ok(selectedIds.includes('p-upcoming'));
  assert.ok(!selectedIds.includes('p-far'), '远期计划必须被排除');

  const farExclusion = excludedReasons.find(r => r.id === 'p-far');
  assert.ok(farExclusion);
  assert.equal(farExclusion.reason, 'chapter_out_of_range');

  const exactDecision = decisions.find(d => d.id === 'p-exact');
  assert.equal(exactDecision.reason, 'chapter_target_match');

  const upcomingDecision = decisions.find(d => d.id === 'p-upcoming');
  assert.equal(upcomingDecision.reason, 'chapter_upcoming_horizon');
});

test('M3-03: selectRelevantPlans 角色在场性匹配加分与 JSON 格式解析', () => {
  const plans = [
    { id: 'p-no-char', targetChapterRange: '5', title: '无角色涉及' },
    { id: 'p-pov-char', targetChapterRange: '5', title: '涉及主角', participantIds: ['char_xiao_yan'] },
    { id: 'p-cast-json', targetChapterRange: '5', title: '涉及配角JSON', participant_ids_json: JSON.stringify(['char_xun_er']) }
  ];

  const query = {
    chapterNo: 5,
    povId: 'char_xiao_yan',
    castIds: ['char_xun_er']
  };

  const { selectedPlans } = selectRelevantPlans(plans, query);
  // 命中角色的计划应获得更高分数，排在前面
  assert.equal(selectedPlans.length, 3);
  assert.ok(selectedPlans[0].id === 'p-cast-json' || selectedPlans[0].id === 'p-pov-char');
  assert.ok(selectedPlans[1].id === 'p-cast-json' || selectedPlans[1].id === 'p-pov-char');
  assert.equal(selectedPlans[2].id, 'p-no-char');
});

test('M3-04: selectRelevantPlans 必保指令 (+100分) 穿透章节超范围限制', () => {
  const plans = [
    { id: 'p-ch5', targetChapterRange: '5', title: '普通当章计划' },
    { id: 'p-far-required', targetChapterRange: '30-40', title: '远期必保核心计划' }
  ];

  const query = {
    chapterNo: 5,
    requiredPlanIds: ['p-far-required']
  };

  const { selectedPlans, decisions } = selectRelevantPlans(plans, query);
  assert.equal(selectedPlans.length, 2);
  assert.equal(selectedPlans[0].id, 'p-far-required', '必保计划得分最高排首位');

  const reqDecision = decisions.find(d => d.id === 'p-far-required');
  assert.ok(reqDecision);
  assert.equal(reqDecision.included, true);
  assert.equal(reqDecision.reason, 'required_plan_directive');
});

test('M3-05: selectRelevantPlans 稳定排序与 Top-N 截断容量限制', () => {
  const plans = [
    { id: 'p-1', targetChapterRange: '5', title: '计划1' },
    { id: 'p-2', targetChapterRange: '5', title: '计划2' },
    { id: 'p-3', targetChapterRange: '5', title: '计划3' },
    { id: 'p-4', targetChapterRange: '5', title: '计划4' },
    { id: 'p-5', targetChapterRange: '5', title: '计划5' }
  ];

  const query = { chapterNo: 5 }; // 默认 Top 3
  const { selectedPlans, excludedReasons } = selectRelevantPlans(plans, query);

  assert.equal(selectedPlans.length, 3);
  assert.deepEqual(selectedPlans.map(p => p.id), ['p-1', 'p-2', 'p-3']);

  const cappedReasons = excludedReasons.filter(r => r.reason === 'plan_budget_capped');
  assert.equal(cappedReasons.length, 2);
  assert.deepEqual(cappedReasons.map(r => r.id), ['p-4', 'p-5']);

  // 支持 query.maxPlans 调整到最大 5
  const queryCustom = { chapterNo: 5, maxPlans: 5 };
  const resultCustom = selectRelevantPlans(plans, queryCustom);
  assert.equal(resultCustom.selectedPlans.length, 5);
});

test('M3-06: compileContext 将提炼的 plans 挂载至 writingPackage.plans 并保留 auditPackage 隔离', () => {
  const plans = [
    { id: 'plan-1', targetChapterRange: '5', title: '夺取异火', content: '深入塔戈尔大沙漠青莲地心火所在之地', status: 'planned', revision: 2 },
    { id: 'plan-2', targetChapterRange: '10-20', title: '中州风云', content: '远期中州势力纠葛', status: 'planned', revision: 1 },
    { id: 'plan-done', targetChapterRange: '5', title: '三年之约', content: '已在上一卷完成', status: 'completed', revision: 3 }
  ];

  const source = {
    bookId: 'test-novel',
    branchId: 'main',
    version: 1,
    facts: [{ id: 'fact-1', propositionId: 'prop-1', revision: 1, displayText: '萧炎修炼焚决' }],
    cognitions: [],
    policies: [],
    profiles: [],
    plans,
    sourceCurrent: () => true
  };

  const query = {
    chapterNo: 5,
    budgetTokens: 8000,
    modelId: 'default'
  };

  const manifest = compileContext(source, query);

  // writingPackage.plans 包含提炼后的有效计划
  assert.ok(manifest.writingPackage);
  assert.ok(Array.isArray(manifest.writingPackage.plans));
  assert.equal(manifest.writingPackage.plans.length, 1);
  assert.equal(manifest.writingPackage.plans[0].id, 'plan-1');
  assert.equal(manifest.writingPackage.plans[0].title, '夺取异火');
  assert.equal(manifest.writingPackage.plans[0].targetChapterRange, '5');

  // auditPackage 保持全量 plans 隔离供法医审计
  assert.ok(manifest.auditPackage);
  assert.deepEqual(manifest.auditPackage.plans, plans);

  // 审计清单记录包含与排除明细
  assert.ok(manifest.includedReasons.some(r => r.id === 'plan-1'));
  assert.ok(manifest.excludedReasons.some(r => r.id === 'plan-2' && r.reason === 'chapter_out_of_range'));
  assert.ok(manifest.excludedReasons.some(r => r.id === 'plan-done' && r.reason === 'plan_status_completed'));
});

test('M3-07: context.js 八层体系注册、优先级配置与 BLOCK_ORDER 顺位检验', () => {
  // 1. 验证 L2_chapter 八层注册
  assert.equal(BLOCK_TO_LAYER.storyPlans, 'L2_chapter', 'storyPlans 必须登记至 L2_chapter');

  // 2. 验证 Priority 1 核心引导优先级
  assert.equal(PRIORITY.storyPlans, 1, 'storyPlans 必须设定为 Priority 1');

  // 3. 验证 BLOCK_ORDER 紧随 chapterPlan 之后
  const chapterPlanIndex = BLOCK_ORDER.indexOf('chapterPlan');
  const storyPlansIndex = BLOCK_ORDER.indexOf('storyPlans');
  assert.ok(chapterPlanIndex >= 0, 'chapterPlan 必须在 BLOCK_ORDER 中');
  assert.ok(storyPlansIndex >= 0, 'storyPlans 必须在 BLOCK_ORDER 中');
  assert.equal(storyPlansIndex, chapterPlanIndex + 1, 'storyPlans 必须紧随 chapterPlan 之后');
});

test('M3-08: formatStoryPlansMarkdown 格式化为规范 Markdown 结构', () => {
  const plans = [
    {
      title: '破译青铜古殿阵法',
      targetChapterRange: '3-5',
      participantIds: ['char_hero', 'char_master'],
      content: '主角在第三章前必须从藏经阁获得阵法图录，解开偏殿禁制。'
    },
    {
      title: '结交万药斋小医仙',
      targetChapterRange: '5',
      content: '在青山镇万药斋以炼药学徒身份接近小医仙。'
    }
  ];

  const rendered = formatStoryPlansMarkdown(plans);
  const expectedLine1 = '- 计划 1: 【破译青铜古殿阵法】(目标章节: 3-5, 涉及人物: char_hero, char_master)';
  const expectedLine2 = '  规划要求: 主角在第三章前必须从藏经阁获得阵法图录，解开偏殿禁制。';
  const expectedLine3 = '- 计划 2: 【结交万药斋小医仙】(目标章节: 5)';
  const expectedLine4 = '  规划要求: 在青山镇万药斋以炼药学徒身份接近小医仙。';

  assert.ok(rendered.includes(expectedLine1), `应包含计划1元数据行，实际为:\n${rendered}`);
  assert.ok(rendered.includes(expectedLine2), `应包含计划1规划要求，实际为:\n${rendered}`);
  assert.ok(rendered.includes(expectedLine3), `应包含计划2元数据行，实际为:\n${rendered}`);
  assert.ok(rendered.includes(expectedLine4), `应包含计划2规划要求，实际为:\n${rendered}`);
});

test('M3-09: assembleContext 接入 storyPlans 编译并在 L2_chapter 输出 [storyPlans] 块', () => {
  const input = {
    currentTask: '撰写第五章探险',
    chapterGoal: '发现古殿地下秘境',
    storyPlans: [
      {
        id: 'plan-array-break',
        title: '破解古刹金刚封印',
        targetChapterRange: '5',
        participantIds: ['char_hero'],
        content: '必须在子夜前以青莲地心火焚毁第三道阵旗。'
      }
    ]
  };

  const { text, blocks, contextPlan } = assembleContext(input, { model: 'default' });

  // 1. 验证 blocks 中包含 storyPlans
  const storyPlansBlock = blocks.find(b => b.id === 'storyPlans');
  assert.ok(storyPlansBlock, 'blocks 必须包含 storyPlans 块');
  assert.equal(storyPlansBlock.layer, 'L2_chapter');
  assert.equal(storyPlansBlock.priority, 1);

  // 2. 验证 contextPlan.layers.L2_chapter 包含 storyPlans
  assert.ok(contextPlan.layers.L2_chapter.includes('storyPlans'), 'L2_chapter 必须包含 storyPlans');

  // 3. 验证最终提示词 contextText 包含规范的 [storyPlans] 块
  assert.ok(text.includes('[storyPlans]'));
  assert.ok(text.includes('【破解古刹金刚封印】'));
  assert.ok(text.includes('规划要求: 必须在子夜前以青莲地心火焚毁第三道阵旗。'));
});

test('M3-10: 端到端 compileContext 与 assembleContext 打通链路验证', () => {
  const source = {
    bookId: 'test-novel',
    branchId: 'main',
    version: 1,
    facts: [{ id: 'fact-1', propositionId: 'prop-1', revision: 1, displayText: '萧炎身负玄重尺' }],
    cognitions: [],
    policies: [],
    profiles: [],
    plans: [
      {
        id: 'plan-core',
        title: '激战云岚宗外门长老',
        content: '主角绝不可暴露药老灵魂力量，仅用八极崩险胜',
        targetChapterRange: '8',
        participantIds: ['char_xiao_yan', 'char_elder'],
        status: 'active'
      }
    ],
    sourceCurrent: () => true
  };

  const query = {
    currentTask: '撰写第八章大战',
    chapterNo: 8,
    budgetTokens: 10000,
    modelId: 'default'
  };

  const manifest = compileContext(source, query);

  // 验证 compiledContext 文本包含由 assembleContext 渲染的 [storyPlans]
  assert.ok(manifest.compiledContext.includes('[storyPlans]'), 'compiledContext 必须包含 [storyPlans] 块');
  assert.ok(manifest.compiledContext.includes('【激战云岚宗外门长老】'));
  assert.ok(manifest.compiledContext.includes('规划要求: 主角绝不可暴露药老灵魂力量，仅用八极崩险胜'));
  assert.ok(manifest.contextPlan.layers.L2_chapter.includes('storyPlans'));
});

test('M3-11: selectRelevantPlans 与 formatStoryPlansMarkdown 对数字 ID 对象类型防御', () => {
  const plans = [
    {
      id: 'p-numeric',
      title: '数字人物规划',
      targetChapterRange: '1',
      participantIds: [{ id: 1001 }, { name: '医仙' }, 2002],
      content: '测试规划'
    }
  ];

  // 1. selectRelevantPlans 不抛出 TypeError，且提取字符串化后的 participantIds
  const res = selectRelevantPlans(plans, { chapterNo: 1, castIds: [{ id: 1001 }] });
  assert.equal(res.selectedPlans.length, 1);
  assert.deepEqual(res.selectedPlans[0].participantIds, ['1001', '医仙', '2002']);

  // 2. formatStoryPlansMarkdown 正常渲染且不抛错
  const md = formatStoryPlansMarkdown(res.selectedPlans);
  assert.ok(md.includes('涉及人物: 1001, 医仙, 2002'));
});

test('M3-12: selectRelevantPlans 状态门禁对首尾空白与换行符严格过滤', () => {
  const plans = [
    { id: 'p-trim-c', status: '  completed  ', title: '带空格完成', targetChapterRange: '1' },
    { id: 'p-trim-a', status: '\tabandoned\n', title: '带换行废弃', targetChapterRange: '1' },
    { id: 'p-trim-p', status: '  planned  ', title: '带空格计划', targetChapterRange: '1' }
  ];

  const res = selectRelevantPlans(plans, { chapterNo: 1 });
  const selectedIds = res.selectedPlans.map(p => p.id);

  assert.deepEqual(selectedIds, ['p-trim-p']);
  assert.ok(res.excludedReasons.some(r => r.id === 'p-trim-c' && r.reason === 'plan_status_completed'));
  assert.ok(res.excludedReasons.some(r => r.id === 'p-trim-a' && r.reason === 'plan_status_abandoned'));
});

test('M3-13: selectRelevantPlans 内容与摘要保守切片与防双写膨胀验证', () => {
  const longContent = '长篇规划要求'.repeat(30); // 180 字符
  const plans = [
    { id: 'p-no-sum', title: '无摘要计划', content: longContent, targetChapterRange: '1' },
    { id: 'p-with-sum', title: '有摘要计划', content: longContent, summary: '独立简短摘要'.repeat(30), targetChapterRange: '1' }
  ];

  const res = selectRelevantPlans(plans, { chapterNo: 1 });
  const pNoSum = res.selectedPlans.find(p => p.id === 'p-no-sum');
  const pWithSum = res.selectedPlans.find(p => p.id === 'p-with-sum');

  assert.ok(pNoSum);
  assert.ok(pNoSum.content.length <= 300);
  // 无 summary 时自动保守截断至 80 字符，杜绝完整双写膨胀
  assert.equal(pNoSum.summary.length, 80);

  assert.ok(pWithSum);
  // 有 summary 时截断至 150 字符
  assert.equal(pWithSum.summary.length, 150);
});

test('M3-14: selectRelevantPlans 严格过滤 plans 内部数组与无效元素', () => {
  const dirtyPlans = [
    [], // 空数组
    ['nested', 'array'], // 嵌套数组
    null,
    undefined,
    'string_elem',
    12345,
    { id: 'p-valid-obj', title: '合法计划对象', targetChapterRange: '1' }
  ];

  const res = selectRelevantPlans(dirtyPlans, { chapterNo: 1 });
  assert.equal(res.selectedPlans.length, 1);
  assert.equal(res.selectedPlans[0].id, 'p-valid-obj');
});
