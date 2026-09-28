import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.resolve(PROJECT_ROOT, '..', '资源库', '小说原本');
const SAMPLE_MANIFEST = path.resolve(PROJECT_ROOT, 'data', 'genre_sampling_6books.json');
const CONFIG_FILE = path.resolve(PROJECT_ROOT, 'data', 'config.json');
const DEFAULT_OUTPUT = path.resolve(PROJECT_ROOT, 'generated', 'local-style-generation-20260925-gpt-6-luna');
const MODEL_ID = 'gpt-6-luna';
const REASONING_EFFORT = 'max';
const PHASES = ['前期', '前期', '前期', '中期', '中期', '中期', '后期', '后期', '后期'];
const ANNOUNCEMENT = /月票|请假|感言|通知|上架|单章|推书|打赏|完本感言|新年快乐|祝福|公告|读者|番外说明/u;
const CHAPTER_HEADING = /^[ \t\u3000\uFEFF]*(第[零〇一二三四五六七八九十百千万两\d]+[章回节卷篇话][^\r\n]{0,80}|(?:引子|序章|楔子|尾声|大结局|终章|后记)[^\r\n]{0,80}|Chapter\s*\d+[^\r\n]{0,80})[ \t\u3000]*$/gmu;

const PROJECT_WRITING_RULES = [
  '按本次提示词提供的题材、视角、人物目标、语言节奏和情绪曲线写作；不要把不同题材统一改造成同一种主角、冲突或爽点。',
  '只迁移抽象的叙事机制和可观察的文风特征。不得复用参考原作的专名、独特设定、表达、笑点或完整事件顺序。',
  '人物行为须符合其目标、利益、信息和能力边界；反转须依赖此前已经建立的条件，成功要有代价或不可逆结果。',
  '设定跟随眼前行动、对话、物证和规则逐步进入。每段有明确作用，避免解释堆积、重复反应和全知旁白。',
  '动作与感官描写符合物理常识；指代清楚、语句完整、动词自然。避免烂俗比喻、声音实体化、否定式煽情、统一群体反应、机械单字动词和模板化 AI 套话。',
  '按本题材与新提示词设定控制章长，默认约 2200 至 2800 个中文字符；每章完成有效变化并以具体压力、决定、发现或局势变化收尾。',
  '只输出本章标题和小说正文，不输出解释、评分、审稿意见、修改说明或自我评价。'
].join('\n');

function readOptions(argv) {
  const options = { planOnly: false, limitBooks: 0, concurrency: 1, genres: null, onlyGenres: null, output: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan-only') options.planOnly = true;
    else if (arg === '--limit-books') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) throw new Error('--limit-books 必须是正整数');
      options.limitBooks = value;
    } else if (arg === '--concurrency') {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 8) throw new Error('--concurrency 必须是 1 到 8 之间的整数');
      options.concurrency = value;
    } else if (arg === '--genres') {
      const value = argv[++index];
      if (!value) throw new Error('--genres 缺少题材目录列表');
      options.genres = [...new Set(value.split(',').map(genre => genre.trim()).filter(Boolean))];
    } else if (arg === '--only-genres') {
      const value = argv[++index];
      if (!value) throw new Error('--only-genres 缺少题材目录列表');
      options.onlyGenres = [...new Set(value.split(',').map(genre => genre.trim()).filter(Boolean))];
    } else if (arg === '--out') {
      const value = argv[++index];
      if (!value) throw new Error('--out 缺少目录参数');
      options.output = path.resolve(PROJECT_ROOT, value);
    } else {
      throw new Error('未知参数: ' + arg);
    }
  }
  return options;
}

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeBuffer(buffer) {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(buffer.subarray(3)), encoding: 'utf-8-bom' };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(buffer.subarray(2)), encoding: 'utf-16le' };
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(buffer.subarray(2)), encoding: 'utf-16be' };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('gb18030').decode(buffer), encoding: 'gb18030' };
  }
}

