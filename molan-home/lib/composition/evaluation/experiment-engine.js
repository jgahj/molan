'use strict';

/**
 * @file experiment-engine.js
 * 闭环实验引擎 (Closed-Loop Experiment Engine)
 * 
 * 核心架构目标：
 * 1. 协调 (Genre × Style × Goal × Focus × Hook) 5 维上下文下的 A/B 生成实验；
 * 2. 4 维独立多维客观打分：
 *    - causalScore (因果逻辑与状态跃迁完整度)
 *    - literaryScore (文学质感、感官细节与词汇丰富度)
 *    - aiFlavorRisk (AI 味套话风险惩罚)
 *    - tensionDelta (读者张力差量与悬念起伏)
 * 3. 计算双臂差量提升度 (Differential Lift = Arm A - Arm B)；
 * 4. 将差量实验结果反哺更新 StrategyCard 的 stats 与 evidenceStrength，并在兼容矩阵中登记实际协同样本。
 */

const fs = require('node:fs');
const path = require('node:path');
const { calculateStatisticalStrength, createStrategyCard } = require('../corpus/evidence-catalog');

// 典型 AI 恶习与套话词表
const AI_FLAVOR_CLICHE_PATTERNS = [
  /总之/g,
  /值得注意的是/g,
  /显而易见/g,
  /综上所述/g,
  /不难看出/g,
  /波澜壮阔/g,
  /画卷/g,
  /充满变数/g,
  /如同一道/g,
  /宛如/g,
  /深吸一口气/g,
  /眼神中闪过/g,
  /嘴角微微上扬/g,
  /心中暗想/g
];

// 因果与物理受力词汇模式
const CAUSAL_PHYSICAL_PATTERNS = [
  /因为|所以|借着|顺势|反手|反震|震得|犁出|崩裂|后撤|贴上|截断|止住|倒仰|位移|受力|断绝|唯有|死战/g
];

// 感官物证与文学细节词汇模式
const SENSORY_LITERARY_PATTERNS = [
  /烛台|石壁|茶盏|血花|沙石|刃口|微亮|发黄|青石|白气|廊柱|刀柄|铁甲|算盘|松木|指节|滴答/g
];

// 张力与危机词汇模式
const TENSION_CRISIS_PATTERNS = [
  /死战|杀机|惊天|死寂|冷笑|走不脱|狂涌|灼烧|腥甜|断江|咔嗒|危险|危机|变数|紧逼/g
];

class ExperimentEngine {
  constructor(options = {}) {
    this.compatibilityMatrix = options.compatibilityMatrix || null;
    this.persistencePath = options.persistencePath || options.storagePath || options.journalPath || null;
    this.synergyRecords = new Map();

    if (this.persistencePath) {
      this.loadSynergyRecords(this.persistencePath);
    }
  }

  /**
   * 4-Axis Multi-Dimensional Scoring
   * @param {Object} input
   * @param {string} input.text
   * @param {Object} input.context
   * @returns {Promise<Object>}
   */
  async evaluateCandidate(input = {}) {
    const text = String(input.text || '').trim();
    if (!text) {
      return {
        causalScore: 0,
        literaryScore: 0,
        aiFlavorRisk: 0,
        tensionDelta: 0,
        compositeScore: 0
      };
    }

    const context = input.context || {};

    // 1. aiFlavorRisk: 检测典型套话与空洞修饰
    let aiClicheCount = 0;
    for (const pat of AI_FLAVOR_CLICHE_PATTERNS) {
      const m = text.match(pat);
      if (m) aiClicheCount += m.length;
    }
    const aiFlavorRisk = Number(Math.min(1.0, aiClicheCount * 0.15).toFixed(3));

    // 2. causalScore: 因果推导、物理反馈与状态偏转
    let causalHits = 0;
    for (const pat of CAUSAL_PHYSICAL_PATTERNS) {
      const m = text.match(pat);
      if (m) causalHits += m.length;
    }
    const isGenericBrawl = /杀了你|砍死了|打了起来|各种法术/.test(text);
    const baseCausal = isGenericBrawl ? 0.25 : 0.60;
    const causalScore = Number(Math.min(0.95, Math.max(0.1, baseCausal + causalHits * 0.08 - (isGenericBrawl ? 0.1 : 0))).toFixed(3));

    // 3. literaryScore: 感官物证与文学质感
    let sensoryHits = 0;
    for (const pat of SENSORY_LITERARY_PATTERNS) {
      const m = text.match(pat);
      if (m) sensoryHits += m.length;
    }
    const isGenericDialogue = /对话|说：/.test(text) && sensoryHits === 0;
    const baseLiterary = isGenericDialogue ? 0.20 : 0.55;
    const literaryScore = Number(Math.min(0.95, Math.max(0.1, baseLiterary + sensoryHits * 0.10 - (isGenericDialogue ? 0.15 : 0))).toFixed(3));

    // 4. tensionDelta: 张力与悬念波动 (-0.5 ~ +0.8)
    let tensionHits = 0;
    for (const pat of TENSION_CRISIS_PATTERNS) {
      const m = text.match(pat);
      if (m) tensionHits += m.length;
    }
    const tensionDelta = Number((Math.min(0.8, Math.max(-0.4, (tensionHits * 0.15) - (aiFlavorRisk * 0.30) + 0.10))).toFixed(3));

    // 5. 综合复合评分 (Composite Score)
    const rawComposite = 0.35 * causalScore + 0.35 * literaryScore + 0.30 * Math.max(0, tensionDelta + 0.5) - (aiFlavorRisk * 0.60);
    const compositeScore = Number(Math.max(0.01, Math.min(1.0, rawComposite)).toFixed(3));

    return {
      causalScore,
      literaryScore,
      aiFlavorRisk,
      tensionDelta,
      compositeScore
    };
  }

