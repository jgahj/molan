'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GENRE_TAXONOMY,
  CORE_SETTING_TROPES,
  STYLE_TAXONOMY,
  CHAPTER_FUNCTION_TAXONOMY,
  CHAPTER_FOCUS_MODES,
  ENDING_HOOKS,
  compileGenreDirective,
  compileStyleDirective,
  compileChapterFunctionDirective,
  compileFocusDirective,
  compileFullWritingSpecification
} = require('../lib/generation/corpus-archetypes');

test('GENRE_TAXONOMY contains all 7 major categories and subgenres from the handbook', () => {
  const categories = Object.keys(GENRE_TAXONOMY);
  assert.ok(categories.includes('fantasy'), '幻想类');
  assert.ok(categories.includes('realistic'), '现实向类');
  assert.ok(categories.includes('ancient'), '古代背景类');
  assert.ok(categories.includes('romance'), '情感言情类');
  assert.ok(categories.includes('suspense'), '悬疑推理类');
  assert.ok(categories.includes('wuxia'), '武侠类');
  assert.ok(categories.includes('niche'), '小众垂直赛道');

  // 幻想类子类检查
  const fantasySub = GENRE_TAXONOMY.fantasy.subgenres;
  assert.ok(fantasySub.xuanhuan && fantasySub.xuanhuan.name === '玄幻');
  assert.ok(fantasySub.qihuan && fantasySub.qihuan.name === '奇幻');
  assert.ok(fantasySub.xianxia && fantasySub.xianxia.name === '仙侠');
  assert.ok(fantasySub.scifi && fantasySub.scifi.name === '科幻');
  assert.ok(fantasySub.infinite && fantasySub.infinite.name === '无限流');
  assert.ok(fantasySub.apocalypse && fantasySub.apocalypse.name === '末世/末日');
  assert.ok(fantasySub.horror && fantasySub.horror.name === '灵异/惊悚');

  // 现实向类子类检查
  const realisticSub = GENRE_TAXONOMY.realistic.subgenres;
  assert.ok(realisticSub.urban && realisticSub.urban.name === '都市');
  assert.ok(realisticSub.campus && realisticSub.campus.name === '校园');
  assert.ok(realisticSub.era && realisticSub.era.name === '年代文');
  assert.ok(realisticSub.realism && realisticSub.realism.name === '现实题材');

  // 古代背景类
  const ancientSub = GENRE_TAXONOMY.ancient.subgenres;
  assert.ok(ancientSub.ancient_romance && ancientSub.ancient_romance.name === '古言');
  assert.ok(ancientSub.history && ancientSub.history.name === '历史');
  assert.ok(ancientSub.farming && ancientSub.farming.name === '种田文');
});

test('CORE_SETTING_TROPES contains popular tropes from the handbook', () => {
  const tropes = Object.keys(CORE_SETTING_TROPES);
  assert.ok(tropes.includes('system'), '系统流');
  assert.ok(tropes.includes('sign_in'), '签到流');
  assert.ok(tropes.includes('invincible'), '无敌流');
  assert.ok(tropes.includes('mortal'), '凡人流');
  assert.ok(tropes.includes('multiverse'), '诸天流');
  assert.ok(tropes.includes('infrastructure'), '基建种田流');
  assert.ok(tropes.includes('live_stream'), '直播流');
});

test('STYLE_TAXONOMY contains 4 core tiers: popular, texture, emotional, and webnovel specialized', () => {
  const popular = STYLE_TAXONOMY.popular_commercial.styles;
  assert.ok(popular.cool_paced && popular.cool_paced.name === '爽文文风');
  assert.ok(popular.accessible_direct && popular.accessible_direct.name === '小白文风');
  assert.ok(popular.light_novel && popular.light_novel.name === '轻小说文风');

  const texture = STYLE_TAXONOMY.narrative_texture.styles;
  assert.ok(texture.realistic_restrained && texture.realistic_restrained.name === '写实文风');
  assert.ok(texture.rustic_folk && texture.rustic_folk.name === '质朴乡土风');
  assert.ok(texture.gorgeous_rhetoric && texture.gorgeous_rhetoric.name === '华丽辞藻风');
  assert.ok(texture.cold_minimalist && texture.cold_minimalist.name === '清冷极简风');
  assert.ok(texture.heavy_epic && texture.heavy_epic.name === '厚重史诗风');

  const emotional = STYLE_TAXONOMY.emotional_tone.styles;
  assert.ok(emotional.humorous_roast && emotional.humorous_roast.name === '幽默诙谐/吐槽风');
  assert.ok(emotional.dark_oppressive && emotional.dark_oppressive.name === '压抑暗黑风');
  assert.ok(emotional.poetic_prose && emotional.poetic_prose.name === '诗意散文风');
  assert.ok(emotional.dramatic_high_conflict && emotional.dramatic_high_conflict.name === '戏剧化强冲突风');

  const specialized = STYLE_TAXONOMY.webnovel_specialized.styles;
  assert.ok(specialized.veteran_composed && specialized.veteran_composed.name === '老白文风');
  assert.ok(specialized.badass_reversal && specialized.badass_reversal.name === '装逼流文风');
  assert.ok(specialized.fragmented_short && specialized.fragmented_short.name === '碎片化短句风');
  assert.ok(specialized.delicate_lingering && specialized.delicate_lingering.name === '缱绻细腻风');
  assert.ok(specialized.hardcore_verified && specialized.hardcore_verified.name === '硬核干货风');
  assert.ok(specialized.parody_meme && specialized.parody_meme.name === '戏仿/玩梗风');
});

