'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSION = 'xuanhuan-scene-v1';
const FUNCTIONS = [
  ['求助与交易', '求助|求见|银子|铜钱|价钱|买|卖|交易|管事|报酬', '用请求、拒绝与筹码变化体现地位差；不要复制范文的人物或交易内容。'],
  ['试探与隐瞒', '试探|隐瞒|秘密|打量|怀疑|真假|撒谎|身份', '让双方说出口的目的与实际目的错开，用一次选择暴露立场。'],
  ['危机与选择', '危险|逃|追|血|杀|死|退路|袭|救', '交代空间、可用手段和代价，让选择改变局面，避免只堆紧张形容词。'],
  ['成长与代价', '修炼|突破|功法|气血|境界|经脉|天赋|练|力量', '用一次失败、限制或实际用途表现能力变化，不把升级写成参数播报。'],
  ['关系与情绪', '母亲|父亲|师父|朋友|笑|哭|愧|担心|沉默|兄|姐', '从当前关系和未说出口的诉求选择动作；不强迫每个人用同一种情绪动作。'],
  ['悬念与发现', '奇怪|发现|线索|痕迹|不对|为何|竟|消失|声音', '先建立可理解的异常，再给能改变判断的证据，保留可回答的问题。'],
  ['冲突与兑现', '不服|规矩|当众|挑战|赌|赢|输|跪|反驳|众人', '先明确读者期待和对手理由，兑现时改变利益或关系，而不只描写围观惊讶。']
];
const DIMENSIONS = ['追读意愿', '人物可信', '场景因果', '对白质感', '信息节奏', '语言自然'];
const overlapIndexes = new WeakMap();

function sourceOverlapIssues(text, scenes) {
  if (!String(text || '').trim()) throw Object.assign(new Error('待检查正文为空'), { code: 'SOURCE_TEXT_MISSING' });
  if (compact(text).length < 36) throw Object.assign(new Error('待检查正文不足36字，无法执行来源重合检查'), { code: 'SOURCE_TEXT_TOO_SHORT' });
  if (!Array.isArray(scenes)) throw Object.assign(new Error('玄幻原文语料不可用'), { code: 'SOURCE_CORPUS_UNAVAILABLE' });
  const searchableScenes = scenes.filter(scene => scene && typeof scene.text === 'string' && compact(scene.text).length >= 36);
  if (!searchableScenes.length) throw Object.assign(new Error('玄幻原文语料没有可检查片段'), { code: 'SOURCE_CORPUS_UNAVAILABLE' });

  let index = overlapIndexes.get(scenes);
  if (!index) {
    index = new Map();
    for (const scene of searchableScenes) {
      const normalized = compact(scene.text);
      for (let offset = 0; offset <= normalized.length - 24; offset += 12) {
        const key = normalized.slice(offset, offset + 24);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ id: scene.id, normalized, offset });
      }
    }
    overlapIndexes.set(scenes, index);
  }
  const normalized = compact(text);
  const matched = new Set();
  const issues = [];
  for (let offset = 0; offset <= normalized.length - 24; offset += 1) {
    const candidates = index.get(normalized.slice(offset, offset + 24)) || [];
    for (const candidate of candidates) {
      if (matched.has(candidate.id)) continue;
      let left = 0, right = 24;
      while (left < offset && left < candidate.offset && normalized[offset - left - 1] === candidate.normalized[candidate.offset - left - 1]) left += 1;
      while (offset + right < normalized.length && candidate.offset + right < candidate.normalized.length && normalized[offset + right] === candidate.normalized[candidate.offset + right]) right += 1;
      if (left + right >= 36) { matched.add(candidate.id); issues.push({ code: 'source_overlap', severity: 'blocker', evidence: normalized.slice(offset - left, offset - left + 36), sourceId: candidate.id }); }
    }
    if (issues.length >= 10) break;
  }
  return issues;
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function compact(value) {
  return String(value || '').replace(/[^\p{L}\p{N}]/gu, '');
}

function tagsFor(text) {
  const scored = FUNCTIONS.map(([name, pattern, technique]) => ({ name, technique, hits: (text.match(new RegExp(pattern, 'g')) || []).length }));
  return scored.filter(item => item.hits > 0).sort((left, right) => right.hits - left.hits).slice(0, 3);
}

function chapterRanges(text) {
  const pattern = /^[ \t]*(?:第[零〇一二三四五六七八九十百千万两\d]+[章节回卷][^\r\n]{0,65}|\d{1,5}[、.．][ \t]*[^\r\n]{1,65}|\d{3,5}[\u4e00-\u9fff][^\r\n]{0,55})[ \t]*$/gm;
  const headings = [...text.matchAll(pattern)].map(match => ({ title: match[0].trim(), start: match.index + match[0].length }));
  return headings.map((heading, index) => ({ ...heading, end: index + 1 < headings.length ? headings[index + 1].start - headings[index + 1].title.length : text.length })).filter(chapter => chapter.end - chapter.start > 700);
}

