// 去AI味词表挖掘脚本（双源对照法）。
// 目标：生成“AI 高频而语料低频”的去 AI 味词表，不依赖历史生成文本（本地无存档）。
// 双源对照：
//   ① 候选池 = correction-policy.js 中 UNIVERSAL_CORRECTION_RULES（R-01~R-18）正则里的字面词/短语
//              + 内置常见 AI 套话候选清单（120+ 条）；
//   ② 语料基线 = 从 ../资源库/小说原本 各题材桶抽样原书（只读），统计每个候选词的
//              每百万字频率（PMF，字数口径：去除空白后的字符数，与资源库管线一致）。
// 分级规则：manual 候选词 corpusPmf < 5 → block；5~30 → watch；> 30 → 语料常用词，丢弃。
//           correction-policy 正则字面词不受 PMF 分级约束，直接 block（纠错库本身已禁用）。
// 输出：molan-home/data/ai-flavor-lexicon.json（schemaVersion: ai-flavor-lexicon-1）。
// 安全约束：本脚本对 资源库 目录只读，绝不向其写入任何文件（输出前有路径越界断言）。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const SCRIPT_DIR = import.meta.dirname;
const MOLAN_HOME = path.resolve(SCRIPT_DIR, '..');
const CORPUS_ROOT = path.resolve(MOLAN_HOME, '..', '资源库', '小说原本');
const OUTPUT_PATH = path.join(MOLAN_HOME, 'data', 'ai-flavor-lexicon.json');
const SCHEMA_VERSION = 'ai-flavor-lexicon-1';
const LEXICON_VERSION_PREFIX = 'ai-flavor-lexicon-v1';

// 语料抽样总量目标（约 40 本）。实际题材桶数较多时，每桶抽样数按总量目标自适应
// （每桶至少 1 本、至多 4 本），在“共约 40 本”与“覆盖所有题材桶”之间取平衡。
const TARGET_TOTAL_BOOKS = 40;
const MIN_PER_BUCKET = 1;
const MAX_PER_BUCKET = 4;

// PMF（每百万字频率）分级阈值：< 5 → block；5~30 → watch；> 30 → 语料常用词，丢弃。
const BLOCK_PMF_BELOW = 5;
const WATCH_PMF_MAX = 30;

// 模式候选词（含 ".*" 通配）编译为正则时的间隔片段：跨句标点即断开。
const PATTERN_GAP_SOURCE = '[^。！？\\n]{0,40}';

