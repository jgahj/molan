'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isBarebonesPrompt,
  enrichPromptWithGemini,
  UNIVERSAL_PROMPT_SCHEMA_SPEC
} = require('../lib/generation/prompt-enricher');

test('isBarebonesPrompt detects simple and uninspired prompts', () => {
  assert.equal(isBarebonesPrompt(''), true);
  assert.equal(isBarebonesPrompt('写第15章，两人拉扯'), true);
  assert.equal(isBarebonesPrompt('师尊给徒弟疗伤，徒弟吐槽'), true);

  const completePrompt = `
【题材与基调】
仙侠恋爱轻喜剧 / 师徒反差拉扯。
【核心人物】
1. 佳云泽：表面求生装怂，内心疯狂吐槽。
2. 顾凝欣：千年冰山无情道剑仙，初涉情关笨拙傲娇。
【三幕分镜节拍】
第一幕：榻前拉扯。
第二幕：恼羞拆穿。
第三幕：焦糊甜粥索赔。
【语言与文风硬约束】
严禁老套AI套话，禁止嘴角勾起、瞳孔骤缩。
  `;
  assert.equal(isBarebonesPrompt(completePrompt), false);
});

test('enrichPromptWithGemini enriches barebones prompts with full structure using model or fallback', async () => {
  // 测试模拟 Gemini 3.8 调用
  let modelCalled = false;
  const mockCallModel = async (options) => {
    modelCalled = true;
    assert.equal(options.stage, 'prompt_enrichment');
    assert.ok(options.system.includes('网文总编剧'));
    assert.ok(options.userPrompt.includes('顾凝欣'));
    return {
      text: `
【题材与基调】
仙侠修真恋爱轻喜剧 / 师徒反差拉扯 / 破第四面墙吐槽流。
表面仙风道骨、内里嘴贫求生。

【核心人物张力矩阵】
1. 佳云泽（男主）：表面恭顺装怂，内心疯狂吐槽。
2. 顾凝欣（女主）：名震九州的桃花剑仙，初涉情关笨拙失态。
3. 云光仙子：随身老祖，日常吃瓜看戏。

【三幕分镜微节拍】
第一幕【榻前拉扯·破壁求生】：静室空间中师尊借检查道体半压在床榻，男主双手护胸用司命神尊正经胡扯。
第二幕【交错对峙·外壳破防】：三段式指出解腰带、按丹田出格举动，师尊耳红破防，男主以白玉瓜圆场。
第三幕【记忆触媒·霸道索赔】：后厨热焦糊甜粥触景生情回忆旧事，师尊宣布每月检查一次道体霸道索赔。

【语言与文风硬约束】
1. 严禁嘴角勾起、骨节泛白等AI套话。
2. 严格执行动作-对白交错律。
      `
    };
  };

  const result = await enrichPromptWithGemini({
    rawPrompt: '写师尊在床榻前逼迫徒弟，徒弟吐槽，然后喝甜粥',
    outline: '本章是感情升温拉扯章节',
    characters: [
      { name: '佳云泽', role: '徒弟', personality: '嘴贫求生', contrast: '深知审核法则' },
      { name: '顾凝欣', role: '师尊', personality: '清冷剑仙', contrast: '情窦初开笨拙傲娇' }
    ],
    novelProfile: { title: '逆徒休走', primaryGenre: '仙侠' },
    callModel: mockCallModel
  });

  assert.equal(modelCalled, true);
  assert.equal(result.wasEnriched, true);
  assert.ok(result.enrichedPrompt.includes('【题材与基调】'));
  assert.ok(result.enrichedPrompt.includes('【核心人物张力矩阵】'));
  assert.ok(result.enrichedPrompt.includes('【三幕分镜微节拍】'));
  assert.ok(result.enrichedPrompt.includes('【语言与文风硬约束】'));
});

test('enrichPromptWithGemini uses fallback when callModel is not provided', async () => {
  const result = await enrichPromptWithGemini({
    rawPrompt: '简单的打斗场面',
    genre: '玄幻修真',
    novelProfile: { title: '万古天帝' }
  });

  assert.equal(result.wasEnriched, true);
  assert.equal(result.modelUsed, 'rule_fallback');
  assert.ok(result.enrichedPrompt.includes('【题材与基调】'));
  assert.ok(result.enrichedPrompt.includes('【三幕分镜微节拍】'));
});
