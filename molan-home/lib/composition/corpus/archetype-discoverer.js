'use strict';

/**
 * @file archetype-discoverer.js
 * 章节运作原型发现与聚类引擎 (Chapter Archetype Discovery Engine)
 * 
 * 核心功能：
 * 1. 26 维正交特征空间抽取与连续归一化：
 *    - 11 维文风统计特征 (Stylometry: narrativeDensity, emotionalIntensity, etc.)
 *    - 7 维笔墨镜头预算特征 (Focus Vector: dialogue, action, setting, conflict, character, emotion, foreshadowing)
 *    - 8 维初筛动力学与母题特征 (Screener Dynamics: thrill, plot, character, emotion, suspense, style, hook, pacing)
 * 2. 确定性 K-Means 聚类 (Farthest-Point MaxMin 初始化 + 自适应 K = min(K, N))
 * 3. 欧氏几何中心质心 (Mathematical Centroid) 计算
 * 4. 数据驱动动态合成 ChapterArchetypeProfile (结构动力学、张力曲线模型、节奏字数预算公式、范例章节)
 * 5. 独立输出规范化 archetypes.json，完全解耦于策略规则挖掘流水线
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * 26 维特征向量坐标轴定义
 */
const VECTOR_26D_DIMENSIONS = Object.freeze([
  // --- Group 1: 11D Stylometry (Indices 0 - 10) ---
  'narrativeDensity',           // 0: 动作动词密度 (0~1)
  'emotionalIntensity',         // 1: 情绪应激词与感叹标点密度 (0~1)
  'rhetoricalAbundance',        // 2: 比喻词与四字成语密度 (0~1)
  'colloquialLevel',            // 3: 对白口语语气助词密度 (0~1)
  'dialogueRatio',              // 4: 对白字数占比 (0~1)
  'psychologicalRatio',         // 5: 心理独白与认知揣测占比 (0~1)
  'settingRatio',               // 6: 环境天候与建筑描写占比 (0~1)
  'averageSentenceLengthNorm',  // 7: 句长归一化 [6, 60] -> [0, 1]
  'shortSentenceRatio',         // 8: 短句 (<=15字) 比例 (0~1)
  'informationDensity',         // 9: 词汇信息熵与悬念词负载 (0~1)
  'negativeSpaceRatio',         // 10: 破折号与省略号留白停顿 (0~1)

  // --- Group 2: 7D Focus Vector (Indices 11 - 17) ---
  'focus_dialogue',             // 11: 镜头分配 - 对白
  'focus_action',               // 12: 镜头分配 - 动作
  'focus_setting',              // 13: 镜头分配 - 环境
  'focus_conflict',             // 14: 镜头分配 - 冲突
  'focus_character',            // 15: 镜头分配 - 人物
  'focus_emotion',              // 16: 镜头分配 - 情感
  'focus_foreshadowing',        // 17: 镜头分配 - 伏笔

  // --- Group 3: 8D Screener & Dynamics (Indices 18 - 25) ---
  'screener_thrill',            // 18: 爽点指标分 (0~1)
  'screener_plot',              // 19: 剧情推进分 (0~1)
  'screener_character',         // 20: 人物弧光分 (0~1)
  'screener_emotion',           // 21: 情绪感染分 (0~1)
  'screener_suspense',          // 22: 悬疑张力分 (0~1)
  'screener_style',             // 23: 文风质感分 (0~1)
  'screener_hook',              // 24: 章末钩子强度分 (结合 tailHook.strength) (0~1)
  'screener_pacing'             // 25: 叙事节奏加速度分 (0~1)
]);

/**
 * 稳健数值裁剪，防 NaN、null、undefined
 * @param {*} val
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clamp(val, min = 0.0, max = 1.0, fallback = 0.0) {
  if (val === null || val === undefined) return fallback;
  const num = Number(val);
  if (Number.isNaN(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

/**
 * 从章节特征对象中抽取连续 26 维归一化向量 V in [0, 1]^26
 * @param {Object} chapter
 * @returns {Float64Array}
 */