// ============ ① 内置常见 AI 套话候选清单（含任务指定示例，扩展至 120+） ============
const MANUAL_CANDIDATES = [
  // —— 任务指定示例 ——
  '无与伦比', '令人叹为观止', '深深地', '缓缓地', '微微地', '展现出', '彰显出', '体现出',
  '独一无二', '意义非凡', '在这个.*的时代', '随着.*的发展', '仿佛', '似乎', '宛如',
  '不是.*而是', '一丝', '一缕', '一股', '嘴角勾起', '眼底闪过', '空气仿佛凝固', '时间仿佛静止',
  '心脏猛地一缩', '指尖冰冷', '不可抑制地', '不由自主地', '显而易见', '毋庸置疑', '与此同时',
  '话音刚落', '刹那间', '霎时间', '瞳孔骤缩', '倒吸一口凉气', '如遭雷击', '久久不能平静',
  '思绪万千', '百感交集',
  // —— 神态反应套话 ——
  '嘴角上扬', '嘴角微微上扬', '勾起一抹', '一抹笑意', '一抹精光', '眼神深邃', '眼眸深邃',
  '深邃的眼眸', '眼底掠过', '眸光一闪', '眸中闪过', '眸光闪烁', '眉头微蹙', '眉头紧锁',
  '神色凝重', '面色凝重', '脸色骤变', '瞳孔猛地一缩', '呼吸一滞', '心头一紧', '心猛地一沉',
  '心中一凛', '心里咯噔一下', '后背发凉', '冷汗涔涔', '身形一僵', '身体一僵', '脚步一顿',
  '戛然而止', '空气骤然安静', '落针可闻', '气氛凝固', '大脑一片空白', '骇然失色',
  '睫毛颤了颤', '指节泛白',
  // —— 旁白议论/情绪标签套话 ——
  '复杂的情绪', '五味杂陈', '心潮澎湃', '难以言喻', '难以名状', '一言难尽', '神色复杂',
  '神情复杂', '目光复杂', '眼神复杂', '语气凝重', '声音里带着', '语气里带着', '带着几分',
  '众所周知', '不可否认', '值得一提的是', '需要指出的是', '总而言之', '综上所述',
  '换句话说', '简而言之', '从某种意义上说', '在某种程度上', '不得不说', '不禁让人',
  '让人不由得', '由此可见', '毫无疑问', '更重要的是', '值得注意的是', '不仅如此',
  // —— 拔高预告/宏大叙事套话 ——
  '更大的风暴', '暗流涌动', '山雨欲来', '命运的齿轮开始转动', '一切都变了', '从这一刻起',
  '注定不平凡', '拉开了序幕', '新的篇章', '属于他的传奇', '内心深处', '灵魂深处',
  '仿佛过了一个世纪', '世界仿佛安静了下来', '脑海中闪过', '脑海中浮现', '脑海里回荡',
  // —— 高频修饰副词/时间状语 ——
  '缓缓开口', '缓缓说道', '淡淡说道', '淡淡道', '微微一笑', '微微颔首', '微微一怔',
  '不由得', '下意识地', '情不自禁地', '猛地', '蓦地', '骤然', '陡然', '倏然', '顿时',
  '一瞬间', '宛若', '犹如', '好似', '恍若', '而在此时', '就在这时', '说时迟那时快',
  '电光石火之间', '顷刻间',
  // —— 比喻/感官修辞套话 ——
  '锐利的目光', '冰冷的目光', '冰冷的语气', '冷冽的气息', '强大的气场', '无形的威压',
  '淡淡的笑意', '浅浅一笑', '意味深长', '似笑非笑', '似有深意', '高深莫测',
  '让人捉摸不透', '令人心安', '令人窒息', '令人心悸', '不寒而栗', '毛骨悚然', '头皮发麻',
  '头皮一阵发麻', '直勾勾', '一眨不眨', '仿佛在诉说着', '无声地诉说着', '深深地看了一眼',
  '定定地看着', '回过神来', '眼前一亮', '灵光一闪', '四目相对', '相视一笑', '指尖摩挲',
  '揉了揉眉心'
];

// ============ 纠错规则正则字面词提取时的普通语境词过滤表 ============
// 这些词在 R-01~R-18 正则中仅充当“组合模板”的语境成分（主语/动词/情绪名词等），
// 单独出现属于正常汉语或正常网文用词（如“声音/目光/带着/愣住/杀意”），
// 只有在纠错规则的组合模板中才构成问题，因此不作为独立词条进入词表。
const GENERIC_CONTEXT_TERMS = [
  // 语境名词/主语（含同步群体反应模板 R-07 的主语）
  '声音', '语气', '目光', '指尖', '笔尖', '嘴角', '双腿', '手臂', '身体', '嗓子',
  '所有人', '全场', '众人', '整个大厅',
  // 语境动词/助词
  '带着', '不是', '而是', '本想', '因为', '看到', '发现', '于是', '转而', '改为', '还能',
  '依旧', '可以', '依旧可以', '之前', '离开', '赶在', '做出', '决定', '停在', '顿在', '扫过', '落在',
  '勾起', '战斗', '说话', '发声', '颤栗', '抽搐', '一下', '漏出', '漏来', '飘出', '飘来',
  '渗入', '渗出', '化作', '得很',
  // 普通群体反应词（仅在“所有人+反应”模板中成问题）
  '愣住', '沉默', '惊呆',
  // 普通形容词（仅在“得很X”等模板中成问题）
  '平静', '凝重', '决绝',
  // 普通情绪名词（仅在“满是/一丝 + 情绪”模板中成问题）
  '心疼', '无奈', '紧张', '忐忑', '恐惧', '愤怒', '悲伤', '担忧', '决然', '柔情', '杀意',
  '冷意', '寒意', '阴鸷', '复杂', '贪婪', '深沉', '威压', '疲惫', '玩味', '挣扎', '狠厉',
  '疯狂', '精芒', '茫然', '释然', '笑容', '冷笑', '阴狠', '自得'
];

