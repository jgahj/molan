'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const material = require('../lib/character-material');

test('normalizeCharacterVoiceContract 规范化角色台词契约字段', () => {
  // 1. 空输入返回 null
  assert.equal(material.normalizeCharacterVoiceContract(null), null);
  assert.equal(material.normalizeCharacterVoiceContract(''), null);
  assert.equal(material.normalizeCharacterVoiceContract({}), null);

  // 2. 字符串输入解析为 habit
  const fromStr = material.normalizeCharacterVoiceContract('说话总是慢半拍，带有浓重方言腔');
  assert.ok(fromStr);
  assert.equal(fromStr.sentenceLengthPreference, 'medium');
  assert.deepEqual(fromStr.verbalHabits, ['说话总是慢半拍，带有浓重方言腔']);

  // 3. 完整对象解析
  const full = material.normalizeCharacterVoiceContract({
    sentenceLengthPreference: 'short',
    responsePattern: '反问压制',
    verbalHabits: ['呵', '有何指教'],
    tabooPhrases: ['臣服', '求饶'],
    samples: ['刀在手，谁敢动？', '废话少说。']
  });
  assert.ok(full);
  assert.equal(full.sentenceLengthPreference, 'short');
  assert.equal(full.responsePattern, '反问压制');
  assert.deepEqual(full.verbalHabits, ['呵', '有何指教']);
  assert.deepEqual(full.tabooPhrases, ['臣服', '求饶']);
  assert.deepEqual(full.samples, ['刀在手，谁敢动？', '废话少说。']);

  // 4. 别名兼容：sentence_length_preference, habit, taboo, voiceSamples
  const alias = material.normalizeCharacterVoiceContract({
    sentence_length_preference: '长句',
    habit: '习惯以类比举例说明',
    taboo: '你算什么东西',
    samples: ['世间事往往如此。']
  });
  assert.ok(alias);
  assert.equal(alias.sentenceLengthPreference, 'long');
  assert.deepEqual(alias.verbalHabits, ['习惯以类比举例说明']);
  assert.deepEqual(alias.tabooPhrases, ['你算什么东西']);
  assert.deepEqual(alias.samples, ['世间事往往如此。']);
});

test('buildCharacterVoiceDirectiveBlock 正确渲染台词契约块', () => {
  // 1. 空角色列表返回空字符串
  assert.equal(material.buildCharacterVoiceDirectiveBlock([]), '');
  assert.equal(material.buildCharacterVoiceDirectiveBlock(null), '');

  // 2. 携带台词契约的角色渲染
  const directive = material.buildCharacterVoiceDirectiveBlock([
    {
      name: '陈西风',
      archetype: '冷静理智型',
      voice: {
        sentenceLengthPreference: 'short',
        responsePattern: '军令决断',
        verbalHabits: ['照办', '勿问'],
        tabooPhrases: ['我不知道'],
        samples: ['将尸体带走，船开走。']
      }
    },
    {
      name: '张拂潇',
      archetype: '活泼开朗型',
      voice: {
        sentenceLengthPreference: 'medium',
        verbalHabits: ['老娘', '真爽啊']
      }
    }
  ]);

  assert.ok(directive.includes('molan-character-voice-contract-v1'));
  assert.ok(directive.includes('【陈西风】'));
  assert.ok(directive.includes('单轮台词偏向精炼短句'));
  assert.ok(directive.includes('军令决断'));
  assert.ok(directive.includes('言语禁忌（严禁出现）：我不知道'));
  assert.ok(directive.includes('【张拂潇】'));
  assert.ok(directive.includes('口吻习惯：老娘、真爽啊'));
  assert.ok(directive.includes('15~30 字'));
});

test('buildCharacterMaterialBlock 自动注入角色台词契约指令', () => {
  const request = {
    mode: 'auto',
    primaryArchetype: '冷静理智型',
    dimensions: ['dialogue'],
    query: '试探对手',
    proseTask: true,
    characters: [
      {
        name: '叶宁',
        archetype: '冷静理智型',
        voice: {
          sentenceLengthPreference: 'medium',
          verbalHabits: ['依据何在']
        }
      }
    ]
  };

  const block = material.buildCharacterMaterialBlock({}, request);
  assert.ok(block.messages.length >= 1);
  const content = block.messages[0].content;
  assert.ok(content.includes('【角色台词与言语交互契约'));
  assert.ok(content.includes('【叶宁】'));
  assert.ok(content.includes('依据何在'));
});

test('buildCharacterMaterialBlock 在 raw 模式且无样本时仍然注入角色台词契约指令', () => {
  const request = {
    mode: 'raw',
    proseTask: true,
    characters: [
      {
        name: '陆沉',
        voice: {
          sentenceLengthPreference: 'long',
          verbalHabits: ['此话怎讲']
        }
      }
    ]
  };

  const block = material.buildCharacterMaterialBlock({}, request);
  assert.ok(block.messages.length >= 1);
  const content = block.messages[0].content;
  assert.ok(content.includes('【角色台词与言语交互契约'));
  assert.ok(content.includes('【陆沉】'));
  assert.ok(content.includes('此话怎讲'));
});

