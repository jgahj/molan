'use strict';

/**
 * dissection-docx.js
 * ---------------------------------------------------------------------------
 * 零依赖（仅使用 Node.js 内置模块）的 Microsoft Word .docx 生成器。
 *
 * .docx 本质上是一个 ZIP 压缩包，里面包含若干 XML 部件（part）。本模块：
 *   1. 使用内置 zlib 的 deflateRawSync 手写一个最小的 ZIP 写入器；
 *   2. 自行计算 CRC32 校验值；
 *   3. 生成 Word 打开文档所需的最小 XML 部件集合；
 *   4. 将"拆书（book-analysis）"记录与结构化结果渲染为文档正文。
 *
 * 不依赖任何第三方 npm 包，仅使用 node:zlib。
 * ---------------------------------------------------------------------------
 */

const zlib = require('zlib');

/* =========================================================================
 * 1. CRC32 校验（标准多项式 0xEDB88320）
 * ========================================================================= */

// 预计算 CRC 查表，避免每次循环重复计算
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * 计算一段缓冲区的 CRC32 校验值（返回无符号 32 位整数）。
 * @param {Buffer} buf 待校验的数据（未压缩前的原始字节）
 * @returns {number} CRC32
 */
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* =========================================================================
 * 2. 最小 ZIP 写入器（无外部依赖）
 * ========================================================================= */

/**
 * 将 DOS 日期时间编码为 ZIP 所需的 2 字节 time 与 2 字节 date。
 * @param {Date} d
 * @returns {{time:number, date:number}}
 */