function extract26DVector(chapter = {}) {
  const v = new Float64Array(26);
  const sty = chapter.stylometry || {};
  const fts = chapter.features || {};
  const foc = chapter.focusVector || {};
  const scr = chapter.screener?.scores || chapter.screener?.dimensionScores || {};
  const qDims = chapter.screener?.qualifiedDimensions || chapter.qualifiedDimensions || [];
  const goal = chapter.primaryGoal || '';
  const hook = chapter.tailHook || {};

  // Group 1: 11D Stylometry (0..10)
  v[0] = clamp(sty.narrativeDensity ?? fts.actionBeatDensity, 0, 1, 0.70);
  v[1] = clamp(sty.emotionalIntensity, 0, 1, 0.50);
  v[2] = clamp(sty.rhetoricalAbundance, 0, 1, 0.40);
  v[3] = clamp(sty.colloquialLevel, 0, 1, 0.45);
  v[4] = clamp(sty.dialogueRatio ?? fts.dialogueDensity, 0, 1, 0.35);
  v[5] = clamp(sty.psychologicalRatio, 0, 1, 0.25);
  v[6] = clamp(sty.settingRatio ?? fts.sensoryDetailDensity, 0, 1, 0.20);

  // 句长归一化：将 [6, 60] 映射到 [0, 1]，基准 20 字对应 ~0.259
  const rawAvgLen = sty.averageSentenceLength !== undefined && sty.averageSentenceLength !== null
    ? Number(sty.averageSentenceLength)
    : 20.0;
  const safeAvgLen = Number.isNaN(rawAvgLen) ? 20.0 : Math.min(60.0, Math.max(6.0, rawAvgLen));
  v[7] = clamp((safeAvgLen - 6.0) / 54.0, 0, 1, 0.259);

  v[8] = clamp(sty.shortSentenceRatio ?? fts.pacingAcceleration, 0, 1, 0.55);
  v[9] = clamp(sty.informationDensity, 0, 1, 0.70);
  v[10] = clamp(sty.negativeSpaceRatio, 0, 1, 0.40);

  // Group 2: 7D Focus Vector (11..17)
  const hasFocus = foc.dialogue !== undefined || foc.action !== undefined || foc.setting !== undefined ||
    foc.conflict !== undefined || foc.character !== undefined || foc.emotion !== undefined || foc.foreshadowing !== undefined;

  if (hasFocus) {
    const rawFoc = [
      clamp(foc.dialogue, 0, 1, 0),
      clamp(foc.action, 0, 1, 0),
      clamp(foc.setting, 0, 1, 0),
      clamp(foc.conflict, 0, 1, 0),
      clamp(foc.character, 0, 1, 0),
      clamp(foc.emotion, 0, 1, 0),
      clamp(foc.foreshadowing, 0, 1, 0)
    ];
    const sumFoc = rawFoc.reduce((a, b) => a + b, 0);
    if (sumFoc > 0) {
      for (let i = 0; i < 7; i++) {
        v[11 + i] = clamp(rawFoc[i] / sumFoc, 0, 1, 0);
      }
    } else {
      v[11] = 0.20; v[12] = 0.15; v[13] = 0.15; v[14] = 0.20; v[15] = 0.15; v[16] = 0.10; v[17] = 0.05;
    }
  } else {
    // 依母题目标与文风补全笔墨分配
    v[11] = clamp(fts.dialogueDensity ?? v[4], 0, 1, 0.20);
    v[12] = clamp(fts.actionBeatDensity ?? (v[0] * 0.4), 0, 1, 0.15);
    v[13] = clamp(v[6], 0, 1, 0.15);
    v[14] = clamp(fts.conflictPushDelta ?? (goal === 'conflict_push' ? 0.45 : 0.20), 0, 1, 0.20);
    v[15] = 0.15;
    v[16] = clamp(v[1] * 0.3, 0, 1, 0.10);
    v[17] = goal === 'info_reveal' ? 0.25 : 0.05;
    let fSum = 0;
    for (let i = 0; i < 7; i++) fSum += v[11 + i];
    if (fSum > 0) {
      for (let i = 0; i < 7; i++) v[11 + i] = v[11 + i] / fSum;
    }
  }

  // Group 3: 8D Screener Dynamics (18..25)
  v[18] = clamp(scr.thrill ?? (qDims.includes('thrill') ? 0.85 : (goal === 'conflict_push' ? 0.80 : 0.50)), 0, 1, 0.50);
  v[19] = clamp(scr.plot ?? (qDims.includes('plot') ? 0.85 : 0.60), 0, 1, 0.50);
  v[20] = clamp(scr.character ?? (qDims.includes('character') ? 0.85 : (goal === 'dialogue_game' ? 0.75 : 0.50)), 0, 1, 0.50);
  v[21] = clamp(scr.emotion ?? (qDims.includes('emotion') ? 0.85 : v[1]), 0, 1, 0.50);
  v[22] = clamp(scr.suspense ?? (fts.suspense ?? (qDims.includes('suspense') ? 0.85 : (goal === 'info_reveal' ? 0.80 : 0.40))), 0, 1, 0.50);
  v[23] = clamp(scr.style ?? (qDims.includes('style') ? 0.85 : 0.60), 0, 1, 0.50);
  v[24] = clamp(hook.strength ?? (scr.hook ?? (qDims.includes('hook') ? 0.85 : 0.50)), 0, 1, 0.50);
  v[25] = clamp(scr.pacing ?? (fts.pace ?? (qDims.includes('pacing') ? 0.85 : v[8])), 0, 1, 0.50);

  return v;
}

