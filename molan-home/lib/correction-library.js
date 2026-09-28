'use strict';

// 纠错库单一事实源（SSOT）解析层。
// 输入：用户维护的《纠错库.md》；输出：结构化 rules / cases / blacklist / checks，
// 以及三档 prompt（核心 / 场景 / 对照）、由数据派生的扫描规则、跨章重复观察表和回流合并工具。
// 本模块只读 Markdown，不依赖 server.js；server.js 与构建脚本共用这里的解析结果。

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const LIBRARY_SCHEMA_VERSION = 'correction-library-1';
const MAX_PHRASE_LENGTH = 20;
const MIN_PHRASE_LENGTH = 2;

const SCENE_PROFILES = [
  {
    id: 'combat',
    label: '打斗与受伤',
    keywords: /打斗|厮杀|交手|出手|一掌|一剑|一刀|刀锋|拳|搏杀|战斗|杀|伤势|受伤|流血|重创|逃命|追杀|围攻|激战|对决/,
    ruleIds: ['R-01', 'R-15', 'R-37', 'R-38', 'R-39'],
    caseTypes: /伤势|动作落点|玄力|物理|感官|回合|倒数|数值|震颤/
  },
  {
    id: 'dialogue',
    label: '对白与人物口吻',
    keywords: /对白|台词|对话|说道|质问|谈判|争执|争吵|讨价|逼问|辩解|嘲讽|劝说|告白|口吻/,
    ruleIds: ['R-07', 'R-16', 'R-08'],
    caseTypes: /台词|对白|口吻|语气|人物立场|亲人|口号/
  },
  {
    id: 'opening',
    label: '开篇与制度交代',
    keywords: /第一章|第1章|开篇|开局|开头|楔子|序章|世界观|设定|规则|制度|考核|份额|开场/,
    ruleIds: ['R-13', 'R-40'],
    caseTypes: /制度|解释顺序|百科|设定注入|宏观/
  },
  {
    id: 'emotion',
    label: '情绪与神态',
    keywords: /哭|泪|愤怒|悲伤|恐惧|绝望|心疼|情绪|激动|哽咽|颤抖|崩溃|安慰|拥抱|告别/,
    ruleIds: ['R-04', 'R-05', 'R-06', 'R-14'],
    caseTypes: /情绪|神态|笑意|反差|冗余|心理/
  },
  {
    id: 'crowd',
    label: '群像场面',
    keywords: /众人|全场|人群|围观|哄笑|议论|大殿|广场|擂台|演武场|宴席|朝会/,
    ruleIds: ['R-07', 'R-12'],
    caseTypes: /群像|群体|全场/
  },
  {
    id: 'investigation',
    label: '线索与证据',
    keywords: /线索|证据|物证|痕迹|勘查|查案|尸体|凶手|推理|真相|下毒|追查|盘问/,
    ruleIds: ['R-08'],
    caseTypes: /越界判断|证据|指代|侦查|因果|推理/
  }
];

