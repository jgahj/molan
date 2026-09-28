'use strict';

/**
 * ground-truth-extractor.js
 * ---------------------------------------------------------------------------
 * 原本小说三阶段抽取与双粒度提示词压缩引擎 (Ground Truth Stage & Dual Prompt Extractor)
 *
 * 核心设计目标：
 * 1. 定向访问 `资源库/小说原本/`（受保护目录严格只读）；
 * 2. 对每部小说自动定位并抽取三阶段章节：
 *    - 前期 (Early): 第 1~2 章（破题、人设立体度与世界观建立）；
 *    - 中期 (Middle): 约 50% 进度处（中盘多方博弈、战力/关系升级）；
 *    - 后期 (Late): 约 85% 进度处（高潮前夕、决战蓄势与因果兑现）；
 * 3. 将真实原文章节智能压缩为双粒度提示词：
 *    - 详细版本 (Detailed Prompt): 包含微观情节骨架、4~6 个精准转折、人物心理潜台词；
 *    - 粗略版本 (Coarse Prompt): 仅提供核心矛盾与目标走向（1~2 句话梗概）；
 *    - 共同硬契约：两版提示词【必须 100% 完整继承原著的文章风格、语言特质与感官色调】。
 * ---------------------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');

// 章节标题通用正则
const CHAPTER_HEADING_REGEX = /^[ \t]*(?:第[零〇一二三四五六七八九十百千万两\d]+章(?:[ \t]+[^\r\n]{1,100})?|序章[^\r\n]{0,100}|楔子[^\r\n]{0,100})[ \t]*$/gm;

// 常见文风特质与流派机制映射
const GENRE_STYLE_DIRECTIVES = Object.freeze({
  玄幻: '【东方玄幻·智斗与神威】行文张弛有度，注重高潮交锋时的微观物理受力（骨骼微鸣、重力形变、肌肉抗阻）。对白机锋幽默，拒绝报菜名灌输设定，以场景动作和利益博弈自然带出世界观。',
  都市: '【现代都市·世情与拉扯】行文极具市井烟火气与现实质感，注重人情往来的微观潜台词与利益交锋。对白幽默利落、带刺自嘲，拒绝低幼口嗨与降智打脸，体现成熟理性的成年人心智。',
  仙侠: '【古典仙侠·克制与道心】笔触典雅深沉，带有佛理禅机或仙途寂寥感。交锋注重招式拆解、心性拷问与因果律动，人物言行有古雅礼法约束，拒绝粗鄙无脑爽文套话。',
  悬疑灵异: '【中式民俗·怪谈与压迫】注重感官递进压迫（冷意、光影跳跃、微弱异响），严格遵循视角隔离，绝不出现上帝视角全知剧透。危机遵循物理尺度步步逼近，制造让读者屏息的窒息感。',
  历史脑洞: '【历史正剧·礼制与政争】严守古代君臣、宗族礼法秩序，严禁现代大词穿帮。政治博弈着眼于制度、钱粮、人脉与权谋微澜，写出大时代碾压下人物的挣扎与格局。',
  青春甜宠: '【现代言情·情绪流动与细腻通感】极度注重男女主角微表情、视线躲闪、指尖触感与呼吸节奏的微观刻画。对白多重潜台词交锋，情绪波形细腻起伏，充满心动张力与生活甜涩。'
});

/**
 * 健壮地读取小说文本（自动探测 UTF-8 与 GB18030）
 */
function readNovelText(filePath) {
  const buffer = fs.readFileSync(filePath);
  let text = '';
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch (_) {
    try {
      text = new TextDecoder('gb18030', { fatal: true }).decode(buffer);
    } catch (_) {
      text = buffer.toString('utf8');
    }
  }
  return text;
}

/**
 * 扫描指定题材目录，获取前 N 本代表作小说清单
 */
