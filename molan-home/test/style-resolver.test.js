'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { resolveStyle, formatStyleDirectives, computeDeterministicHash } = require('../lib/style/style-resolver');

test('style-resolver: scene 显式指定风格优先于请求与权威作品设定，配置来源置信度为 null 标明策略属性', async () => {
  const result = await resolveStyle({
    scene: { style: '紧张逼仄的近身搏击风' },
    request: { style: '全局史诗宏大叙事风' },
    authoritativeContext: { narrativeStyle: '温和平实日常风' }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.source, 'scene_explicit');
  assert.equal(result.confidence, null);
  assert.equal(result.confidenceType, 'configured_policy');
  assert.equal(result.bundle.schemaVersion, 'style-bundle-v2');
  assert.match(result.style, /紧张逼仄的近身搏击风/);
  assert.doesNotMatch(result.style, /\[object Object\]/);
});

test('style-resolver: chapterContract 显式风格优先于作品权威设定与 author 偏好', async () => {
  const result = await resolveStyle({
    chapterContract: { style: '硬核推理冷峻风' },
    request: {},
    authoritativeContext: {
      narrativeStyle: '古典华丽辞藻风',
      authorDna: '抒情散文风'
    }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.source, 'request_explicit');
  assert.equal(result.confidence, null);
  assert.equal(result.confidenceType, 'configured_policy');
  assert.match(result.style, /硬核推理冷峻风/);
});

test('style-resolver: 标准 tone 对象与对象形态 rules / samples 展开保留语义与字段，绝不出现 [object Object]', async () => {
  const complexProfile = {
    styleId: 'noir_cyberpunk',
    tone: { overall: '阴冷潮湿', lighting: '霓虹反光', atmosphere: '压抑冷峻' },
    voice: '第一人称冷眼旁观，多用断句',
    language: { sentence: 'short_staccato', pacing: 'fast' },
    dialogue: { style: 'cynical', subtext: '利益试探' },
    emotion: '麻木而克制',
    hardRules: [
      { id: 'rule-1', rule: '禁止使用感叹号', penalty: '重写' },
      { id: 'rule-2', rule: '禁止出现阳光明媚的正面环境描写', penalty: '重写' }
    ],
    softPreferences: [
      { id: 'pref-1', rule: '多借机械义肢与烟雨细节折射心境', priority: 'high' }
    ],
    positiveSamples: [
      { id: 'sample-1', sample: '雨水顺着合成皮革领口淌进锁骨，冷得像义体排异反应。', mood: '寒冷' }
    ]
  };

  const result = await resolveStyle({
    request: { styleProfile: complexProfile }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.source, 'request_explicit');
  assert.equal(result.bundle.styleId, 'noir_cyberpunk');
  assert.equal(result.bundle.rules.hardRules.length, 2);
  assert.equal(result.bundle.rules.softPreferences.length, 1);
  assert.equal(result.bundle.samples.length, 1);

  assert.match(result.style, /【基调风格】：overall: 阴冷潮湿；lighting: 霓虹反光；atmosphere: 压抑冷峻/);
  assert.match(result.style, /【硬性规约】：\n- 禁止使用感叹号\n- 禁止出现阳光明媚的正面环境描写/);
  assert.match(result.style, /【风格偏好】：\n- 多借机械义肢与烟雨细节折射心境/);
  assert.match(result.style, /【正向质感范例】：\n「雨水顺着合成皮革领口淌进锁骨，冷得像义体排异反应。」/);
  assert.doesNotMatch(result.style, /\[object Object\]/);
});

test('style-resolver: 在未显式提供文风时继承服务端权威作品设定，置信度为 null 标明配置性质', async () => {
  const result = await resolveStyle({
    authoritativeContext: {
      narrativeStyle: '清冷留白、古典肃穆'
    }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.source, 'narrative_authoritative');
  assert.equal(result.confidence, null);
  assert.equal(result.confidenceType, 'configured_policy');
  assert.match(result.style, /清冷留白、古典肃穆/);
});

test('style-resolver: 真实 detector 命中 hardcore_progression、creepy_folklore、dark_calculating、humorous_sand_sculpture，断言全部输出无原型剧情事实模板并传入纯语言机制', async () => {
  const detectorCases = [
    {
      expectedStyleId: 'hardcore_progression',
      prose: '韩立捡到了神秘小绿瓶，黄枫谷七玄门墨大夫，小心翼翼隐忍算计，散修灵根灵石紧缺，如履薄冰。',
      expectedMechanisms: [/sentence:\s*short-medium/, /pacing:\s*measured/, /metaphorDensity:\s*0\.18/, /dialogue:\s*subtextual/],
      forbiddenFactPatterns: [/雷霆万钧/, /清扫战场毁灭痕迹/, /资源消耗与丹药法器折损必须有具体数字/, /众生相自私趋利/, /严禁降智同门/]
    },
    {
      expectedStyleId: 'creepy_folklore',
      prose: '深夜荒凉的凶宅里摆放着红衣女与纸人，诡异的绣花鞋靠在棺材旁，阴兵冥婚忌讳不可名状。',
      expectedMechanisms: [/sentence:\s*medium/, /pacing:\s*quiet-tension/, /metaphorDensity:\s*0\.2/, /dialogue:\s*subtextual/],
      forbiddenFactPatterns: [/破局必须依靠对既有规则漏洞/, /道具的极限运用/, /章末留足不可逆的悬念/]
    },
    {
      expectedStyleId: 'dark_calculating',
      prose: '方源握紧春秋蝉站在青茅山古月山寨，为了利益至上万物皆为棋子绝无圣母，冷血枭雄不择手段灭门炼化。',
      expectedMechanisms: [/sentence:\s*short-medium/, /pacing:\s*measured/, /metaphorDensity:\s*0\.18/, /dialogue:\s*subtextual/],
      forbiddenFactPatterns: [/主角目标唯有长生或超凡巅峰/, /世间万物皆为可消耗资源/, /反派与正道皆非蠢货/]
    },
    {
      expectedStyleId: 'humorous_sand_sculpture',
      prose: '张拂潇和张海琪在盘花海礁水鬼望乡，吐槽发疯沙雕逗比，老娘终于送走瘟神！',
      expectedMechanisms: [/sentence:\s*varied/, /pacing:\s*quick-release/, /metaphorDensity:\s*0\.28/, /dialogue:\s*playful/],
      forbiddenFactPatterns: [/主角必须保持/, /绝对掌控力/, /狂躁放狠话/, /战力超群/, /抢劫抢到老娘头上来了/]
    }
  ];

  for (const testCase of detectorCases) {
    const result = await resolveStyle({
      authoritativeContext: {
        proseSamples: [testCase.prose]
      }
    });

    assert.equal(result.status, 'resolved');
    assert.equal(result.source, 'inferred_sample');
    assert.equal(result.bundle.styleId, testCase.expectedStyleId);
    assert.equal(result.confidenceType, 'measured');
    assert.ok(typeof result.confidence === 'number' && result.confidence > 0.6);

    for (const mechanismPattern of testCase.expectedMechanisms) {
      assert.match(result.style, mechanismPattern);
    }

    const fullSerialized = JSON.stringify(result.bundle) + '\n' + result.style;
    for (const forbiddenPattern of testCase.forbiddenFactPatterns) {
      assert.doesNotMatch(fullSerialized, forbiddenPattern);
    }
    assert.doesNotMatch(result.style, /\[object Object\]/);
  }
});

test('style-resolver: detector 未提供置信度时置信度标为 null 且 confidenceType 为 unknown，不捏造 0.8', async () => {
  const originalDetector = require('../lib/style-detector');
  const originalDetectNovelStyle = originalDetector.detectNovelStyle;
  originalDetector.detectNovelStyle = () => ({
    matchedBy: 'tone_analysis',
    styleArchetype: 'hardcore_progression',
    confidence: undefined
  });

  try {
    const result = await resolveStyle({
      authoritativeContext: {
        proseSamples: ['这是一段具备修仙推断特征的正文内容，用于测试缺失置信度。']
      }
    });

    assert.equal(result.status, 'resolved');
    assert.equal(result.source, 'inferred_sample');
    assert.equal(result.bundle.styleId, 'hardcore_progression');
    assert.equal(result.confidence, null);
    assert.equal(result.confidenceType, 'unknown');
    assert.notEqual(result.confidence, 0.8);
  } finally {
    originalDetector.detectNovelStyle = originalDetectNovelStyle;
  }
});

test('style-resolver: matchedBy === genre_default 拦截退回中性默认且不冒充实际推断', async () => {
  const fallbackResult = await resolveStyle({
    authoritativeContext: {
      proseSamples: ['这是一段极其普通的日常白话记录，没有任何修真或特殊文风特征。张三看了一眼李四说知道了。']
    },
    genre: { key: '都市', family: 'urban' }
  });

  assert.notEqual(fallbackResult.source, 'sample_genre_default');
  assert.equal(fallbackResult.source, 'neutral_default');
  assert.equal(fallbackResult.confidence, null);
  assert.equal(fallbackResult.confidenceType, 'configured_policy');
});

test('style-resolver: 无任何指定风格与推断时退回中性默认，置信度为 null 标明为配置默认而非测量', async () => {
  const result = await resolveStyle({});

  assert.equal(result.status, 'resolved');
  assert.equal(result.source, 'neutral_default');
  assert.equal(result.confidence, null);
  assert.equal(result.confidenceType, 'configured_policy');
  assert.equal(result.bundle.schemaVersion, 'style-bundle-v2');
  assert.match(result.style, /自然叙述|中性/);
  assert.doesNotMatch(result.style, /\[object Object\]/);
});

test('style-resolver: 换 genre 不强制换 style，用户明确文风优先', async () => {
  const explicitStyle = '极简冷硬派';

  const urbanResult = await resolveStyle({
    genre: '都市',
    request: { style: explicitStyle }
  });

  const fantasyResult = await resolveStyle({
    genre: '玄幻',
    request: { style: explicitStyle }
  });

  assert.equal(urbanResult.style, fantasyResult.style);
  assert.equal(urbanResult.source, 'request_explicit');
  assert.equal(fantasyResult.source, 'request_explicit');
  assert.equal(urbanResult.bundle.sourceHash, fantasyResult.bundle.sourceHash);
});

test('style-resolver: hash 稳定与对保留字段变化失效校验', async () => {
  const inputAlpha = {
    request: {
      styleProfile: {
        styleId: 'test_hash_style',
        tone: { overall: '肃穆庄严' },
        hardRules: ['规则一', '规则二']
      }
    }
  };

  const inputBeta = {
    request: {
      styleProfile: {
        styleId: 'test_hash_style',
        tone: { overall: '肃穆庄严' },
        hardRules: ['规则一', '规则二']
      }
    }
  };

  const inputGamma = {
    request: {
      styleProfile: {
        styleId: 'test_hash_style',
        tone: { overall: '肃穆庄严' },
        hardRules: ['规则一', '规则三修改']
      }
    }
  };

  const responseAlpha = await resolveStyle(inputAlpha);
  const responseBeta = await resolveStyle(inputBeta);
  const responseGamma = await resolveStyle(inputGamma);

  assert.ok(responseAlpha.bundle.sourceHash);
  assert.equal(responseAlpha.bundle.sourceHash, responseBeta.bundle.sourceHash);
  assert.notEqual(responseAlpha.bundle.sourceHash, responseGamma.bundle.sourceHash);
});

test('style-resolver: 未给出 profileId 持久化加载语义时安全退回且不抛出未捕获异常', async () => {
  const result = await resolveStyle({
    request: { styleProfileId: 'non_existent_profile_99999' }
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.source, 'neutral_default');
  assert.equal(result.bundle.schemaVersion, 'style-bundle-v2');
});
