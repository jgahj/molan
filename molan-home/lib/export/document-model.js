'use strict';

const DEFAULT_LANGUAGE = 'zh-CN';

/** 将现有小说状态规范为只读、可多格式渲染的导出文档模型。 */
function buildExportDocument(book = {}) {
  if (!book || typeof book !== 'object' || Array.isArray(book)) throw new TypeError('小说导出输入必须是对象');
  const title = cleanText(book.title || book.name || '未命名作品', 300);
  const volumes = Array.isArray(book.volumes) ? book.volumes : [];
  const sourceChapters = Array.isArray(book.chapters) ? book.chapters : volumes.flatMap(volume =>
    (Array.isArray(volume && volume.chapters) ? volume.chapters : []).map(chapter => ({
      ...chapter,
      volumeTitle: chapter.volumeTitle || volume.title || ''
    }))
  );
  if (sourceChapters.length > 10000) throw new RangeError('单次导出最多支持 10000 章');

  const chapters = sourceChapters.map((chapter, index) => {
    if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) throw new TypeError(`第 ${index + 1} 章数据无效`);
    const number = Number(chapter.number || chapter.chapterNo || chapter.chapterIndex) || index + 1;
    const chapterTitle = cleanText(chapter.title || chapter.name || `第${number}章`, 300);
    const content = chapterContent(chapter);
    return Object.freeze({
      id: cleanText(chapter.id || `chapter-${index + 1}`, 160),
      number,
      title: chapterTitle,
      volumeTitle: cleanText(chapter.volumeTitle || '', 300),
      content
    });
  });

  return Object.freeze({
    schemaVersion: 'molan-export-document-v1',
    id: cleanText(book.id || book.projectId || '', 160),
    title,
    author: cleanText(book.author || '', 300),
    language: cleanText(book.language || DEFAULT_LANGUAGE, 32),
    description: cleanText(book.description || book.summary || '', 5000),
    modifiedAt: validIso(book.modifiedAt || book.updatedAt),
    chapters: Object.freeze(chapters)
  });
}

/** 抽取章节正文并统一换行符，避免将 HTML 当成正文格式写入导出文件。 */
function chapterContent(chapter) {
  if (typeof chapter.text === 'string') return normalizeNewlines(chapter.text);
  if (typeof chapter.content === 'string') return normalizeNewlines(chapter.content);
  if (!Array.isArray(chapter.scenes)) return '';
  return chapter.scenes.map(scene => {
    if (typeof scene === 'string') return scene;
    if (!scene || typeof scene !== 'object') return '';
    return String(scene.text || scene.content || '');
  }).filter(text => text.length > 0).map(normalizeNewlines).join('\n\n');
}

/** 限制元数据长度并清除 XML 1.0 不允许的控制字符。 */
function cleanText(value, maxLength) {
  return String(value == null ? '' : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '\uFFFD').trim().slice(0, maxLength);
}

/** 统一 CRLF、CR 与 LF 为 LF。 */
function normalizeNewlines(value) {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n');
}

/** 将有效日期规范为 ISO-8601，缺失或非法值使用当前时间。 */
function validIso(value) {
  const timestamp = value == null ? NaN : new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

module.exports = { DEFAULT_LANGUAGE, buildExportDocument, normalizeNewlines };