function parseChapters(text) {
  const matches = [...text.matchAll(CHAPTER_HEADING)];
  if (!matches.length) return [];

  let first = 0;
  if (matches.length > 5 && matches[4].index < 3000) {
    const firstAfterContents = matches.findIndex(match => match.index > 3000);
    if (firstAfterContents > 0) first = firstAfterContents;
  }

  return matches.slice(first).map((match, offset, list) => {
    const next = list[offset + 1];
    const end = next ? next.index : text.length;
    const fullText = text.slice(match.index, end).trim();
    const body = text.slice(match.index + match[0].length, end).trim();
    return {
      sourceIndex: first + offset + 1,
      title: match[1].trim(),
      body,
      fullText
    };
  }).filter(chapter => chapter.body.length >= 500 && !ANNOUNCEMENT.test(chapter.title));
}

function chooseSamples(chapters) {
  if (chapters.length < 9) return null;
  const output = [];
  const used = new Set();
  for (let slot = 0; slot < 9; slot += 1) {
    const target = Math.min(chapters.length - 1, Math.floor(((slot + 0.5) * chapters.length) / 9));
    let selected = target;
    while (used.has(selected) && selected < chapters.length - 1) selected += 1;
    while (used.has(selected) && selected > 0) selected -= 1;
    if (used.has(selected)) return null;
    used.add(selected);
    output.push({ ...chapters[selected], phase: PHASES[slot], phaseSlot: slot % 3 + 1 });
  }
  return output;
}

function safeSegment(value, maxLength = 70) {
  let result = String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_')
    .replace(/[ .]+$/gu, '')
    .trim()
    .slice(0, maxLength);
  if (!result) result = 'untitled';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(result)) result = '_' + result;
  return result;
}

function resolveTitleFile(directory, title, filesByStem) {
  const requested = String(title || '').trim();
  const withExtension = path.extname(requested) ? requested : requested + '.txt';
  const direct = path.join(directory, withExtension);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct;
  const stem = path.basename(requested, path.extname(requested)).toLocaleLowerCase();
  return filesByStem.get(stem) || null;
}

function inspectBook(filePath, genre, order) {
  const buffer = fs.readFileSync(filePath);
  const decoded = decodeBuffer(buffer);
  const chapters = parseChapters(decoded.text);
  const samples = chooseSamples(chapters);
  if (!samples) return null;
  const title = path.basename(filePath, path.extname(filePath));
  const id = crypto.createHash('sha256').update(genre + '\0' + title).digest('hex').slice(0, 14);
  return {
    id,
    genre,
    order,
    title,
    sourcePath: path.relative(SOURCE_ROOT, filePath),
    sourceHash: digest(buffer),
    encoding: decoded.encoding,
    validChapterCount: chapters.length,
    sampleMeta: samples.map(sample => ({
      phase: sample.phase,
      phaseSlot: sample.phaseSlot,
      sourceIndex: sample.sourceIndex,
      title: sample.title,
      charCount: sample.fullText.length
    }))
  };
}

function buildPlan(genreFilter = null) {
  const sampling = JSON.parse(fs.readFileSync(SAMPLE_MANIFEST, 'utf8'));
  const allGenres = Object.keys(sampling).filter(genre => genre !== '测试');
  const problems = [];
  if (genreFilter) {
    const unknown = genreFilter.filter(genre => !allGenres.includes(genre));
    if (unknown.length) problems.push('未知或禁止的题材目录: ' + unknown.join('、'));
  }
  const genres = allGenres.filter(genre => !genreFilter || genreFilter.includes(genre)).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const books = [];

  for (const genre of genres) {
    const genreDir = path.join(SOURCE_ROOT, genre);
    if (!fs.existsSync(genreDir) || !fs.statSync(genreDir).isDirectory()) {
      problems.push(genre + ': 题材目录不存在');
      continue;
    }
    const files = fs.readdirSync(genreDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.txt$/iu.test(entry.name))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const filesByStem = new Map(files.map(name => [path.basename(name, path.extname(name)).toLocaleLowerCase(), path.join(genreDir, name)]));
    const picked = Array.isArray(sampling[genre]?.picked) ? sampling[genre].picked : [];
    if (picked.length < 6) problems.push(genre + ': 抽样清单少于 6 本');

    const candidates = [];
    for (const item of picked) {
      const filePath = resolveTitleFile(genreDir, item.title, filesByStem);
      if (filePath && !candidates.includes(filePath)) candidates.push(filePath);
    }
    for (const name of files) {
      const filePath = path.join(genreDir, name);
      if (!candidates.includes(filePath)) candidates.push(filePath);
    }

    let selected = 0;
    for (const filePath of candidates) {
      if (selected >= 6) break;
      try {
        const record = inspectBook(filePath, genre, selected + 1);
        if (!record) continue;
        record.order = selected + 1;
        books.push(record);
        selected += 1;
      } catch (error) {
        problems.push(genre + ': 无法解析一本候选原文（' + String(error.message || error).slice(0, 140) + '）');
      }
    }
    if (selected < 6) problems.push(genre + ': 仅找到 ' + selected + ' 本含 9 个完整章节的小说');
  }

  const counts = new Map();
  for (const book of books) counts.set(book.genre, (counts.get(book.genre) || 0) + 1);
  const badCounts = genres.filter(genre => counts.get(genre) !== 6);
  if (badCounts.length) problems.push('题材数量不符合每类 6 本: ' + badCounts.join('、'));
  return { genres, books, problems };
}

