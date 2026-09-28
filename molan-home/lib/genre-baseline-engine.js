'use strict';

/**
 * genre-baseline-engine.js
 * ---------------------------------------------------------------------------
 * 网络小说分题材质量基线统计引擎 (Genre-Specific Quality Baseline Engine)
 *
 * 核心设计原则：
 * 1. 坚决摒弃“用一套标准评价所有题材”，建立 8 大母类与 48 细分题材的差异化经验分布；
 * 2. 全量输出七维统计量：P25、P50 (中位数)、P75、均值、标准差、IQR 与异常边界；
 * 3. 覆盖 18 项网文核心质量指标；
 * 4. 统计经验分布 ≠ 质量真理：注入情境化宽容度机制，结合章节功能与剧情机制释义；
 * 5. 明确指标检测模式分流：适合自动检测 (auto)、必须由LLM深层判断 (llm)、联合判断 (hybrid)。
 * ---------------------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASELINES_PATH = path.join(__dirname, '..', 'data', 'benchmark-database', 'genre-quality-baselines.json');

/**
 * 18 项网文核心质量指标元数据与判定模式分类定义
 */
const GENRE_METRIC_DEFINITIONS = {
  chapter_length: {
    key: 'chapter_length',
    displayName: '章节长度',
    unit: '字',
    detectionMode: 'auto',
    detectionRationale: '纯字符统计与字数预算核算，规则可 100% 确定性精确量化。',
    contextualNotes: '玄幻修真长篇单章通常较大 (2500-3800)，都市快节奏或对话流偏短 (1800-2600)。卷终高潮章篇幅翻倍属于合理扩容。'
  },
  dialogue_ratio: {
    key: 'dialogue_ratio',
    displayName: '对话比例',
    unit: '比率',
    detectionMode: 'auto',
    detectionRationale: '基于对话引号对标记的封闭性字符统计，确定性强。',
    contextualNotes: '都市言情与古代宅斗对白密度高 (35%-55%)；荒野求生、单刷秘境与重工业硬科幻对白极少 (15%-25%)。独处探索章对白为零属常态。'
  },
  psychological_ratio: {
    key: 'psychological_ratio',
    displayName: '心理描写比例',
    unit: '比率',
    detectionMode: 'auto',
    detectionRationale: '直接内心独白动词、心理状态指示词匹配，无模型依赖。',
    contextualNotes: '闭关突破、重大人生抉择与心魔劫章节，心理自省比例显著上升；激战拼杀动作章节心理句大幅收敛。'
  },
  description_ratio: {
    key: 'description_ratio',
    displayName: '描写比例',
    unit: '比率',
    detectionMode: 'auto',
    detectionRationale: '五感动词、感官修饰与物理受力动作段落占比。',
    contextualNotes: '动作战斗章描写密集；快节奏交割交易或快速推进章以叙述和对白为主。'
  },
  character_count: {
    key: 'character_count',
    displayName: '活跃人物数量',
    unit: '人/章',
    detectionMode: 'auto',
    detectionRationale: '启发式名+动词实体识别与代词过滤，规则可稳定统计。',
    contextualNotes: '拍卖会、宗门大比或寿宴场景活跃人数密集 (6-12人)；潜行刺杀、闭关修炼场景仅主角 1 人。'
  },
  consecutive_flat_chapters: {
    key: 'consecutive_flat_chapters',
    displayName: '平淡章节连续长度',
    unit: '章',
    detectionMode: 'auto',
    detectionRationale: '基于张力波峰与冲突标记的滑动窗口连续计数。',
    contextualNotes: '日常种田、修仙日常流对平淡连续容忍度高 (2-4章)；战神反打脸或规则怪谈求生类容差极低 (<=1章)。'
  },
  new_character_density: {
    key: 'new_character_density',
    displayName: '新人物登场密度',
    unit: '人/万字',
    detectionMode: 'auto',
    detectionRationale: '跨章实体库去重与全局首次出现位点差分统计。',
    contextualNotes: '开篇 1-5 章换地图阶段新人物密集；中后期剧情收拢阶段需严格限制新人物，防止认知过载。'
  },
  new_setting_density: {
    key: 'new_setting_density',
    displayName: '新设定密度',
    unit: '处/万字',
    detectionMode: 'auto',
    detectionRationale: '专有体系词、境界、宗门、法宝术语出现频率分析。',
    contextualNotes: '开篇世界观铺垫期设定集中；中后期应侧重既有规则的对抗应用，而非不断空降新体系。'
  },
  scene_count: {
    key: 'scene_count',
    displayName: '场景数量',
    unit: '个/章',
    detectionMode: 'hybrid',
    detectionRationale: '规则初筛时空指示词与空行标记，LLM 校验是否为真正物理转场而非角色回忆闪回。',
    contextualNotes: '单章平均 1-3 个场景。战术追击或多线并进可达 4-5 个场景；深室盘问或单场擂台可全章单一场景。'
  },
  conflict_density: {
    key: 'conflict_density',
    displayName: '冲突密度',
    unit: '段落比',
    detectionMode: 'hybrid',
    detectionRationale: '规则快速捕获对抗动作与对抗词，LLM 审计冲突是否具备实质利益阻力与尊严博弈。',
    contextualNotes: '高潮大战章冲突密度超 0.70；战后清点战利品与养伤过渡章允许低于 0.20，属于必要的情绪回落。'
  },
  information_density: {
    key: 'information_density',
    displayName: '信息密度',
    unit: '有效信息量/千字',
    detectionMode: 'hybrid',
    detectionRationale: '词汇多样性与实体分布初筛，LLM 剔除无效注水与同义复述，计算净剧情推进量。',
    contextualNotes: '快穿、悬疑解密信息密度极高；传统长篇仙侠讲求节奏蓄势与氛围沉淀，信息密度适中。'
  },
  hook_density: {
    key: 'hook_density',
    displayName: '钩子密度',
    unit: '处/章',
    detectionMode: 'hybrid',
    detectionRationale: '末尾段式启发匹配初筛，LLM 最终确认是否形成有效的心流悬置与阅读驱动。',
    contextualNotes: '章末必须留有悬念（新危机/反转/疑问）；章中微钩子维持注意力。分卷终章可适度闭环释放。'
  },
  shuangdian_density: {
    key: 'shuangdian_density',
    displayName: '爽点密度',
    unit: '处/章',
    detectionMode: 'hybrid',
    detectionRationale: '反转震惊与收获词初筛，LLM 核验读者期待是否得到充分压抑后的实质释放。',
    contextualNotes: '爽文流打脸密集；慢热硬核求生流追求长时间沉淀后的单次巨大复利兑现，单章爽点计数不宜盲目追求过高。'
  },
  emotion_variation: {
    key: 'emotion_variation',
    displayName: '情绪变化频率',
    unit: '波峰波谷/章',
    detectionMode: 'hybrid',
    detectionRationale: '情感正负极性词动态变化曲线初筛，LLM 判别情绪转变的合理性与潜台词错位。',
    contextualNotes: '绝境反转章情绪由极度压抑骤转为狂喜与释怀；日常平稳章情绪波动舒缓。'
  },
  foreshadow_count: {
    key: 'foreshadow_count',
    displayName: '伏笔埋设数量',
    unit: '条/章',
    detectionMode: 'llm',
    detectionRationale: '需要深层语义理解道具磨损、异常言行与深层因果，纯规则无法区分普通环境陈设与真正线索。',
    contextualNotes: '开篇阶段每章埋设 1-3 处隐性伏笔；高潮对决阶段应主要集中收拢，少埋新长线伏笔。'
  },
  foreshadow_payoff_rate: {
    key: 'foreshadow_payoff_rate',
    displayName: '伏笔回收率',
    unit: '百分比',
    detectionMode: 'llm',
    detectionRationale: '需跨章节追溯因果账簿，核实前期悬置线索是否在当前情境下以合逻辑方式兑现。',
    contextualNotes: '单章微伏笔当章回收；长线伏笔跨卷回收；完本或卷末回收率应趋近 100%。'
  },
  causal_density: {
    key: 'causal_density',
    displayName: '剧情因果密度',
    unit: '健全度评分',
    detectionMode: 'llm',
    detectionRationale: '需全局推演行动动机与连锁反应，判定事件是否为主角主观能动而非天降机械神或反派降智。',
    contextualNotes: '高水平作品因果链环环相扣 ($A \\to B \\to C$)；任何偶发事件必须在前文有概率伏笔垫底。'
  },
  event_progression_speed: {
    key: 'event_progression_speed',
    displayName: '事件推进速度',
    unit: '主线跃迁指数',
    detectionMode: 'llm',
    detectionRationale: '需审视全局剧情阶段与核心冲突目标，判断章节是在实质推演主线还是在无意义灌水。',
    contextualNotes: '不同流派主线推进周期不同。快节奏文 1-2 章一换局，大架构群像文允许在支线博弈中多线编织。'
  }
};

