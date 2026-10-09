'use strict';

/**
 * @file prompt-experiment-extractor.js
 * 资源库小说全库单章抽样与双模提示词提取引擎 (Corpus Dual Prompt Extractor)
 * 
 * 核心功能：
 * 1. 鲁棒小说章节切分与随机确定性采样 (R1)：
 *    - 支持分卷分隔符 (Shukuge)、标准章名正则与非标准短标题；
 *    - 严格过滤纯感言/请假/目录，锁定有效章节 (>=1000字)；
 *    - 基于书名与哈希种子的确定性单章随机抽样；
 * 2. 双模提示词智能提取管线 (R2)：
 *    - 极简提示词 (Minimal Prompt)：核心故事情节概要 (150~300字) + 题材文风基调特征；
 *    - 完整提示词 (Comprehensive Prompt)：人设动机 + 冲突阻力节拍 + 因果债务与末尾钩子 + 
 *      墨阑 5 维参数 (Genre/Style/Goal/Focus/Hook) + 4 级注意力分级 (Tier 1~4)；
 * 3. 四象限对照实验配置装配 (R3)：
 *    - 象限 A (实验组 A): 墨阑完整链路 + 极简提示词
 *    - 象限 B (实验组 B): 墨阑完整链路 + 完整提示词
 *    - 象限 C (对照组 C): 大模型单轮直出 + 极简提示词
 *    - 象限 D (对照组 D): 大模型单轮直出 + 完整提示词
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { extractChapterFactors } = require('./factorized-extractor');

// 分割线正则（书阁/起点下载格式）
const RE_DIVIDER = /^-{6,}\s*$/m;

// 章节标题正则（标准长篇网文格式，兼容卷前缀如 卷一、第一卷、VIP卷、正文卷 等）
const RE_CHAPTER_HEADING = /^[ \t\u3000\uFEFF]*(?:(?:(?:第\s*[0-9一二三四五六七八九十百千万两零〇]+\s*卷|卷\s*[0-9一二三四五六七八九十百千万两零〇]+|VIP卷|正文卷|作品相关|分卷[0-9一二三四五六七八九十]+)[ \t\u3000\uFEFF:：\-_–—]*)?(?:第\s*[0-9一二三四五六七八九十百千万两零〇]+\s*[章回节篇话折]|Chapter\s*\d+|【\s*\d{1,4}\s*】|\d{1,4}\s*[.、，:：\s\-–—]\s*[\u4e00-\u9fa5a-zA-Z]|(?:引子|序章?|楔子|尾声|大结局|终章|后记|结语|番外(?:[篇章\d\s]|$)|上架感言))[^\r\n]{0,80})[ \t\u3000]*$/m;

// 元数据黑名单关键词（排除纯感言与公告）
const META_EXCLUDE_KEYWORDS = [
  '上架感言', '完本感言', '完结感言', '请假条', '请假', '停更', '说明', 
  '通告', '通知', '附录', '设定集', '番外介绍', '新书预告', '推书'
];

/**
 * 鲁棒切分小说章节
 * @param {string} rawText 原始全文本
 * @returns {Array<{chapterNo: number, title: string, content: string, charCount: number}>}
 */
