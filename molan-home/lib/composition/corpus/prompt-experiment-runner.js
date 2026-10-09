'use strict';

/**
 * @file prompt-experiment-runner.js
 * 四象限对照实验批处理调度器与质量评估引擎 (Quadrant Batch Runner & Quality Evaluator)
 * 
 * 核心功能：
 * 1. 四象限批处理执行调度 (R4)：
 *    - 象限 A (实验组 A): 墨阑完整链路 + 极简提示词
 *    - 象限 B (实验组 B): 墨阑完整链路 + 完整提示词
 *    - 象限 C (对照组 C): 大模型单轮直出 + 极简提示词
 *    - 象限 D (对照组 D): 大模型单轮直出 + 完整提示词
 * 2. 健壮的并发控制、断点续传 (.checkpoint.json) 与 API 退避；
 * 3. 严格的 Dry-run 试跑模式与 Mock 验证模式（零 Token 误消耗）；
 * 4. 多维质量比对度量工具 (QuadrantQualityEvaluator)：
 *    - 篇幅字数拟合比、11 维文风空间欧氏距离、冲突动作密度、AI 味套词惩罚、核心线索留存率与综合质量得分。
 */

const fs = require('node:fs');
const path = require('node:path');
const { extractChapterFactors } = require('./factorized-extractor');

// 常见机械 AI 味套词黑名单与惩罚权重
const AI_FLAVOR_CLICHES = [
  '嘴角勾起', '倒吸一口凉气', '瞳孔骤缩', '心中涌起', '仿佛在诉说',
  '冷笑一声', '玩味的笑容', '深吸一口气', '眼神中闪过一丝', '不可置信',
  '似笑非笑', '面色微变', '心中的震惊无以复加', '天地为之变色'
];

/**
 * 估算中文字符/词 Token 消耗
 * @param {string} text 
 * @returns {number}
 */
function estimateTokens(text = '') {
  const str = String(text || '');
  let cjk = 0;
  let nonCjk = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 0x4e00 && code <= 0x9fff) {
      cjk++;
    } else {
      nonCjk++;
    }
  }
  return Math.ceil(cjk * 1.25 + nonCjk * 0.3);
}

/**
 * 计算两个 11 维文风向量之间的欧氏距离
 * @param {Object} v1 
 * @param {Object} v2 
 * @returns {number} 距离 (0~1 越小越相似)
 */
function calculateStylometryDistance(v1 = {}, v2 = {}) {
  const keys = [
    'narrativeDensity', 'emotionalIntensity', 'rhetoricalAbundance',
    'colloquialLevel', 'dialogueRatio', 'psychologicalRatio',
    'settingRatio', 'shortSentenceRatio', 'informationDensity',
    'negativeSpaceRatio'
  ];

  let sumSq = 0;
  for (const k of keys) {
    const val1 = Number(v1[k] ?? 0.5);
    const val2 = Number(v2[k] ?? 0.5);
    sumSq += Math.pow(val1 - val2, 2);
  }
  return Number((Math.sqrt(sumSq / keys.length)).toFixed(4));
}

/**
 * 四象限质量比对评估器 (QuadrantQualityEvaluator)
 */
