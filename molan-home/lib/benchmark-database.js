'use strict';

/**
 * benchmark-database.js
 * ---------------------------------------------------------------------------
 * 网络小说「同类可比」Benchmark 数据库检索与分层匹配引擎。
 * 遵循“相似度优先于数量”与“严禁文本抄袭”原则。
 *
 * 五级分层匹配机制：
 *   Level 4/5: 细分流派/主角原型/开篇模式精准匹配（置信度 0.90~0.98）
 *   Level 2:   48 个细分题材标准基准（置信度 0.75~0.95）
 *   Level 1:   8 大叙事母类宏观基准平滑降级（置信度 0.60~0.90）
 * ---------------------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DB_DIR = path.join(__dirname, '..', 'data', 'benchmark-database');

let cachedDatabase = null;
let lastLoadedTime = 0;
const CACHE_TTL_MS = 60000; // 1 分钟缓存

/**
 * 加载并缓存 Benchmark 数据库
 */
function loadBenchmarkDatabase(dbDir = DEFAULT_DB_DIR) {
  const now = Date.now();
  if (cachedDatabase && (now - lastLoadedTime < CACHE_TTL_MS)) {
    return cachedDatabase;
  }

  if (!fs.existsSync(dbDir)) {
    return null;
  }

  try {
    const indexPath = path.join(dbDir, 'index.json');
    if (!fs.existsSync(indexPath)) return null;

    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const level1 = JSON.parse(fs.readFileSync(path.join(dbDir, 'level1-families.json'), 'utf8'));
    const level2 = JSON.parse(fs.readFileSync(path.join(dbDir, 'level2-subgenres.json'), 'utf8'));
    const level4 = JSON.parse(fs.readFileSync(path.join(dbDir, 'level4-archetypes.json'), 'utf8'));

    const allMap = new Map();
    [...level1, ...level2, ...level4].forEach(b => allMap.set(b.benchmark_id, b));

    cachedDatabase = {
      index,
      level1,
      level2,
      level4,
      allMap
    };
    lastLoadedTime = now;
    return cachedDatabase;
  } catch (err) {
    console.error('[benchmark-database] 加载失败:', err.message);
    return null;
  }
}

/**
 * 刷新重载数据库缓存
 */
function invalidateCache() {
  cachedDatabase = null;
  lastLoadedTime = 0;
}

/**
 * 根据 ID 获取指定 Benchmark
 */
function getBenchmarkById(benchmarkId, dbDir = DEFAULT_DB_DIR) {
  const db = loadBenchmarkDatabase(dbDir);
  if (!db) return null;
  return db.allMap.get(benchmarkId) || null;
}

/**
 * 列出 Benchmark 清单（支持按 level 或 genre 过滤）
 */
function listBenchmarks(filter = {}, dbDir = DEFAULT_DB_DIR) {
  const db = loadBenchmarkDatabase(dbDir);
  if (!db) return [];
  let list = Array.from(db.allMap.values());
  if (filter.level) {
    list = list.filter(b => b.level === filter.level);
  }
  if (filter.genre) {
    list = list.filter(b => b.genre === filter.genre || b.subgenre?.includes(filter.genre));
  }
  return list;
}

/**
 * 核心匹配算法：按“同类可比”与金字塔分层查找最匹配的 Benchmark
 * @param {Object} criteria 查询条件
 *   - genre: 一级母类或题材
 *   - subgenre: 二级细分题材
 *   - protagonistType: 主角原型 (如 '冷静理智型 / 谨慎藏拙')
 *   - openingMode: 开篇模式 ('scene' | 'dialogue' | 'exposition')
 *   - prompt: 创作提示词 (用于辅助推断流派)
 *   - allowFallback: 是否允许降级到 Level 2 / Level 1 (默认 true)
 */