/**
 * 欧氏距离平方
 */
function euclideanDistSq(u, v) {
  let sum = 0;
  for (let i = 0; i < 26; i++) {
    const d = u[i] - v[i];
    sum += d * d;
  }
  return sum;
}

/**
 * 欧氏距离
 */
function calculateEuclideanDistance(u, v) {
  return Math.sqrt(euclideanDistSq(u, v));
}

/**
 * 均方根归一化距离 (RMSE Distance in [0, 1])
 */
function calculateRmseDistance(u, v) {
  return Math.sqrt(euclideanDistSq(u, v) / 26);
}

/**
 * 从特征中提取真实作者身份（未经验证作者严格返回 null）
 */
function extractFeatureAuthor(f) {
  if (!f) return null;
  const rawAuthor = f.author || f.authorName || f.metadata?.author;
  if (!rawAuthor || typeof rawAuthor !== 'string') return null;
  const trimmed = rawAuthor.trim();
  if (!trimmed || trimmed === '未知' || trimmed === '未知作者' || trimmed === '佚名' || trimmed === 'null' || trimmed === 'undefined') {
    return null;
  }
  if (trimmed.startsWith('author_') || trimmed === f.novelTitle || trimmed === f.bookId) {
    return null;
  }
  return trimmed;
}

/**
 * 确定性 K-Means 聚类
 * 特性：
 * - 自适应 K：K_eff = min(K, N)，严格防止空簇与除零
 * - 确定性 MaxMin (Farthest-Point Traversal) 初始化：无需随机种子，保证 100% 可复现
 * - 稳定断绝平局机制
 * 
 * @param {Array<Object>} chapters
 * @param {number} requestedK
 * @param {Object} options
 * @returns {Object} { k, clusters: Array<{ clusterIndex, centroid, members }> }
 */