/** 加载墨阑通用纠错库的 R-01~R-18 规则（correction-policy.js 为 CommonJS 模块）。
 * 参数：无。
 * 返回值：UNIVERSAL_CORRECTION_RULES 规则数组。
 */
function loadCorrectionRules() {
  const requireCjs = createRequire(import.meta.url);
  const policy = requireCjs(path.join(MOLAN_HOME, 'correction-policy.js'));
  return policy.UNIVERSAL_CORRECTION_RULES;
}

/** 从纠错规则的正则源码中提取纯字面词/短语：
 * 跳过字符类 [...] 与转义序列，按正则元字符切分，仅保留长度 ≥ 2 且含汉字的字面片段。
 * 参数：pattern 为纠错规则中的 RegExp 对象。
 * 返回值：该规则提取到的字面词数组（模板型规则可能提取不到可独立成词的字面量）。
 */
function extractLiteralTermsFromPattern(pattern) {
  const source = pattern.source;
  const runs = [];
  let current = '';
  // 把已累积的字面片段收进结果并清空当前累积。
  const flush = () => {
    if (current) {
      runs.push(current);
      current = '';
    }
  };
  let index = 0;
  while (index < source.length) {
    const ch = source[index];
    if (ch === '\\') {
      // 转义序列（如 \n、\.）视为边界，不产生字面片段
      flush();
      index += 2;
      continue;
    }
    if (ch === '[') {
      // 字符类 [...] 整体视为通配边界（如 [^。！？\n]{0,24}）
      const close = source.indexOf(']', index);
      index = close === -1 ? source.length : close + 1;
      flush();
      continue;
    }
    if ('(){}|?*+.:^$,'.includes(ch)) {
      // 正则元字符（分组、量词、 alternation 分隔符等）视为边界
      flush();
      index += 1;
      continue;
    }
    current += ch;
    index += 1;
  }
  flush();
  return runs.filter((run) => run.length >= 2 && /[\u4e00-\u9fff]/.test(run));
}

/** 汇总 R-01~R-18 全部规则的字面词（剔除普通语境词）。
 * 参数：rules 为纠错规则数组。
 * 返回值：字面词 Set（correction-policy 来源词条集合）。
 */
function collectCorrectionPolicyTerms(rules) {
  const generic = new Set(GENERIC_CONTEXT_TERMS);
  const terms = new Set();
  for (const rule of rules) {
    for (const term of extractLiteralTermsFromPattern(rule.pattern)) {
      if (generic.has(term)) continue;
      terms.add(term);
    }
  }
  return terms;
}

/** 列出语料库下的全部题材桶（一级子目录，且桶内确有 txt 原书；只读操作）。
 * 参数：corpusRoot 为 资源库/小说原本 的绝对路径。
 * 返回值：[{ bucket, dir, files }]，files 为按文件名排序的 txt 文件名数组。
 */
function listCorpusBuckets(corpusRoot) {
  const entries = fs.readdirSync(corpusRoot, { withFileTypes: true });
  const buckets = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(corpusRoot, entry.name);
    const files = fs.readdirSync(dir)
      .filter((name) => name.toLowerCase().endsWith('.txt'))
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .sort();
    if (files.length) buckets.push({ bucket: entry.name, dir, files });
  }
  buckets.sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : 0));
  return buckets;
}

/** 计算每个题材桶的抽样本数：按总量目标自适应，
 * 每桶至少 1 本、至多 4 本（桶数很多时每桶少抽，桶数很少时每桶多抽）。
 * 参数：bucketCount 为题材桶总数。
 * 返回值：每桶抽样本数。
 */
