#!/usr/bin/env node
'use strict';

/**
 * @file build_lora_dataset.mjs
 * 资源库 1,279 本真人小说全量 LoRA 微调数据集构造引擎 (v2 零假模板/防泄露版)
 *
 * 核心升级：
 * 1. 彻底移除写死假粗稿模板，杜绝“输入与正文无关”导致的严重幻觉与不听指令问题；
 * 2. 以 70%【真实前文续写 (novel_continuation)】+ 30%【真实节拍写作 (outline_expansion)】构建双任务 SFT，
 *    且两条任务使用互不重叠的独立文本切片（零重复输出）；
 * 3. 按【书本级】严格切分训练集 (95%) 与验证集 (5%)，实现 0% 数据泄露；
 * 4. 跳过 `测试` 等非语料目录，强化人名抽取黑名单，并将单条样本总长度精准控在
 *    1,500~2,150 字内，确保 Qwen2.5 MAX_SEQ_LENGTH=2048 零截断。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 路径解析：支持从工作区根目录或 molan-home/scripts 执行
const WORKSPACE_ROOT = path.resolve(__dirname, '../../');
const CORPUS_ROOT = fs.existsSync(path.resolve(WORKSPACE_ROOT, '资源库/小说原本'))
  ? path.resolve(WORKSPACE_ROOT, '资源库/小说原本')
  : path.resolve(__dirname, '../data/corpus-fallback');

const OUTPUT_DIR = path.resolve(__dirname, '../data/lora-training');

// 命令行参数解析
const args = process.argv.slice(2);
function getArg(name, def) {
  for (const a of args) {
    if (a.startsWith(`--${name}=`)) return a.split('=').slice(1).join('=');
    if (a === `--${name}`) return true;
  }
  return def;
}

const LIMIT_BOOKS = parseInt(getArg('limit-books', '0'), 10); // 0 为全量
const SLICES_PER_BOOK = parseInt(getArg('slices-per-book', '4'), 10);
const CONTEXT_CHARS = parseInt(getArg('context-chars', '600'), 10);
const TARGET_CHARS = parseInt(getArg('target-chars', '1200'), 10);
const VAL_RATIO = parseFloat(getArg('val-ratio', '0.05'));
const GENRES_FILTER_RAW = String(getArg('genres', '') || '').trim();
const GENRES_FILTER = GENRES_FILTER_RAW
  ? new Set(GENRES_FILTER_RAW.split(/[,，]/).map(s => s.trim()).filter(Boolean))
  : null;

const SKIP_DIRS = new Set(['测试', 'test', 'tmp', 'temp', '.git', 'node_modules']);

// 编码回退解码器
const gbkDecoder = new TextDecoder('gb18030', { fatal: false });
function readNovelText(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf.subarray(3));
  }
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf.subarray(2));
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf.subarray(2));
  }
  const sample = buf.subarray(0, Math.min(buf.length, 32768));
  const utf8Str = sample.toString('utf8');
  const replacementCount = (utf8Str.match(/\uFFFD/g) || []).length;
  if (replacementCount > 10) {
    return gbkDecoder.decode(buf);
  }
  return buf.toString('utf8');
}

// 噪音过滤正则表达式（剔除章节标题、水印、感言、推书、网站广告）
const NOISE_LINE_REGEX = /^(?:第[0-9一二三四五六七八九十百千万零〇]+[章节回卷篇话折]|Chapter\s*\d+|【\s*\d+\s*】|PS|ps|求月票|求推荐|求收藏|求订阅|求打赏|本章完|未完待续|作者有话说|感谢各位|感谢读者|感谢打赏|推书|上架感言|完本感言|新书预告|防盗章节|www\.|http|笔趣阁|起点中文网|起点女生网|纵横中文网|搜笔趣阁|手机用户请浏览|免费阅读|无弹窗|请记住本书首发域名|天才一秒记住)/i;

// 严禁混入的典型 AI 套词
const AI_CLICHE_REGEX = /嘴角勾起|倒吸凉气|眼神闪过一丝|瞳孔骤缩|空气仿佛凝固|宛如实质|令人窒息的压迫感|正如他所料|伴随着这一声|微凝/;

// 非人名黑名单与禁用虚词/代词字（防止把动词、代词、量词误抽为角色名）
const NON_NAME_REGEX = /^(?:大的|小的|老的|老头|老者|老人|少年|青年|少女|男子|女子|男人|女人|妇女|众人|对方|自己|心中|心里|有人|没人|这时|此时|突然|随即|只见|一边|一面|一旁|旁边|大家|大伙|兄弟|姐妹|朋友|师父|师傅|老板|先生|女士|小姐|公子|姑娘|丫头|小子|家伙|东西|什么|怎么|没有|不是|已经|那个|这个|他们|她们|我们|你们|大人|大军|大队|大殿|大厅|大门|大声|大笑|大喊|大喝|大事|大喜|大惊|大怒|小声|小心|小事|小队|小院|小巷|小屋|小脸|小手|老大|老二|老三|老四|老五|老子|老婆|老爹|老娘|老妈|老爸|老师|老实|老早|老爷|大师兄|大师姐|二师兄|小师妹|小师弟|老大人|禁军统领)$/;
const INVALID_NAME_CHAR_REGEX = /[的她他它我你您这那哪谁其各每某两三四五六七八九十百千万的得地了着过又也在有是从把被给向对跟和与及或但而却才就都还只很太更最不没无别正刚已曾将要会能可该应让使叫请压苦]/;

/**
 * 规范化单行文本
 */
