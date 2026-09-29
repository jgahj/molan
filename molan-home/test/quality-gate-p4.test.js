'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateUnifiedQuality } = require('../lib/quality/unified-quality-gate');
const { auditGeneratedChapter } = require('../lib/generation-pipeline-coordinator');

test('P4: 恶意样本 - 事实冲突与反向规避被 Hard Blocker 准确拦截', () => {
  // 1. 实体关系事实冲突 (地姥女婿)
  const factConflictText = '周叙站在风雪中，看着前方的营帐。作为地姥女婿，他必须在今夜做出决断。'.repeat(15);
  const resConflict = evaluateUnifiedQuality(factConflictText, { genre: '玄幻' });
  assert.equal(resConflict.status, 'block');
  assert.equal(resConflict.passed, false);
  assert.ok(resConflict.blockers.some(b => b.code === 'FACT_RELATIONSHIP_CONFLICT'));

  // 2. 悬疑开篇上帝视角剧透
  const suspenseSpoilerText = '老街铜锁落地，发出清脆的鸣响。陈寻俯身拾起，其实凶手早已看穿了所有的秘密，幕后黑手就是赵掌柜。'.repeat(10);
  const resSuspense = evaluateUnifiedQuality(suspenseSpoilerText, { genre: '悬疑', contract: { chapterNo: 1 } });
  assert.equal(resSuspense.status, 'block');
  assert.equal(resSuspense.passed, false);
  assert.ok(resSuspense.blockers.some(b => b.code === 'SUSPENSE_SPOILER_BLOCKER'));

  // 3. 女频后宅粗暴武力破局
  const femaleBruteText = '正堂之上，老夫人面色阴沉。沈清辞没有与她多费口舌，直接拔剑刺向主母，这一剑快若奔雷。'.repeat(10);
  const resFemale = evaluateUnifiedQuality(femaleBruteText, { genre: '古言世情', contract: { chapterNo: 2 } });
  assert.equal(resFemale.status, 'block');
  assert.equal(resFemale.passed, false);
  assert.ok(resFemale.blockers.some(b => b.code === 'FEMALE_ROMANCE_BRUTE_FORCE'));

  // 4. 重度生理抽搐与 AI 味
  const spasmText = '他指腹反复摩挲着茶盏，食指轻叩桌面。这一刻，他喉咙发紧，喉头发干，心跳漏了一拍，下颌紧绷。'.repeat(10);
  const resSpasm = evaluateUnifiedQuality(spasmText, { genre: '都市' });
  assert.equal(resSpasm.status, 'block');
  assert.equal(resSpasm.passed, false);
  assert.ok(resSpasm.blockers.some(b => b.code === 'AI_FLAVOR_CRITICAL'));
});

test('P4: 软性告警 - 次要问题生成 Soft Warning 但不阻断生成', () => {
  // 1. 历史正剧现代大词穿帮
  const historyText = '户部侍郎周叙在朝堂之上朗声奏对，主张朝廷应当运用大数据沉淀与互联网思维进行粮草转运，方能实现宏观调控。'.repeat(10);
  const resHistory = evaluateUnifiedQuality(historyText, { genre: '历史古代' });
  assert.equal(resHistory.status, 'warn');
  assert.equal(resHistory.passed, true);
  assert.equal(resHistory.blockers.length, 0);
  assert.ok(resHistory.warnings.some(w => w.code === 'HISTORICAL_ANACHRONISM'));

  // 2. 角色声音禁忌词触发
  const tabooText = '守卫拔出腰间横刀，看着对面的黑衣人，嘴角露出一丝冷笑，淡淡一笑后跨出大门。'.repeat(10);
  const resTaboo = evaluateUnifiedQuality(tabooText, {
    genre: '玄幻',
    contextCharacters: [
      { id: 'guard-1', name: '守卫', voice: { tabooWords: ['淡淡一笑'] } }
    ]
  });
  assert.equal(resTaboo.status, 'warn');
  assert.equal(resTaboo.passed, true);
  assert.ok(resTaboo.warnings.some(w => w.code === 'CHARACTER_VOICE_TABOO'));
});

test('P4: 正常合格样本 - 顺利通过且综合质量评分高', () => {
  const goodChapter = `深秋的夜风卷着湿冷的沙尘，扑打在青石驿站的木窗格上。
周叙解下腰间的两截短棍，用粗布慢慢擦拭上面的机油与磨损痕迹。案头的油灯跳动着暗黄的火苗，将他的影子拉得极长。
门外传来两声沉闷的马蹄声，随即停在照壁前。
“掌柜，打三斤干肉，两壶烧酒。”一个沙哑的声音透过门缝飘了进来，带着西北风沙特有的粗粝感。
周叙没有抬头，手指稳稳搭在短棍接驳处的机括上。他听得出来，来人的马靴底钉了铁掌，那是边军斥候才有的行头。
然而此时本该驻防在三百里外的斥候，绝不该在子夜时分孤身出现在这座废弃的驿站。
窗外的风声更急了，吹得悬在屋檐下的铁马叮当作响。
柴门被推开了一条缝，风雪裹着刺骨的寒意直灌而入，门槛前多了一道高大而沉默的黑影。
周叙终于抬起头，目光落在那柄横系在对方腰间的制式短刀上，神色波澜不惊。`;

  const resGood = evaluateUnifiedQuality(goodChapter, {
    genre: '都市高武',
    contract: { chapterNo: 1, isClimax: false }
  });

  assert.equal(resGood.status, 'pass');
  assert.equal(resGood.passed, true);
  assert.equal(resGood.blockers.length, 0);
  assert.ok(resGood.score >= 85, `合格章节评分应 >= 85，实际为 ${resGood.score}`);
  assert.ok(resGood.evidence.factContinuity.passed);
  assert.ok(resGood.evidence.aiFlavor.passed);
});

test('P4: generation-pipeline-coordinator 委托 unified quality gate 审计输出', () => {
  const chapterText = '林川握紧长剑，目光凝视前方。'.repeat(30);
  const audit = auditGeneratedChapter(chapterText, { genre: '玄幻' });

  assert.ok(audit.qualityGate);
  assert.equal(typeof audit.qualityGate.status, 'string');
  assert.equal(typeof audit.qualityGate.score, 'number');
  assert.ok(Array.isArray(audit.qualityGate.blockers));
  assert.ok(Array.isArray(audit.qualityGate.warnings));
  assert.ok(audit.qualityGate.evidence);
  assert.equal(typeof audit.passed, 'boolean');
});