function extractChapters(rawText = '') {
  const text = String(rawText || '');
  if (!text.trim()) return [];

  const lines = text.split(/\r?\n/);

  // 1. 分割线格式检测 (>= 5 个分割线)
  const divIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^-{6,}\s*$/)) {
      divIndices.push(i);
    }
  }

  if (divIndices.length >= 5) {
    const chapters = [];
    for (let i = 0; i < divIndices.length; i++) {
      const startLine = divIndices[i];
      const endLine = (i + 1 < divIndices.length) ? divIndices[i + 1] : lines.length;
      const subLines = lines.slice(startLine + 1, endLine);
      const titleLine = subLines.find(l => l.trim().length > 0) || `第${i + 1}章`;
      const content = subLines.join('\n').trim();
      if (content.length > 0) {
        chapters.push({
          chapterNo: chapters.length + 1,
          title: titleLine.trim(),
          content,
          charCount: content.length
        });
      }
    }
    if (chapters.length > 0) return chapters;
  }

  // 2. 标准章节标题正则匹配
  const headingIndices = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(RE_CHAPTER_HEADING)) {
      headingIndices.push(i);
    }
  }

  if (headingIndices.length >= 2) {
    // 过滤紧贴在前言的目录页（前 30 行内距离 < 3 行的密集匹配）
    let startMatchIdx = 0;
    if (headingIndices.length > 10) {
      for (let i = 0; i < Math.min(headingIndices.length - 1, 30); i++) {
        if (headingIndices[i + 1] - headingIndices[i] < 3) {
          startMatchIdx = i + 1;
        }
      }
      if (startMatchIdx > 5) {
        headingIndices.splice(0, startMatchIdx);
      }
    }

    const chapters = [];
    for (let i = 0; i < headingIndices.length; i++) {
      const startLine = headingIndices[i];
      const endLine = (i + 1 < headingIndices.length) ? headingIndices[i + 1] : lines.length;
      const title = lines[startLine].trim();
      const content = lines.slice(startLine + 1, endLine).join('\n').trim();
      if (content.length > 0) {
        chapters.push({
          chapterNo: chapters.length + 1,
          title,
          content,
          charCount: content.length
        });
      }
    }
    if (chapters.length > 0) return chapters;
  }

  // 3. 非标准数字后缀短标题匹配 (如：尸体上的葡萄1, 预见自杀案1)
  const patternHeadingIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length >= 2 && line.length <= 25 && /^[\u4e00-\u9fa5a-zA-Z0-9·_—\s]+[0-9一二三四五六七八九十]+$/.test(line)) {
      const prevBlank = (i === 0 || lines[i - 1].trim() === '');
      const nextBlank = (i === lines.length - 1 || lines[i + 1].trim() === '');
      if (prevBlank || nextBlank) {
        patternHeadingIndices.push(i);
      }
    }
  }

  if (patternHeadingIndices.length >= 3) {
    const chapters = [];
    for (let i = 0; i < patternHeadingIndices.length; i++) {
      const startLine = patternHeadingIndices[i];
      const endLine = (i + 1 < patternHeadingIndices.length) ? patternHeadingIndices[i + 1] : lines.length;
      const title = lines[startLine].trim();
      const content = lines.slice(startLine + 1, endLine).join('\n').trim();
      if (content.length > 0) {
        chapters.push({
          chapterNo: chapters.length + 1,
          title,
          content,
          charCount: content.length
        });
      }
    }
    if (chapters.length > 0) return chapters;
  }

  // 4. 兜底分块 (针对极少数无标题长文本，按自然段落划分 ~2500 字分章)
  if (text.length > 3000) {
    const chapters = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = [];
    let currentLen = 0;
    let chunkIndex = 1;

    for (const p of paragraphs) {
      currentChunk.push(p);
      currentLen += p.length;
      if (currentLen >= 2500) {
        const content = currentChunk.join('\n\n').trim();
        chapters.push({
          chapterNo: chunkIndex,
          title: `第${chunkIndex}节`,
          content,
          charCount: content.length
        });
        currentChunk = [];
        currentLen = 0;
        chunkIndex++;
      }
    }

    if (currentChunk.length > 0) {
      const content = currentChunk.join('\n\n').trim();
      if (content.length > 0) {
        chapters.push({
          chapterNo: chunkIndex,
          title: `第${chunkIndex}节`,
          content,
          charCount: content.length
        });
      }
    }
    if (chapters.length > 0) return chapters;
  }

  // 5. 极端单篇保底
  return [{
    chapterNo: 1,
    title: '全文本章',
    content: text.trim(),
    charCount: text.trim().length
  }];
}

/**
 * 判断章节是否为有效章节
 * @param {Object} chapter 章节对象
 * @param {number} minChars 最低字数要求
 * @returns {boolean}
 */
function isValidChapter(chapter, minChars = 1000) {
  if (!chapter || !chapter.content) return false;
  if (chapter.charCount < minChars) return false;

  const title = String(chapter.title || '');
  for (const kw of META_EXCLUDE_KEYWORDS) {
    if (title.includes(kw)) {
      return false;
    }
  }

  // 避免纯目录或极度重复的水文
  const lines = chapter.content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 5 && chapter.charCount < 1500) return false;

  return true;
}

/**
 * 确定性随机采样：从图书章节列表中抽取 1 个有效章节
 * @param {Array<Object>} chapters 章节列表
 * @param {string} seed 确定性种子
 * @returns {Object} 抽中的章节
 */