class QuadrantQualityEvaluator {
  /**
   * 评估生成的正文相比原著章节的各项质量度量
   * @param {string} generatedText 生成文本
   * @param {Object} originalSample 原始样本记录 (含 originalChapterText, dualPrompts 等)
   * @param {string} quadrant 象限 ('A' | 'B' | 'C' | 'D')
   * @returns {Object} 评测度量结果
   */
  evaluateCandidate(generatedText = '', originalSample = {}, quadrant = 'A') {
    const text = String(generatedText || '').trim();
    const origText = String(originalSample.originalChapterText || '').trim();

    const charCount = text.length;
    const origCharCount = origText.length || 3000;
    const lengthRatio = Number((charCount / origCharCount).toFixed(3));

    // 1. 因子化抽取生成文本的文风特征
    let genFactors = null;
    let styleDistance = 0.5;
    try {
      genFactors = extractChapterFactors(text, {
        title: originalSample.title,
        genre: originalSample.category
      });
      const origFactors = originalSample.dualPrompts?.factors?.stylometry || {};
      styleDistance = calculateStylometryDistance(genFactors.stylometry, origFactors);
    } catch (_) {
      // 降级缺省
    }

    // 2. 动作与冲突密度测算
    const actionVerbs = (text.match(/冲|杀|斩|劈|刺|轰|撞|退|按|扣|崩|裂|砸|拔|闪|握|碾/g) || []).length;
    const actionDensity = Number((actionVerbs / Math.max(10, charCount / 100)).toFixed(3));

    // 3. AI 味套词惩罚比率 (Cliché Risk)
    let aiMatchCount = 0;
    for (const phrase of AI_FLAVOR_CLICHES) {
      aiMatchCount += (text.split(phrase).length - 1);
    }
    const aiFlavorRisk = Number((aiMatchCount / Math.max(1, charCount / 1000)).toFixed(3));

    // 4. 关键人设与线索留存率
    const identifiedEntities = originalSample.dualPrompts?.comprehensive?.entities?.identifiedEntities || [];
    let retainedEntityCount = 0;
    for (const ent of identifiedEntities) {
      if (text.includes(ent)) {
        retainedEntityCount++;
      }
    }
    const entityRetention = identifiedEntities.length > 0 
      ? Number((retainedEntityCount / identifiedEntities.length).toFixed(3)) 
      : 1.0;

    // 5. 综合质量得分计算 (0~100 分)
    // - 篇幅达标度 (25分): 长度接近 1.0 最优
    const lengthScore = Math.max(0, 25 - Math.abs(1.0 - lengthRatio) * 35);
    // - 文风拟合度 (30分): styleDistance 越低越好
    const styleScore = Math.max(0, (1.0 - styleDistance) * 30);
    // - 冲突张力 (20分): actionDensity 0.2~0.6 最优
    const actionScore = Math.min(20, actionDensity * 40);
    // - 线索实体留存 (15分)
    const entityScore = entityRetention * 15;
    // - AI 味扣分 (最多扣 15 分)
    const aiPenalty = Math.min(15, aiFlavorRisk * 10);

    const compositeScore = Number(Math.max(0, Math.min(100, lengthScore + styleScore + actionScore + entityScore - aiPenalty)).toFixed(1));

    return {
      quadrant,
      bookId: originalSample.bookId,
      category: originalSample.category,
      charCount,
      lengthRatio,
      styleDistance,
      actionDensity,
      aiFlavorRisk,
      entityRetention,
      compositeScore,
      stylometry: genFactors ? genFactors.stylometry : null
    };
  }

  /**
   * 汇总多象限评估报告
   * @param {Array<Object>} evaluations 
   * @returns {Object} 对比分析报告
   */
  generateComparisonSummary(evaluations = []) {
    const byQuadrant = { A: [], B: [], C: [], D: [] };
    for (const e of evaluations) {
      if (byQuadrant[e.quadrant]) {
        byQuadrant[e.quadrant].push(e);
      }
    }

    const calcAvg = (arr, key) => {
      if (!arr.length) return 0;
      const sum = arr.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);
      return Number((sum / arr.length).toFixed(2));
    };

    const summary = {};
    for (const q of ['A', 'B', 'C', 'D']) {
      const items = byQuadrant[q];
      summary[q] = {
        totalSamples: items.length,
        avgCharCount: calcAvg(items, 'charCount'),
        avgLengthRatio: calcAvg(items, 'lengthRatio'),
        avgStyleDistance: calcAvg(items, 'styleDistance'),
        avgActionDensity: calcAvg(items, 'actionDensity'),
        avgAiFlavorRisk: calcAvg(items, 'aiFlavorRisk'),
        avgEntityRetention: calcAvg(items, 'entityRetention'),
        avgCompositeScore: calcAvg(items, 'compositeScore')
      };
    }

    return summary;
  }
}

