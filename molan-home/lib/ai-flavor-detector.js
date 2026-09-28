'use strict';

// 墨阑 AI 味检测器（CJS，供 server.js require）。
// 职责：懒加载 data/ai-flavor-lexicon.json（AI 高频套话词表），
// 对文本统计句长离散度、字符 bigram TTR、段落均匀度与套话命中密度，
// 与风格指纹基线（lib/style-fingerprint.js 的 profile，可为 null）比较后输出 0-100 的
// AI 味量化分数（越高越像 AI）与逐项指标，供 humanize 改写链路做门禁与提示注入。
// 词表缺失或损坏时安静降级（返回 null / 空串），绝不抛错。

const fs = require('node:fs');
const path = require('node:path');

// 词表数据文件默认路径（molan-home/data/ai-flavor-lexicon.json）。
const DEFAULT_LEXICON_FILE = path.join(__dirname, '..', 'data', 'ai-flavor-lexicon.json');

// 评分权重与阈值（与产品约定一致，四路加权，满分 100）。
const SCORE_RULES = Object.freeze({
  // 文本句长 std / 基线句长 std：< 0.6 满分 30，0.6-0.9 线性衰减，≥ 0.9 记 0。
  sentenceStd: { fullRatio: 0.6, zeroRatio: 0.9, points: 30 },
  // 文本 TTR / 基线 TTR：线性同法（与句长规则同比例，0.75 × 2/3 = 0.5 以下满分），满分 20。
  ttr: { fullRatio: 0.5, zeroRatio: 0.75, points: 20 },
  // 段落长度变异系数：< 0.45 视为过度均匀（越均匀越 AI），记 20 分。
  paragraphCvThreshold: 0.45,
  paragraphCvPoints: 20,
  // block 套话每千字次数：1-3 之间线性，≥ 3 满分 30，≤ 1 记 0（线性 clamp）。
  blockPerKilo: { low: 1, high: 3, points: 30 },
  // 低于 40 分视为通过（AI 味可接受）。
  passThreshold: 40
});

// 结构性深层 AI 痕迹正则（拟声断语碎段、NPC 回合制排队、机械二元对称）
const STRUCTURAL_AI_PATTERNS = Object.freeze({
  pseudoFragmentation: /^(?:咚|咔嚓|骨骼脆响|木头裂开|一声|两声|三声|杀步|轰|砰|啪|刺啦|噗嗤|铛|叮)[。！？…—~]*$/u,
  turnTaking: /(?:最前一人|第一名|第二名|第三名|第四名|第五名|又一名|另一名|随后一名)[^，。\n\r]{0,15}(?:横刀|砍向|冲来|逼近|趁隙|拔刀|扑上|抢步)/gu,
  binarySymmetry: /(?:一枚[^，。！？\n\r]{1,15}，一枚|第一步[^，。！？\n\r]{1,15}，第二步|只剩半边[^，。！？\n\r]{0,10}另一半|三只[^，。！？\n\r]{1,15}只有(?:靠|一)|一半[^，。！？\n\r]{1,15}另一半)/gu,
  isolatedExplanatory: /^(?:这是(?:暗语|暗号|规矩|死局|杀招|圈套|死案|警告|私货|切口)[^，。\n\r]{0,15}|里面有私货[^。！？\n\r]{0,15}|暗令不在[^。！？\n\r]{0,15}|(?:他|她)没有退|[^，。\n\r]{1,6}(?:看懂了|不再等|脸色变了|转身便走|伸出手|没有拔刀)|匣身震动)[。！？]*$/u,
  somaticOverreaction: /(?:(?:指腹|指肚|拇指|手指)反复?摩挲|食指轻叩(?:桌面|桌案)|指尖(?:骤然)?(?:一顿|悬在半空|僵在半空)|掐(?:进|入)掌心|骨节捏得泛白|指节泛白|指骨泛白|喉咙发紧|咽喉发紧|喉头发干|喉头一哽|呼吸骤然一窒|按揉发胀的太阳穴|后槽牙咬得咯咯作响|喉结上下滚动)/gu
});

// 句终符切句（后行断言，保留句终符计入句长，与指纹构建端口径一致）。
const SENTENCE_SPLIT_PATTERN = /(?<=[。！？])/u;
// 换行切段（单换行亦分段）：模型输出与编辑器正文用单换行分段，不能只认空行。
const PARAGRAPH_SPLIT_PATTERN = /\n+/;
// 全部空白（压缩文本用，与指纹构建端口径一致）。
const WHITESPACE_PATTERN = /\s+/gu;
// 停用标点与符号（bigram TTR 前去除，与指纹构建端口径一致）。
const STOP_PUNCTUATION_PATTERN = /[\p{P}\p{S}]/gu;