function findComparableBenchmark(criteria = {}, dbDir = DEFAULT_DB_DIR) {
  const db = loadBenchmarkDatabase(dbDir);
  if (!db) return null;

  const reqGenre = String(criteria.genre || '').trim();
  const reqSubgenre = String(criteria.subgenre || '').trim();
  const reqProtagonist = String(criteria.protagonistType || '').trim();
  const promptText = String(criteria.prompt || '');

  // 1. 尝试 Level 4: 细分流派与主角原型匹配 (Highest Precision)
  for (const b of db.level4) {
    const genreMatch = (reqGenre && b.genre.includes(reqGenre)) || (reqSubgenre && b.subgenre.includes(reqSubgenre));
    const protagMatch = reqProtagonist && (
      b.protagonist_type.includes(reqProtagonist) ||
      reqProtagonist.includes(b.protagonist_type.split('/')[0].trim())
    );

    // 关键词意图命中（如"凡人"、"谨慎"、"气血"、"怪谈"、"避难所"、"魔药"、"密电"、"宅斗"）
    const keywordMatch = promptText && (
      (b.benchmark_id.includes('FANREN') && /凡人|谨慎|散修|藏拙|灵根/i.test(promptText)) ||
      (b.benchmark_id.includes('URBAN_MARTIAL') && /气血|高武|武考|体检/i.test(promptText)) ||
      (b.benchmark_id.includes('RULE_HORROR') && /怪谈|规则|异化|死局/i.test(promptText)) ||
      (b.benchmark_id.includes('WASTELAND') && /废土|避难所|重工|辐射/i.test(promptText)) ||
      (b.benchmark_id.includes('SEQUENCE') && /魔药|序列|维多利亚|蒸汽/i.test(promptText)) ||
      (b.benchmark_id.includes('SPY_CODE') && /谍战|密电|潜伏|破译/i.test(promptText)) ||
      (b.benchmark_id.includes('MANSION') && /月例|对牌|庶女|内宅|主母/i.test(promptText))
    );

    if ((genreMatch && protagMatch) || keywordMatch) {
      return {
        ...b,
        matchLevel: 'Level4_Pacing',
        matchType: keywordMatch ? 'archetype_keyword_exact' : 'archetype_protagonist_exact',
        downgraded: false
      };
    }
  }

  // 2. 尝试 Level 2: 细分题材基准匹配 (Subgenre Exact Match)
  if (reqSubgenre) {
    const matchedL2 = db.level2.find(b => b.subgenre === reqSubgenre || reqSubgenre.includes(b.subgenre) || b.subgenre.includes(reqSubgenre));
    if (matchedL2) {
      return {
        ...matchedL2,
        matchLevel: 'Level2_Subgenre',
        matchType: 'subgenre_exact',
        downgraded: false
      };
    }
  } else if (reqGenre) {
    // 仅提供 genre 时，精确命中某个二级细分题材才走 Level 2
    const exactL2 = db.level2.find(b => b.subgenre === reqGenre);
    if (exactL2) {
      return {
        ...exactL2,
        matchLevel: 'Level2_Subgenre',
        matchType: 'subgenre_exact',
        downgraded: false
      };
    }
  }

  // 3. 安全平滑降级到 Level 1: 8 大叙事母类基准 (Family Fallback)
  if (criteria.allowFallback !== false) {
    let matchedL1 = null;
    if (reqGenre) {
      matchedL1 = db.level1.find(b => b.genre === reqGenre || b.genre.includes(reqGenre) || reqGenre.includes(b.genre));
    }
    // 自动推断母类
    if (!matchedL1) {
      const allText = [reqGenre, reqSubgenre, promptText].join(' ');
      if (/修仙|修真|仙侠|玄幻|武侠/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '玄幻修真');
      else if (/高武|都市|商战|神豪/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '都市高武');
      else if (/末世|废土|星际|科幻/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '科幻末世');
      else if (/诡异|灵异|悬疑|惊悚/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '悬疑惊悚');
      else if (/历史|大明|三国|谍战/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '历史古代');
      else if (/奇幻|西幻|魔法|巫师/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '西方奇幻');
      else if (/古言|宫斗|宅斗|王爷/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '古言世情');
      else if (/甜宠|总裁|恋爱|婚恋/i.test(allText)) matchedL1 = db.level1.find(b => b.genre === '现代言情');
    }

    if (matchedL1) {
      return {
        ...matchedL1,
        matchLevel: 'Level1_Family',
        matchType: 'family_fallback',
        downgraded: true,
        downgradeReason: `未在数据库中找到题材【${reqSubgenre || reqGenre}】的高阶同流派样本，已平滑降级至母类【${matchedL1.genre}】综合基准。`
      };
    }
  }

  return null;
}

/**
 * 将同类可比 Benchmark 转换为注入给起草模型的样本统计观察块（≤300 字）
 */
