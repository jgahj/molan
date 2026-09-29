'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  scanGeneratedNovels,
  parseGenerationDirectory,
  buildMultiGranularityTree,
  generateGeneratedNovelProfile,
  validateGeneratedNovelProfile,
  GENERATED_NOVEL_PROFILE_FIELDS
} = require('../lib/generated-novel-preprocessor');

const { extractNovelQualityProfile } = require('../lib/novel-quality-profiler');

test('AI生成小说预处理引擎：零配置自动扫描并解析生成套件', () => {
  const packages = scanGeneratedNovels();
  assert.ok(Array.isArray(packages), '扫描结果应为数组');
  assert.ok(packages.length >= 1, '应至少扫描到1个生成套件');

  const pkg = packages.find(p => p.packageId.includes('月圆夜前的布局'));
  assert.ok(pkg, '应自动识别到【月圆夜前的布局-20260910】');

  // 校验上下文提取要素
  assert.equal(pkg.title, '月圆夜前的布局');
  assert.ok(pkg.novelText.length > 2000, '正文字符数应大于2000');
  assert.ok(pkg.rawDraft.length > 2000, '首稿字符数应大于2000');
  assert.ok(pkg.promptText.length > 500, '提示词应成功提取');
  assert.ok(pkg.revisionText.length > 500, '优化策略/修订要求应成功提取');

  // 人物、世界观、道具
  assert.ok(pkg.characters.length >= 4, '应至少提取出4个主要人物');
  const charNames = pkg.characters.map(c => c.name);
  assert.ok(charNames.includes('张若尘'), '人物中应包含张若尘');
  assert.ok(charNames.includes('姑射静'), '人物中应包含姑射静');
  assert.ok(pkg.worldview.includes('东方玄幻'), '世界观应为东方玄幻');
  assert.ok(pkg.keyProps.length >= 3, '应提取出至少3件关键道具');

  // 大纲节点
  assert.ok(pkg.outline.length >= 5, '大纲剧情节点应至少有5个阶段');

  // 模型与执行参数
  assert.equal(pkg.generationParameters.requestedModel, 'gpt-5.6-luna');
  assert.equal(pkg.generationParameters.requestId, 'req_b4d5379e717078c44af9dc987fce694f');
  assert.ok(pkg.generationParameters.tokens.total > 10000, 'Token总数应记录');
});

test('AI生成小说预处理引擎：必须固化五大生成上下文版本指纹', () => {
  const packages = scanGeneratedNovels();
  const pkg = packages[0];

  assert.ok(pkg.versions.generation_version, 'generation_version 必须存在');
  assert.ok(pkg.versions.model_version, 'model_version 必须存在');
  assert.ok(pkg.versions.prompt_version.startsWith('sha256:'), 'prompt_version 必须为sha256指纹');
  assert.ok(pkg.versions.story_bible_version, 'story_bible_version 必须存在');
  assert.ok(pkg.versions.optimizer_version, 'optimizer_version 必须存在');
});

test('AI生成小说预处理引擎：七级分析粒度树 (全书->卷->篇章->章节->场景->段落->句子) 完整性', () => {
  const packages = scanGeneratedNovels();
  const pkg = packages[0];

  const tree = buildMultiGranularityTree(pkg.novelText, {
    title: pkg.title,
    creationPlan: pkg.creationPlan
  });

  const root = tree.root;
  assert.equal(root.level, 'book', '顶层必须为 book 级别');
  assert.equal(root.title, pkg.title);
  assert.equal(root.totalChars, pkg.novelText.replace(/\r\n?/g, '\n').trim().length);

  // 卷 volume
  assert.equal(root.children.length, 1);
  const volume = root.children[0];
  assert.equal(volume.level, 'volume');

  // 篇章 arc
  assert.ok(volume.children.length >= 2, '卷内应包含至少2个大剧情弧');
  const arc = volume.children[0];
  assert.equal(arc.level, 'arc');

  // 章节 chapter
  const chapter = arc.children[0];
  assert.equal(chapter.level, 'chapter');

  // 场景 scene
  assert.ok(chapter.children.length >= 5, '章节内应拆分出至少5个时空场景');
  const scene = chapter.children[0];
  assert.equal(scene.level, 'scene');
  assert.ok(scene.setting, '场景应具备时空环境定义');

  // 段落 paragraph
  assert.ok(scene.children.length >= 1, '场景内应包含段落');
  const para = scene.children[0];
  assert.equal(para.level, 'paragraph');
  assert.ok(['dialogue', 'action', 'description', 'monologue', 'narrative'].includes(para.type));

  // 句子 sentence
  assert.ok(para.children.length >= 1, '段落内应包含句子');
  const sent = para.children[0];
  assert.equal(sent.level, 'sentence');
  assert.ok(sent.charCount > 0, '句子字数应大于0');
});