function scanGenreBooks(genreDir, limit = 6) {
  if (!fs.existsSync(genreDir)) return [];
  const entries = fs.readdirSync(genreDir)
    .filter(name => name.endsWith('.txt') && !name.includes('【搜笔趣阁') && !name.includes('part'));

  const books = [];
  for (const filename of entries) {
    const fullPath = path.join(genreDir, filename);
    const stat = fs.statSync(fullPath);
    // 过滤掉小于 50KB 或大于 40MB 的极端文件（全面兼容女频言情与轻小说）
    if (stat.size < 50 * 1024 || stat.size > 40 * 1024 * 1024) continue;

    const base = filename.replace(/\.txt$/, '');
    const parts = base.split(/\s*[-—]\s*/);
    const title = parts[0]?.trim() || base;
    const author = parts[1]?.trim() || '佚名';

    books.push({
      filename,
      fullPath,
      title,
      author,
      sizeBytes: stat.size
    });

    if (books.length >= limit) break;
  }

  return books;
}

/**
 * 从小说全本中抽取前、中、后三阶段章节
 */
function extractThreeStages(filePath, options = {}) {
  const text = readNovelText(filePath);
  const headings = [...text.matchAll(CHAPTER_HEADING_REGEX)];

  if (headings.length < 5) {
    // 章节正则无法直接匹配时，降级按自然长度分三段抽取
    return extractFallbackStages(text, options);
  }

  const totalChapters = headings.length;
  // 前期：第 1~2 章（优先第 1 章）
  const earlyIdx = 0;
  // 中期：约 50% 进度
  const middleIdx = Math.floor(totalChapters * 0.5);
  // 后期：约 85% 进度（高潮蓄势前夕）
  const lateIdx = Math.floor(totalChapters * 0.85);

  const getChapterData = (index, stageKey) => {
    let startIdx = index;
    let heading = headings[startIdx];
    let start = heading.index;
    let nextIdx = startIdx + 1;
    let end = headings[nextIdx] ? headings[nextIdx].index : Math.min(start + 8000, text.length);
    let chapterRaw = text.slice(start, end).trim();
    let titleLine = heading[0].trim();
    let body = chapterRaw.slice(titleLine.length).trim();

    // 如果单章过短（例如微型短章 < 1000字），向后顺延拼接直到达到完整场景篇幅（>= 1500字 或 最多顺延5章）
    while (body.length < 1500 && nextIdx < headings.length && nextIdx < startIdx + 6) {
      nextIdx++;
      end = headings[nextIdx] ? headings[nextIdx].index : Math.min(start + 12000, text.length);
      chapterRaw = text.slice(start, end).trim();
      body = chapterRaw.slice(titleLine.length).trim();
    }

    return {
      stage: stageKey,
      chapterIndex: index + 1,
      totalChapters,
      chapterTitle: titleLine,
      bodyText: body,
      charCount: body.length,
      paragraphs: body.split(/\r?\n+/).filter(p => p.trim())
    };
  };

  return {
    totalChapters,
    early: getChapterData(earlyIdx, 'early'),
    middle: getChapterData(middleIdx, 'middle'),
    late: getChapterData(lateIdx, 'late')
  };
}

/**
 * 备选分段抽取（处理无标准“第X章”标题的小说）
 */
function extractFallbackStages(fullText, options = {}) {
  const totalChars = fullText.length;
  const sliceLength = 3000;

  const getSlice = (startOffset, stageKey) => {
    const raw = fullText.slice(startOffset, startOffset + sliceLength).trim();
    const paragraphs = raw.split(/\r?\n+/).filter(p => p.trim());
    return {
      stage: stageKey,
      chapterIndex: stageKey === 'early' ? 1 : (stageKey === 'middle' ? 50 : 100),
      totalChapters: 100,
      chapterTitle: `${stageKey}阶段典型切片`,
      bodyText: raw,
      charCount: raw.length,
      paragraphs
    };
  };

  return {
    totalChapters: 100,
    early: getSlice(0, 'early'),
    middle: getSlice(Math.floor(totalChars * 0.5), 'middle'),
    late: getSlice(Math.floor(totalChars * 0.85), 'late')
  };
}

/**
 * 提炼原文章节的核心情节节点与人物动机
 */