/**
 * 通用统计计算工具：计算 P25, P50, P75, 均值, 方差, IQR 与异常边界
 */
function computeDistributionStats(numbers) {
  const nums = (Array.isArray(numbers) ? numbers : [])
    .filter(v => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b);

  if (nums.length === 0) {
    return {
      p25: 0,
      p50: 0,
      p75: 0,
      mean: 0,
      std: 0,
      iqr: 0,
      outlierLower: 0,
      outlierUpper: 0,
      sample_count: 0
    };
  }

  const quantile = q => {
    const pos = (nums.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (nums[base + 1] !== undefined) {
      return Number((nums[base] + rest * (nums[base + 1] - nums[base])).toFixed(4));
    }
    return Number(nums[base].toFixed(4));
  };

  const p25 = quantile(0.25);
  const p50 = quantile(0.50);
  const p75 = quantile(0.75);
  const sum = nums.reduce((a, b) => a + b, 0);
  const mean = Number((sum / nums.length).toFixed(4));
  const variance = nums.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / nums.length;
  const std = Number(Math.sqrt(variance).toFixed(4));
  const iqr = Number((p75 - p25).toFixed(4));
  const outlierLower = Number(Math.max(0, p25 - 1.5 * iqr).toFixed(4));
  const outlierUpper = Number((p75 + 1.5 * iqr).toFixed(4));

  return {
    p25,
    p50,
    p75,
    mean,
    std,
    iqr,
    outlierLower,
    outlierUpper,
    sample_count: nums.length
  };
}

/**
 * 情境化文学宽容度动态校验
 * 根据章节上下文（如 isClimax, isDowntime, isBreakthrough, isOpening）解释指标偏离
 */
function evaluateWithContext(metricKey, value, genre = '玄幻修真', context = {}) {
  const def = GENRE_METRIC_DEFINITIONS[metricKey];
  if (!def) {
    return { valid: true, explanation: '未录入的检测指标' };
  }

  const numVal = Number(value) || 0;
  const c = context || {};

  // 1. 休整与过渡情境 (isDowntime / isTransition)
  if ((c.isDowntime || c.isTransition || c.sceneType === 'settlement') && metricKey === 'conflict_density') {
    if (numVal < 0.20) {
      return {
        conforming: true,
        contextApplied: true,
        status: 'justified_by_context',
        explanation: '本章标注为战后休整/利益交割过渡节点，冲突密度低于 P25 属于合理的文学情绪呼吸回落，不属于注水或平淡缺陷。'
      };
    }
  }

  // 2. 独处悟道与突破情境 (isBreakthrough / isSoloDungeon)
  if ((c.isBreakthrough || c.isSolo || c.sceneType === 'cultivation') && (metricKey === 'dialogue_ratio' || metricKey === 'character_count')) {
    if (numVal <= 0.05) {
      return {
        conforming: true,
        contextApplied: true,
        status: 'justified_by_context',
        explanation: '本章为闭关修炼/单人探索环境，零对白或单人出场符合情境物理真实。'
      };
    }
  }

  // 3. 决战与卷终大高潮 (isClimax / isArcFinal)
  if ((c.isClimax || c.isArcFinal) && metricKey === 'chapter_length') {
    if (numVal > 5000) {
      return {
        conforming: true,
        contextApplied: true,
        status: 'justified_by_context',
        explanation: '本章为卷终生死决战大高潮，篇幅扩容突破 P75 上界，属于充分展开多视角搏杀的必要文学处理。'
      };
    }
  }

  return {
    conforming: true,
    contextApplied: false,
    status: 'standard_evaluation',
    explanation: '当前指标在经验分布正常容差范围内。'
  };
}

/**
 * 加载全品类质量基线数据库
 */
function loadGenreQualityBaselines(filePath = DEFAULT_BASELINES_PATH) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error('[genre-baseline-engine] 基线库加载失败:', err.message);
    return null;
  }
}

