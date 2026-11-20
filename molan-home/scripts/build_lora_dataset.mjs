#!/usr/bin/env node
'use strict';

/**
 * @file build_lora_dataset.mjs
 * 资源库 1,279 本真人小说全量 LoRA 微调数据集构造引擎
 * 
 * 核心目标：
 * 从 `资源库/小说原本` (48 题材家族 + 根目录 1,279 本真人网文) 提取高突发度、高白描、自然断句的真实段落，
 * 构造符合 LLaMA-Factory / ms-swift / Unsloth 行业标准的 Alpaca 与 ShareGPT 双格式 SFT 数据集。
 * 
 * 包含两大去AI味核心微调任务：
 * 1. 【Pass 2 降AI精修洗稿】(de_ai_humanize): 输入细纲/草稿 -> 输出地道真人自然网文，重塑 Logits 转移概率
 * 2. 【Pass 1 细纲高突发度主笔】(outline_expansion): 输入题材/角色/4节拍大纲 -> 输出真人小说正文
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
    if (a.startsWith(`--${name}=`)) return a.split('=')[1];
    if (a === `--${name}`) return true;
  }
  return def;
}
const LIMIT_BOOKS = parseInt(getArg('limit-books', '0'), 10); // 0 为全量 1279 本
const SLICES_PER_BOOK = parseInt(getArg('slices-per-book', '3'), 10);
const TARGET_SLICE_CHARS = parseInt(getArg('slice-chars', '2000'), 10);
const VAL_RATIO = parseFloat(getArg('val-ratio', '0.05'));

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

// 噪音过滤正则表达式（剔除水印、感言、推书、网站广告）
const NOISE_LINE_REGEX = /^(?:第[0-9一二三四五六七八九十百千万零〇]+[章节回卷篇话折]|Chapter\s*\d+|【\s*\d+\s*】|PS|ps|求月票|求推荐|求收藏|本章完|作者有话说|感谢各位|感谢读者|感谢打赏|推书|上架感言|完本感言|新书预告|www\.|http|笔趣阁|起点中文网|起点女生网|纵横中文网|搜笔趣阁|手机用户请浏览|免费阅读|无弹窗)/i;

/**
 * 清洗单篇小说并按跨度截取指定数量的高质量切片
 */
function cleanAndExtractSlices(rawText, slicesCount = 3, targetChars = 2000) {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const len = text.length;
  if (len < 3000) return [];

  // 跳过前 10%（避免前言、设定集、目录堆叠）并截取分散的切片
  const offsets = [];
  if (slicesCount === 1) {
    offsets.push(0.35);
  } else if (slicesCount === 2) {
    offsets.push(0.25, 0.65);
  } else if (slicesCount === 3) {
    offsets.push(0.18, 0.48, 0.78);
  } else {
    for (let i = 0; i < slicesCount; i++) {
      offsets.push(0.15 + (i * (0.75 / (slicesCount - 1))));
    }
  }

  const validSlices = [];
  for (const frac of offsets) {
    let start = Math.floor(len * frac);
    // 对齐自然段落首
    const nextNl = text.indexOf('\n', start);
    if (nextNl > start && nextNl - start < 400) {
      start = nextNl + 1;
    }

    const rawChunk = text.slice(start, start + targetChars + 800);
    const rawParas = rawChunk.split(/\n+/);
    
    // 逐段过滤与清洗
    const cleanParas = [];
    let currentChars = 0;

    for (const p of rawParas) {
      const trimmed = p.replace(/^[\s\u3000\uFEFF]+|[\s\u3000\uFEFF]+$/g, '');
      if (!trimmed || trimmed.length < 4) continue;
      if (NOISE_LINE_REGEX.test(trimmed)) continue;
      
      // 标点符号规范化：英文双引号转中文
      const normalized = trimmed
        .replace(/"([^"]*)"/g, '“$1”')
        .replace(/'([^']*)'/g, '‘$1’')
        .replace(/--|——/g, '——');

      cleanParas.push(normalized);
      currentChars += normalized.length;
      if (currentChars >= targetChars) break;
    }

    if (cleanParas.length < 6 || currentChars < 1000) continue;

    // 统计特征质量过滤（确保真人高突发度、段长轻快）
    const paraLens = cleanParas.map(p => p.length);
    const paraMean = currentChars / cleanParas.length;
    // 排除极端散文大方块段落 (段均 > 55) 或纯极端碎语 (段均 < 15)
    if (paraMean < 18 || paraMean > 52) continue;

    // 对白比例过滤 (确保既有动作又有言行交锋，对白占比 10% ~ 70%)
    let dialogueChars = 0;
    for (const p of cleanParas) {
      const matches = p.match(/[“"][^”"]*[”"]/g);
      if (matches) {
        dialogueChars += matches.reduce((sum, m) => sum + m.length, 0);
      }
    }
    const dialRatio = dialogueChars / currentChars;
    if (dialRatio < 0.08 || dialRatio > 0.72) continue;

    // 严禁含 AI 恶习套词的废样本
    const sliceText = cleanParas.join('\n');
    if (/嘴角勾起|倒吸凉气|眼神闪过一丝|微凝|正如他所料|伴随着这一声/.test(sliceText)) {
      continue;
    }

    validSlices.push({
      text: sliceText,
      charCount: currentChars,
      paraCount: cleanParas.length,
      paraMean: parseFloat(paraMean.toFixed(1)),
      dialRatio: parseFloat(dialRatio.toFixed(3)),
      paragraphs: cleanParas
    });
  }

  return validSlices;
}