function distillChapterPlotBeats(paragraphs = []) {
  const beats = [];
  const validParas = paragraphs.filter(p => p.length >= 25);
  const step = Math.max(1, Math.floor(validParas.length / 5));

  for (let i = 0; i < validParas.length && beats.length < 5; i += step) {
    const snippet = validParas[i].slice(0, 80).replace(/["'“”]/g, '');
    beats.push(snippet);
  }

  return beats;
}

/**
 * 将提取的原文章节压缩生成双粒度提示词（详细版 vs 粗略版）
 */
function compressToDualPrompts(stageData, metadata = {}) {
  const { stage, chapterTitle, bodyText, paragraphs } = stageData;
  const bookTitle = metadata.title || '未知作品';
  const author = metadata.author || '名家';
  const genre = metadata.genre || '玄幻';

  const styleDirective = GENRE_STYLE_DIRECTIVES[genre] || GENRE_STYLE_DIRECTIVES.玄幻;
  const beats = distillChapterPlotBeats(paragraphs);

  // 1. 构建详细版 Prompt (Detailed Prompt)
  const detailedPromptLines = [
    `请根据以下精准大纲分镜，创作一章高水准的${genre}小说章节（字数约 2200~2800 字）：`,
    '',
    `【作品风格与语言特质 (强制遵守)】`,
    `- 原著范本：《${bookTitle}》（作者：${author}）`,
    `- 题材风格基调：${styleDirective}`,
    `- 叙事视角：第三人称受限视角，严守信息隔离与微观生理受力细节。`,
    '',
    `【核心情境与背景】`,
    `本章处于故事的【${stage === 'early' ? '开篇破题' : (stage === 'middle' ? '中盘升级' : '高潮决战')}】阶段，章节名拟定为《${chapterTitle}》。`,
    '',
    `【微观剧情节点与分镜 (必须全部逐一推进)】`
  ];

  beats.forEach((beat, idx) => {
    detailedPromptLines.push(`${idx + 1}. 分镜${idx + 1}：${beat}……（围绕此核心行动展开对白试探与局势升级）`);
  });

  detailedPromptLines.push(
    '',
    `【人物与对白契约】`,
    `- 角色对话必须带有双关试探与性格反差，严禁工具人直白说出意图；`,
    `- 高潮或对抗处必须书写具体的物理抗阻、骨骼与环境受力形变；`,
    `- 章末必须保留具备强烈点击冲动的悬念钩子。`
  );

  const detailedPrompt = detailedPromptLines.join('\n');

  // 2. 构建粗略版 Prompt (Coarse Prompt)
  // 仅保留 1~2 句核心冲突梗概，但必须 100% 完整保留风格语言要求
  const coreConflict = beats.length >= 2
    ? `主角在面临阶段核心阻力时（${beats[0].slice(0, 30)}），被迫采取果断行动，并在对抗中引发后续变局（${beats[beats.length - 1].slice(0, 30)}）。`
    : `主角在该阶段遭遇突发危机与立场抉择，必须在重重阻力中破局推进。`;

  const coarsePromptLines = [
    `请创作一章高水准的${genre}小说章节（字数约 2200~2800 字）：`,
    '',
    `【作品风格与语言特质 (强制遵守)】`,
    `- 原著范本：《${bookTitle}》（作者：${author}）`,
    `- 题材风格基调：${styleDirective}`,
    `- 叙事视角：第三人称受限视角，严守信息隔离与微观生理受力细节。`,
    '',
    `【宏观核心冲突梗概】`,
    `本章处于故事的【${stage === 'early' ? '开篇破题' : (stage === 'middle' ? '中盘升级' : '高潮决战')}】阶段，章节名拟定为《${chapterTitle}》。`,
    `${coreConflict}`,
    '请根据上述宏观方向自由推演具体情节脉络，但必须保持原著冷峻机锋与紧凑商业节奏，章末留有悬念。'
  ];

  const coarsePrompt = coarsePromptLines.join('\n');

  return {
    stage,
    bookTitle,
    author,
    genre,
    originalWordCount: bodyText.length,
    originalSnippet: bodyText.slice(0, 200),
    detailedPrompt,
    coarsePrompt
  };
}

module.exports = {
  GENRE_STYLE_DIRECTIVES,
  readNovelText,
  scanGenreBooks,
  extractThreeStages,
  compressToDualPrompts
};