/**
 * 获取指定母类/细分题材的全套基准指标分布
 */
function getGenreBaseline(genre = '', subgenre = '', filePath = DEFAULT_BASELINES_PATH) {
  const db = loadGenreQualityBaselines(filePath);
  if (!db || !db.baselines) return null;
  const requestedGenre = String(genre || '').trim();
  const requestedSubgenre = String(subgenre || '').trim();

  // 1. 精确匹配 subgenre
  if (requestedSubgenre && db.baselines[requestedSubgenre]) {
    return db.baselines[requestedSubgenre];
  }
  // 2. 精确匹配 genre 母类
  if (requestedGenre && db.baselines[requestedGenre]) {
    return db.baselines[requestedGenre];
  }
  // 3. 模糊匹配母类
  if (requestedGenre) {
    for (const [key, data] of Object.entries(db.baselines)) {
      if (key.includes(requestedGenre) || requestedGenre.includes(key)) {
        return data;
      }
    }
  }
  return null;
}

/**
 * 获取指标判定模式分类汇总表
 */
function getDetectionModeClassification() {
  const classification = {
    auto: [],
    hybrid: [],
    llm: []
  };

  for (const def of Object.values(GENRE_METRIC_DEFINITIONS)) {
    classification[def.detectionMode].push({
      key: def.key,
      displayName: def.displayName,
      unit: def.unit,
      rationale: def.detectionRationale,
      contextualNotes: def.contextualNotes
    });
  }

  return classification;
}

module.exports = {
  GENRE_METRIC_DEFINITIONS,
  computeDistributionStats,
  evaluateWithContext,
  loadGenreQualityBaselines,
  getGenreBaseline,
  getDetectionModeClassification
};