function sampleChapter(chapters = [], seed = '') {
  if (!chapters.length) {
    throw new Error('章节列表为空，无法采样');
  }

  // 首选过滤：字数 >= 1000 且非感言
  let validCandidates = chapters.filter(c => isValidChapter(c, 1000));

  // 次选兜底：字数 >= 500
  if (validCandidates.length === 0) {
    validCandidates = chapters.filter(c => isValidChapter(c, 500));
  }

  // 保底：取正文最长的一个章节
  if (validCandidates.length === 0) {
    const sorted = [...chapters].sort((a, b) => b.charCount - a.charCount);
    return sorted[0];
  }

  // 使用确定性 SHA-256 哈希种子映射索引
  const hash = crypto.createHash('sha256').update(String(seed || 'molan_sampling_seed_2026')).digest();
  const index = hash.readUInt32BE(0) % validCandidates.length;

  return validCandidates[index];
}

/**
 * 从小说正文中提取实体角色、对话人物与核心对抗
 * @param {string} text 章节正文
 * @returns {Object} 角色与实体画像
 */
function extractEntitiesAndCharacters(text = '') {
  const content = String(text || '');
  const characters = new Map();

  // 1. 对白归属人物扫描：如 “...”张三冷声道 / 李四皱眉道
  const dialogueAttributionRegex = /[”"’](\s*[\u4e00-\u9fa5]{2,4}\s*(?:冷笑|低声|沉声|皱眉|怒喝|笑道|轻笑|怒道|说|道|问|喝道|叹道|喃喃|喊道|回应|答道))/g;
  let match;
  while ((match = dialogueAttributionRegex.exec(content)) !== null) {
    const rawName = match[1].replace(/(?:冷笑|低声|沉声|皱眉|怒喝|笑道|轻笑|怒道|说|道|问|喝道|叹道|喃喃|喊道|回应|答道)/g, '').trim();
    if (rawName && rawName.length >= 2 && rawName.length <= 4 && !/^(心中|自己|众人|对方|有人|这时|突然|随即)/.test(rawName)) {
      characters.set(rawName, (characters.get(rawName) || 0) + 3);
    }
  }

  // 2. 常见人名及称号模式提取
  const namePattern = /(?:[老小大阿][\u4e00-\u9fa5]|[\u4e00-\u9fa5]{2,3}(?:师兄|师弟|师姐|师妹|长老|宗主|统领|队长|将军|大人|掌门|道友|兄弟|公子|小姐|先生|夫人))/g;
  while ((match = namePattern.exec(content)) !== null) {
    const name = match[0].trim();
    if (name.length >= 2 && name.length <= 5) {
      characters.set(name, (characters.get(name) || 0) + 2);
    }
  }

  // 排序前三主要人物
  const sortedChars = Array.from(characters.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const protagonist = sortedChars[0] || '核心主角';
  const antagonist = sortedChars[1] || (sortedChars.length > 1 ? sortedChars[1] : '对抗阻力方/交锋对手');
  const allies = sortedChars.slice(2, 4);

  return {
    protagonist,
    antagonist,
    allies,
    identifiedEntities: sortedChars.slice(0, 5)
  };
}

/**
 * 提取章节的情节起承转合 4 节拍骨架
 * @param {string} text 章节正文
 * @param {Object} factors 因子特征
 * @returns {Object} 4-beat 节拍
 */
function extractNarrativeBeats(text = '', factors = {}) {
  const content = String(text || '').trim();
  const len = content.length;

  const part1 = content.slice(0, Math.floor(len * 0.25));
  const part2 = content.slice(Math.floor(len * 0.25), Math.floor(len * 0.55));
  const part3 = content.slice(Math.floor(len * 0.55), Math.floor(len * 0.85));
  const part4 = content.slice(Math.floor(len * 0.85));

  // 提取各部分中最具代表性的陈述句
  const extractKeySentence = (chunk, defaultText) => {
    const sents = chunk.split(/[。！？!?\n]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 15 && s.length <= 60 && !/^[“”"']/.test(s));
    return sents[0] || defaultText;
  };

  const beatQi = extractKeySentence(part1, '开局交代局势暗流与临场环境，核心人物面临即时任务或隐患。');
  const beatCheng = extractKeySentence(part2, '局势进一步升级，外部阻力或利益试探介入，双方展开接触与言行试探。');
  const beatZhuan = extractKeySentence(part3, '突发冲突爆发或关键事实浮出水面，原定计划受挫，局势出现戏剧性转折。');
  const beatHe = extractKeySentence(part4, '阶段性交锋分出初步结果，余波未平，并向章末抛出更深层的悬念或危机。');

  return {
    beatQi,
    beatCheng,
    beatZhuan,
    beatHe
  };
}

/**
 * 双模提示词提取核心：为采样章节生成“极简提示词”与“完整提示词”
 * @param {string} chapterText 章节完整正文
 * @param {Object} metadata 包含 bookId, title, category, author, chapterTitle, chapterNo 等元数据
 * @returns {Object} 包含极简提示词与完整提示词的对象
 */
function extractDualPrompts(chapterText = '', metadata = {}) {
  const text = String(chapterText || '').trim();
  if (!text) {
    throw new TypeError('extractDualPrompts 章节正文不能为空');
  }

  // 1. 调用系统正交因子提取器
  const factors = extractChapterFactors(text, {
    title: metadata.title || '',
    chapterNo: metadata.chapterNo || 1,
    genre: metadata.category || 'universal'
  });

  const { stylometry, primaryGoal, focusVector, tailHook, outcomeContract } = factors;
  const entities = extractEntitiesAndCharacters(text);
  const beats = extractNarrativeBeats(text, factors);

  // 2. 提炼文风标签与基调描述
  const styleTraits = [];
  if (stylometry.shortSentenceRatio >= 0.55) styleTraits.push('短促冷峻');
  else if (stylometry.shortSentenceRatio <= 0.35) styleTraits.push('从容舒展');

  if (stylometry.narrativeDensity >= 0.50) styleTraits.push('强物理动作张力');
  if (stylometry.dialogueRatio >= 0.40) styleTraits.push('高密机锋对白');
  if (stylometry.emotionalIntensity >= 0.45) styleTraits.push('激烈情绪压迫');
  if (stylometry.informationDensity >= 0.65) styleTraits.push('高信息线索负载');
  if (stylometry.negativeSpaceRatio >= 0.40) styleTraits.push('适度克制留白');
  if (styleTraits.length === 0) styleTraits.push('扎实平稳叙事');

  const styleToneDesc = styleTraits.join('、');

  // 3. 构建【极简提示词 (Minimal Prompt)】(150~300 字核心概要 + 题材文风)
  const categoryName = metadata.category || '通俗网络文学';
  const minimalSummary = `本章围绕【${entities.protagonist}】在【${categoryName}】情境下的关键行动展开。` +
    `开局${beats.beatQi.slice(0, 45)}；随后局势升级，${entities.antagonist}施加关键阻力，双方产生剧烈对抗或机锋博弈；` +
    `转折点${beats.beatZhuan.slice(0, 45)}；章末${beats.beatHe.slice(0, 40)}，留下${tailHook.type === 'crisis' ? '生死危机' : (tailHook.type === 'suspense' ? '未解谜团' : '重要悬念')}钩子。`;

  const minimalPromptMarkdown = [
    `# 创作任务：${metadata.title} - ${metadata.chapterTitle}`,
    `**题材类型**：${categoryName}`,
    `**文风基调**：${styleToneDesc}（短句比: ${(stylometry.shortSentenceRatio * 100).toFixed(0)}%，对白比: ${(stylometry.dialogueRatio * 100).toFixed(0)}%，动作密度: ${(stylometry.narrativeDensity * 100).toFixed(0)}%）`,
    `**核心故事情节概要**：`,
    minimalSummary,
    `**章末要求**：结尾卡在关键情境节点，制造${tailHook.gapType || '信息缺口'}，促使读者强烈翻页。`
  ].join('\n\n');

  // 4. 构建【完整提示词 (Comprehensive Prompt)】
  // 映射 5 维墨阑系统规格 (Genre, Style, Goal, Focus, Hook)
  const genreId = `${(metadata.category || 'universal').replace(/[\/\s]/g, '_')}_profile`;
  const styleId = stylometry.shortSentenceRatio > 0.5 ? 'laobai_restrained' : 'balanced_classical';
  const goalId = primaryGoal || 'conflict_push';
  const hookId = tailHook.type === 'crisis' ? 'crisis_imminent' : (tailHook.type === 'suspense' ? 'suspense_clue' : 'anticipation_turn');

  const fiveDimensions = {
    genre: {
      id: genreId,
      family: metadata.category || 'universal',
      background: [metadata.category, '原著情境'],
      coreConflicts: ['外部阻力施压', '即时生存/利益竞争']
    },
    style: {
      id: styleId,
      baseVector: {
        narrativeDensity: stylometry.narrativeDensity,
        emotionalIntensity: stylometry.emotionalIntensity,
        rhetoricalAbundance: stylometry.rhetoricalAbundance,
        colloquialLevel: stylometry.colloquialLevel,
        dialogueRatio: stylometry.dialogueRatio,
        psychologicalRatio: stylometry.psychologicalRatio,
        settingRatio: stylometry.settingRatio,
        averageSentenceLength: stylometry.averageSentenceLength,
        shortSentenceRatio: stylometry.shortSentenceRatio,
        informationDensity: stylometry.informationDensity,
        negativeSpaceRatio: stylometry.negativeSpaceRatio
      },
      positiveDirectives: [
        `短句比控制在 ${(stylometry.shortSentenceRatio * 100).toFixed(0)}% 左右，动作描写注重受力传导`,
        `对白占比保持约 ${(stylometry.dialogueRatio * 100).toFixed(0)}%，台词话里有话且穿插微动作`
      ]
    },
    goal: {
      id: goalId,
      name: goalId === 'conflict_push' ? '冲突激化推进' : (goalId === 'info_reveal' ? '关键物证线索浮出' : '情节均衡推进'),
      stateDelta: outcomeContract.stateDelta
    },
    focus: {
      budgetWeights: focusVector,
      directives: {
        dialogue: `对白预算 ${(focusVector.dialogue * 100).toFixed(0)}%，注重信息试探与交锋`,
        action: `动作预算 ${(focusVector.action * 100).toFixed(0)}%，突出具象动作动词`,
        conflict: `冲突预算 ${(focusVector.conflict * 100).toFixed(0)}%，阻力不可轻易瓦解`
      }
    },
    hook: {
      id: hookId,
      type: tailHook.type,
      gapType: tailHook.gapType,
      strength: tailHook.strength,
      directive: `章末 200 字内必须构建${tailHook.gapType}，尾句卡在情绪/危机高位`
    }
  };

  const attentionTiers = {
    tier1Permanent: {
      bibleRules: [
        `世界观基底遵守【${metadata.category}】核心法则，严禁出现脱离题材背景的违和概念`,
        `严禁机械 AI 味套词（如“嘴角勾起”、“倒吸凉气”、“眼神闪过一丝玩味”）`,
        `遵循现实物理逻辑与因果一致性，战力与信息不可无序跃迁`
      ]
    },
    tier2Strategy: {
      pacingFormula: `本章推进节奏采用【起-承-转-合】四段式，核心目标指向【${goalId}】`,
      sceneTechniques: [
        `起：${beats.beatQi}`,
        `承：${beats.beatCheng}`,
        `转：${beats.beatZhuan}`,
        `合：${beats.beatHe}`
      ]
    },
    tier3Evidence: {
      exemplarTraits: `对齐原著文风：平均句长 ${stylometry.averageSentenceLength} 字，虚词熵 ${stylometry.functionWordEntropy}，修辞丰度 ${stylometry.rhetoricalAbundance}`,
      dialogueRatioConstraint: `严格将对白占比约束在 ${(stylometry.dialogueRatio * 100).toFixed(0)}% 上下`
    },
    tier4Immediate: {
      sceneState: `即时现场：主角【${entities.protagonist}】直面【${entities.antagonist}】，因果债务：${outcomeContract.stateDelta.stateAfter}`,
      immediateGoal: `推进本章核心冲突，完成向下一阶段不可逆的状态位移`
    }
  };

  const comprehensivePromptMarkdown = [
    `# 墨阑全规格创书任务书：${metadata.title} - ${metadata.chapterTitle}`,
    `> 题材归属：${metadata.category} | 章节字数规格：2500~3500字 | 目标：${goalId}`,
    ``,
    `## 一、人物设定与行动动机`,
    `- **核心主角**：【${entities.protagonist}】（即时动机：破局脱困、抢占先机或查明线索）`,
    `- **对抗对手**：【${entities.antagonist}】（阻力动机：利益掠夺、信息封锁或直接压制）`,
    `- **在场相关方**：${entities.allies.length ? entities.allies.join('、') : '周边观察者/次要对手'}`,
    ``,
    `## 二、核心冲突阻力与情节起伏节拍`,
    `- **冲突核心**：${outcomeContract.stateDelta.stateBefore} -> ${outcomeContract.stateDelta.stateAfter}`,
    `- **【起】阶段**：${beats.beatQi}`,
    `- **【承】阶段**：${beats.beatCheng}`,
    `- **【转】阶段**：${beats.beatZhuan}`,
    `- **【合】阶段**：${beats.beatHe}`,
    ``,
    `## 三、因果债务状态机与章末钩子`,
    `- **状态位移 (State Delta)**：${outcomeContract.stateDelta.stateAfter}`,
    `- **不可逆约束**：${outcomeContract.stateDelta.invalidIfRemoved}`,
    `- **章末钩子规范**：类型【${tailHook.type}】/ 缺口模式【${tailHook.gapType}】/ 强度【${tailHook.strength}】`,
    `- **钩子指示**：卡在${tailHook.type === 'crisis' ? '突发危险逼近' : '颠覆性事实显露'}的瞬间，杜绝任何提早平账或自我安慰。`,
    ``,
    `## 四、墨阑 5 维参数配置 (5D Composition Matrix)`,
    `- **Genre Profile**：${genreId} (题材家族: ${metadata.category})`,
    `- **Style Profile**：${styleId} (句长 ${stylometry.averageSentenceLength} 字, 短句比 ${(stylometry.shortSentenceRatio * 100).toFixed(0)}%, 对白比 ${(stylometry.dialogueRatio * 100).toFixed(0)}%, 动作密度 ${(stylometry.narrativeDensity * 100).toFixed(0)}%)`,
    `- **Goal Profile**：${goalId}`,
    `- **Focus Vector**：对白 ${(focusVector.dialogue * 100).toFixed(0)}% / 动作 ${(focusVector.action * 100).toFixed(0)}% / 冲突 ${(focusVector.conflict * 100).toFixed(0)}% / 心理 ${(focusVector.emotion * 100).toFixed(0)}% / 环境 ${(focusVector.setting * 100).toFixed(0)}%`,
    `- **Hook Profile**：${hookId}`,
    ``,
    `## 五、4 级注意力分级规划 (Attention Tiering)`,
    `- **Tier 1 (圣经与世界观法则)**：${attentionTiers.tier1Permanent.bibleRules.join('；')}`,
    `- **Tier 2 (策略节拍与场景技法)**：${attentionTiers.tier2Strategy.pacingFormula}；节拍严格对照起承转合`,
    `- **Tier 3 (文风证据与约束指标)**：${attentionTiers.tier3Evidence.exemplarTraits}`,
    `- **Tier 4 (现场行动与即时前情)**：${attentionTiers.tier4Immediate.sceneState}`
  ].join('\n');

  return {
    minimal: {
      summary: minimalSummary,
      styleTone: styleToneDesc,
      markdown: minimalPromptMarkdown,
      charCount: minimalPromptMarkdown.length
    },
    comprehensive: {
      entities,
      beats,
      fiveDimensions,
      attentionTiers,
      markdown: comprehensivePromptMarkdown,
      charCount: comprehensivePromptMarkdown.length
    },
    factors
  };
}

/**
 * 组装四象限实验与对照任务载荷 (4-Quadrant Task Matrix)
 * @param {Object} sampleRecord 采样数据记录
 * @returns {Object} 四象限各自的任务定义与输入载荷
 */
function buildQuadrantConfigs(sampleRecord = {}) {
  const { bookId, title, category, chapterTitle, chapterNo, dualPrompts } = sampleRecord;
  const minimal = dualPrompts.minimal;
  const comprehensive = dualPrompts.comprehensive;

  return {
    quadrantA: {
      quadrant: 'A',
      type: 'experiment_a',
      name: '墨阑完整生成链 + 极简提示词',
      description: '输入极简提示词，由墨阑系统场景规划器、策略编译器、注意力分级算法驱动智能补全并生成正文',
      pipeline: 'molan_full_pipeline',
      promptLevel: 'minimal',
      payload: {
        bookId,
        title,
        category,
        chapterNo,
        chapterTitle,
        systemDirectives: '启用墨阑 Phase 2 创作编排管线，由极简提示词自动推导场景细纲与策略卡。',
        userPrompt: minimal.markdown,
        inferredSpec: true
      }
    },
    quadrantB: {
      quadrant: 'B',
      type: 'experiment_b',
      name: '墨阑完整生成链 + 完整提示词',
      description: '输入全规格 5 维参数与注意力分级约束，驱动墨阑系统以最高保真度策略生成高张力正文',
      pipeline: 'molan_full_pipeline',
      promptLevel: 'comprehensive',
      payload: {
        bookId,
        title,
        category,
        chapterNo,
        chapterTitle,
        systemDirectives: '启用墨阑 Phase 2 创作编排管线，严格绑定 5 维 Profile 与 Tier 1~4 注意力分级。',
        userPrompt: comprehensive.markdown,
        fiveDimensions: comprehensive.fiveDimensions,
        attentionTiers: comprehensive.attentionTiers,
        inferredSpec: false
      }
    },
    quadrantC: {
      quadrant: 'C',
      type: 'control_c',
      name: '大模型单轮直接生成 + 极简提示词',
      description: '作为对照组，不经过墨阑编排链路，直接使用大模型对极简提示词进行单轮零次生成',
      pipeline: 'direct_llm_single_turn',
      promptLevel: 'minimal',
      payload: {
        bookId,
        title,
        category,
        chapterNo,
        chapterTitle,
        systemPrompt: '你是一名资深网络小说作家，请根据以下简要提示词撰写一章小说正文。要求情节连贯，文笔流畅，字数约2500~3500字。',
        userPrompt: minimal.markdown
      }
    },
    quadrantD: {
      quadrant: 'D',
      type: 'control_d',
      name: '大模型单轮直接生成 + 完整提示词',
      description: '作为对照组，不经过墨阑编排链路，直接将长文本完整提示词喂给大模型进行单轮长上下文生成',
      pipeline: 'direct_llm_single_turn',
      promptLevel: 'comprehensive',
      payload: {
        bookId,
        title,
        category,
        chapterNo,
        chapterTitle,
        systemPrompt: '你是一名资深网络小说作家，请严格遵循以下全维度设定、起承转合节拍、文风指标与注意力规则，撰写一章小说正文。字数约2500~3500字。',
        userPrompt: comprehensive.markdown
      }
    }
  };
}

/**
 * 完整处理单本图书：切章、采样、双模提炼、组装四象限
 * @param {string} filePath 图书绝对/相对路径
 * @param {Object} options 包含 category, seed 等可选参数
 * @returns {Object} 完整样本实验档案
 */
function processBookFile(filePath, options = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const filename = path.basename(filePath, path.extname(filePath));
  const category = options.category || path.basename(path.dirname(filePath)) || '通用';

  // 解析作者
  let author = null;
  const authorMatch = content.slice(0, 500).match(/(?:作者[：:]\s*|著[：:]\s*)([^\r\n\s]{2,10})/);
  if (authorMatch) {
    author = authorMatch[1].trim();
  }

  // 1. 切分全部章节
  const chapters = extractChapters(content);
  if (!chapters.length) {
    throw new Error(`无法从书籍切分出章节: ${filePath}`);
  }

  // 2. 确定性随机采样 1 个有效章节
  const seed = `${filePath}_${filename}_${options.seed || 'molan_2026'}`;
  const sampled = sampleChapter(chapters, seed);

  // 3. 双模提示词提取
  const metadata = {
    bookId: filename,
    title: filename,
    author,
    category,
    chapterNo: sampled.chapterNo,
    chapterTitle: sampled.title,
    charCount: sampled.charCount
  };

  const dualPrompts = extractDualPrompts(sampled.content, metadata);

  // 4. 组装采样记录
  const sampleRecord = {
    bookId: filename,
    title: filename,
    author,
    category,
    sourceFilePath: filePath,
    sampledChapter: {
      chapterNo: sampled.chapterNo,
      chapterTitle: sampled.title,
      charCount: sampled.charCount,
      totalChaptersInBook: chapters.length,
      contentSnippet: sampled.content.slice(0, 500) + '...'
    },
    originalChapterText: sampled.content,
    dualPrompts,
    createdAt: new Date().toISOString()
  };

  // 5. 挂载四象限实验组/对照组配置
  sampleRecord.quadrants = buildQuadrantConfigs(sampleRecord);

  return sampleRecord;
}

module.exports = {
  RE_DIVIDER,
  RE_CHAPTER_HEADING,
  extractChapters,
  isValidChapter,
  sampleChapter,
  extractEntitiesAndCharacters,
  extractNarrativeBeats,
  extractDualPrompts,
  buildQuadrantConfigs,
  processBookFile
};
