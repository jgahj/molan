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
    const origCharCount = origText.length 
      || originalSample.sampledChapter?.charCount 
      || originalSample.charCount 
      || 3000;
    const lengthRatio = Number((charCount / Math.max(1, origCharCount)).toFixed(3));

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
    const nonce = Math.random().toString(36).slice(2);
    const tmp = `${this.checkpointFile}.${process.pid}.${Date.now()}.${nonce}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), 'utf8');
    try {
      fs.renameSync(tmp, this.checkpointFile);
    } catch (_) {
      try {
        fs.copyFileSync(tmp, this.checkpointFile);
        fs.unlinkSync(tmp);
      } catch (e) {}
    }
  }

  /**
   * 模拟生成小说章节正文 (Mock Mode，用于零成本管线验证)
   * 按象限真实模拟不同链路的生成特征：
   * - 象限 A (实验组 A): 墨阑管线智能补全，动作密度高，篇幅饱满 (~2400~2800字)，无 AI 套词
   * - 象限 B (实验组 B): 墨阑全规格生成，高保真文风对齐，篇幅完美契合 (~2800~3400字)，因果位移明确，最高得分
   * - 象限 C (对照组 C): 大模型单轮直出+极简Prompt，篇幅短小 (~900~1300字)，结构散乱，经典 AI 味套词高发
   * - 象限 D (对照组 D): 大模型单轮直出+完整Prompt，中等篇幅 (~1800~2300字)，规则依从度衰减，轻微套词
   * @param {Object} sampleRecord 
   * @param {string} quadrant 
   * @returns {string}
   */
  generateMockChapter(sampleRecord = {}, quadrant = 'A') {
    const { category, sampledChapter, dualPrompts } = sampleRecord;
    const comp = dualPrompts?.comprehensive || {};
    const beats = comp.beats || {};
    const entities = comp.entities || {};
    const protag = entities.protagonist || '主角';
    const antag = entities.antagonist || '对手';
    const allies = entities.allies || [];
    const allyName = allies[0] || '身旁随从';

    const targetChapterNo = sampledChapter?.chapterNo || 1;
    const baseActionSentence = `${protag}反手拔刀，刀芒破空横扫，劲气震碎青石！${antag}踏步侧身，铁拳轰然砸落，火星在雨幕中炸开。`;

    if (quadrant === 'B') {
      // 象限 B (实验组 B): 墨阑完整链路 + 完整提示词
      const p1 = `【${category}】夜色如墨，阴风怒号。${protag}按刀驻足，目光扫过四周暗影。${beats.beatQi || '开局暗流汹涌，即时危机逼近。'}风声呼啸，长阶之上的杀机已然攀至顶点。`;
      const p2 = `“${protag}，交出账册，留你全尸。”阴影之中，${antag}缓步而出，身后黑压压的刀手列阵而立。${allyName}低声告诫：“小心有诈，此人早有埋伏。”${beats.beatCheng || '局势升级，冲突全面激化。'}`;
      const p3 = `${baseActionSentence}双方接连交手三十余合，刀光剑影呼啸交错，鲜血飞溅在残破门楣之上。${beats.beatZhuan || '异变陡生，局面急转直下。'}`;
      const p4 = `硝烟散尽，胜负初分。${protag}以刀柱地，而废墟深处却传来阵阵异样心跳声，更大的隐患已然降临。${beats.beatHe || '章末悬念高悬，留下致命线索缺口。'}`;
      const repeatParagraph = `劲风掠过断壁残垣，四周草木尽折。${protag}眼神冷冽，步步为营。双方机锋相对，每一寸空气都凝结着森寒杀意。${baseActionSentence}`;
      const fillers = Array(6).fill(repeatParagraph).join('\n\n');
      return [
        `第${targetChapterNo}章 策略全景高保真生成 (B象限)`,
        '',
        p1, '',
        p2, '',
        fillers, '',
        p3, '',
        p4
      ].join('\n');
    } else if (quadrant === 'A') {
      // 象限 A (实验组 A): 墨阑完整链路 + 极简提示词
      const p1 = `【${category}】冷雨初歇，青石长街升起雾气。${protag}独立于街口，四下悄无声息。${beats.beatQi || '局势暗流涌动。'}`;
      const p2 = `街角传来沉重脚步，${antag}带着森然杀意现身：“阁下今日插翅难飞。”言语试探间，两道身影霍然相撞！${beats.beatCheng || '冲突激化。'}`;
      const p3 = `${baseActionSentence}${beats.beatZhuan || '局面发生关键转折。'}`;
      const p4 = `长街重新归于死寂，${protag}收刃入鞘，然而夜幕深处却浮现出更为诡谲的危机。${beats.beatHe || '章末悬念。'}`;
      const repeatParagraph = `刀刃交击之音清脆刺耳，劲风激荡四野。${protag}闪身欺近，拳风如雷，震退阻力。`;
      const fillers = Array(4).fill(repeatParagraph).join('\n\n');
      return [
        `第${targetChapterNo}章 墨阑智能补全生成 (A象限)`,
        '',
        p1, '',
        p2, '',
        fillers, '',
        p3, '',
        p4
      ].join('\n');
    } else if (quadrant === 'D') {
      // 象限 D (对照组 D): 大模型单轮直出 + 完整提示词
      const p1 = `【${category}】天地肃穆。${protag}深吸一口气，心中暗道不妙。${beats.beatQi || '开局平稳。'}`;
      const p2 = `${antag}面色微变，冷冷看向${protag}，二人展开试探。${beats.beatCheng || '双方开始对话博弈。'}`;
      const p3 = `电光石火间，二人招式交锋。${protag}身形退后三步，深吸一口气，神色凝重。${beats.beatZhuan || '转折发生。'}`;
      const p4 = `一切暂时平息，胜负未明。${beats.beatHe || '章末等待后续。'}`;
      const repeatParagraph = `四周空气凝重，气氛变得微妙起来。二人对视一眼，各自揣摩着对方的用意。`;
      const fillers = Array(3).fill(repeatParagraph).join('\n\n');
      return [
        `第${targetChapterNo}章 大模型单轮直出 (D象限)`,
        '',
        p1, '',
        p2, '',
        fillers, '',
        p3, '',
        p4
      ].join('\n');
    } else {
      // 象限 C (对照组 C): 大模型单轮直出 + 极简提示词
      const p1 = `【${category}】林间静悄悄的。${protag}嘴角勾起一抹玩味的笑容，眼神中闪过一丝冷厉。${beats.beatQi || '故事开始。'}`;
      const p2 = `${antag}倒吸一口凉气，瞳孔骤缩：“你竟然没死？！”心中的震惊无以复加。${beats.beatCheng || '对手震惊。'}`;
      const p3 = `${protag}冷笑一声，闪电般出手，空气中仿佛在诉说方才的凶险。${beats.beatZhuan || '产生转折。'}`;
      const p4 = `风声呼啸，天地为之变色。究竟接下来会如何，谁也说不清。${beats.beatHe || '留下悬念。'}`;
      return [
        `第${targetChapterNo}章 大模型单轮直出 (C象限)`,
        '',
        p1, '',
        p2, '',
        p3, '',
        p4
      ].join('\n');
    }
  }

  /**
   * 执行四象限批处理任务
   * @param {Object} options 包含 quadrant, category, limit, dryRun, mock, resume, concurrency, confirmPhase1Approved, generator
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

    const targetConcurrency = Math.max(1, Math.min(16, Number(options.concurrency || this.concurrency || 2)));
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

    // 1. 构建所有待运行任务清单
    const pendingTasks = [];
    for (const sampleMeta of samples) {
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
          if (checkpoint.completed[taskId].evaluation) {
            evaluations.push(checkpoint.completed[taskId].evaluation);
          }
          continue;
        }

        const qConfigKey = `quadrant${q}`;
        const qConfig = (fullRecord.quadrants && fullRecord.quadrants[qConfigKey])
          ? fullRecord.quadrants[qConfigKey]
          : { quadrant: q, pipeline: 'generic', promptLevel: 'default', payload: {} };

        pendingTasks.push({
          taskId,
          fullRecord,
          quadrant: q,
          qConfig
        });
      }
    }

    // 2. 使用并发 Worker 池并行调度任务
    let taskIdx = 0;
    const workerCount = Math.min(targetConcurrency, pendingTasks.length || 1);
    const workers = Array.from({ length: workerCount }, async () => {
      while (taskIdx < pendingTasks.length) {
        const currentTask = pendingTasks[taskIdx++];
        const { taskId, fullRecord, quadrant: q, qConfig } = currentTask;

        if (dryRun) {
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

          if (typeof options.generator === 'function') {
            const liveText = await options.generator({ sampleRecord: fullRecord, quadrant: q, qConfig, taskId });
            const evalResult = this.evaluator.evaluateCandidate(liveText, fullRecord, q);
            const taskResult = {
              taskId,
              bookId: fullRecord.bookId,
              category: fullRecord.category,
              quadrant: q,
              mode: 'live',
              status: 'completed',
              pipeline: qConfig.pipeline,
              generatedCharCount: (liveText || '').length,
              evaluation: evalResult,
              timestamp: new Date().toISOString()
            };
            checkpoint.completed[taskId] = taskResult;
            results.push(taskResult);
            evaluations.push(evalResult);
            completedTasks++;
            this.saveCheckpoint(checkpoint);
          } else {
            throw new Error('【真实生成待就绪】已通过 --confirm-phase1-approved 门禁。未配置 options.generator 或未检测到大模型 API 凭证 (如 GEMINI_API_KEY / OPENAI_API_KEY)。请配置相关凭据或生成回调后启动生产并发生成。');
          }
        }
      }
    });

    await Promise.all(workers);

    const summary = {
      totalTasks,
      completedTasks,
      skippedTasks,
      concurrency: targetConcurrency,
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
