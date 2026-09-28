'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractTextFeatures,
  calculateTextDistance,
  compareTriad
} = require('../lib/ground-truth-comparator');

test('Ground Truth Comparator：指纹特征抽取与文风距离计算', () => {
  const sample = `
“这一刀，你接得下吗？”
张若尘倒退三步，骨骼微鸣，嘴角溢出血迹，自嘲地笑了一声。
四周重力形变让青石寸寸龟裂。
  `;

  const feat = extractTextFeatures(sample);
  assert.ok(feat.charCount > 20);
  assert.ok(feat.dialogueRatio > 0.1);
  assert.ok(feat.somaticDensity > 0, '应识别出骨骼/重力/龟裂等受力感官词');
  assert.ok(feat.humanWeaknessHits > 0, '应识别出自嘲等弱点词');

  const dist = calculateTextDistance(feat, feat);
  assert.equal(dist, 0, '相同文本距离应为 0');
});

test('Ground Truth Comparator：三角对照评测与提示词敏感度 (PSI) 断言', () => {
  const original = `
神灵大手横空碾碎石门，恐怖的重力形变让青石地面寸寸龟裂。神威压在肩头，张若尘骨骼微鸣，气血翻滚暴退三步，嘴角溢出一丝血迹。
姑射静踏入神殿，冷冷质问：“你在算计老祖宗？”
张若尘在刀尖起舞，暗中调息平复剧烈的心跳，嘴上却淡然笑道：“我怕你笑场。”
  `;

  // 详细版：高保真对白与受力
  const detailedGen = `
神灵大手横空碾碎石门，重力形变让青石地面寸寸龟裂。张若尘骨骼微鸣，气血翻滚暴退三步，嘴角溢出一丝血迹。
姑射静走入大殿，质问道：“你连老祖宗都敢算计？”
张若尘暗中调息平复心跳，自嘲笑道：“我怕你笑场。”
  `;

  // 粗略版：缺少受力和对白细节，偏向平淡叙述
  const coarseGen = `
神灵大手抓来，张若尘被打退了。姑射静来了，问他在干什么。张若尘笑了笑。
  `;

  const triad = compareTriad(original, detailedGen, coarseGen, {
    bookTitle: '一世之尊',
    genre: '玄幻',
    stage: 'early'
  });

  assert.ok(triad.distances.detailedToOriginal < triad.distances.coarseToOriginal, '详细版距原著距离应小于粗略版');
  assert.ok(triad.promptSensitivityIndex > 0, '详细版正向逼近，PSI 必须大于 0');
  assert.equal(triad.verdict, 'detailed_superior');
});