function sceneWindows(text, chapter) {
  const body = text.slice(chapter.start, chapter.end);
  const paragraphs = [...body.matchAll(/[^\r\n]+/g)].filter(match => match[0].trim());
  const output = [];
  let start = null;
  for (const paragraph of paragraphs) {
    if (start === null) start = paragraph.index;
    const end = paragraph.index + paragraph[0].length;
    if (end - start < 1400) continue;
    if (end - start <= 3400) output.push({ start: chapter.start + start, end: chapter.start + end, text: body.slice(start, end).trim() });
    start = null;
  }
  return output;
}

function buildCorpus(sourceDirectory) {
  const root = fs.realpathSync(sourceDirectory);
  const files = fs.readdirSync(root).filter(name => name.endsWith('.txt')).sort();
  const authors = [...new Set(files.map(name => name.replace(/\.txt$/, '').split(' - ').slice(1).join(' - ') || name))].sort((left, right) => digest(left).localeCompare(digest(right)));
  const heldout = new Set(authors.slice(0, Math.max(1, Math.ceil(authors.length * 0.2))));
  const books = [];
  const scenes = [];
  const seen = new Set();
  for (const filename of files) {
    const buffer = fs.readFileSync(path.join(root, filename));
    let text = buffer.toString('utf8');
    let encoding = 'utf8';
    if ((text.match(/\uFFFD/g) || []).length > 10) { text = new TextDecoder('gb18030').decode(buffer); encoding = 'gb18030'; }
    const [title, ...authorParts] = filename.replace(/\.txt$/, '').split(' - ');
    const author = authorParts.join(' - ') || filename;
    const id = digest(filename).slice(0, 16);
    const split = heldout.has(author) ? 'holdout' : 'reference';
    const chapters = chapterRanges(text);
    const chosen = [...new Set(Array.from({ length: Math.min(40, chapters.length) }, (_, index) => Math.floor(index * chapters.length / Math.min(40, chapters.length))))];
    let count = 0;
    for (const chapterIndex of chosen) {
      const chapter = chapters[chapterIndex];
      const windows = sceneWindows(text, chapter);
      const scene = windows[(chapterIndex + count) % Math.max(1, windows.length)];
      if (!scene || /本章未完|求月票|最新网址|请收藏|请记住本站/.test(scene.text)) continue;
      const hash = digest(compact(scene.text));
      if (seen.has(hash)) continue;
      seen.add(hash);
      const tags = tagsFor(scene.text);
      scenes.push({ id: hash.slice(0, 20), bookId: id, title, author, split, chapter: chapter.title, start: scene.start, end: scene.end, text: scene.text, functions: tags.map(item => item.name), techniques: tags.map(item => item.technique), annotation: 'heuristic-unreviewed', sourceHash: digest(buffer), filename });
      count += 1;
    }
    books.push({ id, title, author, filename, split, encoding, sourceHash: digest(buffer), chapters: chapters.length, scenes: count, warning: count ? '' : '未找到足够的完整章节窗口，需要人工确认格式' });
  }
  return { version: VERSION, generatedAt: new Date().toISOString(), sourceDirectory: root, splitPolicy: 'author-hash-20-percent-holdout', books, scenes };
}

function terms(text) {
  const normalized = compact(text).toLowerCase();
  const output = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) output.add(normalized.slice(index, index + 2));
  return output;
}

