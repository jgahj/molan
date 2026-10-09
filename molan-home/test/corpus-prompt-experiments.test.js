'use strict';

/**
 * @file corpus-prompt-experiments.test.js
 * 资源库小说抽样、双模提示词提取与四象限实验系统单元与集成测试套件
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  extractChapters,
  isValidChapter,
  sampleChapter,
  extractEntitiesAndCharacters,
  extractNarrativeBeats,
  extractDualPrompts,
  buildQuadrantConfigs,
  processBookFile
} = require('../lib/composition/corpus/prompt-experiment-extractor');

const {
  estimateTokens,
  calculateStylometryDistance,
  QuadrantQualityEvaluator,
  QuadrantBatchRunner
} = require('../lib/composition/corpus/prompt-experiment-runner');

describe('Corpus Prompt Experiments - Chapter Extraction & Sampling', () => {
  it('extractChapters correctly extracts chapters with divider format', () => {
    const rawText = [
      '前言部分',
      '------',
      '第一章 初入江湖',
      '少年走出山门，天下风云变色。',
      '------',
      '第二章 荒野夜袭',
      '长剑出鞘，黑影应声而倒。',
      '------',
      '第三章 危机四伏',
      '客栈之外，杀机密布。',
      '------',
      '第四章 绝地反击',
      '掌风呼啸，震碎青石长街。',
      '------',
      '第五章 终局之战',
      '烟尘落定，胜负自分。'
    ].join('\n');

    const chaps = extractChapters(rawText);
    assert.strictEqual(chaps.length, 5);
    assert.strictEqual(chaps[0].chapterNo, 1);
    assert.strictEqual(chaps[0].title, '第一章 初入江湖');
    assert.ok(chaps[0].content.includes('少年走出山门'));
  });

  it('extractChapters correctly extracts chapters with standard heading regex', () => {
    const rawText = [
      '第1章 觉醒时刻',
      '光芒四射，少年从昏迷中苏醒。'.repeat(50),
      '第2章 强敌来犯',
      '门外传来了沉重的战鼓声。'.repeat(50),
      '第3章 绝处逢生',
      '阵法运转，抵挡住了漫天剑雨。'.repeat(50)
    ].join('\n\n');

    const chaps = extractChapters(rawText);
    assert.strictEqual(chaps.length, 3);
    assert.strictEqual(chaps[1].title, '第2章 强敌来犯');
  });

  it('isValidChapter filters out pure announcements and short chapters', () => {
    const announcement = {
      title: '上架感言与致谢',
      content: '感谢各位读者的支持，今天上架十更！'.repeat(20),
      charCount: 1200
    };
    assert.strictEqual(isValidChapter(announcement, 1000), false);

    const validChapter = {
      title: '第5章 深夜潜行',
      content: '夜黑风高，李巡握紧刀柄，无声潜入密林之中。'.repeat(50),
      charCount: 1500
    };
    assert.strictEqual(isValidChapter(validChapter, 1000), true);

    const tooShort = {
      title: '第6章 对决',
      content: '短文本。',
      charCount: 20
    };
    assert.strictEqual(isValidChapter(tooShort, 1000), false);
  });

  it('sampleChapter deterministically samples 1 valid chapter using seed', () => {
    const chapters = [
      { chapterNo: 1, title: '第1章', content: '正文1...'.repeat(200), charCount: 1200 },
      { chapterNo: 2, title: '第2章', content: '正文2...'.repeat(200), charCount: 1400 },
      { chapterNo: 3, title: '第3章', content: '正文3...'.repeat(200), charCount: 1600 },
      { chapterNo: 4, title: '第4章', content: '正文4...'.repeat(200), charCount: 1800 }
    ];

    const sampled1 = sampleChapter(chapters, 'seed_abc_123');
    const sampled2 = sampleChapter(chapters, 'seed_abc_123');
    assert.strictEqual(sampled1.chapterNo, sampled2.chapterNo);
    assert.strictEqual(sampled1.title, sampled2.title);
  });
});

describe('Corpus Prompt Experiments - Dual Prompt Extractor', () => {
  const sampleChapterText = [
    '第10章 密林截杀',
    '冷雨淅淅沥沥地落下，青石长阶上升腾起森然寒气。',
    '李巡反手按在腰间的鸣鸿刀柄上，指节因为过度用力而泛着青白。',
    '“李大人，既然来了，何必急着走？”一道阴冷沙哑的声音自前方阴影处传来。',
    '赵督主身披黑蟒袍，缓缓踱步而出，身后数十名东厂番子已悄然封死了所有退路。',
    '“赵大人好大的阵仗。”李巡冷笑一声，目光却飞速扫视着四周的突围路线。',
    '“奉指挥使密令，留下账册，咱家可保你全尸。”赵督主抬手，森森弩箭齐齐对准了李巡。',
    '空气几乎在这一刻凝固，沉重的压迫感令人窒息。',
    '李巡深知，今日若退半步，不仅自身难保，江南三千冤魂的血债将彻底被掩埋。',
    '突然，他动了！鸣鸿刀化作一道雪白惊雷，悍然斩向正面的盾阵！',
    '铛的一声巨响，火星在雨夜中炸开，两名番子倒飞而出！',
    '赵督主瞳孔骤缩，未曾料到重围之下李巡竟然敢率先动手。',
    '刀光交织，李巡在箭雨与刀光间险象环生，胸前已被划开一道见骨的血痕。',
    '但他那一刀却借力撕开了侧翼包围，整个人破门而入，冲进了漆黑的古刹废墟之中。',
    '然而，当他撞开古刹沉重铁门的瞬间，整个人却猛然僵住——',
    '古刹正殿之中，赫然端坐着那位本该在京城闭关的当朝国师！',
    '国师缓缓睁开双眼，嘴角噙着一抹冷意，究竟是谁走漏了风声？'
  ].join('\n\n');

  it('extractEntitiesAndCharacters extracts protagonist, antagonist, and dialogue attributions', () => {
    const entities = extractEntitiesAndCharacters(sampleChapterText);
    assert.ok(entities.protagonist, 'Should identify protagonist');
    assert.ok(entities.antagonist, 'Should identify antagonist');
    assert.ok(entities.identifiedEntities.length > 0);
  });

  it('extractNarrativeBeats extracts 4-beat narrative arc', () => {
    const beats = extractNarrativeBeats(sampleChapterText);
    assert.ok(beats.beatQi.length > 0);
    assert.ok(beats.beatCheng.length > 0);
    assert.ok(beats.beatZhuan.length > 0);
    assert.ok(beats.beatHe.length > 0);
  });

  it('extractDualPrompts produces minimal and comprehensive prompts matching specs', () => {
    const metadata = {
      bookId: 'test_book_01',
      title: '大明夜刀行',
      author: '墨客',
      category: '武侠',
      chapterNo: 10,
      chapterTitle: '第10章 密林截杀',
      charCount: sampleChapterText.length
    };

    const dual = extractDualPrompts(sampleChapterText, metadata);

    // 1. 验证极简提示词
    assert.ok(dual.minimal.summary.length >= 100);
    assert.ok(dual.minimal.styleTone.length > 0);
    assert.ok(dual.minimal.markdown.includes('创作任务：大明夜刀行'));
    assert.ok(dual.minimal.markdown.includes('核心故事情节概要'));

    // 2. 验证完整提示词
    assert.ok(dual.comprehensive.markdown.includes('墨阑全规格创书任务书'));
    assert.ok(dual.comprehensive.markdown.includes('一、人物设定与行动动机'));
    assert.ok(dual.comprehensive.markdown.includes('二、核心冲突阻力与情节起伏节拍'));
    assert.ok(dual.comprehensive.markdown.includes('三、因果债务状态机与章末钩子'));
    assert.ok(dual.comprehensive.markdown.includes('四、墨阑 5 维参数配置'));
    assert.ok(dual.comprehensive.markdown.includes('五、4 级注意力分级规划'));

    // 3. 验证 5 维配置结构
    const dims = dual.comprehensive.fiveDimensions;
    assert.ok(dims.genre.id);
    assert.ok(dims.style.id);
    assert.ok(dims.goal.id);
    assert.ok(dims.focus.budgetWeights);
    assert.ok(dims.hook.id);

    // 4. 验证 4 级注意力结构
    const tiers = dual.comprehensive.attentionTiers;
    assert.ok(Array.isArray(tiers.tier1Permanent.bibleRules));
    assert.ok(tiers.tier2Strategy.pacingFormula);
    assert.ok(tiers.tier3Evidence.exemplarTraits);
    assert.ok(tiers.tier4Immediate.sceneState);
  });
});

describe('Corpus Prompt Experiments - 4-Quadrant Task Matrix', () => {
  it('buildQuadrantConfigs constructs Quadrants A, B, C, D properly', () => {
    const sampleRecord = {
      bookId: 'book_x',
      title: '科幻之光',
      category: '科幻',
      chapterNo: 5,
      chapterTitle: '第5章 跃迁故障',
      dualPrompts: {
        minimal: {
          summary: '飞船遭遇引力坍缩。',
          markdown: '# 极简Prompt'
        },
        comprehensive: {
          markdown: '# 完整Prompt',
          fiveDimensions: { genre: { id: 'scifi' } },
          attentionTiers: { tier1Permanent: {} }
        }
      }
    };

    const quads = buildQuadrantConfigs(sampleRecord);

    // 象限 A: 实验组 A (墨阑全链路 + 极简)
    assert.strictEqual(quads.quadrantA.quadrant, 'A');
    assert.strictEqual(quads.quadrantA.pipeline, 'molan_full_pipeline');
    assert.strictEqual(quads.quadrantA.promptLevel, 'minimal');
    assert.strictEqual(quads.quadrantA.payload.inferredSpec, true);

    // 象限 B: 实验组 B (墨阑全链路 + 完整)
    assert.strictEqual(quads.quadrantB.quadrant, 'B');
    assert.strictEqual(quads.quadrantB.pipeline, 'molan_full_pipeline');
    assert.strictEqual(quads.quadrantB.promptLevel, 'comprehensive');
    assert.strictEqual(quads.quadrantB.payload.inferredSpec, false);
    assert.ok(quads.quadrantB.payload.fiveDimensions);
    assert.ok(quads.quadrantB.payload.attentionTiers);

    // 象限 C: 对照组 C (大模型直出 + 极简)
    assert.strictEqual(quads.quadrantC.quadrant, 'C');
    assert.strictEqual(quads.quadrantC.pipeline, 'direct_llm_single_turn');
    assert.strictEqual(quads.quadrantC.promptLevel, 'minimal');

    // 象限 D: 对照组 D (大模型直出 + 完整)
    assert.strictEqual(quads.quadrantD.quadrant, 'D');
    assert.strictEqual(quads.quadrantD.pipeline, 'direct_llm_single_turn');
    assert.strictEqual(quads.quadrantD.promptLevel, 'comprehensive');
  });
});

describe('Corpus Prompt Experiments - Quality Evaluation & Batch Runner', () => {
  it('calculateStylometryDistance accurately measures vector distances', () => {
    const v1 = { shortSentenceRatio: 0.6, dialogueRatio: 0.3, narrativeDensity: 0.5 };
    const v2 = { shortSentenceRatio: 0.6, dialogueRatio: 0.3, narrativeDensity: 0.5 };
    const distIdentical = calculateStylometryDistance(v1, v2);
    assert.strictEqual(distIdentical, 0);

    const v3 = { shortSentenceRatio: 0.1, dialogueRatio: 0.8, narrativeDensity: 0.1 };
    const distDiff = calculateStylometryDistance(v1, v3);
    assert.ok(distDiff > 0.1);
  });

  it('QuadrantQualityEvaluator computes composite score and penalty', () => {
    const evaluator = new QuadrantQualityEvaluator();
    const origSample = {
      bookId: 'test_book',
      category: '都市',
      originalChapterText: '原本正文'.repeat(400),
      dualPrompts: {
        factors: { stylometry: { shortSentenceRatio: 0.5, dialogueRatio: 0.3 } },
        comprehensive: {
          entities: { identifiedEntities: ['林凡', '赵总'] }
        }
      }
    };

    const goodSentence = '林凡推开厚重大门，拔出钢笔按在合同上。“赵总，请过目。”赵总冷笑道：“凭你也配？”林凡闪身退步，目光如刀。';
    const goodGenText = goodSentence.repeat(20);
    const goodEval = evaluator.evaluateCandidate(goodGenText, origSample, 'A');
    assert.strictEqual(goodEval.quadrant, 'A');
    assert.ok(goodEval.compositeScore > 50, `compositeScore ${goodEval.compositeScore} should be > 50`);

    // 包含大量 AI 味套词的文本应受扣分惩罚
    const badGenText = '林凡嘴角勾起一抹玩味的笑容，倒吸一口凉气，瞳孔骤缩。眼神中闪过一丝不可置信。' + '深吸一口气。'.repeat(100);
    const badEval = evaluator.evaluateCandidate(badGenText, origSample, 'C');
    assert.ok(badEval.aiFlavorRisk > 0);
  });

  it('QuadrantBatchRunner runs dry-run mode and calculates tokens cleanly', async () => {
    // 搭建临时测试实验目录
    const tmpDir = path.join(os.tmpdir(), `molan_test_exp_${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, '玄幻'), { recursive: true });

    const mockSample = {
      bookId: 'mock_xuanhuan',
      title: '万界修神',
      category: '玄幻',
      sampledChapter: { chapterNo: 1, chapterTitle: '第1章', charCount: 2000 },
      originalChapterText: '正文内容'.repeat(200),
      dualPrompts: {
        minimal: { markdown: '极简提示词' },
        comprehensive: { markdown: '完整提示词', beats: {}, entities: {} }
      }
    };
    mockSample.quadrants = buildQuadrantConfigs(mockSample);

    fs.writeFileSync(path.join(tmpDir, '玄幻', 'mock_xuanhuan.json'), JSON.stringify(mockSample), 'utf8');

    const manifest = {
      version: '1.0.0',
      stats: { totalBooks: 1, processedBooks: 1 },
      samples: [
        {
          bookId: 'mock_xuanhuan',
          category: '玄幻',
          relativeJsonPath: '玄幻/mock_xuanhuan.json'
        }
      ]
    };
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

    const runner = new QuadrantBatchRunner({
      experimentDir: tmpDir
    });

    const summary = await runner.runBatch({ dryRun: true });
    assert.strictEqual(summary.mode, 'dry_run');
    assert.strictEqual(summary.totalTasks, 4); // A, B, C, D 4个象限
    assert.strictEqual(summary.completedTasks, 4);

    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('QuadrantBatchRunner runs mock mode, resumes from checkpoint and generates evaluations', async () => {
    const tmpDir = path.join(os.tmpdir(), `molan_test_mock_${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, '都市'), { recursive: true });

    const mockSample = {
      bookId: 'mock_urban',
      title: '重返巅峰',
      category: '都市',
      sampledChapter: { chapterNo: 3, chapterTitle: '第3章', charCount: 2000 },
      originalChapterText: '商战交锋'.repeat(250),
      dualPrompts: {
        minimal: { markdown: '极简提示词' },
        comprehensive: { markdown: '完整提示词', beats: { beatQi: '开局' }, entities: { protagonist: '顾沉' } }
      }
    };
    mockSample.quadrants = buildQuadrantConfigs(mockSample);

    fs.writeFileSync(path.join(tmpDir, '都市', 'mock_urban.json'), JSON.stringify(mockSample), 'utf8');

    const manifest = {
      version: '1.0.0',
      stats: { totalBooks: 1, processedBooks: 1 },
      samples: [
        {
          bookId: 'mock_urban',
          category: '都市',
          relativeJsonPath: '都市/mock_urban.json'
        }
      ]
    };
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

    const runner = new QuadrantBatchRunner({
      experimentDir: tmpDir
    });

    // 运行 mock 模式
    const summary = await runner.runBatch({ mock: true });
    assert.strictEqual(summary.mode, 'mock');
    assert.strictEqual(summary.completedTasks, 4);
    assert.ok(summary.evaluationSummary.A);
    assert.ok(summary.evaluationSummary.B);

    // 检查 checkpoint 文件存在
    assert.ok(fs.existsSync(runner.checkpointFile));

    // 二次运行开启 resume，应全部跳过已完成项
    const resumeSummary = await runner.runBatch({ mock: true, resume: true });
    assert.strictEqual(resumeSummary.skippedTasks, 4);

    // 清理临时目录
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
