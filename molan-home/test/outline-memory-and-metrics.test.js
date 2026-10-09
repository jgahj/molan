'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compileContext } = require('../lib/memory-context');
const { assembleContext } = require('../lib/generation/context');

test('R3: Memory Context 计划数据治理 - story_plans 成功提升进入 writingPackage 并按章节筛选', () => {
  const plans = [
    { id: 'plan-ch1', chapterNo: 1, title: '第一章规划', summary: '探查古庙并发现线索', planType: 'beat' },
    { id: 'plan-ch2', chapterNo: 2, title: '第二章规划', summary: '与追兵交战', planType: 'beat' },
    { id: 'plan-ch-other', chapterNo: 99, title: '远期决战', summary: '最终魔王战', planType: 'volume_climax' }
  ];

  const source = {
    bookId: 'test-book',
    branchId: 'main',
    version: 1,
    facts: [{ id: 'fact-1', propositionId: 'p-1', revision: 1, displayText: '主角持有灵剑' }],
    cognitions: [],
    policies: [],
    profiles: [],
    plans,
    sourceCurrent: () => true
  };

  // 1. 查询第 1 章时，只提升属于第 1 章的 plans 到 writingPackage
  const queryCh1 = {
    currentTask: '撰写第一章正文',
    chapterNo: 1,
    budgetTokens: 8000,
    modelId: 'gemini-3.8-flash'
  };

  const manifestCh1 = compileContext(source, queryCh1);
  assert.ok(manifestCh1.writingPackage, 'writingPackage 必须存在');
  assert.ok(Array.isArray(manifestCh1.writingPackage.plans), 'writingPackage.plans 必须为数组');
  assert.equal(manifestCh1.writingPackage.plans.length, 1);
  assert.equal(manifestCh1.writingPackage.plans[0].id, 'plan-ch1');
  assert.equal(manifestCh1.writingPackage.plans[0].chapterNo, 1);
  assert.equal(manifestCh1.writingPackage.plans[0].title, '第一章规划');

  // 验证排除原因中记录了不匹配的计划
  const excludedPlanIds = manifestCh1.excludedReasons.filter(r => r.reason === 'chapter_no_mismatch').map(r => r.id);
  assert.ok(excludedPlanIds.includes('plan-ch2'), 'plan-ch2 必须因章节不匹配被排除');
  assert.ok(excludedPlanIds.includes('plan-ch-other'), 'plan-ch-other 必须因章节不匹配被排除');

  // 验证包含原因中记录了提升入模的计划
  const includedPlan = manifestCh1.includedReasons.find(r => r.id === 'plan-ch1');
  assert.ok(includedPlan, 'plan-ch1 必须有 includedReason');
  assert.equal(includedPlan.reason, 'applicable_story_plan');

  // 验证编译后的上下文文本包含该计划摘要
  assert.ok(manifestCh1.compiledContext.includes('第一章规划: 探查古庙并发现线索'));

  // 2. 查询第 2 章时，提升第 2 章的 plans
  const queryCh2 = {
    currentTask: '撰写第二章正文',
    chapterNo: 2,
    budgetTokens: 8000,
    modelId: 'gemini-3.8-flash'
  };
  const manifestCh2 = compileContext(source, queryCh2);
  assert.equal(manifestCh2.writingPackage.plans.length, 1);
  assert.equal(manifestCh2.writingPackage.plans[0].id, 'plan-ch2');
  assert.ok(manifestCh2.compiledContext.includes('第二章规划: 与追兵交战'));
});

