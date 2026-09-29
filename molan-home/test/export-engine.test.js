'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { buildExportDocument, exportBook, renderTxt } = require('../lib/export');

function fixture() {
  return {
    id: 'book-1', title: '潮汐 & 城', author: '林野', description: '城市里的旧信',
    volumes: [{ title: '第一卷', chapters: [
      { id: 'ch-1', title: '雨夜', chapterNo: 1, scenes: [{ text: '门外有人。\n她没有应声。' }] },
      { id: 'ch-2', title: '回信', chapterNo: 2, content: '<script>alert(1)</script>' }
    ] }]
  };
}

function zipEntry(buffer, name) {
  const eocdOffset = buffer.length - 22;
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let cursor = centralOffset;
  while (cursor + 46 <= buffer.length && buffer.readUInt32LE(cursor) === 0x02014b50) {
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const entryName = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (entryName === name) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      return method === 0 ? compressed.toString('utf8') : zlib.inflateRawSync(compressed).toString('utf8');
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

test('export document model preserves volume and chapter order without mutating the book', () => {
  const input = fixture();
  const document = buildExportDocument(input);
  assert.equal(document.schemaVersion, 'molan-export-document-v1');
  assert.deepEqual(document.chapters.map(chapter => chapter.title), ['雨夜', '回信']);
  assert.deepEqual(document.chapters.map(chapter => chapter.volumeTitle), ['第一卷', '第一卷']);
  assert.equal(document.chapters[0].content, '门外有人。\n她没有应声。');
  assert.equal(document.chapters[1].content, '<script>alert(1)</script>');
  assert.equal(input.volumes[0].chapters[0].volumeTitle, undefined);
});

test('TXT export keeps ordered chapter text and supports omitting the table of contents', () => {
  const withToc = renderTxt(fixture());
  const withoutToc = renderTxt(fixture(), { includeToc: false });
  assert.ok(withToc.indexOf('雨夜') < withToc.indexOf('回信'));
  assert.ok(withToc.includes('门外有人。\r\n她没有应声。'));
  assert.ok(withToc.includes('目录'));
  assert.equal(withoutToc.includes('目录'), false);
  assert.ok(exportBook(fixture(), 'txt').length > 0);
});

test('EPUB uses an uncompressed first mimetype entry and escaped navigable chapter XHTML', () => {
  const epub = exportBook(fixture(), 'epub');
  assert.equal(epub.readUInt32LE(0), 0x04034b50);
  assert.equal(epub.readUInt16LE(8), 0);
  const nameLength = epub.readUInt16LE(26);
  assert.equal(epub.subarray(30, 30 + nameLength).toString('utf8'), 'mimetype');
  const payloadOffset = 30 + nameLength + epub.readUInt16LE(28);
  assert.equal(epub.subarray(payloadOffset, payloadOffset + 'application/epub+zip'.length).toString('ascii'), 'application/epub+zip');
  const navigation = zipEntry(epub, 'OEBPS/nav.xhtml');
  const chapter = zipEntry(epub, 'OEBPS/text/chapter-0002.xhtml');
  assert.ok(navigation.indexOf('雨夜') < navigation.indexOf('回信'));
  assert.ok(chapter.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(chapter.includes('<script>'), false);
});

test('DOCX contains a valid Word package with escaped ordered chapter content', () => {
  const docx = exportBook(fixture(), 'docx');
  assert.equal(docx.readUInt32LE(0), 0x04034b50);
  const documentXml = zipEntry(docx, 'word/document.xml');
  assert.ok(documentXml.indexOf('雨夜') < documentXml.indexOf('回信'));
  assert.ok(documentXml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(zipEntry(docx, '[Content_Types].xml').includes('wordprocessingml.document.main+xml'));
});

test('export format validation rejects invalid input and unsupported format', () => {
  assert.throws(() => buildExportDocument(null), /必须是对象/);
  assert.throws(() => exportBook(fixture(), 'pdf'), /不支持的导出格式/);
});