// 词表缓存三态：undefined=尚未加载，null=已尝试加载但文件缺失/损坏，对象=加载成功。
let lexiconCache;

/**
 * 懒加载并进程内缓存 data/ai-flavor-lexicon.json。
 * 文件缺失、JSON 损坏或结构不合法（entries 非数组/为空）时缓存并返回 null，不抛错。
 * @returns {object|null} 词表对象（含 schemaVersion/entries 等），失败返回 null
 */
function loadAiFlavorLexicon() {
  if (lexiconCache !== undefined) return lexiconCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DEFAULT_LEXICON_FILE, 'utf8'));
    if (!parsed || !Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      lexiconCache = null;
      return null;
    }
    lexiconCache = parsed;
    return parsed;
  } catch {
    lexiconCache = null;
    return null;
  }
}

/**
 * 压缩文本：去掉全部空白字符，统计口径与指纹构建端一致。
 * @param {*} text 原始文本
 * @returns {string} 压缩后的文本
 */
function compactText(text) {
  return String(text == null ? '' : text).replace(WHITESPACE_PATTERN, '');
}

/**
 * 求一组数值的算术均值；空数组返回 null。
 * @param {Array<number>} values 数值数组
 * @returns {number|null} 均值
 */
function meanOf(values) {
  if (!values || values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * 求一组数值的总体标准差；少于 2 个样本返回 0。
 * @param {Array<number>} values 数值数组
 * @returns {number} 总体标准差
 */
function populationStdOf(values) {
  if (!values || values.length < 2) return 0;
  const mean = meanOf(values);
  const variance = values.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

/**
 * 统计子串在文本中的非重叠出现次数。
 * @param {string} haystack 被检索文本
 * @param {string} needle 子串
 * @returns {number} 出现次数
 */
function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * 计算去停用标点后文本的字符 bigram TTR（类型数/总数）；不足 2 字符返回 0。
 * @param {string} letters 已去标点的字母串
 * @returns {number} bigram TTR（0-1）
 */
function computeBigramTtr(letters) {
  if (!letters || letters.length < 2) return 0;
  const types = new Set();
  for (let index = 1; index < letters.length; index += 1) {
    types.add(letters.charAt(index - 1) + letters.charAt(index));
  }
  return types.size / (letters.length - 1);
}

/**
 * 将数值四舍五入到固定小数位；非有限数值返回 null。
 * @param {*} value 待清洗的数值
 * @param {number} [digits=4] 保留小数位
 * @returns {number|null} 清洗后的数值
 */
function roundTo(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Number(num.toFixed(digits));
}

/**
 * 比率型线性计分：ratio ≤ fullRatio 记满分，≥ zeroRatio 记 0，中间线性过渡。
 * @param {number} ratio 待计分比率
 * @param {number} fullRatio 满分下界
 * @param {number} zeroRatio 零分上界
 * @param {number} points 满分分值
 * @returns {number} 计得的分值
 */
function linearRatioPoints(ratio, fullRatio, zeroRatio, points) {
  if (ratio <= fullRatio) return points;
  if (ratio >= zeroRatio) return 0;
  return (points * (zeroRatio - ratio)) / (zeroRatio - fullRatio);
}

/**
 * 套话密度型线性计分：value ≤ low 记 0，≥ high 记满分，中间线性过渡（两侧 clamp）。
 * @param {number} value 待计分密度
 * @param {number} low 零分下界
 * @param {number} high 满分上界
 * @param {number} points 满分分值
 * @returns {number} 计得的分值
 */
function linearBandPoints(value, low, high, points) {
  if (value <= low) return 0;
  if (value >= high) return points;
  return (points * (value - low)) / (high - low);
}

/**
 * 对文本计算 AI 味量化得分（0-100，越高越像 AI）。
 * @param {string} text 待检测文本
 * @param {object|null} profile 指纹基线画像（含 sentenceLenStd/ttr 字段），可为 null
 * @returns {{score:number, passed:boolean, metrics:object, details:object}} 检测结果
 */
function computeAiFlavorScore(text, profile) {
  const compact = compactText(text);
  if (!compact) {
    return {
      score: 0,
      passed: true,
      metrics: {
        sentenceStdRatio: null,
        ttrRatio: null,
        paragraphUniformity: 0,
        lexiconBlockPerKilo: 0,
        lexiconWatchPerKilo: 0
      },
      details: { blockHits: [], watchHits: [] }
    };
  }

  // 段落长度：按换行切段（单换行亦分段），段长为去空白后的字符数。
  const paragraphs = String(text == null ? '' : text).split(PARAGRAPH_SPLIT_PATTERN);
  const paragraphLengths = paragraphs
    .map(paragraph => compactText(paragraph).length)
    .filter(length => length > 0);
  const paragraphMean = meanOf(paragraphLengths);
  const paragraphStd = populationStdOf(paragraphLengths);
  const paragraphCv = paragraphMean && paragraphMean > 0 ? paragraphStd / paragraphMean : 0;

  // 结构性深层 AI 痕迹检测：
  // 1. 伪拟声/断语独立成段（如 咚。/咔嚓。/一声。/两声。）
  let pseudoFragCount = 0;
  for (const p of paragraphs) {
    const cl = compactText(p);
    if (cl.length > 0 && cl.length <= 6 && STRUCTURAL_AI_PATTERNS.pseudoFragmentation.test(cl)) {
      pseudoFragCount += 1;
    }
  }

  // 2. 回合制点名排队
  const turnTakingMatches = compact.match(STRUCTURAL_AI_PATTERNS.turnTaking) || [];
  const turnTakingCount = turnTakingMatches.length;

  // 3. 机械二元对称
  const binaryMatches = compact.match(STRUCTURAL_AI_PATTERNS.binarySymmetry) || [];
  const binarySymmetryCount = binaryMatches.length;

  // 4. 视听分镜式独立短行与因果说明断句
  let isolatedExplanatoryCount = 0;
  for (const p of paragraphs) {
    const cl = compactText(p);
    if (cl.length > 0 && cl.length <= 25 && !cl.startsWith('“') && !cl.startsWith('「') && !cl.startsWith('"')) {
      if (STRUCTURAL_AI_PATTERNS.isolatedExplanatory.test(cl)) {
        isolatedExplanatoryCount += 1;
      }
    }
  }

  let singleNarrativeCount = 0;
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed || trimmed.startsWith('“') || trimmed.startsWith('"') || trimmed.startsWith('‘') || trimmed.startsWith('##')) continue;
    const sentences = trimmed.split(/[。！？!?]/).filter(sentence => sentence.trim().length > 0);
    if (sentences.length <= 1) {
      singleNarrativeCount += 1;
    }
  }
  const somaticMatches = compact.match(STRUCTURAL_AI_PATTERNS.somaticOverreaction) || [];
  const somaticOverreactionCount = somaticMatches.length;
  const structuralRiskTotal = pseudoFragCount + turnTakingCount + binarySymmetryCount + isolatedExplanatoryCount + somaticOverreactionCount;

  // 句长：按。！？切句（句终符计入句长），求总体标准差。
  const sentenceLengths = compact
    .split(SENTENCE_SPLIT_PATTERN)
    .map(sentence => sentence.length)
    .filter(length => length > 0);
  const sentenceStd = populationStdOf(sentenceLengths);

  // 字符 bigram TTR：去停用标点后统计。
  const letters = compact.replace(STOP_PUNCTUATION_PATTERN, '');
  const ttr = computeBigramTtr(letters);

  // 词表命中：block 词与 watch 词分别累计出现次数（term 按字面子串计数）。
  const lexicon = loadAiFlavorLexicon();
  const blockHits = [];
  const watchHits = [];
  if (lexicon) {
    for (const entry of lexicon.entries) {
      const term = entry && typeof entry.term === 'string' ? entry.term : '';
      if (!term) continue;
      const count = countOccurrences(compact, term);
      if (count <= 0) continue;
      if (entry.recommendation === 'block') blockHits.push({ term, count });
      else if (entry.recommendation === 'watch') watchHits.push({ term, count });
    }
  }
  const blockHitTotal = blockHits.reduce((sum, hit) => sum + hit.count, 0);
  const watchHitTotal = watchHits.reduce((sum, hit) => sum + hit.count, 0);
  const densityDenominator = Math.max(compact.length, 1000);
  const lexiconBlockPerKilo = roundTo((blockHitTotal * 1000) / densityDenominator) || 0;
  const lexiconWatchPerKilo = roundTo((watchHitTotal * 1000) / densityDenominator) || 0;

  // 与指纹基线比较得比率；基线缺失（或字段无效）记 null 且不参与计分。
  const resolveProfileMetric = val => {
    if (val == null) return null;
    if (typeof val === 'number') return Number.isFinite(val) && val > 0 ? val : null;
    if (typeof val === 'object' && Number.isFinite(Number(val.mean)) && Number(val.mean) > 0) return Number(val.mean);
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const baselineStd = resolveProfileMetric(profile && profile.sentenceLenStd);
  const baselineTtr = resolveProfileMetric(profile && profile.ttr);
  const sentenceStdRatio = baselineStd !== null ? roundTo(sentenceStd / baselineStd) : null;
  const ttrRatio = baselineTtr !== null ? roundTo(ttr / baselineTtr) : null;

  // 四路加权求总分，再取整并 clamp 到 0-100。
  let score = 0;
  if (sentenceStdRatio !== null) {
    score += linearRatioPoints(sentenceStdRatio, SCORE_RULES.sentenceStd.fullRatio, SCORE_RULES.sentenceStd.zeroRatio, SCORE_RULES.sentenceStd.points);
  }
  if (ttrRatio !== null) {
    score += linearRatioPoints(ttrRatio, SCORE_RULES.ttr.fullRatio, SCORE_RULES.ttr.zeroRatio, SCORE_RULES.ttr.points);
  }
  if (paragraphCv < SCORE_RULES.paragraphCvThreshold) score += SCORE_RULES.paragraphCvPoints;
  score += linearBandPoints(lexiconBlockPerKilo, SCORE_RULES.blockPerKilo.low, SCORE_RULES.blockPerKilo.high, SCORE_RULES.blockPerKilo.points);
  score = Math.max(0, Math.min(100, Math.round(score)));

  const byCountDesc = (a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);
  blockHits.sort(byCountDesc);
  watchHits.sort(byCountDesc);

  return {
    score,
    passed: score < SCORE_RULES.passThreshold,
    metrics: {
      sentenceStdRatio,
      ttrRatio,
      paragraphUniformity: roundTo(paragraphCv) || 0,
      structuralRiskTotal,
      structuralSignalsAdvisory: true,
      lexiconBlockPerKilo,
      lexiconWatchPerKilo
    },
    details: { blockHits, watchHits, structuralRisks: { pseudoFragCount, turnTakingCount, binarySymmetryCount, isolatedExplanatoryCount, singleNarrativeCount, somaticOverreactionCount } }
  };
}

/**
 * 生成「AI 高频套话清单」中文指令块（注入改写 system 用）：
 * block 词按语料 PMF 升序取前 60 个（语料中越罕见越优先），watch 词取前 20 个；
 * 词表不可用或无可用词条时返回空字符串。
 * @returns {string} 词表指令块文本
 */
function buildHumanizeLexiconBlock() {
  const lexicon = loadAiFlavorLexicon();
  if (!lexicon) return '';
  const byPmfAsc = (a, b) => (Number(a.corpusPmf) || 0) - (Number(b.corpusPmf) || 0);
  const blockTerms = lexicon.entries
    .filter(entry => entry && entry.recommendation === 'block' && typeof entry.term === 'string' && entry.term)
    .sort(byPmfAsc)
    .slice(0, 60)
    .map(entry => entry.term);
  const watchTerms = lexicon.entries
    .filter(entry => entry && entry.recommendation === 'watch' && typeof entry.term === 'string' && entry.term)
    .sort(byPmfAsc)
    .slice(0, 20)
    .map(entry => entry.term);
  const parts = [];
  if (blockTerms.length > 0) {
    parts.push(`\u3010AI \u9ad8\u9891\u5957\u8bdd\u6e05\u5355\u3011\u4ee5\u4e0b\u8868\u8fbe\u5728\u7f51\u6587\u8bed\u6599\u4e2d\u6781\u5c11\u51fa\u73b0\u800c AI \u751f\u6210\u9ad8\u9891\uff0c\u6539\u5199\u65f6\u5168\u90e8\u66ff\u6362\u6216\u5220\u9664\uff1a${blockTerms.join('\u3001')}`);
  }
  if (watchTerms.length > 0) {
    parts.push(`\u4ee5\u4e0b\u4e3a\u89c2\u5bdf\u7ea7\uff08\u8bed\u6599\u4e2d\u53ef\u89c1\u4f46 AI \u751f\u6210\u504f\u9ad8\uff0c\u6ce8\u610f\u7528\u91cf\uff09\uff1a${watchTerms.join('\u3001')}`);
  }
  if (parts.length === 0) return '';
  return `${parts.join('\uff1b')}\u3002`;
}

module.exports = {
  loadAiFlavorLexicon,
  computeAiFlavorScore,
  buildHumanizeLexiconBlock
};