function clusterChaptersDeterministic(chapters = [], requestedK = 5, options = {}) {
  // 严格过滤掉任何被标记为 UNSEGMENTED 的章节，严防虚拟片段污染原型聚类
  const validChapters = chapters.filter(ch =>
    ch && !ch.unsegmented && ch.chapterTitle !== 'UNSEGMENTED' && ch.title !== 'UNSEGMENTED' && ch.chapterNo !== 0
  );

  const N = validChapters.length;
  if (N === 0) {
    return { k: 0, clusters: [] };
  }

  // 自适应 K 钳制
  const targetK = requestedK !== undefined && requestedK !== null ? parseInt(requestedK, 10) : 5;
  const effectiveK = Math.max(1, Math.min(Number.isNaN(targetK) ? 5 : targetK, N));

  // 映射为 26 维向量条目
  const items = validChapters.map((ch, idx) => ({
    index: idx,
    chapter: ch,
    vector: extract26DVector(ch),
    stableKey: `${ch.bookId || 'b'}_ch${ch.chapterNo ?? idx}_${ch.novelTitle || ''}`
  }));

  // 单样本特例快速退出
  if (N === 1 || effectiveK === 1) {
    const singleCentroid = new Float64Array(26);
    for (const item of items) {
      for (let d = 0; d < 26; d++) singleCentroid[d] += item.vector[d] / N;
    }
    const members = items.map(it => ({
      ...it,
      distanceToCentroid: Math.sqrt(euclideanDistSq(it.vector, singleCentroid))
    }));
    members.sort((a, b) => a.distanceToCentroid - b.distanceToCentroid);
    return {
      k: 1,
      clusters: [{
        clusterIndex: 0,
        centroid: singleCentroid,
        members
      }]
    };
  }

  // 确定性 MaxMin 初始化 (Farthest-Point Traversal)
  // 1. 中心 0：距离全局均值最近的样本点（平局依 index 升序）
  const globalMean = new Float64Array(26);
  for (const item of items) {
    for (let d = 0; d < 26; d++) globalMean[d] += item.vector[d] / N;
  }

  let bestFirstIdx = 0;
  let minMeanDist = Infinity;
  for (let i = 0; i < N; i++) {
    const dist = euclideanDistSq(items[i].vector, globalMean);
    if (dist < minMeanDist) {
      minMeanDist = dist;
      bestFirstIdx = i;
    }
  }

  const centroids = [Float64Array.from(items[bestFirstIdx].vector)];

  // 2. 中心 1 .. K-1：选择距当前已有中心集合的最小距离最大的点 (MaxMin)
  for (let k = 1; k < effectiveK; k++) {
    let farthestIdx = 0;
    let maxMinDist = -Infinity;

    for (let i = 0; i < N; i++) {
      let minDistToCenters = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = euclideanDistSq(items[i].vector, centroids[c]);
        if (d < minDistToCenters) minDistToCenters = d;
      }
      if (minDistToCenters > maxMinDist) {
        maxMinDist = minDistToCenters;
        farthestIdx = i;
      }
    }
    centroids.push(Float64Array.from(items[farthestIdx].vector));
  }

  // Lloyd's 迭代
  const maxIterations = options.maxIterations || 40;
  const tolerance = options.tolerance || 1e-6;
  const assignments = new Int32Array(N);

  for (let iter = 0; iter < maxIterations; iter++) {
    // 分配阶段
    for (let i = 0; i < N; i++) {
      let nearestCluster = 0;
      let nearestDist = Infinity;
      for (let k = 0; k < effectiveK; k++) {
        const d = euclideanDistSq(items[i].vector, centroids[k]);
        if (d < nearestDist) {
          nearestDist = d;
          nearestCluster = k;
        }
      }
      assignments[i] = nearestCluster;
    }

    // 质心更新阶段与空簇防护
    let totalCentroidShift = 0;
    for (let k = 0; k < effectiveK; k++) {
      const clusterMembers = [];
      for (let i = 0; i < N; i++) {
        if (assignments[i] === k) clusterMembers.push(items[i]);
      }

      const newCentroid = new Float64Array(26);
      if (clusterMembers.length === 0) {
        // 若出现空簇，将距离其原质心最远的孤立样本点调配入此空簇
        let worstItemIdx = 0;
        let worstDist = -Infinity;
        for (let i = 0; i < N; i++) {
          const d = euclideanDistSq(items[i].vector, centroids[assignments[i]]);
          if (d > worstDist) {
            worstDist = d;
            worstItemIdx = i;
          }
        }
        assignments[worstItemIdx] = k;
        newCentroid.set(items[worstItemIdx].vector);
      } else {
        for (const m of clusterMembers) {
          for (let d = 0; d < 26; d++) newCentroid[d] += m.vector[d] / clusterMembers.length;
        }
      }

      totalCentroidShift += euclideanDistSq(centroids[k], newCentroid);
      centroids[k] = newCentroid;
    }

    if (totalCentroidShift < tolerance) break;
  }

  // 构造最终聚类结构，成员按距中心质心的距离升序排列
  const clusters = [];
  for (let k = 0; k < effectiveK; k++) {
    const members = [];
    for (let i = 0; i < N; i++) {
      if (assignments[i] === k) {
        const dist = Math.sqrt(euclideanDistSq(items[i].vector, centroids[k]));
        members.push({ ...items[i], distanceToCentroid: dist });
      }
    }
    members.sort((a, b) => a.distanceToCentroid - b.distanceToCentroid);
    clusters.push({
      clusterIndex: k,
      centroid: centroids[k],
      members
    });
  }

  return { k: effectiveK, clusters };
}