test('R4: 上下文回放清单 8 维大纲审计指标闭环完整性验证', () => {
  const outlineContext = {
    chapterId: 'chap-101-alpha',
    chapterNo: 5,
    planRevision: 3,
    outlineHash: 'sha256:abcd1234ef5678',
    dependencies: ['chap-100-event-broken-sword', 'debt-recover-relic'],
    outlineImpact: {
      completed: ['event-enter-dungeon'],
      deferred: ['event-find-secret-door'],
      changed: ['dialogue-reveal-identity'],
      omitted: []
    },
    chapter: {
      id: 'chap-101-alpha',
      chapterNo: 5,
      title: '深渊之下',
      summary: '主角深入深渊古窟寻找灵玉',
      beats: ['初入裂隙', '遭遇石傀儡', '斩断机关']
    }
  };

  const input = {
    outlineContext,
    currentTask: '撰写第五章探索深渊剧情',
    hardState: { inAbyss: true },
    recentChapters: '上一章击退了追兵'
  };

  const options = {
    model: 'gemini-3.8-flash',
    provider: 'google',
    hardLimit: 32000,
    outputReserve: 4000,
    chapterId: 'chap-101-alpha',
    chapterNo: 5,
    outlineRevision: 3,
    outlineHash: 'sha256:abcd1234ef5678',
    stateDeltaCommitted: true
  };

  const { contextPlan } = assembleContext(input, options);
  const manifest = contextPlan.replayManifest;

  // 验证 8 维指标在 contextPlan 根属性与 replayManifest 中均严格闭环且同构
  // 1. resolvedChapterId
  assert.equal(contextPlan.resolvedChapterId, 'chap-101-alpha');
  assert.equal(manifest.resolvedChapterId, 'chap-101-alpha');

  // 2. resolvedChapterNo
  assert.equal(contextPlan.resolvedChapterNo, 5);
  assert.equal(manifest.resolvedChapterNo, 5);

  // 3. outlineRevision & outlineHash
  assert.equal(contextPlan.outlineRevision, 3);
  assert.equal(manifest.outlineRevision, 3);
  assert.equal(contextPlan.outlineHash, 'sha256:abcd1234ef5678');
  assert.equal(manifest.outlineHash, 'sha256:abcd1234ef5678');

  // 4. requiredOutlineIncluded (关键大纲必须真正进入最终提示词)
  assert.equal(contextPlan.requiredOutlineIncluded, true);
  assert.equal(manifest.requiredOutlineIncluded, true);

  // 5. outlineBlockTokens (大纲实际预算消耗度量)
  assert.ok(contextPlan.outlineBlockTokens > 0, '大纲必须有真实 token 预算度量');
  assert.equal(contextPlan.outlineBlockTokens, manifest.outlineBlockTokens);

  // 6. outlineDependenciesIncluded (必要依赖/伏笔召回完整性)
  assert.deepEqual(contextPlan.outlineDependenciesIncluded, ['chap-100-event-broken-sword', 'debt-recover-relic']);
  assert.deepEqual(manifest.outlineDependenciesIncluded, ['chap-100-event-broken-sword', 'debt-recover-relic']);

  // 7. outlineImpact (计划完成、延后、变更追踪)
  assert.deepEqual(contextPlan.outlineImpact.completed, ['event-enter-dungeon']);
  assert.deepEqual(contextPlan.outlineImpact.deferred, ['event-find-secret-door']);
  assert.deepEqual(manifest.outlineImpact.changed, ['dialogue-reveal-identity']);

  // 8. contextTruncationReasons & stateDeltaCommitted
  assert.ok(Array.isArray(contextPlan.contextTruncationReasons));
  assert.ok(Array.isArray(manifest.contextTruncationReasons));
  assert.equal(contextPlan.stateDeltaCommitted, true);
  assert.equal(manifest.stateDeltaCommitted, true);

  // 验证聚合对象 outlineAudit 结构体完备
  assert.ok(contextPlan.outlineAudit, 'contextPlan.outlineAudit 必须存在');
  assert.equal(contextPlan.outlineAudit.resolvedChapterId, 'chap-101-alpha');
  assert.equal(contextPlan.outlineAudit.requiredOutlineIncluded, true);
});

test('R4: 极简/缺省输入下 8 维指标优雅降级不抛错', () => {
  const { contextPlan } = assembleContext({ currentTask: '简单测试' }, { model: 'default' });
  const manifest = contextPlan.replayManifest;

  assert.equal(contextPlan.resolvedChapterId, null);
  assert.equal(manifest.resolvedChapterId, null);
  assert.equal(contextPlan.requiredOutlineIncluded, false);
  assert.equal(contextPlan.outlineBlockTokens, 0);
  assert.deepEqual(contextPlan.outlineDependenciesIncluded, []);
  assert.deepEqual(contextPlan.outlineImpact, { completed: [], deferred: [], changed: [], omitted: [] });
  assert.deepEqual(contextPlan.contextTruncationReasons, []);
  assert.equal(contextPlan.stateDeltaCommitted, false);
});