function retrieve(corpus, query, limit = 3) {
  const queryTerms = terms(String(query).slice(0, 10000));
  const queryTags = new Set(tagsFor(String(query)).map(item => item.name));
  const pool = corpus.scenes.filter(scene => scene && scene.split === 'reference' && typeof scene.text === 'string' && compact(scene.text).length >= 36);
  const frequencies = new Map();
  const candidates = pool.map(scene => {
    const sceneTerms = terms(scene.text);
    for (const term of queryTerms) if (sceneTerms.has(term)) frequencies.set(term, (frequencies.get(term) || 0) + 1);
    return { scene, sceneTerms };
  });
  const ranked = candidates.map(({ scene, sceneTerms }) => {
    let score = 0;
    for (const term of queryTerms) if (sceneTerms.has(term)) score += Math.log(1 + pool.length / (1 + frequencies.get(term)));
    score /= Math.sqrt(Math.max(1, sceneTerms.size));
    score += scene.functions.filter(name => queryTags.has(name)).length * 2;
    return { ...scene, score };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  const authors = new Set();
  return ranked.filter(scene => { if (authors.has(scene.author)) return false; authors.add(scene.author); return true; }).slice(0, limit);
}

function techniqueBlock(scenes) {
  return scenes.map((scene, index) => `技法卡${index + 1}｜${scene.functions.join('、')}\n${scene.techniques.join('\n')}\n这些是规则标注的写法候选，不是必须出现的情节。`).join('\n\n');
}

function writingSystem(techniques = '') {
  return `你是原创玄幻小说正文作者。只输出正文。遵守既定事实、人物认知和本章事件边界。通过人物此刻的目标、阻力、选择及后果组织场景，不逐项复述执行卡。对白服务当前关系和意图，允许沉默、误会、幽默及合理叙述。背景只在读者需要理解行动时解释，不一律禁止说明。普通物件、无名路人和感官细节可以自然补充；新能力、重要人物及改变既定历史的事实必须有依据。情绪表现因人因事而异，不强迫每章出现固定动作或破口。读者已知信息只在发生变化时重提。保持视角和时间清楚，结尾兑现本章变化，不强制反转。服从用户要求的篇幅，中文字符数与输出token数不是一回事。不模仿特定作者，不借用来源专名、情节或句子。\n${techniques}`;
}

function deterministicChecks(text, target = 1500, scenes = []) {
  const body = String(text || '');
  const length = compact(body).length;
  const paragraphs = body.split(/\n+/).map(compact).filter(part => part.length >= 35);
  const counts = new Map();
  const issues = [];
  for (const paragraph of paragraphs) counts.set(paragraph, (counts.get(paragraph) || 0) + 1);
  for (const [paragraph, count] of counts) if (count > 1) issues.push({ code: 'duplicate', evidence: paragraph.slice(0, 80), severity: 'warning' });
  if (length < target * 0.65 || length > target * 1.4) issues.push({ code: 'length', severity: 'warning', evidence: `当前${length}字，目标${target}字` });
  const textAvailable = Boolean(body.trim());
  const textCheckable = length >= 36;
  const sourceAvailable = Array.isArray(scenes) && scenes.some(scene => scene && typeof scene.text === 'string' && compact(scene.text).length >= 36);
  if (sourceAvailable && textAvailable && textCheckable) issues.push(...sourceOverlapIssues(body, scenes));
  if (!textAvailable) issues.push({ code: 'source_text_missing', severity: 'incomplete' });
  else if (!textCheckable) issues.push({ code: 'source_text_too_short', severity: 'incomplete' });
  if (!sourceAvailable) issues.push({ code: 'source_corpus_unavailable', severity: 'incomplete' });
  const reason = !textAvailable ? 'source_text_missing' : !textCheckable ? 'source_text_too_short' : !sourceAvailable ? 'source_corpus_unavailable' : issues.some(issue => issue.code === 'source_overlap') ? 'source_overlap' : '';
  const status = ['source_text_missing', 'source_text_too_short', 'source_corpus_unavailable'].includes(reason) ? 'incomplete' : reason ? 'needs_review' : 'passed';
  return {
    length,
    issues,
    available: textAvailable && sourceAvailable,
    status,
    reason,
    originalityCoverage: 'indexed-scenes-only',
    passed: status === 'passed'
  };
}

function normalizeReview(value, text) {
  if (!value || !Array.isArray(value.issues) || !value.scores || typeof value.scores !== 'object') throw new Error('阅读评审结构不完整');
  const scores = {};
  for (const dimension of DIMENSIONS) {
    const score = Number(value.scores[dimension]);
    if (!Number.isFinite(score) || score < 1 || score > 5) throw new Error('阅读评审维度缺失或越界');
    scores[dimension] = score;
  }
  const issues = value.issues.filter(issue => issue && typeof issue.evidence === 'string' && issue.evidence.length >= 4 && text.includes(issue.evidence)).slice(0, 5).map(issue => ({ dimension: String(issue.dimension || ''), severity: issue.severity === 'blocker' ? 'blocker' : 'warning', evidence: issue.evidence, reason: String(issue.reason || '').slice(0, 500), suggestion: String(issue.suggestion || '').slice(0, 500) }));
  return { scores, issues, rejectedEvidence: value.issues.length - issues.length, summary: String(value.summary || '').slice(0, 500) };
}

function corpusSummary(corpus) {
  const counts = {};
  for (const scene of corpus.scenes) for (const name of scene.functions) counts[name] = (counts[name] || 0) + 1;
  return { version: corpus.version, books: corpus.books.length, scenes: corpus.scenes.length, referenceBooks: corpus.books.filter(book => book.split === 'reference').length, holdoutBooks: corpus.books.filter(book => book.split === 'holdout').length, functions: counts, annotation: '规则候选，未经人工逐条确认；书籍品质不替代样本适用性审查', warnings: corpus.books.filter(book => book.warning).map(book => ({ title: book.title, warning: book.warning })) };
}

module.exports = { VERSION, FUNCTIONS, DIMENSIONS, digest, compact, chapterRanges, sceneWindows, buildCorpus, retrieve, techniqueBlock, writingSystem, deterministicChecks, normalizeReview, corpusSummary, sourceOverlapIssues };
