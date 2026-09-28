import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateClimaxShockGate,
  evaluateSuspenseSandboxGate,
  evaluateSocialDialogueGate,
  evaluateFemaleRomanceGate,
  evaluateHistoricalEtiquetteGate,
  runGenreNarrativeAudits
} from '../lib/genre-narrative-audit.js';

test('1. evaluateClimaxShockGate: 高潮章节缺少现场反响与受创报错，具备则放行', () => {
  const weakClimax = '林渊一招斩出，长剑击中敌方。敌方倒在地上，林渊收剑离开。';
  const weakRes = evaluateClimaxShockGate(weakClimax, { isClimax: true, intensity: 8 }, '传统玄幻');
  assert.equal(weakRes.passed, false);
  assert.equal(weakRes.issue?.category, 'emotional_climax');

  const strongClimax = '剑气爆鸣，黑袍人吐血暴退，整条右臂骨裂声清晰可闻！满座皆惊，全场死寂得连一根针掉在地上都听得见，众人目瞪口呆！';
  const strongRes = evaluateClimaxShockGate(strongClimax, { isClimax: true, intensity: 8 }, '传统玄幻');
  assert.equal(strongRes.passed, true);
});

test('2. evaluateSuspenseSandboxGate: 悬疑开篇前3章禁止全知剧透', () => {
  const spoilerText = '走进废弃医院的第一天，林默就冷冷一笑，因为真相其实是院长在二十年前就自杀了。';
  const res = evaluateSuspenseSandboxGate(spoilerText, { chapterNo: 1 }, '悬疑脑洞');
  assert.equal(res.passed, false);
  assert.equal(res.issue?.severity, 'blocker');

  const normalText = '医院走廊尽头传来滴水声，锈蚀的铁门半掩着，墙根下隐约有一抹干涸的暗红斑迹。';
  const cleanRes = evaluateSuspenseSandboxGate(normalText, { chapterNo: 1 }, '悬疑脑洞');
  assert.equal(cleanRes.passed, true);
});

test('3. evaluateSocialDialogueGate: 拦截低智反派口嗨台词', () => {
  const lowIq = '张少冷笑一声，指着江辰的鼻子吼道：给我跪下磕头叫爷爷，否则天王老子来了也保不住你！';
  const res = evaluateSocialDialogueGate(lowIq, {}, '都市高武');
  assert.equal(res.passed, false);
  assert.equal(res.issue?.category, 'urban_villain_iq');

  const smartVillain = '张律师推了推眼镜，将一份借贷违约通知书推到桌前：“江先生，根据协议第七条，您的房屋抵押权已经在三分钟前正式转移。”';
  const cleanRes = evaluateSocialDialogueGate(smartVillain, {}, '都市高武');
  assert.equal(cleanRes.passed, true);
});

test('4. evaluateFemaleRomanceGate: 拦截男频粗暴刺杀宅斗与油腻土味情话', () => {
  const violentMansion = '苏婉儿眼神冰冷，当场一拳打死主母，让整个苏府化为血海。';
  const res1 = evaluateFemaleRomanceGate(violentMansion, {}, '宫斗宅斗');
  assert.equal(res1.passed, false);
  assert.equal(res1.issue?.severity, 'blocker');

  const greasyText = '顾总一把将她推在落地窗前，邪魅一笑：“小东西，你成功引起了我的注意。”';
  const res2 = evaluateFemaleRomanceGate(greasyText, {}, '豪门总裁');
  assert.equal(res2.passed, false);
  assert.equal(res2.issue?.category, 'romance_greasy');
});

test('5. evaluateHistoricalEtiquetteGate: 拦截穿越现代经济大词', () => {
  const modernAnachronism = '朱元璋坐在奉天殿上，刘伯温启奏道：“陛下，若要稳定大明财政，必须用大数据沉淀来重构经济模型，完成降维打击。”';
  const res = evaluateHistoricalEtiquetteGate(modernAnachronism, {}, '历史古代');
  assert.equal(res.passed, false);
  assert.equal(res.issue?.category, 'historical_anachronism');

  const properHistory = '朱元璋翻看着手中的黄册，沉声道：“户部度支司呈上来的常平仓钱粮，亏空了整整三成，江南士族这是在挖大明的根基！”';
  const cleanRes = evaluateHistoricalEtiquetteGate(properHistory, {}, '历史古代');
  assert.equal(cleanRes.passed, true);
});

test('6. runGenreNarrativeAudits: 聚合调用正常工作', () => {
  const content = '测试正文，平和日常叙事。';
  const report = runGenreNarrativeAudits(content, { intensity: 3 }, '都市日常');
  assert.equal(report.passed, true);
  assert.equal(report.issues.length, 0);
});