function getLocalModel() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const model = (config.platformModels || []).find(item => item.id === MODEL_ID);
  if (!model || model.provider !== 'openai-compat' || !model.baseURL || !model.apiKey) {
    throw new Error('本地平台配置未包含可用的 ' + MODEL_ID + ' 模型');
  }
  return {
    model,
    endpoint: model.baseURL.replace(/\/+$/u, '') + '/chat/completions'
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, filePath);
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function loadOrCreateState(outputRoot, plan) {
  const manifestPath = path.join(outputRoot, 'manifest.json');
  const statePath = path.join(outputRoot, 'progress.json');
  const signatures = plan.books.map(book => book.id);
  if (fs.existsSync(outputRoot)) {
    if (!fs.existsSync(manifestPath) || !fs.existsSync(statePath)) {
      throw new Error('输出目录已存在但没有本批次清单；为保护现有文件已停止: ' + outputRoot);
    }
    const oldManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const oldSignatures = oldManifest.books.map(book => book.id);
    if (JSON.stringify(oldSignatures) !== JSON.stringify(signatures)) {
      throw new Error('现有批次的抽样清单与当前原本库不一致，拒绝覆盖: ' + outputRoot);
    }
    return { manifest: oldManifest, state: JSON.parse(fs.readFileSync(statePath, 'utf8')), manifestPath, statePath };
  }

  fs.mkdirSync(outputRoot, { recursive: true });
  const books = plan.books.map(book => ({ ...book, bookDirectory: path.join(book.genre, String(book.order).padStart(2, '0') + '-' + safeSegment(book.title)) }));
  const manifest = {
    batch: path.basename(outputRoot),
    createdAt: new Date().toISOString(),
    model: MODEL_ID,
    reasoningEffort: REASONING_EFFORT,
    genreCount: plan.genres.length,
    novelsPerGenre: 6,
    novelCount: books.length,
    generatedChaptersPerNovel: 3,
    evaluation: 'not_requested; no scoring, comparison, audit, or revision calls',
    books
  };
  const state = {
    batch: manifest.batch,
    updatedAt: new Date().toISOString(),
    books: Object.fromEntries(books.map(book => [book.id, {
      status: 'pending',
      analysis: 'pending',
      chapters: { '1': 'pending', '2': 'pending', '3': 'pending' },
      errors: []
    }]))
  };
  writeJsonAtomic(manifestPath, manifest);
  writeJsonAtomic(statePath, state);
  writeText(path.join(outputRoot, 'README.md'), [
    '# 本地小说生成批次',
    '',
    '题材数：' + manifest.genreCount,
    '每类小说：6 本',
    '小说总数：' + manifest.novelCount,
    '每本生成：3 章',
    '模型：GPT-6 Luna，推理强度 max',
    '评测：未执行',
    '',
    '每本作品目录包含原文抽样章节、剧情机制与文风提取、生成提示词、生成章节和元数据。此目录保存在本机，不会同步到项目云端。',
    'progress.json 记录逐本和逐章状态，可用同一脚本重新运行并续跑。模型推理请求会将原文抽样内容或生成提示发送到已配置的模型网关。'
  ].join('\n') + '\n');
  return { manifest, state, manifestPath, statePath };
}