test('CHAPTER_FUNCTION_TAXONOMY includes Golden Three Chapters and full functional curve', () => {
  const intro = CHAPTER_FUNCTION_TAXONOMY.introduction.functions;
  assert.ok(intro.golden_ch1_hook, '黄金三章第1章破局钩子');
  assert.ok(intro.golden_ch2_goldfinger, '黄金三章第2章金手指落地');
  assert.ok(intro.golden_ch3_first_cool, '黄金三章第3章首秀爽点');
  assert.ok(intro.character_debut, '人物登场章');
  assert.ok(intro.worldview_setup, '世界观铺陈章');

  const payoff = CHAPTER_FUNCTION_TAXONOMY.growth_payoff.functions;
  assert.ok(payoff.harvest_reward, '收获章');
  assert.ok(payoff.breakthrough_upgrade, '突破升级章');
  assert.ok(payoff.face_slap, '打脸章');

  const climax = CHAPTER_FUNCTION_TAXONOMY.climax_resolution.functions;
  assert.ok(climax.minor_climax, '小高潮章');
  assert.ok(climax.major_climax, '大高潮章');
  assert.ok(climax.resolution_aftermath, '收尾解决章');
  assert.ok(climax.cliffhanger_hook, '悬念留尾章');
  assert.ok(climax.volume_conclusion, '卷末收尾章');
  assert.ok(climax.story_ending, '结局章');
});

test('CHAPTER_FOCUS_MODES supports dialogue, action, environment, psychological, tactics, etc.', () => {
  const modes = Object.keys(CHAPTER_FOCUS_MODES);
  assert.ok(modes.includes('dialogue'));
  assert.ok(modes.includes('action'));
  assert.ok(modes.includes('environment'));
  assert.ok(modes.includes('psychological'));
  assert.ok(modes.includes('tactics'));
  assert.ok(modes.includes('emotional'));
  assert.ok(modes.includes('farming'));
  assert.ok(modes.includes('balanced'));
});

test('ENDING_HOOKS contains the 5 classic novel ending hooks', () => {
  const hooks = Object.keys(ENDING_HOOKS);
  assert.ok(hooks.includes('crisis'), '危机钩');
  assert.ok(hooks.includes('suspense'), '悬念钩');
  assert.ok(hooks.includes('twist'), '反转钩');
  assert.ok(hooks.includes('anticipation'), '期待钩');
  assert.ok(hooks.includes('emotional'), '情感钩');
});

test('compileFullWritingSpecification orchestrates all dimensions into a unified specification', () => {
  const spec = compileFullWritingSpecification({
    genre: 'xuanhuan',
    writingStyle: 'veteran_composed',
    chapterFunction: 'face_slap',
    chapterFocus: 'dialogue',
    endingHook: 'crisis',
    userPrompt: '周烈夜潜刑狱司盗取林家物证，被赵元奎阻拦'
  });

  assert.ok(spec.directive.includes('【小说题材约束·玄幻（幻想类）】'));
  assert.ok(spec.directive.includes('打怪升级、境界突破'));
  assert.ok(spec.directive.includes('【写作风格·老白文风】'));
  assert.ok(spec.directive.includes('反俗套与无脑降智'));
  assert.ok(spec.directive.includes('【单章功能·打脸章】'));
  assert.ok(spec.directive.includes('先抑后扬'));
  assert.ok(spec.directive.includes('【本章结尾钩子·危机钩】'));
  assert.ok(spec.directive.includes('【本章侧重点·对话博弈（重点强化）】'));
  assert.ok(spec.directive.includes('【本章篇幅预算（严格遵守）】'));
  // 默认字数预算：2500~3500 字一章
  assert.equal(spec.wordBudget.target, 3000);
  assert.equal(spec.wordBudget.min, 2500);
  assert.equal(spec.wordBudget.max, 3500);
});

