'use strict';

/**
 * 范文对标度量库：把“对标范本”翻译成可测指标。
 * 全部为确定性本地计算，零模型成本；供 P0 基线、P2 审计、P3 评估与 P4 连续验证复用。
 */

const PROFILE_FIELDS = ['sentenceLenMean', 'sentenceLenStd', 'paragraphLenMean', 'paragraphLenStd', 'dialogueRatio', 'dialogueTurnMean', 'commaPeriodRatio', 'ttr', 'similePerKilo'];
const MEASUREMENT_VERSION = '2-utf16-nonwhitespace-line-sentences';
const DIALOGUE_PAIRS = { '“': '”', '「': '」', '『': '』', '"': '"' };
const SIMILE_PATTERN = /像|仿佛|宛如|如同|好似|恍若/gu;
const DIRECT_PSYCH_PATTERN = /(?:心里|心中|暗想|暗道|想着|想到|觉得|明白|知道|意识到|念头|不由得想|他想|她想)/u;
const ONOMATOPOEIA_PATTERN = /^(?:[咚砰哐轰嘭啪咔嚓嗖唰哗嘶呜嗡叮咣咻噗滋]{1,4}[——…！。]*|[一二三四五六七八九十]声[^，。]{0,4}[。！]?)$/u;
const NAME_VERB_PATTERN = /([\u4e00-\u9fa5]{2,3})(?:说道|说|道|问|笃|喊|叫|骂|笑道|冷笑|答道|回答|开口|抬头|低头|皱眉|摇头|点头|转身|站起|坐下|看着|盯着|走到|走向|伸手|拿起|放下)/gu;
const NAME_STOPWORDS = new Set(['自己', '他们', '她们', '我们', '你们', '有人', '众人', '所有', '这时', '那时', '此时', '然后', '于是', '只是', '但是', '不过', '突然', '忽然', '终于', '已经', '还是', '就是', '不是', '一个', '两个', '几个', '这个', '那个', '什么', '怎么', '没有', '不再', '再次', '一边', '一起', '对方', '旁边', '身后', '门口', '窗外', '眼前', '面前', '心里', '这里', '那里', '哪里', '老人', '少年', '女人', '男人', '孩子', '姑娘', '小子', '大人', '先生', '师父', '师兄', '师姐', '师妹', '师弟', '父亲', '母亲', '爹爹', '娘亲', '哥哥', '姐姐', '弟弟', '妹妹', '叔叔', '爷爷', '奶奶', '老板', '掌柜', '店主', '伙计', '小二', '将军', '公子', '小姐', '夫人', '陛下', '殿下', '大哥', '兄弟', '前辈', '后辈', '长老', '掌门', '宗主', '族长', '队长', '教官', '老师', '同学', '医生', '护士', '警察', '司机']);

/** 四舍五入到固定小数位，避免浮点噪声。 */
function roundTo(value, digits = 4) {
  return Number((Number(value) || 0).toFixed(digits));
}