function getBookSamples(book) {
  const source = path.join(SOURCE_ROOT, book.sourcePath);
  const decoded = decodeBuffer(fs.readFileSync(source));
  const chapters = parseChapters(decoded.text);
  const byIndex = new Map(chapters.map(chapter => [chapter.sourceIndex, chapter]));
  return book.sampleMeta.map(item => {
    const chapter = byIndex.get(item.sourceIndex);
    if (!chapter) throw new Error('原文章节在预检后发生变化: ' + book.sourcePath + ' #' + item.sourceIndex);
    return { ...chapter, phase: item.phase, phaseSlot: item.phaseSlot };
  });
}

function buildAnalysisMessages(book, samples) {
  const samplesText = samples.map((sample, index) => [
    '【' + sample.phase + '第 ' + sample.phaseSlot + ' 篇；原文序号 ' + sample.sourceIndex + '；标题仅供定位】',
    sample.title,
    sample.body
  ].join('\n')).join('\n\n--------------------\n\n');
  const system = [
    '你是中文网文结构与文风拆解编辑。只提炼可迁移的叙事机制和文字行为；本任务不打分、不比较、不审稿。',
    '请分别概括前期、中期、后期样章的剧情功能和变化规律，并总结视角、句段节奏、信息释放、对白、情绪呈现、场景细节和章末悬念等文风特征。',
    '不得引用原句或连续复述原文，不得输出任何原作人物名、地名、组织名、专有设定或独特物品。不要复刻完整情节链；只保留冲突机制、回报类型、压力升级方式与章节功能。',
    '随后设计完全原创的新作品：主角、配角、地点、势力、物件、世界规则全部重新命名和重设；改变核心因果链和事件排列，不能把原作换皮。题材读者承诺和样本阶段感可以保留。',
    '输出剧情机制提取、文风特征提取、新作品设定和三章递进大纲，然后输出一个可直接用于生成的完整提示词。',
    '完整提示词必须放在独立的 <GENERATION_PROMPT> 与 </GENERATION_PROMPT> 标记之间；标记外不得重复该提示词。提示词中只使用新作品专属名词，不得包含原作专名。'
  ].join('\n');
  const user = [
    '题材目录：' + book.genre,
    '请分析以下九个原文章节。前期、中期、后期各三章，顺序已标明。',
    '只输出指定的拆解、新作品设计和提示词，不写小说正文，不给分数。',
    '',
    samplesText
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function parseModelResponse(raw) {
  let content = '';
  let usage = null;
  const dataLines = raw.split(/\r?\n/u).filter(line => line.startsWith('data:'));
  if (dataLines.length) {
    for (const line of dataLines) {
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = chunk.choices && chunk.choices[0];
      const part = choice && choice.delta && choice.delta.content;
      if (typeof part === 'string') content += part;
      else if (Array.isArray(part)) content += part.map(item => item && (item.text || item.content) || '').join('');
      if (choice && choice.message && typeof choice.message.content === 'string') content += choice.message.content;
      if (chunk.usage) usage = chunk.usage;
    }
  } else {
    try {
      const payload = JSON.parse(raw);
      const choice = payload.choices && payload.choices[0];
      const message = choice && choice.message;
      if (message && typeof message.content === 'string') content = message.content;
      if (message && Array.isArray(message.content)) content = message.content.map(item => item && (item.text || item.content) || '').join('');
      if (payload.usage) usage = payload.usage;
      if (!content && payload.error) throw new Error(String(payload.error.message || '模型返回错误'));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error('模型响应无法解析');
      throw error;
    }
  }
  return { content: content.trim(), usage };
}

function safeError(error) {
  return String(error && error.message || error || '未知错误')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, 'Bearer [redacted]')
    .slice(0, 500);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callModel(modelConfig, messages, maxCompletionTokens) {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Authorization: 'Bearer ' + modelConfig.model.apiKey,
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(900000),
        body: JSON.stringify({
          model: MODEL_ID,
          messages,
          stream: true,
          stream_options: { include_usage: true },
          reasoning_effort: REASONING_EFFORT,
          max_completion_tokens: maxCompletionTokens
        })
      });
      const raw = await response.text();
      if (!response.ok) {
        const error = new Error('模型请求 HTTP ' + response.status + ': ' + raw.slice(0, 300));
        error.retryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status);
        throw error;
      }
      const parsed = parseModelResponse(raw);
      if (!parsed.content || parsed.content.length < 80) throw new Error('模型返回内容为空或过短');
      return parsed;
    } catch (error) {
      lastError = error;
      if (error.retryable === false || attempt === 5) break;
      const wait = Math.min(60000, 2500 * (2 ** (attempt - 1)));
      console.warn('模型调用失败，' + Math.ceil(wait / 1000) + ' 秒后重试（' + attempt + '/5）：' + safeError(error));
      await delay(wait);
    }
  }
  throw new Error(safeError(lastError));
}

