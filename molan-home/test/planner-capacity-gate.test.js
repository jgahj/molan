'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPACITY_RULES,
  evaluateChapterCapacity,
  partitionChapterEvents
} = require('../lib/planner-capacity-gate');

test('OPT-SCENE-001: 单章容量门禁评估 (DEF-PACING-002)', () => {
  // 正常事件量 (2~3 节点)
  const optimal = evaluateChapterCapacity(['张若尘踢门惹事', '姑射静救火'], 2400);
  assert.equal(optimal.status, 'optimal');
  assert.equal(optimal.requiresPartitioning, false);
  assert.equal(optimal.downtimeChars, Math.round(2400 * CAPACITY_RULES.recommendedDowntimeRatio));

  // 密集事件量 (4~5 节点)
  const dense = evaluateChapterCapacity(['事件1', '事件2', '事件3', '事件4'], 2400);
  assert.equal(dense.status, 'dense');
  assert.equal(dense.requiresPartitioning, false);
  assert.ok(dense.issue.includes('密集'));

  // 严重过载事件量 (>= 6 节点，如月圆夜原始 7 事件)
  const overloadEvents = [
    '张若尘强闯魔窟踢门惹事',
    '姑射静救回张若尘',
    '伪神设宴抢着结拜',
    '姑射静向母神抱怨被点破算计',
    '三日后张若尘借出天魔石刻并开启日晷',
    '张若尘对木灵希吐露月圆夜真实目的',
    '次日必须离开罗祖云山界'
  ];
  const overload = evaluateChapterCapacity(overloadEvents, 2400);
  assert.equal(overload.status, 'overload');
  assert.equal(overload.requiresPartitioning, true);
  assert.ok(overload.issue.includes('DEF-PACING-002'));
  assert.ok(overload.issue.includes('DEF-PACING-001'));
  assert.ok(overload.recommendation.includes('partitionChapterEvents'));
});

test('OPT-SCENE-001: 智能拆章分流器 (Chapter Partitioning) 连贯性', () => {
  const overloadEvents = [
    '张若尘强闯魔窟踢门惹事',
    '姑射静救回张若尘',
    '伪神设宴抢着结拜',
    '姑射静向母神抱怨被点破算计',
    '三日后张若尘借出天魔石刻并开启日晷',
    '张若尘对木灵希吐露月圆夜真实目的',
    '次日必须离开罗祖云山界'
  ];

  // 拆分为每章最多 3 个事件
  const partitioned = partitionChapterEvents(overloadEvents, { maxPerChapter: 3 });

  assert.equal(partitioned.length, 3, '7 个事件拆分为 3+3+1 = 3 章');
  assert.equal(partitioned[0].events.length, 3);
  assert.equal(partitioned[1].events.length, 3);
  assert.equal(partitioned[2].events.length, 1);

  // 校验跨章钩子与承接关系
  assert.ok(partitioned[0].outgoingHook.includes('埋下强烈行动悬念'));
  assert.ok(partitioned[1].incomingHook.includes('承接前章余波'));
  assert.ok(partitioned[1].outgoingHook.includes('埋下强烈行动悬念'));
  assert.ok(partitioned[2].incomingHook.includes('承接前章余波'));
  assert.equal(partitioned[2].outgoingHook, '阶段终局收束');
});
