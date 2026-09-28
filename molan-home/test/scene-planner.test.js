'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateChapterCapacity,
  planScenes,
  compileSceneDirectives
} = require('../lib/scene-planner');

test('Scene Planner：单章戏剧容量门禁评估 (DEF-PACING-002)', () => {
  // 正常事件量 (2~3 节点)
  const optimal = evaluateChapterCapacity(['张若尘踢门', '姑射静救火'], 2400);
  assert.equal(optimal.status, 'optimal');
  assert.equal(optimal.nodeCount, 2);
  assert.equal(optimal.issue, null);

  // 密集事件量 (4~5 节点)
  const dense = evaluateChapterCapacity(['事件1', '事件2', '事件3', '事件4'], 2400);
  assert.equal(dense.status, 'dense');
  assert.ok(dense.issue.includes('密集'));

  // 严重过载事件量 (>= 6 节点)
  const overload = evaluateChapterCapacity([
    '事件1', '事件2', '事件3', '事件4', '事件5', '事件6', '事件7'
  ], 2400);
  assert.equal(overload.status, 'overload');
  assert.ok(overload.issue.includes('过紧') || overload.issue.includes('紧绷'));
  assert.ok(overload.recommendation.includes('拆解') || overload.recommendation.includes('合并'));
  assert.ok(overload.downtimeChars > 0, '必须分配呼吸留白预算');
});

test('Scene Planner：时空跳跃检测与转场桥梁契约 (DEF-PACING-001)', () => {
  const nodes = [
    '张若尘在木灵希陪同下故意惹事强闯魔窟',
    '姑射静被迫当救火队长从神灵手中救回',
    '伪神设宴抢着结拜',
    '姑射静向母神抱怨，姑射云琉点破逼退婚算计',
    '三日后，张若尘主动来到云琉神殿借出天魔石刻开启日晷',
    '张若尘对木灵希吐露真实目的，月圆夜第二天必须离开'
  ];

  const plan = planScenes(nodes, { targetWordCount: 2400 });
  assert.equal(plan.totalScenes, 6);
  assert.ok(plan.scenesWithBridgeRequired >= 1, '必须检测到需要转场桥梁的场景');

  // 第 5 个节点包含“三日后”，必须要求转场过渡桥梁
  const scene5 = plan.scenes[4];
  assert.equal(scene5.hasTemporalShift, true);
  assert.equal(scene5.requiresTransitionBridge, true);
  assert.ok(scene5.transitionBridgeDirective.includes('DEF-PACING-001'));
  assert.ok(scene5.transitionBridgeDirective.includes('严禁直接以孤立词'));

  // 必须分配中段呼吸留白
  assert.ok(plan.scenesWithDowntimeBudget >= 1, '必须至少包含一个呼吸留白镜头');
});

test('Scene Planner：场景契约编译与 Prompt 格式断言', () => {
  const nodes = ['节点A', '三日后，节点B前往神殿'];
  const plan = planScenes(nodes);
  const promptBlock = compileSceneDirectives(plan);

  assert.ok(promptBlock.includes('### 【分场景规划与时空转场契约 (Scene Planner Enforced)】'));
  assert.ok(promptBlock.includes('转场衔接'));
  assert.ok(promptBlock.includes('DEF-PACING-001'));
});