function generationPromptFromAnalysis(analysis) {
  const match = analysis.match(/<GENERATION_PROMPT>\s*([\s\S]*?)\s*<\/GENERATION_PROMPT>/iu);
  return match ? match[1].trim() : '';
}

function saveState(statePath, state) {
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(statePath, state);
}

function bookOutputDirectory(outputRoot, book) {
  return path.join(outputRoot, book.bookDirectory);
}

async function processBook(outputRoot, book, state, statePath, modelConfig) {
  const progress = state.books[book.id];
  const bookDir = bookOutputDirectory(outputRoot, book);
  const originalDir = path.join(bookDir, 'original');
  const generatedDir = path.join(bookDir, 'generated');
  fs.mkdirSync(originalDir, { recursive: true });
  fs.mkdirSync(generatedDir, { recursive: true });

  const samples = getBookSamples(book);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const phaseSlug = ['early', 'middle', 'late'][Math.floor(index / 3)];
    const filename = phaseSlug + '-' + String(index % 3 + 1).padStart(2, '0') + '-chapter-' + String(sample.sourceIndex).padStart(5, '0') + '.txt';
    const samplePath = path.join(originalDir, filename);
    if (!fs.existsSync(samplePath)) writeText(samplePath, sample.fullText.trim() + '\n');
  }

  writeJsonAtomic(path.join(bookDir, 'metadata.json'), {
    id: book.id,
    genre: book.genre,
    sourceTitle: book.title,
    sourceRelativePath: book.sourcePath,
    sourceSha256: book.sourceHash,
    sourceEncoding: book.encoding,
    validChapterCount: book.validChapterCount,
    model: MODEL_ID,
    reasoningEffort: REASONING_EFFORT,
    samples: book.sampleMeta
  });

  const analysisPath = path.join(bookDir, 'story-style-analysis.md');
  const promptPath = path.join(bookDir, 'generation-prompt.md');
  let prompt = fs.existsSync(promptPath) ? fs.readFileSync(promptPath, 'utf8').trim() : '';
  if (!prompt) {
    progress.analysis = 'running';
    progress.status = 'running';
    saveState(statePath, state);
    const result = await callModel(modelConfig, buildAnalysisMessages(book, samples), 12000);
    const analysis = result.content;
    prompt = generationPromptFromAnalysis(analysis);
    if (!prompt) throw new Error('剧情与文风提取结果缺少提示词标记');
    writeText(analysisPath, analysis + '\n');
    writeText(promptPath, prompt + '\n');
    progress.analysis = 'completed';
    progress.analysisCompletedAt = new Date().toISOString();
    saveState(statePath, state);
  } else {
    progress.analysis = 'completed';
  }

  for (let chapterNo = 1; chapterNo <= 3; chapterNo += 1) {
    const outputPath = path.join(generatedDir, 'chapter-' + String(chapterNo).padStart(2, '0') + '.md');
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 80) {
      progress.chapters[String(chapterNo)] = 'completed';
      continue;
    }
    progress.chapters[String(chapterNo)] = 'running';
    progress.status = 'running';
    saveState(statePath, state);
    const previous = [];
    for (let prior = 1; prior < chapterNo; prior += 1) {
      const priorPath = path.join(generatedDir, 'chapter-' + String(prior).padStart(2, '0') + '.md');
      if (!fs.existsSync(priorPath)) throw new Error('缺少前一章，不能继续生成第 ' + chapterNo + ' 章');
      previous.push(fs.readFileSync(priorPath, 'utf8'));
    }
    const userPrompt = [
      '以下是本作品唯一的生成提示词。严格遵守其中的新设定和三章大纲，不参考或续写任何原作情节。',
      prompt,
      '',
      '现在只生成第 ' + chapterNo + ' 章，正文约 2200 至 2800 个中文字符。只输出章节标题与正文。',
      previous.length ? '前文正文，仅用于保持新作品自身连续性：\n' + previous.join('\n\n') : ''
    ].filter(Boolean).join('\n\n');
    const result = await callModel(modelConfig, [
      { role: 'system', content: PROJECT_WRITING_RULES },
      { role: 'user', content: userPrompt }
    ], 9000);
    writeText(outputPath, result.content + '\n');
    progress.chapters[String(chapterNo)] = 'completed';
    progress['chapter' + chapterNo + 'CompletedAt'] = new Date().toISOString();
    saveState(statePath, state);
    console.log('完成：' + book.genre + ' / ' + book.order + ' / 第 ' + chapterNo + ' 章');
  }

  progress.status = 'completed';
  progress.completedAt = new Date().toISOString();
  progress.errors = [];
  saveState(statePath, state);
}