function resolvePerBucketQuota(bucketCount) {
  if (bucketCount <= 0) return 0;
  const quota = Math.round(TARGET_TOTAL_BOOKS / bucketCount);
  return Math.max(MIN_PER_BUCKET, Math.min(MAX_PER_BUCKET, quota));
}

/** 计算从 total 个候选中均匀抽取 pick 个的下标（确定性抽样，保证结果可复现）。
 * 参数：total 为候选总数；pick 为抽取数量（1 ≤ pick，可为 1）。
 * 返回值：升序下标数组。
 */
function pickSpreadIndices(total, pick) {
  if (pick >= total) return Array.from({ length: total }, (_, i) => i);
  if (pick <= 1) return [Math.floor((total - 1) / 2)];
  return Array.from({ length: pick }, (_, i) => Math.round((i * (total - 1)) / (pick - 1)));
}

/** 从各题材桶确定性抽样原书清单（只读，不写入任何文件）。
 * 参数：corpusRoot 为语料根目录；targetTotal 为总量目标（用于自适应每桶抽样数）。
 * 返回值：{ bucketCount, quota, books: [{ bucket, file, filePath }] }。
 */
function selectSampleBooks(corpusRoot, targetTotal) {
  const buckets = listCorpusBuckets(corpusRoot);
  const quota = resolvePerBucketQuota(buckets.length);
  const books = [];
  for (const { bucket, dir, files } of buckets) {
    for (const index of pickSpreadIndices(files.length, quota)) {
      const file = files[index];
      books.push({ bucket, file, filePath: path.join(dir, file) });
    }
  }
  return { bucketCount: buckets.length, quota, books, targetTotal };
}

/** 读取单本原书并归一化：按 UTF-8 解码（与资源库管线口径一致）、去 BOM、去除全部空白。
 * 去空白后的文本既用于词频统计（可命中跨行断开的词），也用于“字数”统计口径
 * （资源库口径：去除空白后的字符数）。
 * 参数：filePath 为原书 txt 绝对路径（只读）。
 * 返回值：归一化后的正文文本。
 */
function normalizeCorpusText(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('utf8').replace(/^\uFEFF/, '').replace(/\s/g, '');
}

/** 统计普通字面词在文本中的非重叠出现次数。
 * 参数：text 为已归一化正文；term 为字面词。
 * 返回值：出现次数。
 */
function countPlainOccurrences(text, term) {
  let count = 0;
  let pos = text.indexOf(term);
  while (pos !== -1) {
    count += 1;
    pos = text.indexOf(term, pos + term.length);
  }
  return count;
}

/** 把含 ".*" 通配的模式候选词编译为全局正则（间隔片段跨句标点即断开）。
 * 参数：term 为形如 “在这个.*的时代” 的模式候选词。
 * 返回值：全局 RegExp；编译失败返回 null。
 */
function compilePatternTerm(term) {
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const source = term.split('.*').map(escapeRegex).join(PATTERN_GAP_SOURCE);
  try {
    return new RegExp(source, 'g');
  } catch {
    return null;
  }
}

/** 统计模式词（含 ".*" 通配）在文本中的匹配次数。
 * 参数：text 为已归一化正文；regex 为编译好的全局正则。
 * 返回值：匹配次数。
 */
function countPatternOccurrences(text, regex) {
  regex.lastIndex = 0;
  let count = 0;
  let match = regex.exec(text);
  while (match !== null) {
    count += 1;
    if (match[0].length === 0) regex.lastIndex += 1; // 防御零宽匹配导致死循环
    match = regex.exec(text);
  }
  return count;
}

/** 扫描抽样语料，统计全部候选词的出现次数与总字数。
 * 参数：books 为抽样书清单；terms 为全部候选词数组。
 * 返回值：{ counts: Map<term, 次数>, totalChars, bookStats: [{ bucket, file, chars }] }。
 */