/**
 * 动态合成 ChapterArchetypeProfile 实体
 * 包含：
 * - structuralDynamics (起手、转折、高潮、收尾 4 阶链条)
 * - tensionProfile (张力点在 [1.0, 10.0] 范围内，动态代数公式，节拍明细)
 * - pacingFormula (节拍字数占比和为 1.00，短句占比目标，句长目标)
 * - centroid (三组结构化解构质心，无 NaN)
 * - exemplars (距质心最近的前 N 篇范例，携带片段与分数)
 * - clusterMembers (所属章节列表)
 * 
 * @param {Object} cluster
 * @param {Object} options
 * @returns {Object} ChapterArchetypeProfile
 */
function synthesizeChapterArchetypeProfile(cluster, options = {}) {
  const { clusterIndex, centroid, members } = cluster;
  const mu = centroid;

  // 1. 核心特征主导倾向分析
  const conflictScore = 0.4 * mu[14] + 0.3 * mu[18] + 0.3 * mu[12];
  const suspenseScore = 0.4 * mu[22] + 0.3 * mu[17] + 0.3 * mu[9];
  const dialogueScore = 0.4 * mu[4] + 0.3 * mu[11] + 0.3 * mu[20];
  const emotionScore = 0.4 * mu[1] + 0.3 * mu[16] + 0.3 * mu[21];
  const settingScore = 0.4 * mu[6] + 0.3 * mu[13] + 0.3 * mu[2];

  let archetypeId = `archetype_balanced_progression_${clusterIndex + 1}`;
  let archetypeName = '常态推进交织型';
  let category = 'balanced_progression';
  let curveType = 'steady_wave';

  const maxTrait = Math.max(conflictScore, suspenseScore, dialogueScore, emotionScore, settingScore);

  if (maxTrait === conflictScore && conflictScore > 0.28) {
    archetypeId = `archetype_crisis_breakthrough_${clusterIndex + 1}`;
    archetypeName = '高频对抗破局型';
    category = 'conflict_push';
    curveType = 'escalating_climax';
  } else if (maxTrait === suspenseScore && suspenseScore > 0.28) {
    archetypeId = `archetype_deliberate_trap_${clusterIndex + 1}`;
    archetypeName = '设局入扣破疑型';
    category = 'deliberate_trap';
    curveType = 'suspense_wave';
  } else if (maxTrait === dialogueScore && dialogueScore > 0.28) {
    archetypeId = `archetype_confrontation_investigation_${clusterIndex + 1}`;
    archetypeName = '交锋对峙探查型';
    category = 'dialogue_game';
    curveType = 'sawtooth_pressure';
  } else if (maxTrait === emotionScore && emotionScore > 0.28) {
    archetypeId = `archetype_emotional_climax_${clusterIndex + 1}`;
    archetypeName = '暗涌蓄势爆发型';
    category = 'emotional_climax';
    curveType = 'crescendo';
  } else if (maxTrait === settingScore && settingScore > 0.28) {
    archetypeId = `archetype_world_reveal_${clusterIndex + 1}`;
    archetypeName = '静水深流铺陈型';
    category = 'world_reveal';
    curveType = 'steady_wave';
  }

  // 2. 数据驱动的 4 阶结构动力学 (Structural Dynamics)
  const phase1 = mu[11] > 0.30
    ? '言语暗潮初试探'
    : (mu[13] > 0.25 ? '异象铺展压迫逼近' : (mu[14] > 0.25 ? '微观摩擦暗流涌动' : '常态情境隐现裂隙'));

  const phase2 = mu[22] > 0.55
    ? '反常细节引爆信息缺口'
    : (mu[18] > 0.55 ? '强力干预打破平衡阻力升级' : (mu[4] > 0.35 ? '立场对立言辞机锋层层加码' : '多重变量交汇局势加剧复杂'));

  const phase3 = (mu[12] > 0.25 || mu[18] > 0.60)
    ? '核心底牌硬碰硬导致不可逆物理位移'
    : (mu[22] > 0.60 ? '伪装撕裂残酷真相意外浮出' : '核心矛盾正面交锋达成不可逆阶段成果');

  const phase4 = mu[24] > 0.60
    ? '新危机临界引爆章末悬念留钩'
    : (mu[10] > 0.35 ? '因果收束余波未平留白蓄势' : '局势暂歇伏笔隐现引向次轮推进');

  const drivePattern = `${phase1} -> ${phase2} -> ${phase3} -> ${phase4}`;
  const typicalStructure = [
    `起手入场：${phase1}`,
    `推进转折：${phase2}`,
    `高潮决胜：${phase3}`,
    `收敛悬念：${phase4}`
  ];

  const failureModes = [];
  if (mu[8] > 0.65 && mu[0] > 0.70) failureModes.push('特效堆砌报招过频缺乏物理受力传导与受击反馈');
  if (mu[4] > 0.45) failureModes.push('通篇口水对话缺乏肢体微动作与环境反馈导致木偶感');
  if (mu[6] > 0.30) failureModes.push('环境描写过于冗长阻滞叙事主干与因果推进速度');
  if (mu[22] > 0.70) failureModes.push('谜题故弄玄虚隐瞒必要信息损害读者公平解谜体验');
  if (failureModes.length === 0) failureModes.push('冲突各方机械对抗缺乏内在动力与因果代价');

  // 3. 数据驱动的张力曲线模型 (Tension Profile in [1.0, 10.0])
  const t1 = Number(Math.min(10.0, Math.max(1.0, 2.5 + 2.0 * mu[0] + 1.0 * mu[14])).toFixed(1));
  const t2 = Number(Math.min(10.0, Math.max(1.0, t1 + 1.5 + 2.5 * mu[22])).toFixed(1));
  const t3 = Number(Math.min(10.0, Math.max(1.0, 6.5 + 3.0 * Math.max(mu[18], mu[14]))).toFixed(1));
  const t4 = Number(Math.min(10.0, Math.max(1.0, 4.0 + 5.0 * mu[24])).toFixed(1));
  const tensionPoints = [t1, t2, t3, t4];

  const exponent = Number((1.2 + 0.8 * mu[8]).toFixed(2));
  const dynamicFormula = curveType === 'escalating_climax'
    ? `T(t) = ${t1} + ${(t3 - t1).toFixed(1)} * (t/3)^${exponent}`
    : `T(t) = ${((t1 + t3) / 2).toFixed(1)} + ${((t3 - t1) / 2).toFixed(1)} * sin(t * Math.PI / 2.5)`;

  const beats = [
    { beat: 1, name: '入场情境', tension: t1, focus: phase1 },
    { beat: 2, name: '突发变数', tension: t2, focus: phase2 },
    { beat: 3, name: '核心名场面', tension: t3, focus: phase3 },
    { beat: 4, name: '战局收尾', tension: t4, focus: phase4 }
  ];

  // 4. 数据驱动的节奏与字数预算公式 (Pacing Formula)
  const rawWeights = [1.0, 1.2 + 0.5 * mu[22], 1.5 + 1.0 * mu[18], 0.6 + 0.5 * mu[24]];
  const weightSum = rawWeights.reduce((a, b) => a + b, 0);
  const r1 = Number((rawWeights[0] / weightSum).toFixed(2));
  const r2 = Number((rawWeights[1] / weightSum).toFixed(2));
  const r3 = Number((rawWeights[2] / weightSum).toFixed(2));
  const r4 = Number((1.0 - (r1 + r2 + r3)).toFixed(2));
  const beatWordRatios = [r1, r2, r3, r4];

  const targetChars = 3000;
  const sampleWordBudget = {
    targetChars,
    beatChars: [
      Math.round(targetChars * r1),
      Math.round(targetChars * r2),
      Math.round(targetChars * r3),
      Math.round(targetChars * r4)
    ]
  };

  const targetShortSentenceRatio = Number(clamp(mu[8], 0.25, 0.85, 0.55).toFixed(3));
  const targetAvgSentenceLen = Number(clamp(mu[7] * 54.0 + 6.0, 10.0, 50.0, 20.0).toFixed(1));
  const dialogueToActionRatio = Number((mu[4] / Math.max(0.01, mu[12])).toFixed(3));

  // 5. 质心结构化解构 (Centroid)
  const centroidDecomp = {
    style: {
      narrativeDensity: Number(mu[0].toFixed(3)),
      emotionalIntensity: Number(mu[1].toFixed(3)),
      rhetoricalAbundance: Number(mu[2].toFixed(3)),
      colloquialLevel: Number(mu[3].toFixed(3)),
      dialogueRatio: Number(mu[4].toFixed(3)),
      psychologicalRatio: Number(mu[5].toFixed(3)),
      settingRatio: Number(mu[6].toFixed(3)),
      averageSentenceLength: targetAvgSentenceLen,
      shortSentenceRatio: Number(mu[8].toFixed(3)),
      informationDensity: Number(mu[9].toFixed(3)),
      negativeSpaceRatio: Number(mu[10].toFixed(3))
    },
    focus: {
      dialogue: Number(mu[11].toFixed(3)),
      action: Number(mu[12].toFixed(3)),
      setting: Number(mu[13].toFixed(3)),
      conflict: Number(mu[14].toFixed(3)),
      character: Number(mu[15].toFixed(3)),
      emotion: Number(mu[16].toFixed(3)),
      foreshadowing: Number(mu[17].toFixed(3))
    },
    screener: {
      thrill: Number(mu[18].toFixed(3)),
      plot: Number(mu[19].toFixed(3)),
      character: Number(mu[20].toFixed(3)),
      emotion: Number(mu[21].toFixed(3)),
      suspense: Number(mu[22].toFixed(3)),
      style: Number(mu[23].toFixed(3)),
      hook: Number(mu[24].toFixed(3)),
      pacing: Number(mu[25].toFixed(3))
    },
    dynamics: {
      thrill: Number(mu[18].toFixed(3)),
      plot: Number(mu[19].toFixed(3)),
      character: Number(mu[20].toFixed(3)),
      emotion: Number(mu[21].toFixed(3)),
      suspense: Number(mu[22].toFixed(3)),
      style: Number(mu[23].toFixed(3)),
      hook: Number(mu[24].toFixed(3)),
      pacing: Number(mu[25].toFixed(3))
    },
    vector: Array.from(mu).map(v => Number(v.toFixed(4)))
  };

  // 6. 统计与范例抽取 (Exemplars & Cluster Members)
  const bookSet = new Set();
  const authorSet = new Set();
  const clusterMembers = [];

  for (const m of members) {
    const ch = m.chapter;
    if (ch.bookId) bookSet.add(ch.bookId);
    const verifiedAuth = extractFeatureAuthor(ch);
    if (verifiedAuth) authorSet.add(verifiedAuth);

    const memId = ch.chapterTitle || (ch.bookId ? `${ch.bookId}_ch${ch.chapterNo ?? m.index + 1}` : `ch_${m.index + 1}`);
    clusterMembers.push(memId);
  }

  const exemplars = members.slice(0, 3).map(m => {
    const ch = m.chapter;
    const fallbackSnippet = `${ch.novelTitle || '小说'}第${ch.chapterNo ?? 1}章：长夜深沉，暗潮涌动，局势瞬息万变。`;
    const snippet = ch.tailHook?.tailSnippet || ch.features?.tailSnippet || ch.snippet || fallbackSnippet;
    const qualityScore = Number((ch.screener?.scores?.thrill || ch.screener?.scores?.plot || 0.85).toFixed(3));
    const dist = Number(m.distanceToCentroid.toFixed(4));
    const exemplarScore = Number((0.5 * (1.0 - Math.min(1.0, dist)) + 0.5 * qualityScore).toFixed(3));

    return {
      bookId: ch.bookId || 'unknown_book',
      novelTitle: ch.novelTitle || '',
      chapterNo: ch.chapterNo ?? 1,
      chapterTitle: ch.chapterTitle || ch.title || `第${ch.chapterNo ?? 1}章`,
      author: extractFeatureAuthor(ch),
      distanceToCentroid: dist,
      qualityScore,
      exemplarScore,
      snippet
    };
  });

  return {
    schemaVersion: 'chapter-archetype-profile-v1',
    id: archetypeId,
    name: archetypeName,
    category,
    drivePattern,
    typicalStructure,
    failureModes,
    structuralDynamics: {
      drivePattern,
      typicalStructure,
      failureModes
    },
    tensionProfile: {
      curveType,
      tensionPoints,
      dynamicFormula,
      beats
    },
    pacingFormula: {
      beatWordRatios,
      beatRatios: beatWordRatios,
      sampleWordBudget,
      targetShortSentenceRatio,
      targetAvgSentenceLen,
      dialogueToActionRatio
    },
    centroid: centroidDecomp,
    stats: {
      supportCount: members.length,
      bookCount: bookSet.size,
      authorCount: authorSet.size
    },
    exemplars,
    clusterMembers,
    metadata: {
      clusterIndex,
      discoveredAt: new Date().toISOString(),
      memberCount: members.length,
      structuralDynamics: { drivePattern, typicalStructure, failureModes },
      tensionProfile: { curveType, tensionPoints, dynamicFormula, beats },
      pacingFormula: { beatWordRatios, beatRatios: beatWordRatios, targetShortSentenceRatio, targetAvgSentenceLen },
      exemplars,
      clusterMembers,
      centroid: centroidDecomp
    }
  };
}