function printSummary(plan, outputRoot, state) {
  const generatedChapters = Object.values(state.books).reduce((sum, book) => sum + Object.values(book.chapters || {}).filter(status => status === 'completed').length, 0);
  const completedBooks = Object.values(state.books).filter(book => book.status === 'completed').length;
  const failedBooks = Object.values(state.books).filter(book => book.status === 'failed').length;
  console.log(JSON.stringify({
    output: outputRoot,
    genres: plan.genres.length,
    plannedNovels: plan.books.length,
    completedBooks,
    generatedChapters,
    failedBooks,
    expectedChapters: plan.books.length * 3,
    model: MODEL_ID,
    reasoningEffort: REASONING_EFFORT,
    evaluation: 'not run'
  }, null, 2));
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const plan = buildPlan(options.genres);
  if (plan.problems.length) {
    console.error('预检未通过；尚未创建批次目录，也未发送模型请求。');
    for (const problem of plan.problems) console.error('- ' + problem);
    process.exitCode = 2;
    return;
  }
  if (options.planOnly) {
    console.log(JSON.stringify({
      planOnly: true,
      genres: plan.genres.length,
      novels: plan.books.length,
      sourceChapters: plan.books.length * 9,
      generatedChapters: plan.books.length * 3,
      model: MODEL_ID,
      reasoningEffort: REASONING_EFFORT,
      evaluation: 'not run'
    }, null, 2));
    return;
  }

  const modelConfig = getLocalModel();
  const outputRoot = options.output;
  const { manifest, state, statePath } = loadOrCreateState(outputRoot, plan);
  const candidates = options.limitBooks ? manifest.books.slice(0, options.limitBooks) : manifest.books;
  const books = options.onlyGenres ? candidates.filter(book => options.onlyGenres.includes(book.genre)) : candidates;
  const missingGenres = (options.onlyGenres || []).filter(genre => !books.some(book => book.genre === genre));
  if (missingGenres.length) throw new Error('--only-genres 在当前批次范围内没有小说: ' + missingGenres.join(', '));
  console.log('本地批次启动；生成文件仅写入: ' + outputRoot);
  console.log('模型推理会发送原文抽样或生成提示到已配置的 GPT-6 Luna 网关；不会写入项目数据库。');
  let failures = 0;
  let nextBook = 0;
  const workerCount = Math.min(options.concurrency, books.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextBook < books.length) {
      const book = books[nextBook++];
      if (state.books[book.id]?.status === 'completed') continue;
      try {
        await processBook(outputRoot, book, state, statePath, modelConfig);
      } catch (error) {
        failures += 1;
        const progress = state.books[book.id];
        progress.status = 'failed';
        progress.errors = [...(progress.errors || []), { at: new Date().toISOString(), message: safeError(error) }].slice(-5);
        saveState(statePath, state);
        console.error('失败：' + book.genre + ' / ' + book.order + '：' + safeError(error));
      }
    }
  });
  await Promise.all(workers);
  printSummary(plan, outputRoot, state);
  if (failures) process.exitCode = 1;
}

main().catch(error => {
  console.error('批次停止：' + safeError(error));
  process.exitCode = 1;
});
