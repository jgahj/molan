'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  MANDATORY_PROFILE_FIELDS,
  extractNovelQualityProfile,
  validateQualityProfile,
  compareQualityProfiles,
  parseBookChapters
} = require('../lib/novel-quality-profiler');
const benchmarkDatabase = require('../lib/benchmark-database');

const SAMPLE_NOVEL_TEXT = `
第一章 寒冬夜行

    暴风雪撕扯着破败的窗棂，发出刺耳的尖啸。
    林巡裹紧了身上粗粝的羊皮短袄，指尖冻得有些发僵，但他依然沉静地数着手中的七枚铜钱。
    “还差三枚，才够交下个月的柴炭税。”他低声喃喃了一句，清了清嗓子，嘴角泛起一丝自嘲的冷笑。
    门外突然传来了沉重的脚步声，伴随着战靴碾碎积雪的嘎吱异响。
    林巡眼神骤然内敛，反手按住了藏在门轴后的铁凿，没有丝毫慌乱，心跳却不可避免地加快了半分。

第二章 门后试探

    木门吱呀一声被推开了一条缝隙。
    风雪卷入，伴随着浓重的血腥味与焦糊气息。
    “林老弟，是我……李捕头。”门外传来粗重的喘息声，话说到一半便剧烈咳嗽起来，“快……关门，有人在追我……”
    林巡犹豫了一下，目光扫过对方腰间染血的佩刀，停顿了两息，才侧身让他进屋。
    “李头儿，这是规矩外的麻烦。”林巡沉声道，一边迅速插上门闩，顺手递过去一碗温水。
    李捕头瘫坐在草席上，喘着粗气苦笑：“我知道规矩，但这件事关乎整个黑石城的生死……城主府被妖人血祭了！”

第三章 绝地反戈

    话音未落，屋顶上方猛然传来轰然剧震！
    整片瓦砾如雨点般砸落，一道漆黑的刀光携着刺耳的破空声直斩而下。
    “死！”黑袍刺客冷声暴喝。
    危急关头，林巡没有后退，更没有做无意义的惊叫。他身形猛然下沉，借着桌案的翻倒阻挡视线，手中的生锈铁凿以极其刁钻的角度刺向对方受力的右膝关节。
    咔嚓一声脆响！
    骨裂声伴随着刺客的闷哼响起。黑袍刺客倒飞而出，摔在泥地里，满脸难以置信。
    林巡稳稳站在寒风中，手臂肌肉微微发颤，冷冷地盯着对方。
`;

test('NovelQualityProfile: 20 维核心字段与 Schema 完整性校验', async t => {
  await t.test('成功提取 20 维全量字段，且全部符合【feature, value, evidence, confidence, explanation】规范', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT, {
      title: '寒冬夜行',
      author: '测试名家',
      genre: '玄幻修真',
      subgenre: '仙侠'
    });

    assert.equal(profile.schemaVersion, '2.0-novel-quality-profile');
    assert.equal(profile.bookMeta.totalChapters, 3);

    // 校验 20 维字段全部存在
    for (const field of MANDATORY_PROFILE_FIELDS) {
      assert.ok(profile[field], `必须包含字段: ${field}`);
      const block = profile[field];
      assert.ok(block.feature, `${field} 必须包含 feature`);
      assert.notEqual(block.value, undefined, `${field} 必须包含 value`);
      assert.ok(Array.isArray(block.evidence), `${field} 必须包含 evidence 数组`);
      assert.ok(typeof block.confidence === 'number', `${field} 必须包含 numeric confidence`);
      assert.ok(typeof block.explanation === 'string', `${field} 必须包含 explanation 说明`);
    }

    const val = validateQualityProfile(profile);
    assert.equal(val.valid, true, 'Profile 校验应完全通过');
  });

  await t.test('严密证据锚点：evidence 包含段落引用与推导逻辑，杜绝空壳', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT, { title: '测试证据' });
    const dialogueEv = profile.dialogue.evidence;
    assert.ok(dialogueEv.length > 0, '对白字段必须包含证据');
    assert.ok(dialogueEv[0].unitId, '证据必须包含 unitId');
    assert.ok(dialogueEv[0].locationSnippet, '证据必须包含上下文片段');
    assert.ok(dialogueEv[0].rationale, '证据必须包含推导逻辑');
  });
});