  /**
   * 协调 A/B 候选生成实验并计算双臂差量
   * @param {Object} params
   * @param {Object} params.armA Treatment 候选
   * @param {Object} params.armB Control 候选
   * @param {Object} params.context 实验上下文
   * @returns {Promise<Object>}
   */
  async runExperiment(params = {}) {
    const { armA = {}, armB = {}, context = {} } = params;
    const textA = armA.draftText || armA.text || '';
    const textB = armB.draftText || armB.text || '';

    const evalA = await this.evaluateCandidate({ text: textA, context });
    const evalB = await this.evaluateCandidate({ text: textB, context });

    let overallLift = 0;
    let causalDelta = 0;
    let literaryDelta = 0;
    let aiFlavorDelta = 0;
    let tensionDelta = 0;

    if (textA !== textB) {
      overallLift = Number((evalA.compositeScore - evalB.compositeScore).toFixed(4));
      causalDelta = Number((evalA.causalScore - evalB.causalScore).toFixed(4));
      literaryDelta = Number((evalA.literaryScore - evalB.literaryScore).toFixed(4));
      aiFlavorDelta = Number((evalA.aiFlavorRisk - evalB.aiFlavorRisk).toFixed(4));
      tensionDelta = Number((evalA.tensionDelta - evalB.tensionDelta).toFixed(4));
    }

    const differential = {
      overallLift,
      causalDelta,
      literaryDelta,
      aiFlavorDelta,
      tensionDelta
    };

    return {
      evaluationA: evalA,
      evaluationB: evalB,
      differential,
      context,
      armA,
      armB
    };
  }

  /**
   * 将实验差量反哺回 StrategyCard，触发统计指标演进与等级重估
   * @param {Object} params
   * @param {Object} params.strategyCard 待演进策略卡
   * @param {Object} params.differential 实验差量
   * @returns {Promise<Object>} 升级/降级后的策略卡
   */
  async feedBackDifferential(params = {}) {
    const { strategyCard, differential = {} } = params;
    if (!strategyCard) throw new Error('strategyCard 必须提供');

    const card = { ...strategyCard };
    const stats = { ...(card.stats || {}) };

    const lift = typeof differential.overallLift === 'number' ? differential.overallLift : 0;

    // 每次实验样本量自增
    stats.supportCount = (stats.supportCount || 0) + 1;

    // 质量提升度平滑移动平均
    const prevLift = Number(stats.qualityLift ?? 0.1);
    stats.qualityLift = Number(Math.max(-1.0, Math.min(1.0, prevLift + lift * 0.4)).toFixed(3));

    // 置信度与混杂度演进
    const prevConf = Number(stats.confidence ?? 0.85);
    if (lift > 0) {
      stats.confidence = Number(Math.min(1.0, prevConf + 0.05).toFixed(3));
    } else if (lift < 0) {
      stats.confidence = Number(Math.max(0.1, prevConf - 0.20).toFixed(3));
    }

    // 严重负差量时惩罚提升度使其 <= 0，确保触发降级硬门禁
    if (lift < -0.2) {
      stats.qualityLift = Number(Math.min(-0.05, stats.qualityLift).toFixed(3));
    }

    // 重新根据严格证据门禁计算 evidenceStrength
    const newStrength = calculateStatisticalStrength(stats);

    card.stats = stats;
    card.evidenceStrength = newStrength;

    return createStrategyCard(card);
  }