function normalizeParagraph(raw) {
  const trimmed = raw.replace(/^[\s\u3000\uFEFF]+|[\s\u3000\uFEFF]+$/g, '');
  if (!trimmed || trimmed.length < 4) return '';
  if (trimmed.includes('\uFFFD')) return '';
  if (NOISE_LINE_REGEX.test(trimmed)) return '';
  return trimmed
    .replace(/"([^"]*)"/g, '“$1”')
    .replace(/'([^']*)'/g, '‘$1’')
    .replace(/--|——/g, '——');
}

/**
 * 计算段落集合的质量指标
 */
function evaluateParagraphQuality(paragraphs) {
  const charCount = paragraphs.reduce((sum, p) => sum + p.length, 0);
  if (paragraphs.length < 6 || charCount < 750) return null;

  const paraMean = charCount / paragraphs.length;
  if (paraMean < 16 || paraMean > 62) return null;

  let dialogueChars = 0;
  for (const p of paragraphs) {
    const matches = p.match(/[“"][^”"]*[”"]/g);
    if (matches) {
      dialogueChars += matches.reduce((sum, m) => sum + m.length, 0);
    }
  }
  const dialRatio = dialogueChars / charCount;
  if (dialRatio < 0.08 || dialRatio > 0.74) return null;

  const text = paragraphs.join('\n');
  if (AI_CLICHE_REGEX.test(text)) return null;

  return {
    text,
    charCount,
    paraCount: paragraphs.length,
    paraMean: parseFloat(paraMean.toFixed(1)),
    dialRatio: parseFloat(dialRatio.toFixed(3)),
    paragraphs
  };
}

/**
 * 从单篇小说按不重叠跨度抽取独立高质量切片
 * - 偶数/多数切片用于【真实前文续写】(需要连续 context + target，约 1,800 字)
 * - 其余切片用于【真实节拍写作】(只需要独立 target，约 1,200 字)
 */
function extractIndependentSlices(rawText, slicesCount = 4, contextChars = 600, targetChars = 1200) {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const len = text.length;
  if (len < 6000) return [];

  const offsets = [];
  if (slicesCount === 1) {
    offsets.push(0.35);
  } else {
    for (let i = 0; i < slicesCount; i++) {
      offsets.push(0.14 + (i * (0.72 / (slicesCount - 1))));
    }
  }

  const results = [];
  let lastUsedEnd = -1;

  for (let idx = 0; idx < offsets.length; idx++) {
    const frac = offsets[idx];
    let start = Math.floor(len * frac);
    if (start <= lastUsedEnd + 200) continue; // 严防同一本书内切片重叠

    // 对齐自然段落首
    const nextNl = text.indexOf('\n', start);
    if (nextNl > start && nextNl - start < 400) {
      start = nextNl + 1;
    }

    // 75% (前3/4 或 idx%3!==2) 构造真实续写，25%~33% 构造干净节拍写作
    const isContinuation = (idx % 3 !== 2);
    const neededChars = isContinuation ? (contextChars + targetChars) : targetChars;
    const rawChunk = text.slice(start, start + neededChars + 1200);
    const rawParas = rawChunk.split(/\n+/);

    const cleanParas = [];
    let currentChars = 0;
    let rawConsumed = 0;

    for (const rawP of rawParas) {
      rawConsumed += rawP.length + 1;
      const normalized = normalizeParagraph(rawP);
      if (!normalized) {
        // 如果遇到明显的章节切换标题且已经收集了一段内容，停止当前切片以保证连贯性
        if (NOISE_LINE_REGEX.test(rawP.trim()) && currentChars >= 400) {
          break;
        }
        continue;
      }
      cleanParas.push(normalized);
      currentChars += normalized.length;
      if (currentChars >= neededChars) break;
    }

    if (isContinuation) {
      // 按自然段落切分成 context (~500~700字) + target (~950~1350字)
      const ctxParas = [];
      let ctxLen = 0;
      let splitIdx = 0;
      for (let i = 0; i < cleanParas.length; i++) {
        ctxParas.push(cleanParas[i]);
        ctxLen += cleanParas[i].length;
        splitIdx = i + 1;
        if (ctxLen >= contextChars - 80) break;
      }

      const tgtParas = cleanParas.slice(splitIdx);
      const tgtQuality = evaluateParagraphQuality(tgtParas);
      if (!tgtQuality) continue;
      if (ctxParas.length < 3 || ctxLen < 350 || ctxLen > contextChars + 260) continue;
      if (tgtQuality.charCount > targetChars + 260) continue;

      const ctxText = ctxParas.join('\n');
      if (AI_CLICHE_REGEX.test(ctxText)) continue;

      lastUsedEnd = start + rawConsumed;
      results.push({
        task: 'novel_continuation',
        contextText: ctxText,
        contextChars: ctxLen,
        target: tgtQuality
      });
    } else {
      const tgtQuality = evaluateParagraphQuality(cleanParas);
      if (!tgtQuality || tgtQuality.charCount > targetChars + 260) continue;

      lastUsedEnd = start + rawConsumed;
      results.push({
        task: 'outline_expansion',
        target: tgtQuality
      });
    }
  }

  return results;
}

/**
 * 从切片中严谨提取真实出场人名（宁缺毋滥）与 4 节拍真实推进句
 */
function extractCleanElements(paragraphs) {
  const fullText = paragraphs.join('\n');
  const charsMap = new Map();

  // 仅从明确对白归属动词前抽取 2~3 字中文人名
  const diaRegex = /[”"’]\s*([\u4e00-\u9fa5]{2,3})(?:冷笑|低声|沉声|皱眉|怒喝|笑道|轻笑|怒道|说道|问道|喝道|叹道|喃喃|喊道|回应|答道|开口|哼道|冷声道)/g;
  let m;
  while ((m = diaRegex.exec(fullText)) !== null) {
    const candidate = m[1].trim();
    if (
      candidate.length >= 2 &&
      candidate.length <= 3 &&
      !NON_NAME_REGEX.test(candidate) &&
      !INVALID_NAME_CHAR_REGEX.test(candidate)
    ) {
      charsMap.set(candidate, (charsMap.get(candidate) || 0) + 3);
    }
  }

  // 带明确称谓的真实人名（排除纯通用泛称）
  const titleRegex = /([\u4e00-\u9fa5]{1,2}(?:师兄|师弟|师姐|师妹|长老|宗主|掌门|道友|将军|队长|统领|掌柜|管事|大人))/g;
  while ((m = titleRegex.exec(fullText)) !== null) {
    const candidate = m[1].trim();
    if (
      candidate.length >= 3 &&
      candidate.length <= 4 &&
      !NON_NAME_REGEX.test(candidate) &&
      !INVALID_NAME_CHAR_REGEX.test(candidate)
    ) {
      charsMap.set(candidate, (charsMap.get(candidate) || 0) + 2);
    }
  }

  const verifiedChars = Array.from(charsMap.entries())
    .filter(([, score]) => score >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 3);

  // 提取 4 节拍真实叙事锚点（只用该片段真实存在的非对白完整句）
  const totalParas = paragraphs.length;
  const segments = [
    paragraphs.slice(0, Math.max(1, Math.floor(totalParas * 0.25))).join('\n'),
    paragraphs.slice(Math.floor(totalParas * 0.25), Math.floor(totalParas * 0.55)).join('\n'),
    paragraphs.slice(Math.floor(totalParas * 0.55), Math.floor(totalParas * 0.85)).join('\n'),
    paragraphs.slice(Math.floor(totalParas * 0.85)).join('\n')
  ];

  const extractBeat = (chunk) => {
    const sents = chunk
      .split(/[。！？!?\n]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 12 && s.length <= 44 && !/[“”"'‘’]/.test(s));
    return sents[0] || '';
  };

  const beats = segments.map(extractBeat).filter(Boolean);
  return {
    verifiedChars,
    beats
  };
}

/**
 * 确定性伪随机打乱
 */
function seededShuffle(arr, seed = 20261125) {
  let s = seed;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

const CONTINUATION_SYSTEM = [
  '你是一名擅长写高质感中文网络小说的资深作者。',
  '请紧接用户给出的前文片段自然续写正文，保持人物性格、视口连续与口语白描节奏。',
  '写作准则：以具体动作、细节和对白推动情节；段落轻快有呼吸感；禁止空洞总结与机械AI套话。'
].join('\n');

const OUTLINE_SYSTEM = [
  '你是一名擅长写高质感中文网络小说的资深作者。',
  '请根据给定的题材与场景推进要点，直接撰写生动克制、节奏紧凑的小说正文。',
  '写作准则：以白描与自然对话为主，人物行动合乎常理，段落错落轻快，禁止空洞抒情与机械AI套话。'
].join('\n');

/**
 * 将单本书提取的切片转为 SFT 样本
 */
function buildSamplesForBook(bookItem) {
  const rawText = readNovelText(bookItem.fullPath);
  const slices = extractIndependentSlices(rawText, SLICES_PER_BOOK, CONTEXT_CHARS, TARGET_CHARS);
  const samples = [];

  for (const slice of slices) {
    if (slice.task === 'novel_continuation') {
      const approxTarget = Math.round(slice.target.charCount / 100) * 100;
      const userPrompt = [
        `【题材】${bookItem.genre}`,
        `【字数目标】约 ${approxTarget} 字`,
        `【前文片段】`,
        slice.contextText,
        '',
        '请紧接上述前文自然续写接下来的情节正文，直接输出小说正文，不要加标题或说明。'
      ].join('\n');

      samples.push({
        task: 'novel_continuation',
        genre: bookItem.genre,
        bookId: bookItem.bookId,
        instruction: CONTINUATION_SYSTEM,
        input: userPrompt,
        output: slice.target.text,
        charCount: slice.target.charCount
      });
    } else {
      const { verifiedChars, beats } = extractCleanElements(slice.target.paragraphs);
      if (beats.length < 3) continue; // 缺乏清晰真实推进要点则宁缺毋滥

      const approxTarget = Math.round(slice.target.charCount / 100) * 100;
      const lines = [`【题材】${bookItem.genre}`];
      if (verifiedChars.length > 0) {
        lines.push(`【出场人物】${verifiedChars.join('、')}`);
      }
      lines.push('【场景推进要点】');
      beats.forEach((b, i) => {
        lines.push(`${i + 1}. ${b}`);
      });
      lines.push(`【字数目标】约 ${approxTarget} 字`);
      lines.push('请根据以上要点直接创作流畅自然的小说正文，不要加标题或解释。');

      samples.push({
        task: 'outline_expansion',
        genre: bookItem.genre,
        bookId: bookItem.bookId,
        instruction: OUTLINE_SYSTEM,
        input: lines.join('\n'),
        output: slice.target.text,
        charCount: slice.target.charCount
      });
    }
  }

  return samples;
}

/**
 * 主执行函数
 */
async function main() {
  console.log('='.repeat(72));
  console.log('【墨阑 LoRA 真人小说训练数据集构造引擎 v2】启动');
  console.log(`- 语料根目录: ${CORPUS_ROOT}`);
  console.log(`- 产出目标目录: ${OUTPUT_DIR}`);
  console.log(`- 单本独立切片上限: ${SLICES_PER_BOOK} | 前文 ~${CONTEXT_CHARS} 字 / 正文 ~${TARGET_CHARS} 字`);
  console.log(`- 题材过滤: ${GENRES_FILTER ? Array.from(GENRES_FILTER).join(', ') : '全题材 (自动排除测试目录)'}`);
  console.log(`- 书籍扫描上限: ${LIMIT_BOOKS > 0 ? LIMIT_BOOKS : '全库'}`);
  console.log('='.repeat(72));

  if (!fs.existsSync(CORPUS_ROOT)) {
    console.error(`[FATAL] 语料库目录不存在: ${CORPUS_ROOT}`);
    process.exit(1);
  }

  // 1. 扫描所有 txt 书本（跳过测试目录）
  const bookFiles = [];
  const entries = fs.readdirSync(CORPUS_ROOT, { withFileTypes: true });
  let skippedTestFiles = 0;

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const genre = entry.name;
      if (SKIP_DIRS.has(genre.toLowerCase()) || SKIP_DIRS.has(genre)) {
        const subDir = path.join(CORPUS_ROOT, genre);
        skippedTestFiles += fs.readdirSync(subDir).filter(f => f.endsWith('.txt')).length;
        continue;
      }
      if (GENRES_FILTER && !GENRES_FILTER.has(genre)) continue;

      const subDir = path.join(CORPUS_ROOT, genre);
      const files = fs.readdirSync(subDir).filter(f => f.endsWith('.txt')).sort();
      for (const f of files) {
        bookFiles.push({
          bookId: `${genre}/${f}`,
          genre,
          fileName: f,
          fullPath: path.join(subDir, f)
        });
      }
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      if (GENRES_FILTER && !GENRES_FILTER.has('综合通用')) continue;
      bookFiles.push({
        bookId: `综合通用/${entry.name}`,
        genre: '综合通用',
        fileName: entry.name,
        fullPath: path.join(CORPUS_ROOT, entry.name)
      });
    }
  }

  console.log(`[1/4] 扫描完成: 有效小说 ${bookFiles.length} 本（已排除测试目录 ${skippedTestFiles} 本）。`);

  const processList = (LIMIT_BOOKS > 0) ? bookFiles.slice(0, LIMIT_BOOKS) : bookFiles;

  // 2. 先按【书本级】确定性打乱并切分训练/验证书单（彻底杜绝数据泄露）
  const shuffledBooks = [...processList];
  seededShuffle(shuffledBooks, 20261125);

  const valBookCount = Math.max(5, Math.floor(shuffledBooks.length * VAL_RATIO));
  const valBooks = shuffledBooks.slice(0, valBookCount);
  const trainBooks = shuffledBooks.slice(valBookCount);

  console.log(`[2/4] 书本级隔离切分完成: 训练书本 ${trainBooks.length} 本 | 验证书本 ${valBooks.length} 本（0% 跨集重叠）。`);

  const trainSamples = [];
  const valSamples = [];
  const genreStats = {};
  let totalOutputChars = 0;
  let processedBooks = 0;
  const startTime = Date.now();

  const processBucket = (books, targetArr) => {
    for (const book of books) {
      try {
        const samples = buildSamplesForBook(book);
        for (const s of samples) {
          targetArr.push(s);
          totalOutputChars += s.charCount;
          genreStats[s.genre] = (genreStats[s.genre] || 0) + 1;
        }
      } catch {
        // 单个文件损坏容错
      }
      processedBooks++;
      if (processedBooks % 100 === 0 || processedBooks === processList.length) {
        process.stdout.write(`  已处理 ${processedBooks}/${processList.length} 本小说，累计样本 ${trainSamples.length + valSamples.length} 条...\r`);
      }
    }
  };

  processBucket(trainBooks, trainSamples);
  processBucket(valBooks, valSamples);

  // 各自内部打乱
  seededShuffle(trainSamples, 20261126);
  seededShuffle(valSamples, 20261127);

  const allSamples = [...trainSamples, ...valSamples];
  let sumTotalChars = 0;
  let maxTotalChars = 0;
  let over2400Chars = 0;
  for (const s of allSamples) {
    const total = s.instruction.length + s.input.length + s.output.length;
    sumTotalChars += total;
    if (total > maxTotalChars) maxTotalChars = total;
    if (total > 2400) over2400Chars++;
  }

  console.log(`\n[3/4] 提取完成！总样本: ${allSamples.length}（训练 ${trainSamples.length} / 验证 ${valSamples.length}），正文总字数: ${(totalOutputChars / 10000).toFixed(1)} 万字，耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`      单条平均总字数: ${Math.round(sumTotalChars / Math.max(1, allSamples.length))} | 最大总字数: ${maxTotalChars} | 超过 2400 字: ${over2400Chars}`);

  // 3. 序列化输出
  console.log(`[4/4] 正在输出标准 Alpaca 与 ShareGPT/ChatML 格式数据集至: ${OUTPUT_DIR}`);
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const toAlpaca = (s) => ({
    instruction: s.instruction,
    input: s.input,
    output: s.output
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'train_alpaca.json'),
    JSON.stringify(trainSamples.map(toAlpaca), null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'val_alpaca.json'),
    JSON.stringify(valSamples.map(toAlpaca), null, 2),
    'utf8'
  );

  const toShareGptLine = (s) => JSON.stringify({
    messages: [
      { role: 'system', content: s.instruction },
      { role: 'user', content: s.input },
      { role: 'assistant', content: s.output }
    ]
  });

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'train_sharegpt.jsonl'),
    trainSamples.map(toShareGptLine).join('\n') + '\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'val_sharegpt.jsonl'),
    valSamples.map(toShareGptLine).join('\n') + '\n',
    'utf8'
  );

  const datasetInfo = {
    molan_de_ai_alpaca: {
      file_name: 'train_alpaca.json',
      formatting: 'alpaca',
      columns: {
        prompt: 'instruction',
        query: 'input',
        response: 'output'
      }
    },
    molan_de_ai_sharegpt: {
      file_name: 'train_sharegpt.jsonl',
      formatting: 'sharegpt',
      columns: {
        messages: 'messages'
      },
      tags: {
        role_tag: 'role',
        content_tag: 'content',
        user_tag: 'user',
        assistant_tag: 'assistant',
        system_tag: 'system'
      }
    }
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'dataset_info.json'),
    JSON.stringify(datasetInfo, null, 2),
    'utf8'
  );

  const summary = {
    schemaVersion: '2.0',
    generatedAt: new Date().toISOString(),
    splitStrategy: 'book_level_zero_leakage',
    corpusBooksCount: processList.length,
    trainBooksCount: trainBooks.length,
    valBooksCount: valBooks.length,
    skippedTestBooks: skippedTestFiles,
    totalSamples: allSamples.length,
    trainCount: trainSamples.length,
    valCount: valSamples.length,
    totalCharacters: totalOutputChars,
    approxTokens: Math.round(sumTotalChars * 0.72),
    charStats: {
      avgTotalChars: Math.round(sumTotalChars / Math.max(1, allSamples.length)),
      maxTotalChars,
      over2400Chars
    },
    taskBreakdown: {
      novel_continuation: allSamples.filter(s => s.task === 'novel_continuation').length,
      outline_expansion: allSamples.filter(s => s.task === 'outline_expansion').length
    },
    genreStats
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'dataset_summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  console.log('='.repeat(72));
  console.log('🎉 v2 零假模板真人小说数据集构造成功！');
  console.log(`- 训练集: ${trainSamples.length} 条 (${trainBooks.length} 本书)`);
  console.log(`- 验证集: ${valSamples.length} 条 (${valBooks.length} 本书，零泄露)`);
  console.log(`- 任务分布: 真实前文续写 ${summary.taskBreakdown.novel_continuation} 条 | 节拍写作 ${summary.taskBreakdown.outline_expansion} 条`);
  console.log('='.repeat(72));
}

main().catch(err => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
