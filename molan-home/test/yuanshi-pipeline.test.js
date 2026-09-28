'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const { scanUniversalCorrectionRisks } = require('../correction-policy.js');
const { computeAiFlavorScore } = require('../lib/ai-flavor-detector.js');

const PIPELINE_FILE = path.join(__dirname, '..', 'data', 'pipelines', 'yuanshi-law-pipeline.json');

function runTest() {
  console.log('=== [1/4] 测试管线资产解析与完整性校验 ===');
  assert.ok(fs.existsSync(PIPELINE_FILE), '管线数据文件必须存在');
  const pipeline = JSON.parse(fs.readFileSync(PIPELINE_FILE, 'utf8'));

  assert.equal(pipeline.pipelineId, 'pipeline-yuanshi-law-v1');
  assert.ok(pipeline.meta && pipeline.meta.sourceNovel.title === '元始法则');
  assert.equal(pipeline.macroRhythm.openingPacingModel.goldFiveChaptersBlueprint.length, 5, '必须具备黄金前五章节律蓝图');
  assert.ok(pipeline.narrativeSlots.protagonistSlot, '必须具备主角槽位');
  assert.ok(pipeline.narrativeSlots.mentorAnchorSlot, '必须具备引路人槽位');
  assert.ok(pipeline.narrativeSlots.rationalIntellectSlot, '必须具备高冷学者槽位');
  assert.equal(pipeline.writingSkillSpec.fewShotExemplars.length, 4, '必须具备 4 个高光微对位切片');
  console.log('✔ 管线核心结构校验通过');

  console.log('\n=== [2/4] 测试新书槽位绑定与章节合同生成 ===');
  const testNewBookContext = {
    title: '裂隙渊号：深潜法则',
    worldview: '万米马里亚纳海沟深潜科考，遭遇上古神话异兽与海底禁忌遗迹复苏',
    slotsMapping: {
      protagonist: { name: '陆迟', weapon: '青铜分水刺', relic: '阐门九章残片' },
      mentor: { name: '严烈', role: '深潜母船大副' },
      rationalIntellect: { name: '叶白薇', role: '高冷海洋化学生物学博士' },
      factionFriction: { name: '魏乘风', role: '安保组二把手' }
    }
  };

  function generateChapterContract(blueprintCh, bookCtx, pipe) {
    const activeRules = [];
    if (blueprintCh.emotionIntensity >= 7) {
      activeRules.push(...(pipe.correctionPolicyOverlay.genreSpecificShield.sceneTypeRuleFocus.crisis_combat || []));
    } else {
      activeRules.push(...(pipe.correctionPolicyOverlay.genreSpecificShield.sceneTypeRuleFocus.tense_dialogue || []));
    }
    return {
      chapterIndex: blueprintCh.chapterIndex,
      targetWords: pipe.macroRhythm.openingPacingModel.targetChapterWordCount,
      emotionIntensity: blueprintCh.emotionIntensity,
      mission: blueprintCh.narrativeMission,
      hookType: blueprintCh.hookType,
      characters: [
        { name: bookCtx.slotsMapping.protagonist.name, voice: pipe.narrativeSlots.protagonistSlot.voiceSpec },
        { name: bookCtx.slotsMapping.mentor.name, voice: pipe.narrativeSlots.mentorAnchorSlot.voiceSpec },
        { name: bookCtx.slotsMapping.rationalIntellect.name, voice: pipe.narrativeSlots.rationalIntellectSlot.voiceSpec }
      ],
      exemplar: pipe.writingSkillSpec.fewShotExemplars[0].text,
      activeCorrectionRules: activeRules
    };
  }

  const ch1Contract = generateChapterContract(pipeline.macroRhythm.openingPacingModel.goldFiveChaptersBlueprint[0], testNewBookContext, pipeline);
  assert.equal(ch1Contract.chapterIndex, 1);
  assert.equal(ch1Contract.characters.length, 3);
  assert.ok(ch1Contract.activeCorrectionRules.length > 0);
  console.log('✔ 章节合同动态生成逻辑验证通过');

  console.log('\n=== [3/4] 测试反向纠错门禁：拦截典型 AI 味文本 ===');
  const badAiText = `
陆迟站在甲板上，嘴角勾起一抹意味难明的笑意。
空气中弥漫着冷冽的气息，仿佛在诉说着什么。
突然，巨大的阴影破开冰面，全场死寂，众人倒吸一口凉气！
普通人根本无法看清那怪物的轨迹，陆迟却一眼看穿。
最前一人横刀砍向左肋，第二名随后拔刀逼近，第三名趁隙抢攻。
陆迟第十息，才猛然挥出短刺，如鬼魅般一闪而过。
事实证明，这就是唯一真相。
`;

  const auditBad = scanUniversalCorrectionRisks(badAiText);
  console.log(`- 恶意样本命中风险数: ${auditBad.findingCount} 处`);
  console.log(`- 命中规则列表: ${auditBad.matchedRuleIds.join(', ')}`);

  assert.ok(auditBad.matchedRuleIds.includes('R-14-template-smile'), '必须拦截 R-14 (嘴角笑)');
  assert.ok(auditBad.matchedRuleIds.includes('R-07-formulaic-crowd'), '必须拦截 R-07 (全场倒吸凉气)');
  assert.ok(auditBad.matchedRuleIds.includes('R-20-contrast-cliche'), '必须拦截 R-20 (普通人看穿对比句)');
  assert.ok(auditBad.matchedRuleIds.includes('R-27-turn-taking-brawl'), '必须拦截 R-27 (回合制排队打斗)');
  assert.ok(auditBad.matchedRuleIds.includes('R-35-breath-countdown'), '必须拦截 R-35 (第十息倒数)');
  assert.ok(auditBad.matchedRuleIds.includes('R-11-evidence-overclaim'), '必须拦截 R-11 (唯一真相)');
  console.log('✔ 纠错门禁严密性校验通过：100% 精确拦截 6 类重大 AI 恶习');

  console.log('\n=== [4/4] 测试管线合规正文：零违规并通过质检 ===');
  const compliantText = `
零下二十度的极寒中，陆迟双手紧扣在冰冷的船舷铁栏上，寒意直透手套。
呼啸的北风夹着冰碴子，狠狠抽打在橘黄色的防寒服上，发出密集的噼啪碎响。
三公里外的深黑雪脊上，那道高出普通雪熊数倍的庞大阴影正在下伏、蓄力。
掌爪轰然砸落冰原，震起漫天雪雾，每一次落地都带起闷雷般的沉响。
陆迟没有后退，视线死死锁住那头疾驰而来的异兽，重心下沉压入后足，右手缓缓探入怀中，按住了那枚历经千年的青铜残片。
金属的冰冷透过薄薄的手套渗进掌心，上面残缺的断痕在指腹下泛起微弱的涩感。
赵勐大步抢出舱门，一把扯下步枪保险栓，将枪托死死顶住右肩：“退回二道防线，快！”
刺耳的警报声撕裂了风雪，回荡在整条科考船上。
`;

  const auditClean = scanUniversalCorrectionRisks(compliantText);
  const flavorClean = computeAiFlavorScore(compliantText);

  console.log(`- 合规文本纠错命中数: ${auditClean.findingCount} 处 (期望 0)`);
  console.log(`- 合规文本 AI 味评分: ${flavorClean.score} 分 (门限 < 40)`);

  assert.equal(auditClean.findingCount, 0, '合规文本不能触发任何纠错拦截');
  assert.ok(flavorClean.passed, '合规文本必须通过 AI 味评分门禁');
  console.log('✔ 管线合规生成检验通过：语言质感自然，物理感强，零 AI 痕迹');

  console.log('\n=============================================');
  console.log('🎉 《元始法则》试点管线全部端到端自动化测试顺利通过！');
  console.log('=============================================');
}

runTest();