test('开篇质量与章节节奏：多时间窗与张力起伏', async t => {
  await t.test('开篇多时间窗 (1, 3 章) 切片与驱动力指标', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT);
    const windows = profile.opening.value.windows;
    assert.ok(windows.first_1_chapters, '应包含第 1 章窗口');
    assert.ok(windows.first_3_chapters, '应包含第 3 章窗口');
    assert.ok(windows.first_1_chapters.readingDriveScore > 60, '开篇驱动力分值应合理');
    assert.equal(windows.first_1_chapters.protagonistEstablished, true, '首章应建立主角');
  });

  await t.test('章节节奏与场景切换统计', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT);
    const pacing = profile.pacing.value;
    assert.equal(pacing.avgScenesPerChapter >= 1, true, '平均场景数应 >= 1');
    assert.ok(pacing.conflictFrequencyRate > 0, '冲突频率应 > 0');
    assert.equal(pacing.maxConsecutiveFlatChapters <= 2, true, '不应存在过多连续平淡章节');
  });
});

test('人味质感与因果逻辑：小动作、潜台词与缺陷审计', async t => {
  await t.test('精准识别生活化小动作、犹豫迟疑与凡俗人味', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT);
    const human = profile.human_texture.value;
    assert.ok(human.organicScore >= 70, `人味有机质感评分应达标 (实际: ${human.organicScore})`);
    assert.ok(human.markers.livingDetails >= 1, '应识别出生活化细节（如铜钱、羊皮袄）');
    assert.ok(human.markers.hesitation >= 1, '应识别出人物犹豫迟疑（犹豫了一下、停顿了两息）');
  });

  await t.test('因果链与逻辑审计：合规样本无空降金手指与降智', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT);
    const causal = profile.causality.value;
    assert.equal(causal.detectedFlawsCount, 0, '合规样本应 0 缺陷');
    assert.ok(causal.causalHealthScore >= 90, '因果健康度应 >= 90');
  });

  await t.test('异常样本注入测试：成功捕获【空降神功】与【逻辑降智】', () => {
    const flawedText = `
第一章 绝世奇遇
    少年被仇家追杀，走投无路。
    脑海中突然浮现出一门九品神功，毫无征兆地突破到大乘期！
    更奇怪的是，原本精明狠毒的仇家竟然当众把所有计划大声说出，并且鬼使神差地交出了藏宝图！
    `;
    const profile = extractNovelQualityProfile(flawedText, { title: '缺陷样本' });
    const causal = profile.causality.value;
    assert.ok(causal.detectedFlawsCount >= 2, '应至少检出 2 处重大因果缺陷');
    assert.ok(causal.causalHealthScore < 85, '因果健康度应受挫扣分');
  });
});

test('Benchmark 机器比对引擎与区间分布校验', async t => {
  await t.test('成功加载 quality-profiles-distribution.json 并提取母类基准', () => {
    const dist = benchmarkDatabase.getQualityProfileDistribution();
    assert.ok(dist, '应成功加载基准区间分布');
    assert.ok(dist.families['玄幻修真'], '必须包含玄幻修真母类');
    assert.ok(dist.abnormalBounds.aiFlavorScore, '必须包含 AI味异常门限');

    const baseline = benchmarkDatabase.getQualityProfileBaseline('玄幻修真');
    assert.ok(baseline.normalBounds.avgChapterLength, '必须包含单章字数正常区间');
    assert.ok(baseline.normalBounds.dialogueRatio, '必须包含对白占比正常区间');
  });

  await t.test('compareQualityProfiles 对比报告输出正常区间与差异解释', () => {
    const profile = extractNovelQualityProfile(SAMPLE_NOVEL_TEXT, { genre: '玄幻修真' });
    const dist = benchmarkDatabase.getQualityProfileDistribution();
    const comparison = compareQualityProfiles(profile, dist);

    assert.ok(comparison.overallQualityIndex >= 80, '合规样本健康指数应高');
    assert.ok(comparison.evidenceComparison.length >= 2, '必须输出证据对比明细');
    assert.ok(comparison.evidenceComparison[0].deltaExplanation, '对比明细必须包含差异机理阐述');
  });
});