/**
 * 原型聚类主函数 (corpus:discover-patterns)
 * 
 * @param {Object} options
 * @param {string} [options.runDir]
 * @param {string} [options.featuresFile]
 * @param {string} [options.outputFile]
 * @param {Array<Object>} [options.features]
 * @param {number} [options.k=5]
 * @param {number} [options.clusters]
 * @param {number} [options.maxIterations=40]
 * @returns {Promise<Object>} { archetypes, metadata, outputFile }
 */
function discoverChapterArchetypes(options = {}) {
  const runDir = options.runDir ? path.resolve(options.runDir) : null;
  const featuresFile = options.featuresFile
    ? path.resolve(options.featuresFile)
    : (runDir ? path.join(runDir, 'chapter-features.jsonl') : null);

  let rawFeatures = options.features;

  if (!rawFeatures && featuresFile) {
    if (!fs.existsSync(featuresFile)) {
      throw new Error(`无法找到特征文件: ${featuresFile}`);
    }
    const rawContent = fs.readFileSync(featuresFile, 'utf8');
    const rawLines = rawContent.split('\n').filter(Boolean);
    rawFeatures = [];
    for (const line of rawLines) {
      try {
        rawFeatures.push(JSON.parse(line));
      } catch (_) {}
    }
  }

  rawFeatures = rawFeatures || [];

  // 严格过滤掉虚拟未切分章节
  const validFeatures = rawFeatures.filter(f =>
    f && !f.unsegmented && f.chapterTitle !== 'UNSEGMENTED' && f.title !== 'UNSEGMENTED' && f.chapterNo !== 0
  );

  const requestedK = options.k !== undefined && options.k !== null
    ? options.k
    : (options.clusters !== undefined && options.clusters !== null ? options.clusters : 5);

  const outputFile = options.output || options.outputFile
    ? path.resolve(options.output || options.outputFile)
    : (runDir ? path.join(runDir, 'archetypes.json') : null);

  // 0 样本特例
  if (validFeatures.length === 0) {
    const emptyResult = {
      archetypes: {},
      metadata: {
        count: 0,
        k: 0,
        totalChapters: 0,
        generatedAt: new Date().toISOString()
      },
      outputFile
    };

    if (outputFile) {
      const parentDir = path.dirname(outputFile);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(outputFile, JSON.stringify({}, null, 2), 'utf8');
    }

    return emptyResult;
  }

  // 执行确定性 K-Means
  const clusterResult = clusterChaptersDeterministic(validFeatures, requestedK, options);
  const archetypeMap = {};

  for (const cluster of clusterResult.clusters) {
    const profile = synthesizeChapterArchetypeProfile(cluster, options);
    archetypeMap[profile.id] = profile;
  }

  const result = {
    archetypes: archetypeMap,
    metadata: {
      count: Object.keys(archetypeMap).length,
      k: clusterResult.k,
      totalChapters: validFeatures.length,
      generatedAt: new Date().toISOString()
    },
    outputFile
  };

  // 序列化输出 archetypes.json
  if (outputFile) {
    const parentDir = path.dirname(outputFile);
    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(outputFile, JSON.stringify(archetypeMap, null, 2), 'utf8');
  }

  return result;
}

module.exports = {
  VECTOR_26D_DIMENSIONS,
  clamp,
  extract26DVector,
  extractChapterFeatureVector: extract26DVector,
  calculateEuclideanDistance,
  calculateRmseDistance,
  clusterChaptersDeterministic,
  synthesizeChapterArchetypeProfile,
  discoverChapterArchetypes
};