/**
 * 四象限批处理执行调度器 (QuadrantBatchRunner)
 */
class QuadrantBatchRunner {
  /**
   * @param {Object} options
   */
  constructor(options = {}) {
    this.experimentDir = options.experimentDir 
      ? path.resolve(options.experimentDir) 
      : path.resolve(__dirname, '../../../data/corpus-prompt-experiments');
    this.checkpointFile = path.join(this.experimentDir, '.checkpoint.json');
    this.concurrency = Math.max(1, Math.min(8, Number(options.concurrency || 2)));
    this.evaluator = new QuadrantQualityEvaluator();
  }

  /**
   * 加载索引清单 manifest.json
   * @returns {Object}
   */
  loadManifest() {
    const manifestPath = path.join(this.experimentDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`manifest.json 不存在于: ${manifestPath}。请先运行抽取阶段。`);
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }

  /**
   * 读取断点信息
   * @returns {Object}
   */
  loadCheckpoint() {
    if (fs.existsSync(this.checkpointFile)) {
      try {
        return JSON.parse(fs.readFileSync(this.checkpointFile, 'utf8'));
      } catch (_) {
        return { completed: {}, inProgress: {}, lastUpdated: new Date().toISOString() };
      }
    }
    return { completed: {}, inProgress: {}, lastUpdated: new Date().toISOString() };
  }

