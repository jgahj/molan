'use strict';

const { createHash } = require('node:crypto');
const { buildZip } = require('../dissection-docx');
const { buildExportDocument } = require('./document-model');
const { escapeXml } = require('./xml');

/** 将导出文档模型打包为符合 EPUB 3 结构的可重排电子书。 */
function buildEpub(input) {
  const document = input && input.schemaVersion === 'molan-export-document-v1' ? input : buildExportDocument(input);
  const chapterItems = document.chapters.map((chapter, index) => ({
    chapter,
    index,
    id: `chapter-${index + 1}`,
    href: `text/chapter-${String(index + 1).padStart(4, '0')}.xhtml`
  }));
  const identifier = `urn:uuid:${uuidFromDocument(document)}`;
  const timestamp = document.modifiedAt.slice(0, 19) + 'Z';
  const opfChapters = chapterItems.map(item => `<item id="${item.id}" href="${item.href}" media-type="application/xhtml+xml"/>`).join('\n    ');
  const spine = chapterItems.map(item => `<itemref idref="${item.id}"/>`).join('\n    ');
  const navItems = chapterItems.map(item => `<li><a href="${item.href}">${escapeXml(item.chapter.title)}</a></li>`).join('\n        ');
  const entries = [
    { name: 'mimetype', data: Buffer.from('application/epub+zip', 'ascii'), store: true },
    { name: 'META-INF/container.xml', data: containerXml() },
    { name: 'OEBPS/package.opf', data: packageXml(document, identifier, timestamp, opfChapters, spine) },
    { name: 'OEBPS/nav.xhtml', data: navXml(document.title, navItems) },
    { name: 'OEBPS/styles.css', data: stylesheet() },
    ...chapterItems.map(item => ({
      name: `OEBPS/${item.href}`,
      data: chapterXml(item.chapter.title, item.chapter.content)
    }))
  ];
  return buildZip(entries);
}

/** 生成 EPUB 容器索引。 */
function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}

/** 生成 EPUB 元数据、资源清单和章节阅读顺序。 */
function packageXml(document, identifier, timestamp, chapterItems, spine) {
  const creator = document.author ? `<dc:creator>${escapeXml(document.author)}</dc:creator>` : '';
  const description = document.description ? `<dc:description>${escapeXml(document.description)}</dc:description>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escapeXml(document.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${identifier}</dc:identifier>
    <dc:title>${escapeXml(document.title)}</dc:title>
    <dc:language>${escapeXml(document.language)}</dc:language>
    ${creator}
    ${description}
    <meta property="dcterms:modified">${timestamp}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="styles.css" media-type="text/css"/>
    ${chapterItems}
  </manifest>
  <spine>${spine}</spine>
</package>`;
}

/** 生成可导航目录页。 */
function navXml(title, navItems) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
  <head><title>${escapeXml(title)} - 目录</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
  <body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>${navItems}</ol></nav></body>
</html>`;
}

/** 将章节标题和正文转换为经过 XML 转义的 XHTML。 */
function chapterXml(title, content) {
  const paragraphs = String(content || '').split(/\n\s*\n/).map(block => block.trim()).filter(Boolean)
    .map(block => `<p>${block.split('\n').map(escapeXml).join('<br/>')}</p>`).join('\n    ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="../styles.css"/></head>
  <body><section epub:type="chapter" xmlns:epub="http://www.idpf.org/2007/ops"><h1>${escapeXml(title)}</h1>${paragraphs}</section></body>
</html>`;
}

/** 提供跨阅读器稳定的中文排版基础样式。 */
function stylesheet() {
  return `body{font-family:serif;line-height:1.8;margin:5%;}h1{font-size:1.4em;text-align:center;margin:2em 0;}p{margin:0 0 1em;text-indent:2em;}nav ol{padding-left:1.5em;}nav li{margin:.4em 0;}`;
}

/** 按文档内容计算稳定 UUID，确保同一导出输入得到同一包标识。 */
function uuidFromDocument(document) {
  const hash = createHash('sha256').update(JSON.stringify({
    title: document.title,
    author: document.author,
    language: document.language,
    chapters: document.chapters.map(chapter => [chapter.number, chapter.title, chapter.content])
  })).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

module.exports = { buildEpub, chapterXml };
