'use strict';

const { buildExportDocument } = require('./document-model');
const { buildTxt, renderTxt } = require('./txt');
const { buildEpub } = require('./epub');
const { buildDocx } = require('./docx');

/** 将小说状态规范化并按明确格式导出。 */
function exportBook(book, format, options = {}) {
  const document = buildExportDocument(book);
  const normalized = String(format || '').toLowerCase();
  if (normalized === 'txt') return buildTxt(document, options);
  if (normalized === 'epub') return buildEpub(document, options);
  if (normalized === 'docx') return buildDocx(document, options);
  throw new TypeError(`不支持的导出格式: ${format}`);
}

module.exports = { buildExportDocument, buildTxt, renderTxt, buildEpub, buildDocx, exportBook };
