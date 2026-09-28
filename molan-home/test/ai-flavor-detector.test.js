'use strict';

// AI 味检测器单元测试：词表加载与缓存、均匀短句+套话密集文本打高分不通过、
// 指纹基线附近的人类风格文本打低分通过、profile 为 null 的降级，以及词表指令块生成。

const assert = require('node:assert/strict');
const test = require('node:test');

const detector = require('../lib/ai-flavor-detector.js');
const fingerprints = require('../lib/style-fingerprint.js');

// 词表加载：schema 与条目数正确，且二次调用命中缓存（同一引用）。
test('loadAiFlavorLexicon loads and caches the 258-entry lexicon', () => {
  const lexicon = detector.loadAiFlavorLexicon();
  assert.ok(lexicon, '词表应加载成功');
  assert.equal(lexicon.schemaVersion, 'ai-flavor-lexicon-1');
  assert.ok(lexicon.entries.length >= 258, '词表条目应不少于258');
  assert.equal(detector.loadAiFlavorLexicon(), lexicon, '二次调用应命中缓存（同一引用）');
});

// AI 味浓文本：均匀短句 + 段落等长 + block 套话密集 → 高分不通过。
test('computeAiFlavorScore flags uniform cliche-dense text as AI-flavored', () => {
  const profile = fingerprints.resolveFingerprintProfile('都市').profile;
  assert.ok(profile, '都市画像应可用');
  const paragraph = '空气仿佛凝固。世界仿佛安静了下来。令人叹为观止。心脏猛地一缩。指节泛白。瞳孔猛地一缩。';
  const text = Array.from({ length: 4 }, () => paragraph).join('\n\n');
  const result = detector.computeAiFlavorScore(text, profile);
  assert.ok(result.score >= 60, `均匀套话文本应得高分，实际 ${result.score}`);
  assert.equal(result.passed, false);
  assert.ok(result.metrics.lexiconBlockPerKilo > 3, 'block 套话每千字次数应大于 3');
  assert.ok(result.metrics.paragraphUniformity < 0.45, '等长段落应判定为过度均匀');
  assert.ok(result.metrics.sentenceStdRatio < 0.6, '均匀短句的句长离散度应显著低于基线');
  assert.ok(result.details.blockHits.length >= 4, '应记录多个命中词');
  const hit = result.details.blockHits.find(item => item.term === '空气仿佛凝固');
  assert.ok(hit, '应命中“空气仿佛凝固”');
  assert.equal(hit.count, 4);
});

// 人类风格文本：长短句交错、长短段错落、无词表命中 → 低分通过。
test('computeAiFlavorScore passes human-styled text near the fingerprint baseline', () => {
  const profile = fingerprints.resolveFingerprintProfile('都市').profile;
  const text = `雨停了。

陈桂芳把最后一张折叠桌搬进店里，桌腿在青石板上磕出两声闷响。她直起腰，捶了捶后背，朝巷口望了一眼——卖姜的老周还没收摊，塑料布上的水珠顺着褶皱往下淌，滴进砖缝里不见了。

夜市散得早。

十一点刚过，摊主们推着三轮车往巷子深处走，车轮碾过积水，哗啦哗啦响成一片。有人喊老周回家喝酒，老周摆手，说姜没卖完，明天进新货要亏本。这话他上礼拜也说过，上上礼拜也是。

她关了灯。

卷帘门落地那一刻，巷子里只剩两家还亮着：一家是二十四小时便利店，玻璃门上贴着褪色的福字；另一家是巷尾的修表铺，老头趴在工作台前，镊子夹着一枚比米粒还小的齿轮，试了三次没夹稳，齿轮滚进台面的木缝里。他骂了一句方言，把台灯拧亮些，接着找。`;
  const result = detector.computeAiFlavorScore(text, profile);
  assert.equal(result.metrics.lexiconBlockPerKilo, 0, `人类风格文本不应命中 block 词表，命中：${JSON.stringify(result.details.blockHits)}`);
  assert.equal(result.details.blockHits.length, 0);
  assert.ok(result.metrics.sentenceStdRatio >= 0.9, `长短交错的句长离散度应不低于基线，实际 ${result.metrics.sentenceStdRatio}`);
  assert.ok(result.metrics.paragraphUniformity >= 0.45, `长短段错落不应判定为过度均匀，实际 ${result.metrics.paragraphUniformity}`);
  assert.ok(result.score < 40, `人类风格文本应得低分，实际 ${result.score}`);
  assert.equal(result.passed, true);
});