function dosDateTime(d) {
  const time =
    ((d.getHours() & 0x1F) << 11) |
    ((d.getMinutes() & 0x3F) << 5) |
    ((Math.floor(d.getSeconds() / 2) & 0x1F));
  const date =
    (((d.getFullYear() - 1980) & 0x7F) << 9) |
    (((d.getMonth() + 1) & 0x0F) << 5) |
    (d.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}

/**
 * 构造本地文件头（Local File Header）。
 * 压缩方式固定为 8（deflate，使用原始 deflate 流）。
 */
function buildLocalHeader(name, crc, compSize, uncompSize, time, date, method = 8) {
  const nameBuf = Buffer.from(name, 'utf8');
  const buf = Buffer.alloc(30 + nameBuf.length);
  let o = 0;
  buf.writeUInt32LE(0x04034b50, o); o += 4; // 本地文件头签名 PK\x03\x04
  buf.writeUInt16LE(20, o); o += 2;        // version needed to extract
  buf.writeUInt16LE(0, o); o += 2;         // general purpose bit flag
  buf.writeUInt16LE(method, o); o += 2;    // compression method
  buf.writeUInt16LE(time, o); o += 2;      // 最后修改时间
  buf.writeUInt16LE(date, o); o += 2;      // 最后修改日期
  buf.writeUInt32LE(crc, o); o += 4;       // CRC32
  buf.writeUInt32LE(compSize, o); o += 4;  // 压缩后大小
  buf.writeUInt32LE(uncompSize, o); o += 4;// 未压缩大小
  buf.writeUInt16LE(nameBuf.length, o); o += 2; // 文件名长度
  buf.writeUInt16LE(0, o); o += 2;         // 扩展字段长度
  nameBuf.copy(buf, o);
  return buf;
}

/**
 * 构造中央目录文件头（Central Directory File Header）。
 */
function buildCentralHeader(name, crc, compSize, uncompSize, offset, time, date, method = 8) {
  const nameBuf = Buffer.from(name, 'utf8');
  const buf = Buffer.alloc(46 + nameBuf.length);
  let o = 0;
  buf.writeUInt32LE(0x02014b50, o); o += 4; // 中央目录签名 PK\x01\x02
  buf.writeUInt16LE(20, o); o += 2;        // version made by
  buf.writeUInt16LE(20, o); o += 2;        // version needed to extract
  buf.writeUInt16LE(0, o); o += 2;         // general purpose bit flag
  buf.writeUInt16LE(method, o); o += 2;    // compression method
  buf.writeUInt16LE(time, o); o += 2;      // 最后修改时间
  buf.writeUInt16LE(date, o); o += 2;      // 最后修改日期
  buf.writeUInt32LE(crc, o); o += 4;       // CRC32
  buf.writeUInt32LE(compSize, o); o += 4;  // 压缩后大小
  buf.writeUInt32LE(uncompSize, o); o += 4;// 未压缩大小
  buf.writeUInt16LE(nameBuf.length, o); o += 2; // 文件名长度
  buf.writeUInt16LE(0, o); o += 2;         // 扩展字段长度
  buf.writeUInt16LE(0, o); o += 2;         // 文件注释长度
  buf.writeUInt16LE(0, o); o += 2;         // 磁盘起始号
  buf.writeUInt16LE(0, o); o += 2;         // 内部文件属性
  buf.writeUInt32LE(0, o); o += 4;         // 外部文件属性
  buf.writeUInt32LE(offset, o); o += 4;    // 本地文件头偏移
  nameBuf.copy(buf, o);
  return buf;
}

/**
 * 将一组 { name, data } 条目打包成一个合法的 .zip Buffer。
 * @param {Array<{name:string, data:Buffer}>} entries
 * @returns {Buffer} 完整 ZIP 文件内容
 */
function buildZip(entries) {
  const localParts = [];   // 各条目的 本地头+数据 片段
  const centralParts = []; // 各条目的中央目录条目
  let offset = 0;          // 当前偏移（用于记录本地头位置）

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const crc = crc32(data);
    const uncompSize = data.length;
    const method = entry.store === true ? 0 : 8;
    // EPUB 要求 mimetype 使用 ZIP Store，其余既有文档仍使用原始 deflate。
    const compressed = method === 0 ? data : zlib.deflateRawSync(data);
    const compSize = compressed.length;
    const { time, date } = dosDateTime(new Date());

    const localHeader = buildLocalHeader(entry.name, crc, compSize, uncompSize, time, date, method);
    localParts.push(localHeader, compressed);

    centralParts.push(buildCentralHeader(entry.name, crc, compSize, uncompSize, offset, time, date, method));

    offset += localHeader.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const centralSize = centralBuf.length;
  const centralOffset = offset; // 中央目录起始偏移 = 所有本地片段之后

  // End Of Central Directory 记录
  const eocd = Buffer.alloc(22);
  let o = 0;
  eocd.writeUInt32LE(0x06054b50, o); o += 4; // EOCD 签名 PK\x05\x06
  eocd.writeUInt16LE(0, o); o += 2;         // 当前磁盘号
  eocd.writeUInt16LE(0, o); o += 2;         // 中央目录起始磁盘号
  eocd.writeUInt16LE(entries.length, o); o += 2; // 本磁盘中央目录记录数
  eocd.writeUInt16LE(entries.length, o); o += 2; // 中央目录总记录数
  eocd.writeUInt32LE(centralSize, o); o += 4;    // 中央目录大小
  eocd.writeUInt32LE(centralOffset, o); o += 4;  // 中央目录起始偏移
  eocd.writeUInt16LE(0, o); o += 2;         // 注释长度

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

/* =========================================================================
 * 3. XML 辅助：转义与段落/标题渲染
 * ========================================================================= */

/**
 * 转义 XML 中的特殊字符（& < > " '）。
 */
function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 渲染一个普通段落（<w:p>）。
 * - 将字符串中的 \n 转换为 <w:br/> 换行；
 * - 依据 depth 添加缩进（用于嵌套列表）；
 * - 可选加粗。
 * @param {string} text 段落文本
 * @param {number} depth 嵌套层级（0 为顶层）
 * @param {{bold?:boolean}} [opts]
 */
function renderParagraph(text, depth, opts) {
  opts = opts || {};
  const safeDepth = Math.max(0, depth | 0);
  const indent = safeDepth > 0
    ? ` w:ind="w:left="${safeDepth * 360}" w:hanging="0"`
    : '';
  const rpr = opts.bold ? '<w:rPr><w:b/></w:rPr>' : '';

  // 将换行符转换为 <w:br/>
  const str = String(text);
  let runs = '';
  const lines = str.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) runs += '<w:br/>';
    runs += escapeXml(lines[i]);
  }

  return `<w:p><w:pPr><w:pStyle w:val="Normal"/>${indent}</w:pPr>` +
    `<w:r>${rpr}<w:t xml:space="preserve">${runs}</w:t></w:r></w:p>`;
}