/** 去空白后的纯文本与段落数组。 */
function paragraphsOf(text) {
  return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

/** 中文句子切分（以句终符为界），过滤空片段。 */
function sentencesOf(text) {
  return paragraphsOf(text).flatMap(paragraph => (paragraph.replace(/\s+/gu, '').match(/[^。！？!?]+(?:[。！？!?]+[”’」』"']*)?|[。！？!?]+[”’」』"']*/gu) || []).filter(item => /[^。！？!?“”‘’「」『』"']/u.test(item)));
}

/**
 * 9 字段风格指纹，与 scripts/build-style-fingerprints.mjs 及编辑器 computeTextFingerprint 同构。
 */
function computeTextFingerprint(text) {
  const acc = { totalChars: 0, sentenceCount: 0, sentenceLenSum: 0, sentenceLenSumSq: 0, pendingSentenceLen: 0, paragraphCount: 0, paragraphLenSum: 0, paragraphLenSumSq: 0, inDialogue: false, currentTurnLen: 0, dialogueCharCount: 0, dialogueTurnCount: 0, dialogueTurnLenSum: 0, commaCount: 0, periodCount: 0, simileHitCount: 0, bigramTotal: 0, bigramTypes: new Set(), pendingBigramChar: '' };
  const recordSentence = length => { acc.sentenceCount += 1; acc.sentenceLenSum += length; acc.sentenceLenSumSq += length * length; };
  const recordParagraph = length => { acc.paragraphCount += 1; acc.paragraphLenSum += length; acc.paragraphLenSumSq += length * length; };
  for (const line of String(text || '').split('\n')) {
    const compact = String(line ?? '').replace(/\s+/gu, '');
    if (!compact) continue;
    acc.totalChars += compact.length;
    // 每个非空行视为一段：范本原文一段一行（等价于空行分段），生成正文多为单换行分段。
    recordParagraph(compact.length);
    for (const sentence of sentencesOf(compact)) recordSentence(sentence.length);
    acc.commaCount += (compact.match(/，/gu) || []).length;
    acc.periodCount += (compact.match(/。/gu) || []).length;
    acc.simileHitCount += (compact.match(SIMILE_PATTERN) || []).length;
    for (const ch of compact) {
      if (!acc.inDialogue && Object.hasOwn(DIALOGUE_PAIRS, ch)) {
        acc.inDialogue = true;
        acc.dialogueClose = DIALOGUE_PAIRS[ch];
        acc.currentTurnLen = 0;
      } else if (acc.inDialogue && ch === acc.dialogueClose) {
        acc.dialogueTurnCount += 1;
        acc.dialogueTurnLenSum += acc.currentTurnLen;
        acc.dialogueCharCount += acc.currentTurnLen;
        acc.inDialogue = false;
        acc.currentTurnLen = 0;
      } else if (acc.inDialogue) acc.currentTurnLen += ch.length;
    }
    const filtered = compact.replace(/[\p{P}\p{S}]/gu, '');
    let previous = acc.pendingBigramChar;
    for (const ch of filtered) {
      if (previous) { acc.bigramTotal += 1; acc.bigramTypes.add(previous + ch); }
      previous = ch;
    }
    acc.pendingBigramChar = previous;
  }
  const sentenceMean = acc.sentenceCount > 0 ? acc.sentenceLenSum / acc.sentenceCount : 0;
  const sentenceStd = acc.sentenceCount > 1 ? Math.sqrt(Math.max(0, acc.sentenceLenSumSq / acc.sentenceCount - sentenceMean * sentenceMean)) : 0;
  const paragraphMean = acc.paragraphCount > 0 ? acc.paragraphLenSum / acc.paragraphCount : 0;
  const paragraphStd = acc.paragraphCount > 1 ? Math.sqrt(Math.max(0, acc.paragraphLenSumSq / acc.paragraphCount - paragraphMean * paragraphMean)) : 0;
  return {
    sentenceLenMean: roundTo(sentenceMean), sentenceLenStd: roundTo(sentenceStd),
    paragraphLenMean: roundTo(paragraphMean), paragraphLenStd: roundTo(paragraphStd),
    dialogueRatio: acc.totalChars > 0 ? roundTo(acc.dialogueCharCount / acc.totalChars, 6) : 0,
    dialogueTurnMean: acc.dialogueTurnCount > 0 ? roundTo(acc.dialogueTurnLenSum / acc.dialogueTurnCount) : 0,
    commaPeriodRatio: acc.periodCount > 0 ? roundTo(acc.commaCount / acc.periodCount) : null,
    ttr: acc.bigramTotal > 0 ? roundTo(acc.bigramTypes.size / acc.bigramTotal, 6) : 0,
    similePerKilo: acc.totalChars > 0 ? roundTo(acc.simileHitCount * 1000 / acc.totalChars) : 0,
    totalChars: acc.totalChars
  };
}

/** 文风距离：逐字段相对基线均值偏差（基线标准差归一），输出 0-100 分与逐项明细。 */
function computeStyleDistance(fingerprint, baseline) {
  if (!fingerprint || !baseline || typeof baseline !== 'object') return null;
  const perField = {};
  let devSum = 0;
  let counted = 0;
  for (const [field, stat] of Object.entries(baseline)) {
    if (!PROFILE_FIELDS.includes(field)) continue;
    const mean = stat?.mean;
    const stdDev = stat?.stdDev;
    const value = fingerprint[field];
    if (!Number.isFinite(mean) || !Number.isFinite(value)) continue;
    const denom = Math.max(Math.abs(mean), stdDev > 0 ? stdDev : Math.abs(mean) * 0.15, 0.05);
    const deviation = Math.min(3, Math.abs(value - mean) / denom);
    perField[field] = { value, mean, deviation: Number(deviation.toFixed(3)) };
    devSum += deviation;
    counted += 1;
  }
  if (!counted) return null;
  return { score: Math.max(0, Math.round(100 - (devSum / counted) * 45)), perField };
}

/** 从多份指纹聚合基线（mean/stdDev），供题材基线构建使用。 */
function aggregateBaseline(fingerprints) {
  const rows = (Array.isArray(fingerprints) ? fingerprints : []).filter(Boolean);
  const baseline = {};
  for (const field of PROFILE_FIELDS) {
    const values = rows.map(row => row[field]).filter(Number.isFinite);
    if (!values.length) continue;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    baseline[field] = { mean: roundTo(mean), stdDev: roundTo(Math.sqrt(variance)), count: values.length };
  }
  return baseline;
}

/**
 * 范本结构统计（P1 题材基线新增维度）：单句段占比、直接心理句占比、拟声独立段占比、
 * 开篇方式（对白起/场景起/设定起）、章末钩子类型、章长、对白段占比。
 */
function computeStructureStats(text) {
  const paragraphs = paragraphsOf(text);
  const sentences = sentencesOf(text);
  const singleSentenceParagraphs = paragraphs.filter(paragraph => sentencesOf(paragraph).length === 1 && paragraph.replace(/\s/gu, '').length <= 40).length;
  const directPsychSentences = sentences.filter(sentence => !/^[“"「『]/u.test(sentence) && DIRECT_PSYCH_PATTERN.test(sentence)).length;
  const onomatopoeiaParagraphs = paragraphs.filter(paragraph => ONOMATOPOEIA_PATTERN.test(paragraph)).length;
  const dialogueParagraphs = paragraphs.filter(paragraph => /“[^”]+”|"[^"]+"|「[^」]+」|『[^』]+』/u.test(paragraph)).length;
  const opening = paragraphs.slice(0, 3).join('');
  let openingMode = 'scene';
  if (/^[“"「『]/u.test(paragraphs[0] || '')) openingMode = 'dialogue';
  else if (/(?:年前|以来|自从|据说|传说|这个世界|这片大陆|所谓|乃是|是[^，。]{0,6}(?:之一|最|第一))/u.test(opening) && !/“/.test(opening)) openingMode = 'exposition';
  const tail = paragraphs.slice(-3).join('');
  let endingMode = 'unknown';
  if (/[？?][”’」』"']*$/u.test(tail) || /(?:为什么|怎么会|到底|究竟|是谁|什么人)/u.test(tail)) endingMode = 'question';
  else if (/(?:突然|忽然|就在这时|这时|门外|响起|传来|冲进|出现|一道|炸开|轰)/u.test(tail)) endingMode = 'newProblem';
  else if (/(?:终于|总算|松了口气|结束|落下|安静|睡去|离开|回到|收起|放下)/u.test(tail)) endingMode = 'fulfil';
  else if (/(?:却|但|然而|可是|没想到|反而)/u.test(tail)) endingMode = 'turn';
  return {
    chars: String(text || '').replace(/\s+/gu, '').length,
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    singleSentenceParagraphRatio: paragraphs.length ? roundTo(singleSentenceParagraphs / paragraphs.length) : 0,
    directPsychRatio: sentences.length ? roundTo(directPsychSentences / sentences.length) : 0,
    onomatopoeiaParagraphRatio: paragraphs.length ? roundTo(onomatopoeiaParagraphs / paragraphs.length) : 0,
    dialogueParagraphRatio: paragraphs.length ? roundTo(dialogueParagraphs / paragraphs.length) : 0,
    openingMode,
    endingMode,
    endingModeMethod: 'last-three-paragraphs-keyword-heuristic-not-semantic-review',
    measurementVersion: MEASUREMENT_VERSION
  };
}

/** 启发式提取正文中的人名候选（名+动作动词），排除常见称谓词。 */
function extractNameCandidates(text) {
  const counts = new Map();
  for (const match of String(text || '').matchAll(NAME_VERB_PATTERN)) {
    const name = match[1];
    if (NAME_STOPWORDS.has(name) || /^[的了着过在是不也都又就把被让]/.test(name) || /[的了着过在是不也都又就把被让]$/.test(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

/** 人名两两共字检测：返回共享汉字的人名对。 */
function nameCharacterOverlap(names) {
  const list = [...new Set((Array.isArray(names) ? names : []).map(name => String(name || '').trim()).filter(name => name.length >= 2))];
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const shared = [...new Set([...list[i]].filter(ch => list[j].includes(ch)))];
      if (shared.length) pairs.push({ a: list[i], b: list[j], shared });
    }
  }
  return pairs;
}

/** 字符 n-gram 重合率：正文与参考样本共享的 n-gram 类型占正文 n-gram 类型的比例。 */
function ngramOverlap(text, references, size = 8) {
  const source = String(text || '').replace(/[\s\p{P}]/gu, '');
  const grams = new Set();
  for (let index = 0; index + size <= source.length; index += 1) grams.add(source.slice(index, index + size));
  if (!grams.size) return { ratio: 0, hits: [] };
  const refText = (Array.isArray(references) ? references : [references]).map(item => String(item || '').replace(/[\s\p{P}]/gu, '')).join('\u0000');
  const hits = [];
  for (const gram of grams) if (refText.includes(gram)) hits.push(gram);
  return { ratio: roundTo(hits.length / grams.size, 6), hits: hits.slice(0, 20) };
}

/**
 * 硬约束检查：字数偏离、20 字前缀重复段、重复句/状态短语、新专名数量、人名共字。
 * options: { targetWords, tolerance(0.15), knownEntities: string[], maxNewNames(8) }
 */
function hardConstraintChecks(text, options = {}) {
  const targetWords = Number(options.targetWords) || 0;
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 0.15;
  const known = new Set((Array.isArray(options.knownEntities) ? options.knownEntities : []).map(item => String(item || '').trim()).filter(Boolean));
  const maxNewNames = Number(options.maxNewNames) || 8;
  const issues = [];
  const chars = String(text || '').replace(/\s+/gu, '').length;
  if (targetWords > 0 && (chars < targetWords * (1 - tolerance) || chars > targetWords * (1 + tolerance))) {
    issues.push({ code: 'word_count', severity: 'warning', detail: `字数 ${chars}，目标 ${targetWords}±${Math.round(tolerance * 100)}%` });
  }
  const paragraphs = paragraphsOf(text).filter(item => item.length >= 12);
  const seenPrefix = new Map();
  const duplicateParagraphs = [];
  paragraphs.forEach((paragraph, index) => {
    const key = paragraph.slice(0, 20);
    if (seenPrefix.has(key)) duplicateParagraphs.push({ first: seenPrefix.get(key), second: index + 1, text: key });
    else seenPrefix.set(key, index + 1);
  });
  if (duplicateParagraphs.length) issues.push({ code: 'duplicate_paragraph', severity: 'blocker', detail: `${duplicateParagraphs.length} 处 20 字前缀重复段`, samples: duplicateParagraphs.slice(0, 3) });
  const sentenceCount = new Map();
  for (const sentence of sentencesOf(text).filter(item => item.length >= 15)) {
    const key = sentence.slice(0, 18);
    sentenceCount.set(key, (sentenceCount.get(key) || 0) + 1);
  }
  const repeated = [...sentenceCount.entries()].filter(([, count]) => count >= 3);
  if (repeated.length) issues.push({ code: 'repeated_state', severity: 'warning', detail: `${repeated.length} 个句子/状态短语出现 ≥3 次`, samples: repeated.slice(0, 3).map(([key, count]) => ({ text: key, count })) });
  const names = extractNameCandidates(text);
  const newNames = names.filter(item => !known.has(item.name) && ![...known].some(entity => entity.includes(item.name) || item.name.includes(entity)));
  if (newNames.length > maxNewNames) issues.push({ code: 'new_names', severity: 'warning', detail: `本章新专名候选 ${newNames.length} 个 > ${maxNewNames}`, samples: newNames.slice(0, 10).map(item => item.name) });
  const overlapPairs = nameCharacterOverlap(names.map(item => item.name));
  if (overlapPairs.length) issues.push({ code: 'name_char_overlap', severity: 'info', detail: `${overlapPairs.length} 对人名共享汉字`, samples: overlapPairs.slice(0, 5) });
  return { chars, issues, names, newNames: newNames.map(item => item.name), duplicateParagraphs, repeatedSentences: repeated.length, passed: !issues.some(item => item.severity === 'blocker') };
}

/** 汇总一章的全部确定性指标，供基线表与评估表使用。 */
function summarizeChapter(text, options = {}) {
  const fingerprint = computeTextFingerprint(text);
  const structure = computeStructureStats(text);
  const hard = hardConstraintChecks(text, options);
  const styleDistance = options.baseline ? computeStyleDistance(fingerprint, options.baseline) : null;
  return { fingerprint, structure, hard: { passed: hard.passed, issues: hard.issues, newNameCount: hard.newNames.length, repeatedSentences: hard.repeatedSentences, duplicateParagraphs: hard.duplicateParagraphs.length }, styleDistance };
}

module.exports = { MEASUREMENT_VERSION, PROFILE_FIELDS, computeTextFingerprint, computeStyleDistance, aggregateBaseline, computeStructureStats, extractNameCandidates, nameCharacterOverlap, ngramOverlap, hardConstraintChecks, summarizeChapter, paragraphsOf, sentencesOf };