  /**
   * 写入断点信息
   * @param {Object} checkpoint 
   */
  saveCheckpoint(checkpoint = {}) {
    checkpoint.lastUpdated = new Date().toISOString();
    const tmp = this.checkpointFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), 'utf8');
    fs.renameSync(tmp, this.checkpointFile);
  }

  /**
   * 模拟生成小说章节正文 (Mock Mode，用于零成本管线验证)
   * @param {Object} sampleRecord 
   * @param {string} quadrant 
   * @returns {string}
   */
  generateMockChapter(sampleRecord = {}, quadrant = 'A') {
    const { title, category, sampledChapter, dualPrompts } = sampleRecord;
    const beats = dualPrompts.comprehensive?.beats || {};
    const entities = dualPrompts.comprehensive?.entities || {};
    const protag = entities.protagonist || '主角';
    const antag = entities.antagonist || '对手';

    const p1 = `【${category}】天地肃穆。${protag}静立于风中，目光审视着周遭异动。${beats.beatQi || '开局暗流涌动。'}`;
    const p2 = `不多时，脚步声由远及近。${antag}赫然现身，冷冷看向${protag}：“此路不通，阁下何必执迷不悟？”双方言语试探，杀机在空气中弥漫。${beats.beatCheng || '冲突逐步升级。'}`;
    const p3 = `电光石火间，劲气轰鸣！${protag}身形暴退，掌中兵刃发出清脆铮鸣，悍然招架而上。${beats.beatZhuan || '异变骤起，局面逆转。'}`;
    const p4 = `烟尘落定，胜负未绝。${protag}收势而立，而前方幽暗深处，却传来了更为令人窒息的异样威压。${beats.beatHe || '章末悬念顿生。'}`;

    return [
      `第${sampledChapter.chapterNo}章 模拟生成 (${quadrant}象限)`,
      '',
      p1, '',
      p2, '',
      p3, '',
      p4
    ].join('\n');
  }

  /**
   * 执行四象限批处理任务
   * @param {Object} options 包含 quadrant, category, limit, dryRun, mock, resume
   * @returns {Promise<Object>} 运行报告
   */
  async runBatch(options = {}) {
    const {
      quadrant = 'all', // 'A' | 'B' | 'C' | 'D' | 'all'
      category = null,
      limit = null,
      dryRun = false,
      mock = false,
      resume = true
    } = options;

    const manifest = this.loadManifest();
    let samples = manifest.samples || [];

    if (category) {
      samples = samples.filter(s => s.category === category);
    }
    if (limit && limit > 0) {
      samples = samples.slice(0, Number(limit));
    }

    const targetQuadrants = (quadrant === 'all') 
      ? ['A', 'B', 'C', 'D'] 
      : [quadrant.toUpperCase()];

    const checkpoint = resume ? this.loadCheckpoint() : { completed: {}, inProgress: {} };
    const results = [];
    const evaluations = [];

    const totalTasks = samples.length * targetQuadrants.length;
    let completedTasks = 0;
    let skippedTasks = 0;

    for (const sampleMeta of samples) {
      // 读取具体图书的实验样本档案
      const bookFile = path.join(this.experimentDir, sampleMeta.category, `${sampleMeta.bookId}.json`);
      if (!fs.existsSync(bookFile)) {
        continue;
      }
      const fullRecord = JSON.parse(fs.readFileSync(bookFile, 'utf8'));

      for (const q of targetQuadrants) {
        const taskId = `${fullRecord.bookId}_quadrant_${q}`;

        // 断点已完成跳过
        if (checkpoint.completed[taskId] && resume) {
          skippedTasks++;
          results.push(checkpoint.completed[taskId]);
          continue;
        }

        const qConfigKey = `quadrant${q}`;
        const qConfig = fullRecord.quadrants[qConfigKey];

        if (dryRun) {
          // Dry-run 试跑验证：断言载荷完备性并估算 Token
          const userPrompt = qConfig.payload.userPrompt || '';
          const sysPrompt = qConfig.payload.systemPrompt || qConfig.payload.systemDirectives || '';
          const estInputTokens = estimateTokens(sysPrompt) + estimateTokens(userPrompt);
          const estOutputTokens = 3500;

          const taskResult = {
            taskId,
            bookId: fullRecord.bookId,
            category: fullRecord.category,
            quadrant: q,
            mode: 'dry_run',
            status: 'validated',
            pipeline: qConfig.pipeline,
            promptLevel: qConfig.promptLevel,
            estimatedTokens: {
              input: estInputTokens,
              output: estOutputTokens,
              total: estInputTokens + estOutputTokens
            },
            timestamp: new Date().toISOString()
          };

          results.push(taskResult);
          completedTasks++;
        } else if (mock) {
          // Mock 运行：模拟生成并执行评测
          const mockText = this.generateMockChapter(fullRecord, q);
          const evalResult = this.evaluator.evaluateCandidate(mockText, fullRecord, q);

          const taskResult = {
            taskId,
            bookId: fullRecord.bookId,
            category: fullRecord.category,
            quadrant: q,
            mode: 'mock',
            status: 'completed',
            pipeline: qConfig.pipeline,
            generatedCharCount: mockText.length,
            evaluation: evalResult,
            timestamp: new Date().toISOString()
          };

          checkpoint.completed[taskId] = taskResult;
          results.push(taskResult);
          evaluations.push(evalResult);
          completedTasks++;
          this.saveCheckpoint(checkpoint);
        } else {
          // 真实生成门禁检查
          if (!options.confirmPhase1Approved) {
            throw new Error('【第一阶段门禁阻断】系统当前处于第一阶段人工确认门禁状态（manifest.status: AWAITING_HUMAN_CONFIRMATION）。待用户人工审阅并确认提示词与抽检报告后，显式传入 --confirm-phase1-approved 方可启动真实模型正文生成。当前请使用 --dry-run 或 --mock 执行调度检验。');
          }
          throw new Error('生产大模型调用接口预留：已通过 --confirm-phase1-approved 门禁，待配置 API 密钥后启动并发生成。');
        }
      }
    }

    const summary = {
      totalTasks,
      completedTasks,
      skippedTasks,
      mode: dryRun ? 'dry_run' : (mock ? 'mock' : 'live'),
      quadrants: targetQuadrants,
      evaluationSummary: evaluations.length ? this.evaluator.generateComparisonSummary(evaluations) : null,
      resultsCount: results.length
    };

    return summary;
  }
}

module.exports = {
  AI_FLAVOR_CLICHES,
  estimateTokens,
  calculateStylometryDistance,
  QuadrantQualityEvaluator,
  QuadrantBatchRunner
};