function buildComparablePromptTarget(benchmark) {
  if (!benchmark || !benchmark.metrics_target) return '';
  const m = benchmark.metrics_target;
  const lines = [
    `【同类可比基准锚点（${benchmark.sample_count || 0} 本《${benchmark.subgenre}》样本观察；仅作参考，不构成目标或门禁）】`
  ];

  const chapterChars = m.chapterChars;
  if (Array.isArray(chapterChars) && chapterChars.length === 2 && chapterChars.every(Number.isFinite)) {
    lines.push(`- 样本章长范围约 ${chapterChars[0]}～${chapterChars[1]} 字；实际篇幅以本章合同和用户目标为准。`);
  }
  if (Number.isFinite(m.dialogueRatio) || Number.isFinite(m.dialogueTurnMean)) {
    const parts = [];
    if (Number.isFinite(m.dialogueRatio)) parts.push(`对白占比约 ${Math.round(m.dialogueRatio * 100)}%`);
    if (Number.isFinite(m.dialogueTurnMean)) parts.push(`单轮对白均值约 ${Math.round(m.dialogueTurnMean)} 字`);
    lines.push(`- 样本对白统计：${parts.join('，')}；按角色表达目的取舍，不规定统一对白长度。`);
  }
  if (Number.isFinite(m.sentenceLenMean)) {
    lines.push(`- 样本句长均值约 ${Math.round(m.sentenceLenMean)} 字，仅供节奏观察。`);
  }
  if (Number.isFinite(m.similePerKilo)) {
    lines.push(`- 样本明喻约 ${m.similePerKilo} 次/千字；不要求复用特定修辞或描写方式。`);
  }

  if (benchmark.friction_constraints) {
    lines.push(`- 样本物理阻力观察（先按当前作品设定判断是否适用）：${benchmark.friction_constraints}`);
  }
  if (benchmark.taboos) {
    lines.push(`- 样本避坑观察（不覆盖用户已确认的创作约束）：${benchmark.taboos}`);
  }

  return lines.join('\n');
}

/**
 * 获取数据库统计摘要
 */
function getDatabaseSummary(dbDir = DEFAULT_DB_DIR) {
  const db = loadBenchmarkDatabase(dbDir);
  if (!db) return { status: 'not_initialized', totalBenchmarks: 0 };
  return {
    status: 'ready',
    totalBenchmarks: db.allMap.size,
    countsByLevel: db.index.countsByLevel || {},
    availableGenres: Object.keys(db.index.byGenre || {}),
    availableSubgenres: Object.keys(db.index.bySubgenre || {}),
    availableArchetypes: Object.keys(db.index.byProtagonistType || {})
  };
}

/**
 * 获取质量特征工程基准区间分布
 */
function getQualityProfileDistribution(dbDir = DEFAULT_DB_DIR) {
  const distPath = path.join(dbDir, 'quality-profiles-distribution.json');
  if (!fs.existsSync(distPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(distPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 获取指定母类或细分题材的质量特征基线
 */
function getQualityProfileBaseline(genre = '', dbDir = DEFAULT_DB_DIR) {
  const dist = getQualityProfileDistribution(dbDir);
  if (!dist || !dist.families) return null;
  const requestedGenre = String(genre || '').trim();
  if (!requestedGenre) return null;
  if (dist.families[requestedGenre]) return dist.families[requestedGenre];
  // 查找子分类匹配
  for (const [famName, famData] of Object.entries(dist.families)) {
    if (famName.includes(requestedGenre) || requestedGenre.includes(famName)) {
      return famData;
    }
  }
  return null;
}

/**
 * 获取全局异常与报警门限
 */
function getQualityBoundaries(dbDir = DEFAULT_DB_DIR) {
  const dist = getQualityProfileDistribution(dbDir);
  return dist?.abnormalBounds || null;
}

const {
  loadGenreQualityBaselines,
  getGenreBaseline,
  getDetectionModeClassification,
  evaluateWithContext,
  GENRE_METRIC_DEFINITIONS
} = require('./genre-baseline-engine');

module.exports = {
  loadBenchmarkDatabase,
  getBenchmarkById,
  listBenchmarks,
  findComparableBenchmark,
  buildComparablePromptTarget,
  getDatabaseSummary,
  getQualityProfileDistribution,
  getQualityProfileBaseline,
  getQualityBoundaries,
  loadGenreQualityBaselines,
  getGenreQualityBaseline: getGenreBaseline,
  getDetectionModeClassification,
  evaluateWithContext,
  GENRE_METRIC_DEFINITIONS,
  invalidateCache
};