  /**
   * 从 JSONL 磁盘日志文件恢复协同记录 (启动恢复)
   * @param {string} filePath 文件路径
   * @returns {number} 成功恢复的记录数
   */
  loadSynergyRecords(filePath = this.persistencePath) {
    if (!filePath) return 0;
    try {
      if (!fs.existsSync(filePath)) return 0;
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
      let count = 0;
      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (record && record.key && typeof record.observedLift === 'number' && Number.isFinite(record.observedLift)) {
            this.synergyRecords.set(record.key, record.observedLift);
            count++;
          }
        } catch (_) {
          // 容错处理损坏行
        }
      }
      return count;
    } catch (_) {
      return 0;
    }
  }

  /**
   * 追加写单条记录到 JSONL 磁盘文件 (追加写日志)
   * @param {Object} record 待持久化实体
   * @param {string} filePath 文件路径
   */
  appendSynergyRecord(record, filePath = this.persistencePath) {
    if (!filePath || !record) return;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const line = JSON.stringify(record) + '\n';
      fs.appendFileSync(filePath, line, 'utf8');
    } catch (_) {
      // 容错降级，不阻塞内存主流程
    }
  }

  /**
   * 将当前内存中的全部协同记录持久化写入目标 JSONL 文件
   * @param {string} filePath 文件路径
   * @returns {number} 写入条目数
   */
  flushSynergyRecords(filePath = this.persistencePath) {
    if (!filePath) return 0;
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const lines = [];
      for (const [key, observedLift] of this.synergyRecords.entries()) {
        lines.push(JSON.stringify({ key, observedLift, flushedAt: new Date().toISOString() }));
      }
      fs.writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
      return lines.length;
    } catch (_) {
      return 0;
    }
  }

  /**
   * 查询协同提升度记录（支持字符串 key 或元组查询对象）
   * @param {string|Object} keyOrParams 键值或包含 tuple/strategyId 的参数对象
   * @returns {number|null}
   */
  getSynergyLift(keyOrParams) {
    if (typeof keyOrParams === 'string') {
      return this.synergyRecords.get(keyOrParams) ?? null;
    }
    if (keyOrParams && typeof keyOrParams === 'object') {
      const tuple = keyOrParams.tuple || keyOrParams;
      const strategyId = keyOrParams.strategyId || '';
      const key = [
        tuple.genre || '*',
        tuple.style || '*',
        tuple.chapterGoal || '*',
        tuple.focus || '*',
        tuple.hook || '*',
        strategyId || '*'
      ].join('::');
      return this.synergyRecords.get(key) ?? null;
    }
    return null;
  }

  /**
   * 记录 5 维上下文元组的协同提升度（支持追加写磁盘日志）
   * @param {Object} params
   * @returns {Promise<Object>}
   */
  async recordCompatibilitySynergy(params = {}) {
    const { tuple = {}, strategyId = '', observedLift = 0 } = params;
    const key = [
      tuple.genre || '*',
      tuple.style || '*',
      tuple.chapterGoal || '*',
      tuple.focus || '*',
      tuple.hook || '*',
      strategyId || '*'
    ].join('::');

    this.synergyRecords.set(key, observedLift);

    const record = {
      key,
      tuple,
      strategyId,
      observedLift,
      recordedAt: new Date().toISOString()
    };

    const targetPath = params.persistencePath || this.persistencePath;
    if (targetPath) {
      if (!this.persistencePath) {
        this.persistencePath = targetPath;
      }
      this.appendSynergyRecord(record, targetPath);
    }

    return {
      success: true,
      tuple,
      strategyId,
      observedLift,
      key,
      persisted: Boolean(targetPath)
    };
  }
}

module.exports = {
  ExperimentEngine,
  AI_FLAVOR_CLICHE_PATTERNS,
  CAUSAL_PHYSICAL_PATTERNS,
  SENSORY_LITERARY_PATTERNS,
  TENSION_CRISIS_PATTERNS
};