const REPETITION_SEED_PHRASES = [
  '面色阴沉', '脸色铁青', '面色铁青', '嘴角微扬', '轻笑一声', '冷笑一声', '闭目凝神', '目光一沉',
  '眼中闪过', '眉头一皱', '深吸一口气', '沉默片刻', '点了点头', '摇了摇头', '嘴角一咧', '面色惨白'
];

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripQuotes(value) {
  return String(value || '')
    .trim()
    .replace(/^[“"'「『]+/, '')
    .replace(/[”"'」』]+$/, '')
    .trim();
}

function splitTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.startsWith('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return inner.split('|').map(cell => cell.trim());
}

function isSeparatorRow(cells) {
  return Array.isArray(cells) && cells.length > 0 && cells.every(cell => /^:?-{2,}:?$/.test(cell));
}

function chapterFromText(text) {
  const match = /第\s*(\d+)\s*章/.exec(String(text || ''));
  return match ? Number(match[1]) : null;
}

function chapterRangeFromText(text) {
  const match = /第\s*(\d+)\s*-\s*(\d+)\s*章/.exec(String(text || ''));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function chapterFromCaseId(id) {
  const match = /^C(\d+)-/.exec(String(id || ''));
  return match ? Number(match[1]) : null;
}

function sourceFromText(text) {
  const value = String(text || '');
  if (/用户/.test(value)) return 'user';
  if (/AI|自查|全面检查/i.test(value)) return 'ai';
  return '';
}

function extractQuotedPhrases(text) {
  const phrases = [];
  const source = String(text || '');
  const quoted = source.match(/[“"]([^”"]{1,60})[”"]/g) || [];
  for (const chunk of quoted) {
    const inner = chunk.slice(1, -1);
    for (const piece of inner.split(/[、/／]/)) {
      const phrase = piece.trim();
      if (!phrase) continue;
      phrases.push(phrase);
    }
  }
  return phrases;
}

// 派生检查列表里既有错误写法（“搜索‘颤一下’”），也有正确写法（“保留‘开放、引入’”）。
// 只在列表项带有“搜索/禁止/一律/统一替换”等否定语气时提取，且只取“改为/替换为”之前的短语。
function extractCheckPhrases(item) {
  const source = String(item || '');
  if (!/搜索|禁止|禁用|一律|统一(?:替换|改)|不得|不写|不用|清零|删除/.test(source)) return [];
  if (/^(?:正文叙述保留|保留|允许|可以|优先)/.test(source)) return [];
  const cut = source.search(/改为|替换为|统一改为|统一替换为|→|删除“|删除"/);
  const head = cut > 0 ? source.slice(0, cut) : source;
  const phrases = [];
  const pattern = /[“"]([^”"]{1,60})[”"]/g;
  let match;
  while ((match = pattern.exec(head)) !== null) {
    const prefix = head.slice(Math.max(0, match.index - 6), match.index);
    // 引号前是“使用/保留/允许/改为/用”时，引号内是正确写法，跳过。
    if (/(?:使用|保留|允许|可用|改为|改成|写成|替换为|用|当作)$/.test(prefix)) continue;
    for (const piece of match[1].split(/[、/／]/)) {
      const phrase = piece.trim();
      if (phrase.length >= 3 && !phrases.includes(phrase)) phrases.push(phrase);
    }
  }
  return phrases;
}

function phraseUsable(phrase) {
  const value = String(phrase || '').trim();
  if (value.length < MIN_PHRASE_LENGTH || value.length > MAX_PHRASE_LENGTH) return false;
  if (/[XYZ]|…|\.\.\.|\s|\+|→|某/.test(value)) return false;
  if (/^(?:等|类|型|同上|删除)$/.test(value)) return false;
  return true;
}

function expandSlashVariants(phrase) {
  const value = String(phrase || '').trim();
  if (!value.includes('/')) return [value];
  // “勾起一抹弧度/笑意” → 勾起一抹弧度、勾起一抹笑意。
  const slashIndex = value.indexOf('/');
  const head = value.slice(0, slashIndex);
  const tails = value.slice(slashIndex + 1).split('/');
  const variants = [head];
  for (const tail of tails) {
    if (!tail) continue;
    // 用尾部同长度替换：“勾起一抹弧度/笑意” → “勾起一抹笑意”。
    variants.push(tail.length < head.length ? head.slice(0, head.length - tail.length) + tail : tail);
  }
  return variants.map(v => v.trim()).filter(Boolean);
}

function parseCorrectionLibrary(markdown, options = {}) {
  const text = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const rules = [];
  const cases = [];
  const blacklist = [];
  const checks = [];
  const quantityExamples = [];
  const warnings = [];
  const seenRuleIds = new Set();
  const caseByOriginal = new Map();
  const caseById = new Map();

  let heading = '';
  let headingChapter = null;
  let headingRange = null;
  let headingSource = '';
  let sourceLine = '';
  let inDerivedList = false;
  let tableKind = '';
  let tableHeader = null;

  const title = (lines.find(line => /^#\s+/.test(line)) || '').replace(/^#\s+/, '').trim();

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = raw.trim();
    if (!line) { tableKind = ''; tableHeader = null; continue; }
    if (/^#{1,6}\s+/.test(line)) {
      heading = line.replace(/^#{1,6}\s+/, '').trim();
      headingChapter = chapterFromText(heading);
      headingRange = chapterRangeFromText(heading);
      headingSource = sourceFromText(heading);
      sourceLine = '';
      inDerivedList = /派生检查|派生规则/.test(heading);
      tableKind = '';
      tableHeader = null;
      continue;
    }
    if (/^来源[：:]/.test(line)) {
      sourceLine = line;
      continue;
    }
    if (/^派生规则[：:]/.test(line)) { inDerivedList = true; continue; }
    if (line.startsWith('- ') && inDerivedList) {
      const item = line.slice(2).trim();
      const phrases = extractCheckPhrases(item).filter(phraseUsable);
      checks.push({ heading, text: item, phrases, chapter: headingChapter, range: headingRange });
      continue;
    }
    const cells = splitTableRow(line);
    if (!cells) { tableKind = ''; tableHeader = null; continue; }
    if (isSeparatorRow(cells)) continue;
    if (!tableHeader) {
      tableHeader = cells;
      const joined = cells.join('|');
      if (/编号\|类别\|必须遵守/.test(joined)) tableKind = 'rules';
      else if (/编号\|错误类型\|原句/.test(joined)) tableKind = 'cases';
      else if (/类型\|黑名单/.test(joined)) tableKind = 'blacklist';
      else if (/场景\|坏例\|改法/.test(joined)) tableKind = 'quantity-bad';
      else tableKind = 'other';
      continue;
    }
    if (tableKind === 'rules' && cells.length >= 4 && /^R-\d+/.test(cells[0])) {
      const id = cells[0];
      if (seenRuleIds.has(id)) warnings.push('重复的硬规则编号：' + id);
      seenRuleIds.add(id);
      rules.push({ id, category: cells[1], must: cells[2], badExample: cells[3], heading });
      continue;
    }
    if (tableKind === 'cases' && cells.length >= 5 && /^C\d+-/.test(cells[0])) {
      const id = cells[0];
      const before = stripQuotes(cells[2]);
      const after = stripQuotes(cells[3]);
      const source = headingSource || sourceFromText(sourceLine) || 'ai';
      const chapter = headingChapter != null && !headingRange ? headingChapter : chapterFromCaseId(id);
      const record = { id, chapter, type: cells[1], before, after, principle: cells[4], source, heading };
      if (caseById.has(id)) {
        warnings.push('重复的案例编号：' + id + '（' + caseById.get(id).heading + ' / ' + heading + '）');
      } else {
        caseById.set(id, record);
      }
      const originalKey = before.replace(/\s+/g, '');
      if (originalKey && caseByOriginal.has(originalKey)) {
        const existing = caseByOriginal.get(originalKey);
        existing.duplicates = existing.duplicates || [];
        existing.duplicates.push(id);
        if (source === 'user') existing.source = 'user';
        warnings.push('同一原句重复登记：' + existing.id + ' 与 ' + id);
        continue;
      }
      if (originalKey) caseByOriginal.set(originalKey, record);
      cases.push(record);
      continue;
    }
    if (tableKind === 'blacklist' && cells.length >= 3) {
      const category = cells[0];
      const phrases = [];
      for (const piece of cells[1].split(/[、，,]/)) {
        for (const variant of expandSlashVariants(piece)) {
          if (phraseUsable(variant)) phrases.push(variant);
        }
      }
      const existing = blacklist.find(entry => entry.category === category);
      if (existing) {
        for (const phrase of phrases) if (!existing.phrases.includes(phrase)) existing.phrases.push(phrase);
      } else {
        blacklist.push({ category, phrases: [...new Set(phrases)], problem: cells[2] });
      }
      continue;
    }
    if (tableKind === 'quantity-bad' && cells.length >= 3) {
      quantityExamples.push({ scene: cells[0], bad: stripQuotes(cells[1]), fix: cells[2] });
      continue;
    }
  }

  const userCaseCount = cases.filter(item => item.source === 'user').length;
  // 修正句里出现过的短语一定是正确写法，不能进入派生检查。
  const correctPhrases = new Set(cases.map(item => item.after.replace(/\s+/g, '')).filter(Boolean));
  for (const check of checks) {
    check.phrases = check.phrases.filter(phrase => !correctPhrases.has(phrase) && ![...correctPhrases].some(after => after.length <= 8 && after === phrase));
  }
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    title,
    version: sha256(text).slice(0, 12),
    sha256: sha256(text),
    bytes: Buffer.byteLength(text, 'utf8'),
    path: options.path || '',
    rules,
    cases,
    blacklist,
    checks,
    quantityExamples,
    warnings,
    stats: {
      ruleCount: rules.length,
      caseCount: cases.length,
      userCaseCount,
      aiCaseCount: cases.length - userCaseCount,
      blacklistPhraseCount: blacklist.reduce((sum, entry) => sum + entry.phrases.length, 0),
      checkPhraseCount: checks.reduce((sum, entry) => sum + entry.phrases.length, 0)
    }
  };
}

/* ---------- 加载与缓存 ---------- */

const libraryCache = new Map();

function loadCorrectionLibraryFromData(dataDir, options = {}) {
  const dir = path.resolve(String(dataDir || path.join(__dirname, '..', 'data', 'correction-library')));
  const rulesPath = path.join(dir, 'rules.json');
  const casesPath = path.join(dir, 'cases.json');
  const blacklistPath = path.join(dir, 'blacklist.json');
  const checksPath = path.join(dir, 'checks.json');
  if (!fs.existsSync(rulesPath) || !fs.existsSync(casesPath)) {
    return null;
  }
  const rulesData = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const casesData = JSON.parse(fs.readFileSync(casesPath, 'utf8'));
  const blacklistData = fs.existsSync(blacklistPath) ? JSON.parse(fs.readFileSync(blacklistPath, 'utf8')) : { blacklist: [] };
  const checksData = fs.existsSync(checksPath) ? JSON.parse(fs.readFileSync(checksPath, 'utf8')) : { checks: [] };

  const rules = Array.isArray(rulesData.rules) ? rulesData.rules : [];
  const cases = Array.isArray(casesData.cases) ? casesData.cases : [];
  const blacklist = Array.isArray(blacklistData.blacklist) ? blacklistData.blacklist : (Array.isArray(blacklistData.categories) ? blacklistData.categories : []);
  const checks = Array.isArray(checksData.checks) ? checksData.checks : [];
  const userCaseCount = cases.filter(item => item.source === 'user').length;

  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    title: '墨阑小说写作通用纠错库',
    version: rulesData.version || sha256(JSON.stringify(rules)).slice(0, 12),
    sha256: rulesData.sha256 || '',
    bytes: 0,
    path: dir,
    rules,
    cases,
    blacklist,
    checks,
    quantityExamples: [],
    warnings: [],
    stats: {
      ruleCount: rules.length,
      caseCount: cases.length,
      userCaseCount,
      aiCaseCount: cases.length - userCaseCount,
      blacklistPhraseCount: blacklist.reduce((sum, entry) => sum + (entry.phrases ? entry.phrases.length : 0), 0),
      checkPhraseCount: checks.reduce((sum, entry) => sum + (entry.phrases ? entry.phrases.length : 0), 0)
    }
  };
}

function loadCorrectionLibrary(filePath, options = {}) {
  const defaultDataDir = path.join(__dirname, '..', 'data', 'correction-library');
  const preferData = options.preferData !== false && (options.useDataDir || !filePath || options.preferJson);
  if (preferData && fs.existsSync(path.join(defaultDataDir, 'rules.json'))) {
    try {
      const fromData = loadCorrectionLibraryFromData(defaultDataDir, options);
      if (fromData) {
        if (filePath && fs.existsSync(filePath)) {
          fromData.markdown = fs.readFileSync(filePath, 'utf8');
          fromData.path = filePath;
        }
        return fromData;
      }
    } catch (_) {}
  }
  const resolved = path.resolve(String(filePath || ''));
  const stat = fs.statSync(resolved);
  const cached = libraryCache.get(resolved);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && !options.force) return cached.library;
  const markdown = fs.readFileSync(resolved, 'utf8');
  const library = parseCorrectionLibrary(markdown, { path: resolved });
  library.markdown = markdown;
  libraryCache.set(resolved, { mtimeMs: stat.mtimeMs, size: stat.size, library });
  return library;
}

function clearCorrectionLibraryCache() {
  libraryCache.clear();
}

/* ---------- 场景识别与分档 prompt ---------- */

function detectScenes(text) {
  const source = String(text || '');
  return SCENE_PROFILES.filter(profile => profile.keywords.test(source));
}

function detectRequestMode(text) {
  const source = String(text || '');
  if (/润色|改写|修订|精修|去AI|去 AI|去除AI味|按纠错库|逐句|审校|重写这段|校对/.test(source)) return 'revise';
  return 'draft';
}

function shortCaseLine(item) {
  const before = String(item.before || '').replace(/\s+/g, ' ').slice(0, 60);
  const after = String(item.after || '').replace(/\s+/g, ' ').slice(0, 60);
  if (!before) return '';
  return '- ' + before + ' → ' + (after || '删除');
}

function pickCases(library, predicate, limit, preferUser = true) {
  const pool = (library.cases || []).filter(item => item.before && predicate(item));
  if (preferUser) pool.sort((a, b) => (a.source === 'user' ? 0 : 1) - (b.source === 'user' ? 0 : 1));
  return pool.slice(0, Math.max(0, limit));
}

function renderScenePrompt(library, requestText, options = {}) {
  const scenes = detectScenes(requestText);
  const caseLimit = Math.max(2, Math.min(16, Number(options.caseLimit) || 8));
  const includeCases = options.includeCases !== false;
  const lines = [];
  const usedCaseIds = new Set();
  const ruleById = new Map((library.rules || []).map(rule => [rule.id, rule]));
  if (scenes.length) {
    lines.push('【场景补充｜命中：' + scenes.map(scene => scene.label).join('、') + '】');
    const usedRuleIds = new Set();
    for (const scene of scenes) {
      for (const ruleId of scene.ruleIds) {
        const rule = ruleById.get(ruleId);
        if (!rule || usedRuleIds.has(ruleId)) continue;
        usedRuleIds.add(ruleId);
        lines.push('- ' + rule.id + ' ' + rule.category + '：' + rule.must + '（避免：' + rule.badExample + '）');
      }
    }
    const perScene = Math.max(1, Math.floor(caseLimit / scenes.length));
    const examples = [];
    for (const scene of includeCases ? scenes : []) {
      for (const item of pickCases(library, item => scene.caseTypes.test(item.type), perScene)) {
        if (usedCaseIds.has(item.id)) continue;
        usedCaseIds.add(item.id);
        const line = shortCaseLine(item);
        if (line) examples.push(line);
      }
    }
    if (examples.length) {
      lines.push('已登记的同类纠正（原句 → 改句，只借原则不照抄）：');
      lines.push(...examples);
    }
  } else if (includeCases) {
    const examples = [];
    for (const type of [/烂俗比喻|套话/, /数量词/, /AI套话|模板/, /状语后置|语序/]) {
      for (const item of pickCases(library, item => type.test(item.type), 1)) {
        if (usedCaseIds.has(item.id)) continue;
        usedCaseIds.add(item.id);
        const line = shortCaseLine(item);
        if (line) examples.push(line);
      }
    }
    if (examples.length) {
      lines.push('【常见纠正示例（原句 → 改句）】');
      lines.push(...examples);
    }
  }
  return { text: lines.join('\n'), scenes: scenes.map(scene => scene.id), caseIds: [...usedCaseIds] };
}

function renderReferencePrompt(library, options = {}) {
  const limit = Math.max(10, Math.min(120, Number(options.limit) || 60));
  const groups = new Map();
  const userCases = (library.cases || []).filter(item => item.source === 'user' && item.before);
  for (const item of userCases) {
    const key = String(item.type || '其他').trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const lines = ['【对照档｜用户手动纠正案例，改稿时逐句对照，出现近义变体同样视为违规】'];
  let count = 0;
  for (const [type, items] of groups) {
    if (count >= limit) break;
    lines.push('· ' + type);
    for (const item of items) {
      if (count >= limit) break;
      const line = shortCaseLine(item);
      if (!line) continue;
      lines.push('  ' + line + (item.principle ? '｜' + String(item.principle).slice(0, 50) : ''));
      count += 1;
    }
  }
  return { text: count ? lines.join('\n') : '', count };
}

function renderBlacklistPrompt(library, options = {}) {
  const limitPerCategory = Math.max(3, Math.min(30, Number(options.limitPerCategory) || 12));
  const lines = [];
  for (const entry of library.blacklist || []) {
    if (!entry.phrases.length) continue;
    lines.push('- ' + entry.category + '：' + entry.phrases.slice(0, limitPerCategory).join('、'));
  }
  return lines.length ? '【纠错库黑名单短语（一律删除或改为直接描写）】\n' + lines.join('\n') : '';
}

function renderCorrectionPrompt(library, corePrompt, requestText, options = {}) {
  const mode = options.mode || detectRequestMode(requestText);
  const includeCases = options.includeCases !== false;
  const parts = [];
  const core = String(corePrompt || '').trim();
  if (core) parts.push(core);
  const blacklist = renderBlacklistPrompt(library, options);
  if (blacklist) parts.push(blacklist);
  const scene = renderScenePrompt(library, requestText, options);
  if (scene.text) parts.push(scene.text);
  let referenceCount = 0;
  if (mode === 'revise' && includeCases) {
    const reference = renderReferencePrompt(library, options);
    if (reference.text) { parts.push(reference.text); referenceCount = reference.count; }
  }
  parts.push('以上约束来自纠错库结构化版本 ' + library.version + '（' + (library.stats ? library.stats.ruleCount + ' 条硬规则、' + library.stats.caseCount + ' 条案例' : '') + '）；本次需要的规则与案例均已包含在本消息中，不要尝试读取本地文件。');
  return {
    text: parts.join('\n\n'),
    mode,
    scenes: scene.scenes,
    caseIds: scene.caseIds,
    referenceCount,
    libraryVersion: library.version,
    includeCases
  };
}

/* ---------- 由数据派生的扫描规则 ---------- */

function corePhraseOfCase(item) {
  const before = String(item && item.before || '').replace(/\s+/g, '');
  if (!before) return '';
  const cleaned = before.replace(/（[^）]*）/g, '').trim();
  if (cleaned.length <= 14) return cleaned;
  // 长句取最长的一个标点段落（≤14 字），作为近义变体扩展的核心短语。
  const segments = cleaned.split(/[，。！？；：、“”"…—\n]/).map(seg => seg.trim()).filter(seg => seg.length >= 4 && seg.length <= 14);
  if (!segments.length) return '';
  segments.sort((a, b) => b.length - a.length);
  return segments[0];
}

function buildLibraryScanRules(library) {
  const rules = [];
  (library.blacklist || []).forEach((entry, index) => {
    const phrases = [...new Set(entry.phrases.filter(phraseUsable))].sort((a, b) => b.length - a.length);
    if (!phrases.length) return;
    rules.push({
      id: 'L-blacklist-' + String(index + 1).padStart(2, '0'),
      label: '纠错库黑名单：' + entry.category,
      severity: 'high',
      pattern: new RegExp(phrases.map(escapeRegExp).join('|'), 'g'),
      origin: 'blacklist'
    });
  });
  const checkPhrases = new Set();
  for (const check of library.checks || []) {
    for (const phrase of check.phrases) if (phraseUsable(phrase)) checkPhrases.add(phrase);
  }
  if (checkPhrases.size) {
    rules.push({
      id: 'L-derived-check',
      label: '纠错库派生检查项',
      severity: 'medium',
      pattern: new RegExp([...checkPhrases].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g'),
      origin: 'checks'
    });
  }
  const casePhrases = new Set();
  for (const item of library.cases || []) {
    const phrase = corePhraseOfCase(item);
    if (phrase && phraseUsable(phrase)) casePhrases.add(phrase);
  }
  for (const example of library.quantityExamples || []) {
    if (example.bad && phraseUsable(example.bad)) casePhrases.add(example.bad);
  }
  if (casePhrases.size) {
    rules.push({
      id: 'L-registered-case',
      label: '纠错库已登记原句',
      severity: 'medium',
      pattern: new RegExp([...casePhrases].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'), 'g'),
      origin: 'cases'
    });
  }
  return rules;
}

const RULE_TYPE_HINTS = [
  [/formulaic-metaphor|dead-simile|blacklist/, /烂俗比喻|套话比喻|比喻/],
  [/template-smile|lip-corner/, /AI套话|不自然用词|烂俗比喻/],
  [/decorative-quantity/, /数量词/],
  [/formulaic-crowd/, /群像|群体/],
  [/sensory-personification|sound-personification/, /实体化|通感|感官/],
  [/postposed-state/, /状语后置|语序/],
  [/fragmented-verb|incomplete-phrase/, /单字动词|不完整|缩写|谓语/],
  [/narrator|evidence-overclaim|contrast-cliche/, /旁白|越界|证据|对比句/],
  [/redundant-emotion|redundant-transition/, /冗余|情绪|转场/],
  [/wound|reflex|impact/, /伤势|震颤|物理/]
];

function suggestionForFinding(library, finding) {
  const text = String(finding && finding.text || '').replace(/\s+/g, '');
  const cases = library && library.cases || [];
  const rules = library && library.rules || [];

  // 提取 R-XX 编号
  const ruleMatch = String(finding && finding.ruleId || '').match(/R-(\d+)/);
  const ruleId = ruleMatch ? 'R-' + ruleMatch[1].padStart(2, '0') : '';
  const ruleMeta = ruleId ? rules.find(r => r.id === ruleId) : null;

  if (text) {
    for (const item of cases) {
      if (item.before && item.before.replace(/\s+/g, '').includes(text)) {
        return {
          ruleId: ruleMeta ? ruleMeta.id : finding.ruleId,
          label: ruleMeta ? ruleMeta.label : finding.label,
          must: ruleMeta ? ruleMeta.must : '',
          badExample: ruleMeta ? ruleMeta.badExample : '',
          caseId: item.id,
          before: item.before,
          after: item.after,
          principle: item.principle || (ruleMeta ? ruleMeta.must : '')
        };
      }
    }
  }

  const key = String(finding && finding.ruleId || '') + ' ' + String(finding && finding.label || '');
  for (const [rulePattern, typePattern] of RULE_TYPE_HINTS) {
    if (!rulePattern.test(key)) continue;
    const pool = cases.filter(item => typePattern.test(String(item.type || '')) && item.before);
    const item = pool.find(entry => entry.source === 'user') || pool[0];
    if (item) {
      return {
        ruleId: ruleMeta ? ruleMeta.id : finding.ruleId,
        label: ruleMeta ? ruleMeta.label : finding.label,
        must: ruleMeta ? ruleMeta.must : '',
        badExample: ruleMeta ? ruleMeta.badExample : '',
        caseId: item.id,
        before: item.before,
        after: item.after,
        principle: item.principle || (ruleMeta ? ruleMeta.must : '')
      };
    }
  }

  if (ruleMeta) {
    return {
      ruleId: ruleMeta.id,
      label: ruleMeta.label,
      must: ruleMeta.must,
      badExample: ruleMeta.badExample,
      caseId: null,
      before: null,
      after: null,
      principle: ruleMeta.must
    };
  }

  return null;
}

/* ---------- 章内统计与跨章重复 ---------- */

function countMatches(text, pattern) {
  const matches = String(text || '').match(pattern);
  return matches ? matches.length : 0;
}

function measureCorrectionMetrics(text) {
  const source = String(text || '');
  const chars = source.replace(/\s+/g, '').length;
  const metaphorWords = countMatches(source, /仿佛|宛如|犹如|好似|像是|如同|一般|似的|般/g);
  const decorativeQuantity = countMatches(source, /(?:一丝|一股|一种|一缕)(?:[^。！？\n]{0,6})(?:的)?(?:[\u4e00-\u9fa5]{2})/g);
  const paragraphs = source.split(/\n+/).map(p => p.trim()).filter(Boolean);
  const shortParagraphs = paragraphs.filter(p => p.replace(/[“”"。！？…—]/g, '').length <= 8).length;
  const charLimitMin = 2000;
  const charLimitMax = 3000;
  return {
    chars,
    charLimitMin,
    charLimitMax,
    metaphorWords,
    metaphorLimit: 4,
    decorativeQuantity,
    decorativeQuantityLimit: 2,
    shortParagraphs,
    shortParagraphLimit: 3,
    exceeded: [
      metaphorWords > 4 ? 'metaphorWords' : '',
      decorativeQuantity > 2 ? 'decorativeQuantity' : '',
      shortParagraphs > 3 ? 'shortParagraphs' : '',
      chars > charLimitMax ? 'chapterLength' : ''
    ].filter(Boolean)
  };
}

function repetitionWatchlist(library) {
  const phrases = new Set(REPETITION_SEED_PHRASES);
  for (const item of library && library.cases || []) {
    if (!/重复/.test(String(item.type || ''))) continue;
    for (const phrase of extractQuotedPhrases(item.principle)) if (phraseUsable(phrase) && phrase.length <= 6) phrases.add(phrase);
    const after = String(item.after || '').replace(/\s+/g, '');
    if (after.length >= 3 && after.length <= 6) phrases.add(after);
  }
  return [...phrases];
}

function scanRepetition(text, priorText, watchlist) {
  const current = String(text || '');
  const prior = String(priorText || '');
  const findings = [];
  for (const phrase of Array.isArray(watchlist) ? watchlist : []) {
    if (!phrase) continue;
    const pattern = new RegExp(escapeRegExp(phrase), 'g');
    const currentCount = countMatches(current, pattern);
    if (!currentCount) continue;
    const priorCount = prior ? countMatches(prior, pattern) : 0;
    if (currentCount >= 2 || priorCount >= 3 || (currentCount >= 1 && priorCount >= 2)) {
      findings.push({ phrase, currentCount, priorCount, scope: currentCount >= 2 ? 'chapter' : 'cross-chapter' });
    }
  }
  findings.sort((a, b) => (b.currentCount + b.priorCount) - (a.currentCount + a.priorCount));
  return findings;
}

/* ---------- 回流：inbox 合并到 Markdown ---------- */

function normalizeInboxEntry(entry) {
  const input = entry && typeof entry === 'object' ? entry : {};
  const before = stripQuotes(String(input.original || input.before || '')).slice(0, 400);
  const after = stripQuotes(String(input.corrected || input.after || '')).slice(0, 400);
  const type = String(input.errorType || input.type || '待分类').trim().slice(0, 40) || '待分类';
  const principle = String(input.principle || '').trim().slice(0, 300);
  const chapter = Number.isInteger(Number(input.chapter)) && Number(input.chapter) > 0 ? Number(input.chapter) : null;
  return {
    before,
    after,
    type,
    principle,
    chapter,
    novelId: String(input.novelId || '').slice(0, 80),
    novelTitle: String(input.novelTitle || '').slice(0, 120),
    user: String(input.user || '').slice(0, 160),
    source: input.source === 'ai' ? 'ai' : 'user',
    createdAt: Number(input.createdAt) || Date.now()
  };
}

function readInbox(inboxPath) {
  if (!fs.existsSync(inboxPath)) return [];
  const content = fs.readFileSync(inboxPath, 'utf8');
  const entries = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { entries.push(normalizeInboxEntry(JSON.parse(trimmed))); } catch (_) {}
  }
  return entries.filter(entry => entry.before);
}

function appendInbox(inboxPath, entry) {
  const normalized = normalizeInboxEntry(entry);
  if (!normalized.before) throw new Error('原句不能为空');
  fs.mkdirSync(path.dirname(inboxPath), { recursive: true });
  fs.appendFileSync(inboxPath, JSON.stringify(normalized) + '\n', 'utf8');
  return normalized;
}

function escapeTableCell(value) {
  return String(value || '').replace(/\|/g, '｜').replace(/\r?\n/g, ' ').trim();
}

function nextCaseIdFactory(library) {
  const used = new Set((library.cases || []).map(item => item.id));
  for (const item of library.cases || []) for (const dup of item.duplicates || []) used.add(dup);
  return chapter => {
    const prefix = 'C' + String(chapter || 0).padStart(2, '0') + '-E';
    let n = 1;
    while (used.has(prefix + String(n).padStart(2, '0'))) n += 1;
    const id = prefix + String(n).padStart(2, '0');
    used.add(id);
    return id;
  };
}

function renderInboxSection(library, entries, dateText) {
  const existingOriginals = new Set((library.cases || []).map(item => item.before.replace(/\s+/g, '')));
  const fresh = [];
  const skipped = [];
  for (const entry of entries) {
    const key = entry.before.replace(/\s+/g, '');
    if (existingOriginals.has(key)) { skipped.push(entry); continue; }
    existingOriginals.add(key);
    fresh.push(entry);
  }
  if (!fresh.length) return { markdown: '', added: [], skipped };
  const nextId = nextCaseIdFactory(library);
  const byChapter = new Map();
  for (const entry of fresh) {
    const key = entry.chapter || 0;
    if (!byChapter.has(key)) byChapter.set(key, []);
    byChapter.get(key).push(entry);
  }
  const lines = ['## 编辑器回流纠正记录（' + dateText + '）', '', '来源：用户在编辑器中手动纠正后提交（自动回流，构建脚本合并）。', ''];
  const added = [];
  const derived = new Set();
  for (const [chapter, items] of [...byChapter.entries()].sort((a, b) => a[0] - b[0])) {
    lines.push('### ' + (chapter ? '第' + chapter + '章' : '未标注章节') + '回流纠正（' + dateText + '）');
    lines.push('');
    lines.push('| 编号 | 错误类型 | 原句 | 修正句 | 纠正原则 |');
    lines.push('|---|---|---|---|---|');
    for (const entry of items) {
      const id = nextId(chapter);
      lines.push('| ' + id + ' | ' + escapeTableCell(entry.type) + ' | ' + escapeTableCell(entry.before) + ' | ' + escapeTableCell(entry.after || '删除') + ' | ' + escapeTableCell(entry.principle || '用户手动纠正，原则待补充') + ' |');
      added.push({ ...entry, id });
      const phrase = corePhraseOfCase({ before: entry.before });
      if (phrase && phraseUsable(phrase)) derived.add(phrase);
    }
    lines.push('');
  }
  if (derived.size) {
    lines.push('### 回流派生检查（' + dateText + '）');
    lines.push('');
    lines.push('- 搜索“' + [...derived].join('、') + '”及其近义变体，出现即按对应记录改写。');
    lines.push('');
  }
  return { markdown: lines.join('\n'), added, skipped };
}

function mergeInboxIntoMarkdown(markdown, library, entries, options = {}) {
  const dateText = options.date || new Date().toISOString().slice(0, 10);
  const section = renderInboxSection(library, entries, dateText);
  if (!section.markdown) return { markdown, ...section };
  const source = String(markdown || '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const templateIndex = source.search(/^## [^\n]*新增记录模板/m);
  const insertion = section.markdown.replace(/\n/g, eol);
  const output = templateIndex >= 0
    ? source.slice(0, templateIndex).replace(/\s+$/, '') + eol + eol + insertion + eol + source.slice(templateIndex)
    : source.replace(/\s+$/, '') + eol + eol + insertion + eol;
  return { markdown: output, ...section };
}

module.exports = {
  LIBRARY_SCHEMA_VERSION,
  SCENE_PROFILES,
  parseCorrectionLibrary,
  extractCheckPhrases,
  loadCorrectionLibrary,
  loadCorrectionLibraryFromData,
  clearCorrectionLibraryCache,
  detectScenes,
  detectRequestMode,
  renderScenePrompt,
  renderReferencePrompt,
  renderBlacklistPrompt,
  renderCorrectionPrompt,
  buildLibraryScanRules,
  corePhraseOfCase,
  suggestionForFinding,
  measureCorrectionMetrics,
  repetitionWatchlist,
  scanRepetition,
  normalizeInboxEntry,
  readInbox,
  appendInbox,
  renderInboxSection,
  mergeInboxIntoMarkdown
};