/**
 * 从切片中提取角色画像与 4 节拍（起承转合）
 */
function extractSliceElements(paragraphs) {
  const fullText = paragraphs.join('\n');
  const charsMap = new Map();

  // 对白归属人物扫描：“...”张三冷声道 / 李四皱眉道
  const diaRegex = /[”"’](\s*[\u4e00-\u9fa5]{2,4}\s*(?:冷笑|低声|沉声|皱眉|怒喝|笑道|轻笑|怒道|说|道|问|喝道|叹道|喃喃|喊道|回应|答道))/g;
  let m;
  while ((m = diaRegex.exec(fullText)) !== null) {
    const rawName = m[1].replace(/(?:冷笑|低声|沉声|皱眉|怒喝|笑道|轻笑|怒道|说|道|问|喝道|叹道|喃喃|喊道|回应|答道)/g, '').trim();
    if (rawName && rawName.length >= 2 && rawName.length <= 4 && !/^(心中|自己|众人|对方|有人|这时|突然|随即|只见)/.test(rawName)) {
      charsMap.set(rawName, (charsMap.get(rawName) || 0) + 3);
    }
  }

  // 常见称号模式扫描
  const titleRegex = /(?:[老小大阿][\u4e00-\u9fa5]|[\u4e00-\u9fa5]{2,3}(?:师兄|师弟|师姐|师妹|长老|宗主|统领|队长|将军|大人|掌门|道友|兄弟|公子|小姐|先生|夫人))/g;
  while ((m = titleRegex.exec(fullText)) !== null) {
    const name = m[0].trim();
    if (name.length >= 2 && name.length <= 5) {
      charsMap.set(name, (charsMap.get(name) || 0) + 2);
    }
  }

  const sortedChars = Array.from(charsMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const protagonist = sortedChars[0] || '核心主角';
  const antagonist = sortedChars[1] || '现场阻力方/对手';

  // 提取 4 节拍骨架
  const totalParas = paragraphs.length;
  const p1 = paragraphs.slice(0, Math.floor(totalParas * 0.25)).join(' ');
  const p2 = paragraphs.slice(Math.floor(totalParas * 0.25), Math.floor(totalParas * 0.55)).join(' ');
  const p3 = paragraphs.slice(Math.floor(totalParas * 0.55), Math.floor(totalParas * 0.85)).join(' ');
  const p4 = paragraphs.slice(Math.floor(totalParas * 0.85)).join(' ');

  const getBeat = (chunk, def) => {
    const sents = chunk.split(/[。！？!?\n]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 12 && s.length <= 48 && !/^[“”"']/.test(s));
    return sents[0] || def;
  };

  return {
    protagonist,
    antagonist,
    beatQi: getBeat(p1, '现场气氛暗流涌动，核心人物面临当下切身阻碍。'),
    beatCheng: getBeat(p2, '言语试探与动作交锋逐步升级，利益矛盾公开。'),
    beatZhuan: getBeat(p3, '变故突发或关键底牌显露，局势急转直下。'),
    beatHe: getBeat(p4, '阶段性交锋落幕，余波未平并留下悬念危机。')
  };
}

/**
 * 构造用于 Pass 2 的待精修草稿 (保留核心事实与节拍，但包含部分AI常见平滑描述，训练模型去除AI味)
 */
function buildRoughDraftForPass2(elements, genre, bookTitle) {
  return [
    `【故事背景】题材：${genre} | 出处：《${bookTitle}》`,
    `【核心人物】主角：${elements.protagonist} | 对峙对手：${elements.antagonist}`,
    `【情节节拍】`,
    `1. 起：${elements.beatQi}`,
    `2. 承：${elements.beatCheng}`,
    `3. 转：${elements.beatZhuan}`,
    `4. 合：${elements.beatHe}`,
    `【原始场景粗稿】`,
    `现场气氛有些凝固，${elements.protagonist}站在原地注视着周围的一切，神情显得若有所思。${elements.antagonist}冷冷开口，语气中带着几分挑衅与试探。双方在简短的言辞交锋中互相打量，空气中弥漫着紧张的火药味。随着局势的推移，原本平静的场面被突如其来的变故打破，各种动作接踵而至，矛盾进一步激化。最终双方在试探后暂时告一段落，但更深的隐患已经埋下。`
  ].join('\n');
}

/**
 * 主执行函数
 */
async function main() {
  console.log('='.repeat(70));
  console.log('【墨阑 LoRA 训练数据集构造引擎】启动');
  console.log(`- 语料根目录: ${CORPUS_ROOT}`);
  console.log(`- 产出目标目录: ${OUTPUT_DIR}`);
  console.log(`- 单本抽样切片数: ${SLICES_PER_BOOK} | 单片目标字数: ${TARGET_SLICE_CHARS}`);
  console.log(`- 书籍扫描上限: ${LIMIT_BOOKS > 0 ? LIMIT_BOOKS : '全库 1,279 本'}`);
  console.log('='.repeat(70));

  if (!fs.existsSync(CORPUS_ROOT)) {
    console.error(`[FATAL] 语料库目录不存在: ${CORPUS_ROOT}`);
    process.exit(1);
  }

  // 递归扫描所有 txt 文件
  const bookFiles = [];
  const entries = fs.readdirSync(CORPUS_ROOT, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const genre = entry.name;
      const subDir = path.join(CORPUS_ROOT, genre);
      const files = fs.readdirSync(subDir).filter(f => f.endsWith('.txt'));
      for (const f of files) {
        bookFiles.push({
          genre,
          fileName: f,
          fullPath: path.join(subDir, f)
        });
      }
    } else if (entry.isFile() && entry.name.endsWith('.txt')) {
      bookFiles.push({
        genre: '综合通用',
        fileName: entry.name,
        fullPath: path.join(CORPUS_ROOT, entry.name)
      });
    }
  }

  console.log(`[1/4] 扫描全库完成: 共发现 ${bookFiles.length} 本小说原本。`);

  const processList = (LIMIT_BOOKS > 0) ? bookFiles.slice(0, LIMIT_BOOKS) : bookFiles;

  const datasetSamples = [];
  const genreStats = {};
  let totalProcessed = 0;
  let totalCharsExtracted = 0;
  const startTime = Date.now();

  console.log(`[2/4] 正在提取高质量网文切片并构造双任务微调对...`);

  for (let i = 0; i < processList.length; i++) {
    const item = processList[i];
    try {
      const rawText = readNovelText(item.fullPath);
      const bookTitle = item.fileName.replace(/\.txt$/i, '');
      const slices = cleanAndExtractSlices(rawText, SLICES_PER_BOOK, TARGET_SLICE_CHARS);

      for (const slice of slices) {
        const elements = extractSliceElements(slice.paragraphs);

        // 任务 1: 【Pass 2 降AI精修洗稿】(De-AI Humanizer)
        const deAiInstruction = [
          '你是擅长高质感中文网络小说的资深金牌主笔与文字精修师。',
          '请对以下粗糙、带有机械平滑感或AI套话痕迹的网文草稿进行深度去AI味精修重构。',
          '【精修严厉要求】',
          '1. 【段落轻快】：严格控制单段在 20~40 字之间，多逗号一气呵成，符合手机轻快阅读韵律；',
          '2. 【白描实操】：用具体的动词、物理受力与环境实体推进，禁止主观臆断与情绪定义；',
          '3. 【对白接地气】：台词简明有力，去掉多余的心理解释，动作穿插在对话前后；',
          '4. 【清零AI套话】：严禁出现“伴随着、嘴角勾起、眼神微凝、正如...所说、心中的大石落地”等平滑词汇；',
          '5. 完整保全原草稿中的人物对抗与起承转合事实，输出无任何AI痕迹的地道网络小说正文。'
        ].join('\n');

        const deAiInput = buildRoughDraftForPass2(elements, item.genre, bookTitle);
        const deAiOutput = slice.text;

        datasetSamples.push({
          task: 'de_ai_humanize',
          genre: item.genre,
          book: bookTitle,
          instruction: deAiInstruction,
          input: deAiInput,
          output: deAiOutput,
          charCount: slice.charCount
        });

        // 任务 2: 【Pass 1 细纲高突发度主笔】(Outline to Chapter Continuation)
        const outlineInstruction = [
          '你是中文网络小说领域的金牌主笔。请根据给定的题材背景、核心角色和场景四节拍大纲，撰写一节生动鲜活、节奏紧凑的正文段落。',
          '【写作要求】以白描为主，对白接地气，段落短促轻快，严禁机械AI套词与空洞抒情。'
        ].join('\n');

        const outlineInput = [
          `【题材家族】${item.genre}`,
          `【作品参考】《${bookTitle}》`,
          `【登场人物】主角：${elements.protagonist} | 对抗方：${elements.antagonist}`,
          `【情节起承转合】`,
          `- 起：${elements.beatQi}`,
          `- 承：${elements.beatCheng}`,
          `- 转：${elements.beatZhuan}`,
          `- 合：${elements.beatHe}`,
          `【字数目标】约 ${slice.charCount} 字`
        ].join('\n');

        datasetSamples.push({
          task: 'outline_expansion',
          genre: item.genre,
          book: bookTitle,
          instruction: outlineInstruction,
          input: outlineInput,
          output: deAiOutput,
          charCount: slice.charCount
        });

        totalCharsExtracted += slice.charCount * 2;
        genreStats[item.genre] = (genreStats[item.genre] || 0) + 2;
      }

      totalProcessed++;
      if (totalProcessed % 100 === 0 || totalProcessed === processList.length) {
        process.stdout.write(`  已处理 ${totalProcessed}/${processList.length} 本小说，累计生成 ${datasetSamples.length} 条微调训练样本...\r`);
      }
    } catch (err) {
      // 容错处理单个文件异常
    }
  }

  console.log(`\n[3/4] 数据提取完成！总样本数: ${datasetSamples.length}，涵盖字数: ${(totalCharsExtracted / 10000).toFixed(1)} 万字，耗时: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // 打乱数据集 (基于确定性种子)
  function seededShuffle(arr, seed = 20261120) {
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

  seededShuffle(datasetSamples);

  // 切分训练集与验证集 (95% / 5%)
  const valCount = Math.max(10, Math.floor(datasetSamples.length * VAL_RATIO));
  const valSamples = datasetSamples.slice(0, valCount);
  const trainSamples = datasetSamples.slice(valCount);

  console.log(`[4/4] 正在序列化输出标准 Alpaca 与 ShareGPT 格式数据集至: ${OUTPUT_DIR}`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // 1. 输出 Alpaca 格式 JSON
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'train_alpaca.json'),
    JSON.stringify(trainSamples.map(s => ({
      instruction: s.instruction,
      input: s.input,
      output: s.output
    })), null, 2),
    'utf8'
  );

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'val_alpaca.json'),
    JSON.stringify(valSamples.map(s => ({
      instruction: s.instruction,
      input: s.input,
      output: s.output
    })), null, 2),
    'utf8'
  );

  // 2. 输出 ShareGPT / ChatML 格式 JSONL (单行紧凑)
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

  // 3. 输出 LLaMA-Factory 标准数据集注册文件 dataset_info.json
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

  // 4. 输出统计摘要
  const summary = {
    generatedAt: new Date().toISOString(),
    corpusBooksCount: processList.length,
    totalSamples: datasetSamples.length,
    trainCount: trainSamples.length,
    valCount: valSamples.length,
    totalCharacters: totalCharsExtracted,
    approxTokens: Math.round(totalCharsExtracted * 0.72),
    taskBreakdown: {
      de_ai_humanize: datasetSamples.filter(s => s.task === 'de_ai_humanize').length,
      outline_expansion: datasetSamples.filter(s => s.task === 'outline_expansion').length
    },
    genreStats
  };

  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'dataset_summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  console.log('='.repeat(70));
  console.log('🎉 数据集构造成功！');
  console.log(`- 训练集样本数: ${trainSamples.length} (train_alpaca.json, train_sharegpt.jsonl)`);
  console.log(`- 验证集样本数: ${valSamples.length} (val_alpaca.json, val_sharegpt.jsonl)`);
  console.log(`- LLaMA-Factory 配置: ${path.join(OUTPUT_DIR, 'dataset_info.json')}`);
  console.log(`- 统计摘要: ${path.join(OUTPUT_DIR, 'dataset_summary.json')}`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('[FATAL ERROR]', err);
  process.exit(1);
});
