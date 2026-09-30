'use strict';

function createDissectionResultService({ DISSECTION_ARRAY_FIELDS, DISSECTION_PHASES, DISSECTION_PHASES_BY_DEPTH, DISSECTION_RESULT_ALIASES, DISSECTION_STAGE_REQUIREMENTS }) {
  function safeJsonParse(text) {
    let value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try { return JSON.parse(value); } catch (_) {}
    const first = value.indexOf('{');
    const last = value.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try { return JSON.parse(value.slice(first, last + 1)); } catch (_) {}
    }
    return null;
  }

  function extractJsonFromMixedText(text) {
    const value = String(text || '').trim();
    if (!value) return null;
    let start = value.indexOf('{');
    while (start >= 0) {
      let depth = 0, inString = false, escape = false, end = -1;
      for (let i = start; i < value.length; i += 1) {
        const ch = value[i];
        if (inString) {
          if (escape) escape = false;
          else if (ch === '\\') escape = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') { inString = true; continue; }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) { end = i; break; }
        }
      }
      if (end > start) {
        const candidate = value.slice(start, end + 1);
        const parsed = safeJsonParse(candidate);
        if (parsed) return parsed;
        start = value.indexOf('{', start + 1);
      } else break;
    }
    return null;
  }

  function autoFixJson(text) {
    // 分段验证模式：每执行一个修复步骤后立即尝试 JSON.parse，成功即返回，
    // 避免多个修复规则互相干扰（例如「值缺引号」修复后再被「值内引号转义」破坏）。
    const original = String(text || '').trim();
    if (!original) return null;
    const stripFence = v => v.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const sliceJson = v => {
      const first = v.indexOf('{');
      return first < 0 ? null : v.slice(first);
    };
    const tryParse = v => {
      if (!v) return null;
      try { return JSON.parse(v); } catch (_) { return null; }
    };

    // 部分中转模型会把对象键写成 sellingPoints"：只漏掉左引号。
    // 仅在字符串外、且紧跟对象开始/逗号的位置修复，避免改动正文字符串。
    const repairUnquotedKeyStarts = value => {
      const source = String(value || '');
      const out = [];
      let inString = false;
      let escaped = false;
      for (let index = 0; index < source.length;) {
        const ch = source[index];
        if (inString) {
          out.push(ch);
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          index += 1;
          continue;
        }
        if (ch === '"') {
          inString = true;
          out.push(ch);
          index += 1;
          continue;
        }
        if (ch === '{' || ch === ',') {
          let cursor = index + 1;
          while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
          const rest = source.slice(cursor);
          const quotedEnd = rest.match(/^([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]*)(\s*)"/);
          const bareEnd = rest.match(/^([A-Za-z_\u4e00-\u9fff][A-Za-z0-9_\u4e00-\u9fff-]*)(\s*):/);
          if (quotedEnd && /^\s*:/.test(rest.slice(quotedEnd[0].length))) {
            out.push(ch, source.slice(index + 1, cursor), '"', quotedEnd[1], quotedEnd[2], '"');
            index = cursor + quotedEnd[0].length;
            continue;
          }
          if (bareEnd) {
            out.push(ch, source.slice(index + 1, cursor), '"', bareEnd[1], bareEnd[2], '"');
            index = cursor + bareEnd[0].length - 1;
            continue;
          }
        }
        out.push(ch);
        index += 1;
      }
      return out.join('');
    };

    const repairBrokenObjectMembers = value => {
      let output = String(value || '');
      // 值的结束引号和下一个键的开始引号被模型合并："value" "nextKey":。
      output = output.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*"([A-Za-z_][A-Za-z0-9_]*)"\s*:/g, '"$1": "$2", "$3":');
      // 键名与值之间漏写冒号和左引号："cost "代价"。
      output = output.replace(/"([A-Za-z_][A-Za-z0-9_]*)\s+"(?=[\u4e00-\u9fffA-Za-z])/g, '"$1": "');
      // 字符串值漏掉结束引号，但仍在逗号或对象结束前结束。
      output = output.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"([^"\r\n{}\[\]]*)(?=\s*[,}])/g, '"$1": "$2"');
      // 裸中文/英文值只缺少开始引号，结束引号仍然存在。
      output = output.replace(/"([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*([\u4e00-\u9fffA-Za-z][^,}\]\n"]*?)(?="\s*[,}\]])/g, '"$1": "$2');
      // 空键通常是模型删除了字段名但保留了值；该阶段唯一可能的空键是 cost。
      output = output.replace(/""\s*:/g, '"cost":');
      return output;
    };

    // 候选集合：每步修复后的文本
    const candidates = [];

    // 0) 原始（去围栏 + 截取 JSON 起点）
    let base = sliceJson(stripFence(original));
    if (!base) return null;
    candidates.push(base);

    // 1) 尾逗号修复
    candidates.push(base.replace(/,\s*([}\]])/g, '$1'));

    // 2) 相邻字符串缺逗号
    candidates.push(base.replace(/"(?:[^"\\]|\\.)*"\s+(?="(?:[^"\\]|\\.)*")/g, m => m.replace(/^(.*?)\s+$/, '$1, ')));

    // 3) 修复对象键漏写左引号，再处理键值合并。
    const repairedKeys = repairBrokenObjectMembers(repairUnquotedKeyStarts(base));
    candidates.push(repairedKeys);
    let v3 = repairedKeys.replace(/"([A-Za-z][A-Za-z0-9_]*)\s*(?=[\u4e00-\u9fff])/g, '"$1": "');
    v3 = v3.replace(/"([A-Za-z][A-Za-z0-9_]*)"\s*(?=[\u4e00-\u9fff])/g, '"$1": "');
    // 场景C：key 闭合后直接跟英文值（"name"observation → "name": "observation），
    //       仅当 key 后不是 : , } ] 且紧跟的单词非 true/false/null 时修复
    v3 = v3.replace(/"([A-Za-z][A-Za-z0-9_]*)"\s*(?=[a-zA-Z](?!rue\b|alse\b|ull\b))/g, '"$1": "');
    candidates.push(v3);

    // 4) 值缺起始引号
    candidates.push(v3.replace(/"([A-Za-z][A-Za-z0-9_]*)"\s*:\s*(?=[\u4e00-\u9fffA-Za-z])(?!true|false|null)\s*([^"{}[\],]*?)("[,}\]:])/g, '"$1": "$2"$3'));

    // 5) 数组元素缺左花括号（栈扫描）
    {
      const input = v3;
      const chars = input.split('');
      const stack = [];
      const out = [];
      let i = 0;
      const n = chars.length;
      while (i < n) {
        const ch = chars[i];
        if (stack[stack.length - 1] === 'o' && ch === '{') {
          let previous = out.length - 1;
          while (previous >= 0 && /\s/.test(out[previous])) previous -= 1;
          if (previous >= 0 && out[previous] === '"') {
            out.push('}, ');
            stack.pop();
          }
        }
        if (stack[stack.length - 1] === 'a' && ch === '"') {
          let k = i + 1; let keyStr = '';
          let esc2 = false;
          while (k < n && !(chars[k] === '"' && !esc2)) {
            if (chars[k] === '\\') esc2 = !esc2;
            else esc2 = false;
            keyStr += chars[k]; k += 1;
          }
          const afterKey = k + 1;
          let m = afterKey;
          while (m < n && /\s/.test(chars[m])) m += 1;
          if (m < n && chars[m] === ':' && keyStr.trim()) {
            out.push('{ ');
            stack.push('o');
            continue;
          }
        }
        if (ch === '"') {
          let j = i; let esc = false;
          while (j < n) {
            out.push(chars[j]);
            if (esc) esc = false;
            else if (chars[j] === '\\') esc = true;
            else if (chars[j] === '"' && j > i) break;
            j += 1;
          }
          i = j + 1;
          continue;
        }
        if (ch === '{') { stack.push('o'); out.push(ch); i += 1; continue; }
        if (ch === '[') { stack.push('a'); out.push(ch); i += 1; continue; }
        if (ch === '}') { if (stack.length) stack.pop(); out.push(ch); i += 1; continue; }
        if (ch === ']') { if (stack.length) stack.pop(); out.push(ch); i += 1; continue; }
        out.push(ch);
        i += 1;
      }
      candidates.push(out.join(''));
    }

    // 6) 括号错配修复（去多余右括号 + 补缺失）
    {
      const run = input => {
        const chars = input.split('');
        const filtered = [];
        let dc = 0, ds = 0, inStr = false, esc2 = false;
        for (let i = 0; i < chars.length; i += 1) {
          const ch = chars[i];
          if (inStr) { filtered.push(ch); if (esc2) esc2 = false; else if (ch === '\\') esc2 = true; else if (ch === '"') inStr = false; continue; }
          if (ch === '"') { inStr = true; filtered.push(ch); continue; }
          if (ch === '{') { dc += 1; filtered.push(ch); continue; }
          if (ch === '[') { ds += 1; filtered.push(ch); continue; }
          if (ch === '}') { if (dc <= 0) continue; dc -= 1; filtered.push(ch); continue; }
          if (ch === ']') { if (ds <= 0) continue; ds -= 1; filtered.push(ch); continue; }
          filtered.push(ch);
        }
        let out = filtered.join('');
        if (ds > 0) out += ']'.repeat(ds);
        if (dc > 0) out += '}'.repeat(dc);
        return out;
      };
      // 对 base、v3、数组修复结果各做一次括号修复
      candidates.push(run(base));
      candidates.push(run(v3));
      candidates.push(run(candidates[candidates.length - 3] || base));
    }

    // 逐个尝试
    for (const candidate of candidates) {
      const parsed = tryParse(candidate);
      if (parsed) return parsed;
    }

    // 7) 最后：括号配对子串提取（尾部可能被截断）
    return extractJsonFromMixedText(base);
  }

  function salvageDissectionStageResult(text, stage) {
    const source = String(text || '');
    if (!source.trim()) return null;
    const fieldsByStage = {
      map: ['overview', 'framework', 'dissectionMap', 'timeline', 'storyStructure'],
      structure: ['architecture', 'opening', 'goldenFinger'],
      entities: ['characters', 'relationships', 'worldbuilding', 'antagonists', 'minorRoles', 'evidenceLedger'],
      plot: ['outline', 'foreshadowing', 'conflictStats', 'logicFlaws', 'evidenceLedger'],
      style: ['styleProfile', 'craftConstraints', 'canonConstraints', 'genre', 'sellingPoints', 'sentenceFingerprint', 'reusableTemplates', 'reversalPatterns', 'evidenceLedger'],
      emotion: ['emotion'],
      validate: ['taskConstraints', 'validation', 'evidenceLedger']
    };
    const stageFields = fieldsByStage[stage] || [];
    if (!stageFields.length) return null;
    const allAliases = Object.values(DISSECTION_RESULT_ALIASES).flat();
    const escapeRegExp = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const marker = aliases => new RegExp(
      '(?:^|[,{\\n])\\s*(?:"(?:' + aliases.map(escapeRegExp).join('|') + ')"|(?:' + aliases.map(escapeRegExp).join('|') + '))\\s*:',
      'gi'
    );
    const output = {};
    stageFields.forEach(field => {
      const aliases = DISSECTION_RESULT_ALIASES[field] || [field];
      const startMatch = marker(aliases).exec(source);
      if (!startMatch) return;
      const valueStart = startMatch.index + startMatch[0].length;
      const endPattern = marker(allAliases);
      endPattern.lastIndex = valueStart;
      const nextMatch = endPattern.exec(source);
      const valueEnd = nextMatch ? nextMatch.index : source.length;
      const value = source.slice(valueStart, valueEnd).trim();
      if (!value) return;
      const parsed = autoFixJson('{"' + field + '":' + value + '}');
      if (parsed && Object.prototype.hasOwnProperty.call(parsed, field)) output[field] = parsed[field];
    });
    return Object.keys(output).length ? output : null;
  }

  function emptyDissectionResult() {
    return {
      schemaVersion: '1.1',
      overview: {},
      framework: {},
      dissectionMap: {},
      // ★ F021 结构划分：起承转合各阶段（起止位置/目标/关键事件）
      storyStructure: [],
      characters: [],
      // ★ F042 反派体系：动机/层级/冲突升级/是否脸谱化
      antagonists: [],
      // ★ F044 次要功能角色：炮灰/挑衅者/传话人/工具人
      minorRoles: [],
      relationships: [],
      worldbuilding: [],
      timeline: [],
      outline: [],
      foreshadowing: [],
      // ★ 三类核心结果：开篇节奏 / 金手指 / 文章架构
      opening: {},            // 开篇节奏：字数窗口/钩子/危机节奏/爆点分布
      goldenFinger: {},       // 金手指：类型/激活条件/成长曲线/限制与代价
      architecture: {},       // 文章架构：卷/阶段/章节规模/叙事结构与可迁移骨架
      styleProfile: { version: '1.1', summary: '', dimensions: [], evidence: [], confidence: 0 },
      authorDna: {},
      craftConstraints: [],
      // ★ F073 高频反转套路：类型/铺垫/回收/实例
      reversalPatterns: [],
      canonConstraints: [],
      taskConstraints: [],
      evidenceLedger: [],
      genre: {},
      sellingPoints: [],
      sentenceFingerprint: {},
      reusableTemplates: {},
      emotion: {},
      conflictStats: {},
      logicFlaws: [],
      chapterIndex: [],
      // ★ 阶段2 · 四级分层摘要（章节/故事弧/分卷/全书）
      chapterSummaries: [],
      arcSummaries: [],
      volumeSummaries: [],
      bookSummary: {},
      summaryCoverage: {},
      characterLibrary: [],
      mainline: {},
      storyTree: [],
      conflictChain: [],
      rewardChain: [],
      volumePlan: [],
      arcPlan: [],
      chapterPlan: [],
      scenePlan: [],
      foreshadowPlan: [],
      worldRules: [],
      reviewPlan: {},
      validation: { uncertain: [], conflicts: [], notes: [] }
    };
  }

  function hasDissectionContent(value, key) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0;
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some(item => hasDissectionContent(item));
    if (typeof value !== 'object') return false;
    return Object.entries(value).some(([childKey, childValue]) => {
      if (childKey === 'version' || childKey === 'schemaVersion' || childKey === 'confidence') return false;
      return hasDissectionContent(childValue, childKey);
    });
  }

  function isDissectionPlaceholder(value) {
    const text = String(value == null ? '' : value).trim().toLowerCase();
    if (!text) return true;
    return /^(unknown|candidate|n\/a|none|null|待定|未知|暂无|无|未提供|待提供)$/.test(text) ||
      /未提供正文|未提供设定|未收到小说|缺少必要材料|无法完成真实拆书|无法提取稳定文风/.test(text);
  }

  function hasMeaningfulDissectionContent(value, key) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return !isDissectionPlaceholder(value);
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return key === 'exists' || value;
    if (Array.isArray(value)) return value.some(item => hasMeaningfulDissectionContent(item, key));
    if (typeof value !== 'object') return false;
    if (key === 'goldenFinger' && value.exists === false && (value.type === 'none' || value.kind === 'none')) return true;
    return Object.entries(value).some(([childKey, childValue]) => {
      if (['version', 'schemaVersion', 'confidence', 'status'].includes(childKey)) return false;
      return hasMeaningfulDissectionContent(childValue, childKey);
    });
  }

  function normalizeAuthorDna(value) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const text = (source, max) => String(source == null ? '' : source).trim().slice(0, max);
    const list = (source, max, itemMax) => (Array.isArray(source) ? source : [])
      .map(item => text(item, itemMax))
      .filter(Boolean)
      .slice(0, max);
    const refs = source => list(source, 16, 120);
    const confidence = source => {
      const valueNumber = Number(source);
      return Number.isFinite(valueNumber) ? Math.max(0, Math.min(1, valueNumber)) : 0;
    };
    const rawDimensions = Array.isArray(input.dimensions)
      ? input.dimensions
      : input.dimensions && typeof input.dimensions === 'object'
        ? Object.entries(input.dimensions).map(([name, item]) => ({ name, ...(item && typeof item === 'object' ? item : { observation: item }) }))
        : [];
    const dimensions = rawDimensions.map(item => {
      const source = item && typeof item === 'object' ? item : { observation: item };
      return {
        name: text(source.name || source.axis || source.feature, 80),
        observation: text(source.observation || source.finding || source.description, 600),
        transferable: source.transferable !== false,
        scope: list(source.scope, 8, 120),
        exceptions: list(source.exceptions || source.exception, 8, 180),
        evidenceRefs: refs(source.evidenceRefs || source.evidence || source.sources),
        confidence: confidence(source.confidence)
      };
    }).filter(item => item.name || item.observation).slice(0, 18);
    const rawRules = Array.isArray(input.rules)
      ? input.rules
      : Array.isArray(input.transferableRules)
        ? input.transferableRules
        : Array.isArray(input.constraints)
          ? input.constraints
          : [];
    const rules = rawRules.map((item, index) => {
      const source = item && typeof item === 'object' ? item : { rule: item };
      const ruleType = ['hard_rule', 'preference', 'tendency', 'avoidance', 'open_choice'].includes(String(source.ruleType || source.rule_type))
        ? String(source.ruleType || source.rule_type)
        : 'preference';
      const status = ['candidate', 'confirmed', 'hard_rule', 'conflicted', 'retired', 'unknown'].includes(String(source.status))
        ? String(source.status)
        : 'candidate';
      return {
        id: text(source.id || ('dna-rule-' + (index + 1)), 80),
        axis: text(source.axis || source.feature || source.name, 80),
        rule: text(source.rule || source.instruction || source.observation, 800),
        ruleType,
        scope: list(source.scope, 8, 120),
        exceptions: list(source.exceptions || source.exception, 8, 180),
        evidenceRefs: refs(source.evidenceRefs || source.evidence || source.sources),
        evidenceCount: Math.max(0, Math.floor(Number(source.evidenceCount) || refs(source.evidenceRefs || source.evidence || source.sources).length)),
        confidence: confidence(source.confidence),
        priority: Math.max(0, Math.min(100, Math.floor(Number(source.priority) || 50))),
        status,
        positiveExample: text(source.positiveExample || source.positive_example, 360),
        counterExample: text(source.counterExample || source.counterexample || source.negativeExample, 360)
      };
    }).filter(item => item.rule).slice(0, 40);
    const rawForbidden = Array.isArray(input.forbiddenPatterns) ? input.forbiddenPatterns : (Array.isArray(input.avoidList) ? input.avoidList : []);
    const forbiddenPatterns = rawForbidden.map(item => {
      const source = item && typeof item === 'object' ? item : { pattern: item };
      return {
        pattern: text(source.pattern || source.type || source.name, 160),
        problem: text(source.problem || source.note || source.description, 500),
        replacement: text(source.replacement || source.preferred || source.alternative, 500),
        scope: list(source.scope, 8, 120),
        exceptions: list(source.exceptions || source.exception, 8, 180),
        evidenceRefs: refs(source.evidenceRefs || source.evidence || source.sources),
        confidence: confidence(source.confidence)
      };
    }).filter(item => item.pattern || item.problem).slice(0, 30);
    const evidence = Array.isArray(input.evidenceLedger) ? input.evidenceLedger : (Array.isArray(input.evidence) ? input.evidence : []);
    const evidenceLedger = evidence.map(item => {
      const source = item && typeof item === 'object' ? item : { observation: item };
      return {
        sourceType: text(source.sourceType || source.type, 60),
        observation: text(source.observation || source.pattern || source.note, 600),
        inferredRule: text(source.inferredRule || source.rule, 600),
        evidenceRefs: refs(source.evidenceRefs || source.source || source.sources),
        scope: list(source.scope, 8, 120),
        confidence: confidence(source.confidence),
        status: text(source.status || 'candidate', 30)
      };
    }).filter(item => item.observation || item.inferredRule).slice(0, 60);
    return {
      schemaVersion: '1.0',
      summary: text(input.summary || input.profile || input.description, 1200),
      dimensions,
      rules,
      forbiddenPatterns,
      evidenceLedger,
      unknowns: list(input.unknowns || input.openQuestions, 30, 300),
      confidence: confidence(input.confidence),
      boundary: input.boundary && typeof input.boundary === 'object' ? {
        canonExcluded: input.boundary.canonExcluded !== false,
        excluded: list(input.boundary.excluded, 20, 160),
        note: text(input.boundary.note, 500)
      } : { canonExcluded: true, excluded: [], note: '仅保留可迁移写法，不携带原书专属设定。' }
    };
  }

  function buildAuthorDnaFromDissectionParts(styleProfile, craftConstraints, reusableTemplates, sentenceFingerprint, evidenceLedger) {
    const style = styleProfile && typeof styleProfile === 'object' ? styleProfile : {};
    const dimensions = Array.isArray(style.dimensions) ? style.dimensions : [];
    const rules = Array.isArray(craftConstraints) ? craftConstraints : [];
    if (!String(style.summary || '').trim() && !dimensions.length && !rules.length) return {};
    return normalizeAuthorDna({
      summary: style.summary || '根据拆书文风与创作技法聚合出的可迁移作者 DNA。',
      dimensions,
      rules,
      forbiddenPatterns: reusableTemplates && Array.isArray(reusableTemplates.avoidList) ? reusableTemplates.avoidList : [],
      evidenceLedger,
      confidence: Number(style.confidence) || 0.5,
      boundary: { canonExcluded: true, excluded: [], note: '由文风、技法和句式观察推导，不迁移原书人物、事件或专名。' }
    });
  }

  function ensureDissectionAuthorDna(result) {
    const source = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
    const explicit = source.authorDna || source.authorDNA || source.author_dna;
    if (explicit && typeof explicit === 'object' && !Array.isArray(explicit) && hasMeaningfulDissectionContent(explicit, 'authorDna')) {
      return { ...source, authorDna: normalizeAuthorDna(explicit) };
    }
    const derived = buildAuthorDnaFromDissectionParts(source.styleProfile, source.craftConstraints, source.reusableTemplates, source.sentenceFingerprint, source.evidenceLedger);
    return Object.keys(derived).length ? { ...source, authorDna: derived } : source;
  }

  function dissectionFieldHasUsableContent(key, value) {
    if (key === 'validation') {
      const fields = ['uncertain', 'conflicts', 'notes', 'missingFields', 'portableRules'];
      return !!(value && typeof value === 'object' && !Array.isArray(value) && (
        (typeof value.conclusion === 'string' && !isDissectionPlaceholder(value.conclusion)) ||
        fields.every(field => Array.isArray(value[field])) ||
        fields.some(field => Array.isArray(value[field]) && value[field].some(item => hasMeaningfulDissectionContent(item, field)))
      ));
    }
    if (DISSECTION_ARRAY_FIELDS.has(key) && !Array.isArray(value)) return false;
    if (!DISSECTION_ARRAY_FIELDS.has(key) && key && typeof value === 'string') return false;
    return hasMeaningfulDissectionContent(value, key);
  }

  function dissectionResultHasContent(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
    const normalized = normalizeDissectionStageResult(result);
    const view = normalized ? { ...result, ...normalized } : result;
    return Object.keys(DISSECTION_RESULT_ALIASES).some(key => hasDissectionContent(view[key], key));
  }

  function dissectionResultView(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return {};
    const normalized = normalizeDissectionStageResult(result);
    return ensureDissectionAuthorDna(normalized ? { ...result, ...normalized } : result);
  }

  function normalizeDissectionStageResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const candidates = [
      value,
      value.result,
      value.analysis,
      value.dissection,
      value.dissectionResult,
      value.dissection_map,
      value.dissectionMap,
      value.data
    ].filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate));
    // ★ 模糊匹配：模型偶尔把字段名简写/漂移（如 overview→view、goldenFinger→goldenfinger），
    // 在精确匹配失败时按「包含/小写前缀」兜底，避免整阶段结果丢失。
    function findAlias(candidate, aliases) {
      let fallback = null;
      for (const alias of aliases) {
        if (Object.prototype.hasOwnProperty.call(candidate, alias) && candidate[alias] !== undefined && candidate[alias] !== null) {
          if (hasDissectionContent(candidate[alias], alias)) return alias;
          if (!fallback) fallback = alias;
        }
      }
      const keys = Object.keys(candidate);
      for (const alias of aliases) {
        const low = alias.toLowerCase();
        const hit = keys.find(k => k.toLowerCase() === low || k.toLowerCase().includes(low) || low.includes(k.toLowerCase()));
        if (hit && candidate[hit] !== undefined && candidate[hit] !== null) {
          if (hasDissectionContent(candidate[hit], hit)) return hit;
          if (!fallback) fallback = hit;
        }
      }
      return fallback;
    }
    const normalized = {};
    Object.entries(DISSECTION_RESULT_ALIASES).forEach(([key, aliases]) => {
      for (const candidate of candidates) {
        const alias = findAlias(candidate, aliases);
        if (alias) { normalized[key] = candidate[alias]; break; }
      }
    });
    if (!normalized.overview && typeof value.summary === 'string' && value.summary.trim()) normalized.overview = { summary: value.summary.trim() };
    if (!normalized.styleProfile && value.style && typeof value.style === 'object') normalized.styleProfile = value.style;
    if (!Object.keys(normalized).length) return null;
    return normalized;
  }

  function dissectionStageMissingFields(stage, result) {
    const normalized = normalizeDissectionStageResult(result);
    const view = normalized ? { ...(result && typeof result === 'object' ? result : {}), ...normalized } : (result || {});
    const requirements = DISSECTION_STAGE_REQUIREMENTS[stage] || [];
    return requirements
      .filter(group => !group.some(key => dissectionFieldHasUsableContent(key, view[key])))
      .map(group => group.join(' / '));
  }

  function dissectionPhaseIdsForDepth(depth) {
    return DISSECTION_PHASES_BY_DEPTH[String(depth)] || DISSECTION_PHASES_BY_DEPTH.standard;
  }

  function dissectionResultMissingFields(result, depth) {
    const ids = depth ? dissectionPhaseIdsForDepth(depth) : DISSECTION_PHASES.map(stage => stage.id);
    // 兼容旧版拆书记录：旧结果没有作者 DNA 阶段，不能因为新增字段把历史结果全部判为不完整。
    const legacyResultWithoutDna = result && typeof result === 'object'
      && !Object.prototype.hasOwnProperty.call(result, 'authorDna')
      && !Object.prototype.hasOwnProperty.call(result, 'schemaVersion');
    return ids.flatMap(stage =>
      (legacyResultWithoutDna && stage === 'dna' ? [] : dissectionStageMissingFields(stage, result).map(fields => `${stage}: ${fields}`))
    );
  }

  function dissectionResultHasCompleteContent(result, depth) {
    return dissectionResultMissingFields(result, depth).length === 0;
  }

  function mergeDissectionResult(previous, next) {
    const merged = { ...emptyDissectionResult(), ...(previous && typeof previous === 'object' ? previous : {}) };
    const normalized = normalizeDissectionStageResult(next);
    if (!normalized) return merged;
    Object.keys(normalized).forEach(key => {
      const value = normalized[key];
      const prior = merged[key];
      if (!dissectionFieldHasUsableContent(key, value) && dissectionFieldHasUsableContent(key, prior)) return;
      if (Array.isArray(value)) {
        if (!value.length && Array.isArray(prior) && prior.length) return;
        merged[key] = value;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const output = { ...(prior && typeof prior === 'object' && !Array.isArray(prior) ? prior : {}) };
        Object.entries(value).forEach(([childKey, childValue]) => {
          const priorChild = output[childKey];
          if (Array.isArray(childValue) && !childValue.length && Array.isArray(priorChild) && priorChild.length) return;
          if (!hasMeaningfulDissectionContent(childValue, childKey) && hasMeaningfulDissectionContent(priorChild, childKey)) return;
          output[childKey] = childValue;
        });
        merged[key] = output;
      } else if (value !== undefined && value !== null) merged[key] = value;
    });
    return merged;
  }

  function firstIncompleteDissectionPhase(result, depth) {
    const ids = dissectionPhaseIdsForDepth(depth);
    const index = ids.findIndex(stage => dissectionStageMissingFields(stage, result).length > 0);
    return index >= 0 ? index : ids.length - 1;
  }

  return { safeJsonParse, extractJsonFromMixedText, autoFixJson, salvageDissectionStageResult, emptyDissectionResult, hasDissectionContent, isDissectionPlaceholder, hasMeaningfulDissectionContent, normalizeAuthorDna, buildAuthorDnaFromDissectionParts, ensureDissectionAuthorDna, dissectionFieldHasUsableContent, dissectionResultHasContent, dissectionResultView, normalizeDissectionStageResult, dissectionStageMissingFields, dissectionPhaseIdsForDepth, dissectionResultMissingFields, dissectionResultHasCompleteContent, mergeDissectionResult, firstIncompleteDissectionPhase };
}

module.exports = { createDissectionResultService };