// 基线缺失降级：profile 为 null 时比率指标记 null 且不计分，其余照算；空文本直接零分通过。
test('computeAiFlavorScore tolerates a null profile and empty text', () => {
  const dense = '空气仿佛凝固。令人叹为观止。心脏猛地一缩。指节泛白。';
  const withoutProfile = detector.computeAiFlavorScore(dense, null);
  assert.equal(withoutProfile.metrics.sentenceStdRatio, null, '基线缺失时句长比率应记 null');
  assert.equal(withoutProfile.metrics.ttrRatio, null, '基线缺失时 TTR 比率应记 null');
  assert.ok(withoutProfile.metrics.lexiconBlockPerKilo > 3, '词表命中密度仍应照算');
  assert.ok(withoutProfile.score >= 40, '套话密集文本即使无基线也不应通过');
  assert.equal(withoutProfile.passed, false);

  const empty = detector.computeAiFlavorScore('', null);
  assert.equal(empty.score, 0);
  assert.equal(empty.passed, true);
  assert.deepEqual(empty.details, { blockHits: [], watchHits: [] });
});

// 词表指令块：标题与说明齐全，block 词不超过 60 个、watch 词不超过 20 个，均按语料 PMF 升序选取。
test('buildHumanizeLexiconBlock lists at most 60 block terms and 20 watch terms', () => {
  const block = detector.buildHumanizeLexiconBlock();
  assert.ok(block.length > 0, '词表可用时指令块非空');
  assert.match(block, /【AI 高频套话清单】/);
  assert.match(block, /以下表达在网文语料中极少出现而 AI 生成高频，改写时全部替换或删除：/);
  assert.match(block, /以下为观察级/);

  const blockSection = block.match(/全部替换或删除：([^；]+)；/);
  assert.ok(blockSection, '应能提取 block 词区段');
  const blockTerms = blockSection[1].split('、');
  assert.ok(blockTerms.length > 0 && blockTerms.length <= 60, `block 词应不超过 60 个，实际 ${blockTerms.length}`);
  assert.ok(blockTerms.includes('一柄出鞘的刀'), '语料 PMF 最低的词应入选');

  const watchSection = block.match(/以下为观察级[^：]*：([^。]+)。/);
  assert.ok(watchSection, '应能提取 watch 词区段');
  const watchTerms = watchSection[1].split('、');
  assert.ok(watchTerms.length > 0 && watchTerms.length <= 20, `watch 词应不超过 20 个，实际 ${watchTerms.length}`);
  assert.ok(watchTerms.includes('深深地'), 'watch 词应包含“深深地”');
});

test('computeAiFlavorScore properly unpacks baseline object with mean/stdDev', () => {
  const sample = '张拂潇站在水埠边，看着远处的驳船。江风吹拂，带来腥咸的潮气。老船家摇着橹，低声喊了一声。';
  const objectBaseline = {
    sentenceLenStd: { mean: 18.5, stdDev: 4.2 },
    ttr: { mean: 0.68, stdDev: 0.05 }
  };
  const result = detector.computeAiFlavorScore(sample, objectBaseline);
  assert.ok(result.metrics.sentenceStdRatio !== null, 'sentenceStdRatio should not be null for object baseline');
  assert.ok(result.metrics.ttrRatio !== null, 'ttrRatio should not be null for object baseline');
  assert.strictEqual(typeof result.score, 'number');
});

