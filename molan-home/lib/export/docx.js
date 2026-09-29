'use strict';

const { buildZip } = require('../dissection-docx');
const { buildExportDocument } = require('./document-model');
const { escapeXml } = require('./xml');

/** 将导出文档模型生成 Word Open XML 文档。 */
function buildDocx(input) {
  const document = input && input.schemaVersion === 'molan-export-document-v1' ? input : buildExportDocument(input);
  const body = [paragraph(document.title, 'Title')];
  if (document.author) body.push(paragraph(document.author, 'Subtitle'));
  if (document.description) body.push(paragraph(document.description));
  for (const chapter of document.chapters) {
    if (chapter.volumeTitle) body.push(paragraph(chapter.volumeTitle, 'Heading1', true));
    body.push(paragraph(chapter.title, 'Heading1', true));
    for (const line of chapter.content.split('\n')) body.push(paragraph(line));
  }
  const createdAt = escapeXml(document.modifiedAt);
  const entries = [
    { name: '[Content_Types].xml', data: contentTypesXml() },
    { name: '_rels/.rels', data: rootRelationshipsXml() },
    { name: 'word/document.xml', data: documentXml(body.join('\n')) },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/_rels/document.xml.rels', data: documentRelationshipsXml() },
    { name: 'docProps/core.xml', data: corePropertiesXml(document.title, document.author, createdAt) },
    { name: 'docProps/app.xml', data: appPropertiesXml() }
  ];
  return buildZip(entries);
}

/** 渲染 Word 段落並依章節邊界插入分頁。 */
function paragraph(text, style = 'Normal', pageBreakBefore = false) {
  const pageBreak = pageBreakBefore ? '<w:pageBreakBefore/>' : '';
  const runs = String(text).split('\n').map(escapeXml).join('<w:br/>');
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${pageBreak}</w:pPr><w:r><w:t xml:space="preserve">${runs}</w:t></w:r></w:p>`;
}

/** 生成 Word 文档部件类型表。 */
function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

/** 连接主文档和核心属性关系。 */
function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

/** 连接主文档与样式表。 */
function documentRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

/** 生成含中文字体与标题层级的 Word 样式表。 */
function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="宋体" w:hAnsi="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:pPr><w:jc w:val="center"/><w:spacing w:after="360"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:pPr><w:keepNext/></w:pPr></w:style>
</w:styles>`;
}

/** 生成文档正文及页边距设置。 */
function documentXml(body) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>${body}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr>
  </w:body>
</w:document>`;
}

/** 写入作者、标题和创建时间等核心属性。 */
function corePropertiesXml(title, author, timestamp) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title><dc:creator>${escapeXml(author)}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>
</cp:coreProperties>`;
}

/** 声明导出应用信息。 */
function appPropertiesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>墨阑导出</Application></Properties>`;
}

module.exports = { buildDocx };