/**
 * 渲染一个标题段落（Heading1/2/3）。
 */
function renderHeading(text, level) {
  const style = 'Heading' + Math.min(3, Math.max(1, level | 0));
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>` +
    `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

// 递归渲染最大深度，超过后直接以文本呈现，防止过深嵌套
const MAX_DEPTH = 4;

/**
 * 将任意结构化值递归渲染为段落集合。
 * - 基础类型（string/number/boolean）→ 普通段落；
 * - 数组/对象 → 嵌套缩进的"列表"（key: value 或 • 条目）。
 * @param {*} value 待渲染的值
 * @param {number} depth 当前递归深度
 * @param {string[]} out 收集渲染结果的数组（每段一个字符串）
 */
function renderValue(value, depth, out) {
  // 超过最大递归深度：以安全可读的文本形式呈现，避免无限嵌套
  if (depth > MAX_DEPTH) {
    const text = (typeof value === 'object' && value !== null)
      ? safeStringify(value)
      : String(value);
    out.push(renderParagraph(text, MAX_DEPTH));
    return;
  }

  if (value === null || value === undefined) return;

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') {
    out.push(renderParagraph(String(value), depth));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (item === null || item === undefined) continue;
      if (typeof item === 'object') {
        // 嵌套对象/数组：缩进后再递归
        renderValue(item, depth + 1, out);
      } else {
        out.push(renderParagraph('• ' + String(item), depth + 1));
      }
    }
    return;
  }

  if (t === 'object') {
    const keys = Object.keys(value);
    for (const k of keys) {
      const v = value[k];
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') {
        // 键名加粗作为小节标题，值递归渲染
        out.push(renderParagraph(String(k) + '：', depth + 1, { bold: true }));
        renderValue(v, depth + 1, out);
      } else {
        out.push(renderParagraph(String(k) + '：' + String(v), depth + 1));
      }
    }
    return;
  }
}

/**
 * 安全地将对象转为可读字符串（用于超深递归兜底）。
 */
function safeStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (_) {
    return String(obj);
  }
}

/* =========================================================================
 * 4. 章节标签与渲染顺序
 * ========================================================================= */

// 各结果字段对应的中文小节标题（覆盖任务中列举的全部可能 key）
const SECTION_LABELS = {
  overview: '概览',
  framework: '分析框架',
  storyStructure: '结构划分（起承转合）',
  opening: '开篇节奏',
  goldenFinger: '金手指',
  architecture: '文章架构',
  characters: '人物',
  antagonists: '反派体系',
  minorRoles: '次要功能角色',
  relationships: '人物关系',
  worldbuilding: '世界观',
  timeline: '时间线',
  outline: '大纲',
  foreshadowing: '伏笔',
  styleProfile: '文风',
  craftConstraints: '创作技法',
  reversalPatterns: '反转套路',
  emotion: '情绪曲线',
  conflictStats: '冲突统计',
  genre: '题材',
  sellingPoints: '卖点',
  reusableTemplates: '可复用模板',
  sentenceFingerprint: '句式指纹',
  chapterIndex: '章节目录',
  logicFlaws: '逻辑漏洞',
  validation: '校验结论',
};

// 渲染顺序：尽量贴合拆解报告的逻辑流
const SECTION_ORDER = [
  'overview', 'framework', 'storyStructure', 'opening', 'goldenFinger', 'architecture',
  'characters', 'antagonists', 'minorRoles', 'relationships', 'worldbuilding', 'timeline', 'outline',
  'foreshadowing', 'styleProfile', 'craftConstraints', 'reversalPatterns', 'emotion',
  'conflictStats', 'genre', 'sellingPoints', 'reusableTemplates',
  'sentenceFingerprint', 'chapterIndex', 'logicFlaws', 'validation',
];

