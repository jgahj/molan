import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNovelStyle } from '../lib/style-detector.js';
import { NovelGenerateRegistry } from '../lib/novel-generate-registry.js';
import { adaptIpContinuationMessages } from '../lib/ip-continuation-adapter.js';

test('style-detector: detects comedic female frequency for Zhang Fuxiao beagle novel', () => {
  const result = detectNovelStyle('张拂潇 比格犬 跑了一个人 送瘟神 灌了五斤巴豆', {
    bookTitle: '女频测试'
  });

  assert.equal(result.styleArchetype, 'humorous_sand_sculpture');
  assert.equal(result.genreFamily, '古言世情');
  assert.equal(result.subcategory, '女频衍生');
  assert.ok(result.voiceSpec.allowSlangAndMemes);
  assert.ok(result.voiceSpec.allowComedyBanter);
  assert.ok(result.voiceSpec.prohibitedTones.some(t => t.includes('苦大仇深')));
});

test('style-detector: detects epic grandeur for Zhang Ruochen / Wangu Shen Di', () => {
  const result = detectNovelStyle('世界观：东方玄幻，修炼体系包含大圣、伪神、神境、神尊；罗祖云山界为魔道势力。主要人物：张若尘、姑射静。', {
    bookTitle: '万古神帝'
  });

  assert.equal(result.styleArchetype, 'epic_grandeur');
  assert.equal(result.genreFamily, '玄幻修真');
});

test('style-detector: detects hardcore progression for Han Li / Fanren', () => {
  const result = detectNovelStyle('韩立捡到了神秘小绿瓶，黄枫谷七玄门墨大夫，小心翼翼隐忍算计。', {
    bookTitle: '凡人修仙传'
  });

  assert.equal(result.styleArchetype, 'hardcore_progression');
  assert.equal(result.genreFamily, '玄幻修真');
});

test('style-detector: detects sweet romance and workplace inversion', () => {
  const sweet = detectNovelStyle('校草同桌心动暗恋甜宠，偷偷看他红了耳根，青涩校园治愈。', {
    bookTitle: '偷心'
  });
  assert.equal(sweet.styleArchetype, 'sweet_healing_pet');

  const workplace = detectNovelStyle('打工人拒绝996，老板PUA直接算账仲裁，反向整顿职场降维打击。', {
    bookTitle: '整顿修仙职场'
  });
  assert.equal(workplace.styleArchetype, 'workplace_inversion');
});

test('novel-generate-registry: maps 48 genres and indexes library', () => {
  const registry = new NovelGenerateRegistry();
  const spec = registry.getNovelGenerateSpec('女频测试', {
    queryText: '张拂潇 比格犬 跑路'
  });

  assert.ok(spec);
  assert.equal(spec.styleArchetype, 'humorous_sand_sculpture');
  assert.ok(spec.voiceSpec.allowComedyBanter);
});

test('adaptIpContinuationMessages: dynamically customizes R-47~R-50 per archetype', () => {
  const adaptedNvpin = adaptIpContinuationMessages([
    { role: 'user', content: '写一章小说《女频测试》，主角：张拂潇（比格犬老祖宗），送走瘟神。' }
  ], { creationMode: true, stylePreset: 'auto' });

  const systemPromptNvpin = adaptedNvpin.find(m => m.role === 'system').content;
  assert.ok(systemPromptNvpin.includes('沙雕反差 / 暴躁吐槽流'));
  assert.ok(systemPromptNvpin.includes('暴躁反差与爽快放狠话'));
  assert.ok(systemPromptNvpin.includes('张拂潇'));

  const adaptedFanren = adaptIpContinuationMessages([
    { role: 'user', content: '写一章小说《凡人修仙传》，主角：韩立，神手谷墨大夫，神秘小瓶。' }
  ], { creationMode: true, stylePreset: 'auto' });

  const systemPromptFanren = adaptedFanren.find(m => m.role === 'system').content;
  assert.ok(systemPromptFanren.includes('谨小慎微与利益算计') || systemPromptFanren.includes('古典仙侠凡人流'));

  // 验证 4D 心智动机与第 5 维物理阻力约束是否真正注入并生效
  assert.ok(systemPromptFanren.includes('4D 心智动机图谱与第 5 维物理阻力约束'));
  assert.ok(systemPromptFanren.includes('表面所求'));
  assert.ok(systemPromptFanren.includes('隐匿之物'));
  assert.ok(systemPromptFanren.includes('认知盲区'));
  assert.ok(systemPromptFanren.includes('不可逆位移'));
  assert.ok(systemPromptFanren.includes('物理生活阻力要素'));

  // 验证动态张力热力曲线是否注入并生效
  assert.ok(systemPromptFanren.includes('动态张力热力曲线'));
});

test('style-detector: returns 5D epistemic map and tension curve', () => {
  const result = detectNovelStyle('少年陆鸣持枪傲立，雷池翻滚。', { genreFamily: '玄幻修真' });
  assert.ok(result.epistemic5D);
  assert.ok(result.epistemic5D.desire);
  assert.ok(result.epistemic5D.conceal);
  assert.ok(result.epistemic5D.blindSpots);
  assert.ok(result.epistemic5D.irreversibleChange);
  assert.ok(result.epistemic5D.friction);
  assert.ok(Array.isArray(result.tensionCurve));
  assert.equal(result.tensionCurve.length, 4);
});