function scanCorpus(books, terms) {
  const patternRegexes = new Map();
  for (const term of terms) {
    if (term.includes('.*')) {
      const regex = compilePatternTerm(term);
      if (regex) patternRegexes.set(term, regex);
    }
  }
  const counts = new Map(terms.map((term) => [term, 0]));
  const bookStats = [];
  let totalChars = 0;
  for (const book of books) {
    const text = normalizeCorpusText(book.filePath);
    totalChars += text.length;
    bookStats.push({ bucket: book.bucket, file: book.file, chars: text.length });
    for (const term of terms) {
      const regex = patternRegexes.get(term);
      const hits = regex ? countPatternOccurrences(text, regex) : countPlainOccurrences(text, term);
      if (hits) counts.set(term, counts.get(term) + hits);
    }
    console.log(`[语料] ${book.bucket}/${book.file} · ${text.length.toLocaleString('zh-CN')} 字`);
  }
  return { counts, totalChars, bookStats };
}

/** 计算每百万字频率（PMF），四舍五入保留两位小数（分级判断基于该舍入值，保证输出自洽）。
 * 参数：count 为候选词出现次数；totalChars 为语料总字数。
 * 返回值：PMF 数值；总字数为 0 时返回 0。
 */
function computePmf(count, totalChars) {
  if (totalChars <= 0) return 0;
  return Math.round((count / totalChars) * 1e6 * 100) / 100;
}

/** 依据 PMF 对 manual 候选词分级：corpusPmf < 5 → block；5~30 → watch；> 30 → 语料常用词，丢弃。
 * 参数：pmf 为候选词的语料 PMF。
 * 返回值：'block' | 'watch' | null（null 表示按语料常用词丢弃）。
 */
function classifyByPmf(pmf) {
  if (pmf < BLOCK_PMF_BELOW) return 'block';
  if (pmf <= WATCH_PMF_MAX) return 'watch';
  return null;
}

/** 组装词表输出对象：correction-policy 字面词直接 block；manual 候选词按 PMF 分级，
 * PMF > 30 的 manual 候选视为语料常用词丢弃；与纠错规则字面词重合的候选统一归 correction-policy。
 * 参数：cpTerms 为纠错规则字面词集合；manualTerms 为内置候选清单（已去重）；
 *       counts 为词频统计；totalChars 为语料总字数；corpusMeta 为语料抽样元信息；
 *       generatedAt 为生成时间（Date 对象）。
 * 返回值：符合 ai-flavor-lexicon-1 结构的输出对象。
 */
function buildLexiconOutput(cpTerms, manualTerms, counts, totalChars, corpusMeta, generatedAt) {
  const entries = [];
  let discardedManualCount = 0;
  for (const term of manualTerms) {
    if (cpTerms.has(term)) continue; // 重合词条按 correction-policy 处理
    const pmf = computePmf(counts.get(term) || 0, totalChars);
    const recommendation = classifyByPmf(pmf);
    if (!recommendation) {
      discardedManualCount += 1; // 语料常用词（PMF > 30），说明是正常网文用词，丢弃
      continue;
    }
    entries.push({ term, corpusPmf: pmf, source: 'manual', recommendation });
  }
  for (const term of cpTerms) {
    const pmf = computePmf(counts.get(term) || 0, totalChars);
    entries.push({ term, corpusPmf: pmf, source: 'correction-policy', recommendation: 'block' });
  }
  // 排序：block 在前，其次按语料 PMF 升序（越低越“AI 专属”），最后按词面稳定排序。
  entries.sort((a, b) => {
    if (a.recommendation !== b.recommendation) return a.recommendation === 'block' ? -1 : 1;
    if (a.corpusPmf !== b.corpusPmf) return a.corpusPmf - b.corpusPmf;
    return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
  });
  const blockCount = entries.filter((entry) => entry.recommendation === 'block').length;
  const watchCount = entries.length - blockCount;
  const date = generatedAt.toISOString().slice(0, 10);
  return {
    schemaVersion: SCHEMA_VERSION,
    version: `${LEXICON_VERSION_PREFIX}-${date}`,
    generatedAt: generatedAt.toISOString(),
    corpus: {
      root: '资源库/小说原本',
      bucketCount: corpusMeta.bucketCount,
      bookCount: corpusMeta.bookStats.length,
      totalChars,
      perBucketQuota: corpusMeta.quota,
      samplingNote: `语料库实际题材桶数较多，按“抽样总量约 ${TARGET_TOTAL_BOOKS} 本”优先，自适应为每桶 ${corpusMeta.quota} 本；全库只读，未向资源库写入任何文件。`,
      books: corpusMeta.bookStats
    },
    thresholds: {
      unit: '每百万字频率（PMF）',
      blockBelowPmf: BLOCK_PMF_BELOW,
      watchBelowPmf: WATCH_PMF_MAX,
      discardAbovePmf: WATCH_PMF_MAX
    },
    stats: {
      manualCandidates: manualTerms.length,
      correctionPolicyTerms: cpTerms.size,
      entryCount: entries.length,
      blockCount,
      watchCount,
      discardedManualCount
    },
    entries
  };
}