/**
 * 判断一个值是否"为空"（应当跳过，不渲染）。
 */
function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim().length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v).length === 0;
  return false; // 数字、布尔视为非空
}

/* =========================================================================
 * 5. 各 XML 部件内容生成
 * ========================================================================= */

/**
 * 生成 [Content_Types].xml
 */
function buildContentTypesXml() {
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

/**
 * 生成 _rels/.rels（包级关系）
 */
function buildRootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

/**
 * 生成 word/_rels/document.xml.rels（文档关系，指向样式表）
 */
function buildDocumentRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

/**
 * 生成 word/styles.xml（定义 Normal / Heading1 / Heading2 / Heading3）
 */
function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="宋体" w:cs="Calibri"/>
        <w:sz w:val="21"/>
        <w:szCs w:val="21"/>
      </w:rPr>
    </w:rPrDefault>
    <w:pPrDefault>
      <w:pPr>
        <w:spacing w:after="120" w:line="276" w:lineRule="auto"/>
      </w:pPr>
    </w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="240" w:after="120"/>
      <w:outlineLvl w:val="0"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="1F3864"/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="200" w:after="100"/>
      <w:outlineLvl w:val="1"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="2E5496"/>
      <w:sz w:val="26"/>
      <w:szCs w:val="26"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="160" w:after="80"/>
      <w:outlineLvl w:val="2"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:color w:val="2E5496"/>
      <w:sz w:val="23"/>
      <w:szCs w:val="23"/>
    </w:rPr>
  </w:style>
</w:styles>`;
}

/**
 * 生成 docProps/core.xml（标题 + 创建/修改时间）
 */
function buildCoreXml(title, nowIso) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title>
  <dc:creator>墨阑拆书</dc:creator>
  <cp:lastModifiedBy>墨阑拆书</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`;
}

/**
 * 生成 docProps/app.xml（应用名）
 */
function buildAppXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>墨阑拆书导出</Application>
  <Company>墨阑 AI 小说创作平台</Company>
</Properties>`;
}

/* =========================================================================
 * 6. 主入口
 * ========================================================================= */

/**
 * 根据拆书记录与结构化结果构建 .docx 文件（返回 Buffer）。
 * @param {object} record 拆书记录，至少包含 { title, depth }
 * @param {object} result 结构化结果对象（可为 {}）
 * @returns {Buffer} 完整的 .docx 文档（ZIP 格式）
 */
function buildDissectionDocx(record, result) {
  record = record || {};
  result = result || {};

  const title = (record.title && String(record.title).trim()) || '拆书分析';
  const now = new Date();
  const nowIso = now.toISOString();

  // ---- 组装文档正文 ----
  const body = [];
  // 顶部：记录标题（Heading1）
  body.push(renderHeading(title, 1));
  // 若有分析深度，作为副标题段落
  if (record.depth) {
    body.push(renderParagraph('分析深度：' + String(record.depth)));
  }

  // 依次渲染各非空小节
  for (const key of SECTION_ORDER) {
    const val = result[key];
    if (isEmptyValue(val)) continue;
    const label = SECTION_LABELS[key] || key;
    body.push(renderHeading(label, 2));
    renderValue(val, 0, body);
  }

  const documentXml =
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  // ---- 收集所有 ZIP 部件 ----
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(buildContentTypesXml(), 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(buildRootRelsXml(), 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(buildStylesXml(), 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(buildDocumentRelsXml(), 'utf8') },
    { name: 'docProps/core.xml', data: Buffer.from(buildCoreXml(title, nowIso), 'utf8') },
    { name: 'docProps/app.xml', data: Buffer.from(buildAppXml(), 'utf8') },
  ];

  return buildZip(entries);
}

// 导出公共 API
module.exports = { buildDissectionDocx, crc32, buildZip };
