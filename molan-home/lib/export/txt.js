'use strict';

const { buildExportDocument } = require('./document-model');

/** 将标准导出模型渲染为 UTF-8 TXT 字符串。 */
function renderTxt(input, options = {}) {
  const document = input && input.schemaVersion === 'molan-export-document-v1' ? input : buildExportDocument(input);
  const lines = [document.title, ''];
  if (document.author) lines.push(`作者：${document.author}`, '');
  if (document.description) lines.push(document.description, '');
  if (options.includeToc !== false && document.chapters.length) {
    lines.push('目录');
    for (const chapter of document.chapters) lines.push(`${chapter.number}. ${chapter.title}`);
    lines.push('');
  }
  for (const chapter of document.chapters) {
    if (chapter.volumeTitle) lines.push(chapter.volumeTitle);
    lines.push(chapter.title, '', chapter.content, '');
  }
  const normalized = lines.join('\r\n').replace(/\r\n?|\n/g, '\r\n');
  return `${normalized.replace(/(?:\r\n){3,}/g, '\r\n\r\n').trimEnd()}\r\n`;
}

/** 将 TXT 渲染结果编码为 Buffer，供服务端附件下载使用。 */
function buildTxt(input, options) {
  return Buffer.from(renderTxt(input, options), 'utf8');
}

module.exports = { renderTxt, buildTxt };