/** 校验输出路径只会落在 molan-home 内部，绝不写入 资源库 目录。
 * 参数：outputPath 为计划写入的绝对路径。
 * 返回值：无（路径越界时直接抛错终止）。
 */
function assertSafeOutputPath(outputPath) {
  const relative = path.relative(MOLAN_HOME, outputPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`输出路径越界（必须位于 ${MOLAN_HOME} 内）：${outputPath}`);
  }
}

/** 主流程：加载纠错规则 → 组装双源候选池 → 抽样语料统计 PMF → 生成词表 JSON 并打印摘要。
 * 参数：无。
 * 返回值：无（结果写入 molan-home/data/ai-flavor-lexicon.json）。
 */
function main() {
  assertSafeOutputPath(OUTPUT_PATH);

  // 双源之一：纠错规则 R-01~R-18 的正则字面词
  const rules = loadCorrectionRules();
  const cpTerms = collectCorrectionPolicyTerms(rules);
  console.log(`[纠错库] R-01~R-18 共 ${rules.length} 条规则，提取字面词 ${cpTerms.size} 个`);

  // 双源之二：内置 AI 套话候选清单，合并去重
  const manualTerms = [...new Set(MANUAL_CANDIDATES)];
  const allTerms = [...new Set([...cpTerms, ...manualTerms])];
  console.log(`[候选池] 内置 AI 套话候选 ${manualTerms.length} 个，双源去重后共 ${allTerms.length} 个候选词`);

  // 语料基线：各题材桶抽样（只读）
  const { bucketCount, quota, books } = selectSampleBooks(CORPUS_ROOT, TARGET_TOTAL_BOOKS);
  console.log(`[抽样] ${bucketCount} 个题材桶 × 每桶 ${quota} 本 = ${books.length} 本（总量目标约 ${TARGET_TOTAL_BOOKS} 本，只读）`);

  const { counts, totalChars, bookStats } = scanCorpus(books, allTerms);
  console.log(`[语料] 抽样总字数（去空白）${totalChars.toLocaleString('zh-CN')} 字`);

  // 组装并写出词表
  const generatedAt = new Date();
  const output = buildLexiconOutput(cpTerms, manualTerms, counts, totalChars, { bucketCount, quota, bookStats }, generatedAt);
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const { stats } = output;
  console.log(`[完成] 词表已写入 ${OUTPUT_PATH}`);
  console.log(`[统计] 条目总数 ${stats.entryCount} ｜ block ${stats.blockCount} ｜ watch ${stats.watchCount} ｜ 丢弃（语料常用词）${stats.discardedManualCount}`);
  console.log(`[构成] correction-policy 字面词 ${stats.correctionPolicyTerms} 条（全部 block）｜ manual 候选保留 ${stats.entryCount - stats.correctionPolicyTerms} 条`);
}

main();
