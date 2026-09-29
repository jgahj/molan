(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MolanSearchIndex = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MAX_RESULTS = 5000;

  /** 对字符逐个规范化并保留回到原文 UTF-16 偏移的映射。 */
  function normalizeMapped(value, caseSensitive) {
    const source = String(value == null ? '' : value);
    let normalized = '';
    const starts = [];
    const ends = [];
    let sourceOffset = 0;
    for (const character of source) {
      const nextOffset = sourceOffset + character.length;
      let folded = character.normalize('NFKC');
      if (!caseSensitive) folded = folded.toLocaleLowerCase('zh-CN');
      normalized += folded;
      for (let index = 0; index < folded.length; index += 1) {
        starts.push(sourceOffset);
        ends.push(nextOffset);
      }
      sourceOffset = nextOffset;
    }
    return { source, text: normalized, starts, ends };
  }

  /** 为中英文短语生成单字与相邻双字索引键。 */
  function grams(value) {
    const characters = Array.from(String(value || ''));
    const keys = new Set();
    for (let index = 0; index < characters.length; index += 1) {
      keys.add(`1:${characters[index]}`);
      if (index + 1 < characters.length) keys.add(`2:${characters[index]}${characters[index + 1]}`);
    }
    return Array.from(keys);
  }

  function documentKey(document) {
    return `${String(document.chapterId)}\u0000${String(document.sceneId)}`;
  }

  function boundedLimit(value) {
    const limit = Number(value);
    return Number.isFinite(limit) ? Math.max(1, Math.min(MAX_RESULTS, Math.floor(limit))) : 200;
  }

  /** 构建按章节和场景定位的正文倒排索引。 */
  function buildSearchIndex(input = []) {
    const documents = new Map();
    const postings = new Map();
    let order = 0;
    for (const item of Array.isArray(input) ? input : []) {
      if (!item || item.chapterId == null || item.sceneId == null) continue;
      const key = documentKey(item);
      const normalized = normalizeMapped(item.text, false);
      const document = {
        order: order++,
        chapterId: String(item.chapterId),
        chapterTitle: String(item.chapterTitle || ''),
        sceneId: String(item.sceneId),
        sceneTitle: String(item.sceneTitle || ''),
        revision: Number(item.revision) || 0,
        ...normalized
      };
      documents.set(key, document);
      for (const gram of grams(normalized.text)) {
        const matches = postings.get(gram) || new Set();
        matches.add(key);
        postings.set(gram, matches);
      }
    }
    return { documents, postings };
  }

  function sourceOffset(document, normalizedOffset, end) {
    if (!document.text.length) return 0;
    const index = end ? normalizedOffset - 1 : normalizedOffset;
    const offsets = end ? document.ends : document.starts;
    return offsets[Math.max(0, Math.min(index, offsets.length - 1))] || 0;
  }

  function makeSnippet(source, start, end, radius) {
    const before = Math.max(0, start - radius);
    const after = Math.min(source.length, end + radius);
    return {
      text: `${before ? '…' : ''}${source.slice(before, after)}${after < source.length ? '…' : ''}`,
      start: before,
      matchStart: start - before,
      matchEnd: end - before
    };
  }

  /** 查询倒排候选并返回原文命中偏移，不遍历编辑器 DOM。 */
  function searchSearchIndex(index, queryValue, options = {}) {
    const query = normalizeMapped(queryValue, Boolean(options.caseSensitive)).text;
    if (!query) return { query: String(queryValue || ''), totalMatches: 0, truncated: false, matches: [] };
    const queryGrams = grams(normalizeMapped(queryValue, false).text);
    const postingLists = queryGrams.map(gram => index.postings.get(gram) || new Set());
    postingLists.sort((a, b) => a.size - b.size);
    if (!postingLists.length || !postingLists[0].size) {
      return { query: String(queryValue), totalMatches: 0, truncated: false, matches: [] };
    }
    const candidates = Array.from(postingLists[0]).filter(key => postingLists.every(list => list.has(key)));
    const limit = boundedLimit(options.limit);
    const matches = [];
    let totalMatches = 0;
    for (const key of candidates) {
      const document = index.documents.get(key);
      if (!document) continue;
      const haystack = options.caseSensitive
        ? normalizeMapped(document.source, true)
        : document;
      let cursor = 0;
      while (cursor <= haystack.text.length - query.length) {
        const found = haystack.text.indexOf(query, cursor);
        if (found < 0) break;
        const start = sourceOffset(haystack, found, false);
        const end = sourceOffset(haystack, found + query.length, true);
        totalMatches += 1;
        if (matches.length < limit) {
          matches.push({
            order: document.order,
            chapterId: document.chapterId,
            chapterTitle: document.chapterTitle,
            sceneId: document.sceneId,
            sceneTitle: document.sceneTitle,
            revision: document.revision,
            start,
            end,
            snippet: makeSnippet(document.source, start, end, 36)
          });
        }
        cursor = found + Math.max(1, query.length);
      }
    }
    matches.sort((a, b) => a.order - b.order || a.start - b.start);
    matches.forEach(match => { delete match.order; });
    return { query: String(queryValue), totalMatches, truncated: totalMatches > limit, matches };
  }

  function createSearchIndex(initialDocuments = []) {
    let current = buildSearchIndex(initialDocuments);
    return {
      build(documents) {
        current = buildSearchIndex(documents);
        return { documentCount: current.documents.size };
      },
      search(query, options) { return searchSearchIndex(current, query, options); },
      clear() { current = buildSearchIndex([]); },
      get documentCount() { return current.documents.size; }
    };
  }

  /** 将请求封装为可被编辑器异步调用的 Web Worker 客户端。 */
  function createWorkerClient(worker) {
    if (!worker || typeof worker.postMessage !== 'function') throw new TypeError('缺少有效的搜索 Worker');
    let requestId = 0;
    const pending = new Map();
    const failPending = error => {
      for (const item of pending.values()) item.reject(error);
      pending.clear();
    };
    worker.addEventListener('message', event => {
      const message = event.data || {};
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      if (message.ok) item.resolve(message.result);
      else item.reject(new Error(String(message.error || '搜索索引失败')));
    });
    worker.addEventListener('error', () => failPending(new Error('搜索 Worker 不可用')));
    const request = (type, payload) => new Promise((resolve, reject) => {
      const id = ++requestId;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, ...payload });
    });
    return {
      build(documents) { return request('build', { documents }); },
      search(query, options) { return request('search', { query, options }); },
      terminate() { failPending(new Error('搜索 Worker 已关闭')); worker.terminate(); }
    };
  }

  return { buildSearchIndex, searchSearchIndex, createSearchIndex, createWorkerClient };
});