test('EMPIRICAL_RULES contains data extracted from all 1276 books and provides genuine corpus directives', () => {
  const { EMPIRICAL_RULES } = require('../lib/generation/corpus-archetypes');
  assert.ok(Object.keys(EMPIRICAL_RULES).length >= 40);

  // 玄幻实测语料规则
  const xh = EMPIRICAL_RULES.xuanhuan;
  assert.ok(xh);
  assert.ok(xh.bookCount >= 40);
  assert.ok(xh.avgChapterLength > 2000);
  assert.ok(xh.avgDialogueRatio > 10);
  assert.ok(xh.sampleBooks.some(b => b.title.includes('丹田被废')));

  // 仙侠实测语料规则
  const xx = EMPIRICAL_RULES.xianxia;
  assert.ok(xx);
  assert.ok(xx.sampleBooks.some(b => b.title.includes('临圣')));

  // 都市日常实测语料规则
  const ud = EMPIRICAL_RULES.urban_daily;
  assert.ok(ud);
  assert.ok(ud.sampleBooks.some(b => b.title.includes('不娶还敢撩') || b.title.includes('中了8千万')));

  // 编译玄幻指令必须包含真实名作及三章动线
  const compiled = compileGenreDirective('xuanhuan');
  assert.ok(compiled.includes('语料实测真经·玄幻'));
  assert.ok(compiled.includes('单章基准篇幅'));
  assert.ok(compiled.includes('黄金第1章规律'));
  assert.ok(compiled.includes('黄金第2章规律'));
  assert.ok(compiled.includes('黄金第3章规律'));
});

test('getAtomicPromptBlocks returns completely decoupled blocks for all 5 dimensions', () => {
  const { getAtomicPromptBlocks } = require('../lib/generation/corpus-archetypes');
  const blocks = getAtomicPromptBlocks();
  assert.ok(blocks.genres && Object.keys(blocks.genres).length >= 20, 'Genres atomic blocks');
  assert.ok(blocks.styles && Object.keys(blocks.styles).length >= 10, 'Styles atomic blocks');
  assert.ok(blocks.chapterFunctions && Object.keys(blocks.chapterFunctions).length >= 15, 'Chapter functions atomic blocks');
  assert.ok(blocks.chapterFocusModes && Object.keys(blocks.chapterFocusModes).length >= 8, 'Focus modes atomic blocks');
  assert.ok(blocks.endingHooks && Object.keys(blocks.endingHooks).length >= 5, 'Ending hooks atomic blocks');

  // 验证每个块都有实质性指令
  assert.ok(blocks.genres.xuanhuan.directive.length > 50);
  assert.ok(blocks.styles.cool_paced.directive.length > 30);
  assert.ok(blocks.chapterFunctions.face_slap.directive.length > 30);
  assert.ok(blocks.chapterFocusModes.dialogue.directive.length > 30);
  assert.ok(blocks.endingHooks.crisis.directive.length > 20);
});

test('compileFullWritingSpecification deeply integrates userPrompt into the final prompt', () => {
  const { compileFullWritingSpecification } = require('../lib/generation/corpus-archetypes');
  const spec = compileFullWritingSpecification({
    genre: 'xianxia',
    writingStyle: 'humorous_roast',
    chapterFunction: 'emotional_interaction',
    chapterFocus: 'dialogue',
    endingHook: 'emotional',
    userPrompt: '男主与高冷师尊在寒潭疗伤，师尊强忍心跳假装镇定，男主借口找药试探师尊耳根是否发红'
  });

  assert.ok(spec.directive.includes('【用户核心创作意图与本章剧情指示（最高执行优先级）】'));
  assert.ok(spec.directive.includes('男主与高冷师尊在寒潭疗伤'));
  assert.ok(spec.directive.includes('【小说题材约束·仙侠'));
  assert.ok(spec.directive.includes('【写作风格·幽默诙谐/吐槽风】'));
  assert.ok(spec.directive.includes('【单章功能·情感互动章】'));
  assert.ok(spec.directive.includes('【本章侧重点·对话博弈（重点强化）】'));
  assert.ok(spec.directive.includes('【本章结尾钩子·情感钩】'));
});