test('AI生成小说预处理引擎：23维 GeneratedNovelProfile 标准契约与同构性断言', () => {
  const packages = scanGeneratedNovels();
  const pkg = packages[0];

  const profile = generateGeneratedNovelProfile(pkg, {
    title: pkg.title,
    author: 'AI (gpt-5.6-luna)',
    genre: '玄幻',
    subgenre: '东方玄幻'
  });

  // 验证 23 个顶层必选维度
  assert.equal(GENERATED_NOVEL_PROFILE_FIELDS.length, 23, '必须定义 23 个标准画像维度');
  for (const field of GENERATED_NOVEL_PROFILE_FIELDS) {
    const block = profile[field];
    assert.ok(block, `字段【${field}】必须存在`);
    assert.ok(block.value !== undefined, `字段【${field}】必须包含 value`);
    assert.ok(Array.isArray(block.evidence), `字段【${field}】的 evidence 必须是数组`);
    assert.ok(block.evidence.length > 0, `字段【${field}】的 evidence 数组不能为空`);
    assert.ok(typeof block.confidence === 'number', `字段【${field}】的 confidence 必须是数字`);
    assert.ok(block.confidence >= 0 && block.confidence <= 1, `字段【${field}】的 confidence 必须在 0 到 1 之间`);
  }

  // 验证独立顶层字段特异性
  assert.equal(profile.genre.value.primaryGenre, '玄幻');
  assert.equal(profile.genre.value.subgenre, '东方玄幻');
  assert.ok(profile.ai_flavor.value.aiFlavorScore >= 0);
  assert.ok(profile.metadata.value.generation_version);
  assert.ok(profile.metadata.value.model_version);

  // 验证与 Benchmark 提取器同构
  const benchmarkProfile = extractNovelQualityProfile(pkg.novelText, {
    title: pkg.title,
    genre: '玄幻',
    subgenre: '东方玄幻'
  });

  // 关键物理特征与指标必须 100% 同构一致（同底层计算）
  assert.equal(profile.dialogue.value.dialogueRatio, benchmarkProfile.dialogue.value.dialogueRatio);
  assert.equal(profile.language.value.sentenceLenMean, benchmarkProfile.language.value.sentenceLenMean);
  assert.equal(profile.description.value.sensoryDistribution.visual, benchmarkProfile.description.value.sensoryDistribution.visual);
  assert.equal(profile.human_texture.value.organicScore, benchmarkProfile.human_texture.value.organicScore);

  // 校验器整体通过
  const val = validateGeneratedNovelProfile(profile);
  assert.equal(val.valid, true);

  // 机器比对报告正常生成
  assert.ok(profile.quality_vector, '生成档案应提供质量向量');
  assert.equal(profile.quality_vector.schemaVersion, 'quality-vector-v2');
  assert.equal(Object.keys(profile.quality_vector.values).length, 19);
  assert.equal(Object.hasOwn(profile, 'benchmark_comparison'), false, '预处理不应执行 Benchmark 比较');
});
