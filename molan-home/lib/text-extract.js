'use strict';

/**
 * text-extract.js
 * ----------------------------------------------------------------------------
 * 零依赖（Zero-dependency）Node.js 文本抽取模块。
 *
 * 仅使用 Node.js 内置模块：
 *   - zlib  : 解压 deflate（method 8）数据
 *   - Buffer: 解析二进制 ZIP 结构
 *
 * 支持格式：DOCX（Office Open XML Word 文档）、EPUB（电子书）。
 * 不支持：PDF 与图片（按产品规则拒绝，避免 OCR 误判）。
 *
 * 对外导出：
 *   - isExtractable(filename)        : 判断文件名是否为可抽取格式
 *   - extractDocument(filename, buf) : 异步抽取并返回 { text, title, format }
 * ----------------------------------------------------------------------------
 */

const zlib = require('zlib');

// DOCX/EPUB are ZIP containers. Keep decompression bounded so a small,
// highly-compressed upload cannot exhaust the Node process.
const ZIP_MAX_ENTRIES = 4096;
const ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const ZIP_MAX_COMPRESSION_RATIO = 1000;

/* ===========================================================================
 * 1) 最小 ZIP 读取器（纯 JS，依赖 zlib）
 *    DOCX 与 EPUB 本质上都是 ZIP 压缩包。
 * =========================================================================== */

// ZIP 各关键签名（小端读取得到的 32 位整数）
const SIG_EOCD = 0x06054b50; // PK\x05\x06 —— End Of Central Directory
const SIG_CDH = 0x02014b50; // PK\x01\x02 —— Central Directory File Header
const SIG_LFH = 0x04034b50; // PK\x03\x04 —— Local File Header

/**
 * 从文件末尾向前搜索 EOCD（End Of Central Directory）记录位置。
 * EOCD 之后可能带有注释，因此需从尾部向前扫描签名。
 * @param {Buffer} buf 整个 ZIP 文件的 Buffer
 * @returns {number} EOCD 起始偏移；找不到返回 -1
 */
function findEOCD(buf) {
  if (buf.length < 22) return -1;
  // EOCD 最小 22 字节，注释最长 0xffff，所以从 length-22 向前最多扫描 0xffff 字节
  const minPos = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * 解析 ZIP 缓冲，返回 Map<文件名, 解压后的 Buffer>。
 * @param {Buffer} buf 整个 ZIP 文件的 Buffer
 * @returns {Map<string, Buffer>}
 */
function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw new Error('INVALID_ZIP: 输入不是有效的 ZIP 数据');
  }

  const eocd = findEOCD(buf);
  if (eocd < 0) {
    throw new Error('INVALID_ZIP: 未找到 End Of Central Directory 记录');
  }

  // EOCD 中：偏移 10 = 中央目录条目总数；偏移 16 = 中央目录起始偏移
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  if (totalEntries > ZIP_MAX_ENTRIES) {
    throw new Error('INVALID_ZIP: 文件条目数量超过上限（' + ZIP_MAX_ENTRIES + '）');
  }

  if (cdOffset < 0 || cdOffset + 4 > buf.length) {
    throw new Error('INVALID_ZIP: 中央目录偏移越界');
  }

  const entries = new Map();
  let totalUncompressed = 0;
  let p = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CDH) {
      throw new Error('INVALID_ZIP: 中央目录文件头签名错误（条目 ' + i + '）');
    }

    const method = buf.readUInt16LE(p + 10); // 压缩方式
    const compSize = buf.readUInt32LE(p + 20); // 压缩后大小
    const uncompressedSize = buf.readUInt32LE(p + 24); // 解压后大小
    const nameLen = buf.readUInt16LE(p + 28); // 文件名长度
    const extraLen = buf.readUInt16LE(p + 30); // 扩展字段长度
    const commentLen = buf.readUInt16LE(p + 32); // 注释长度
    const localOffset = buf.readUInt32LE(p + 42); // 本地文件头偏移
    const nameStart = p + 46;

    if (nameStart + nameLen > buf.length) {
      throw new Error('INVALID_ZIP: 文件名越界');
    }
    const filename = buf.toString('utf8', nameStart, nameStart + nameLen);

    // 跳过目录项（以 '/' 结尾）
    if (!filename.endsWith('/')) {
      // 跳到 Local File Header，读取其文件名/扩展字段长度以定位压缩数据起点
      if (localOffset < 0 || localOffset + 30 > buf.length) {
        throw new Error('INVALID_ZIP: 本地文件头偏移越界: ' + filename);
      }
      if (buf.readUInt32LE(localOffset) !== SIG_LFH) {
        throw new Error('INVALID_ZIP: 本地文件头签名错误: ' + filename);
      }
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const dataEnd = dataStart + compSize;

      if (dataStart < localOffset || dataEnd < dataStart || dataEnd > buf.length) {
        throw new Error('INVALID_ZIP: 压缩数据越界: ' + filename);
      }
      if (uncompressedSize > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES || totalUncompressed + uncompressedSize > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP_RESOURCE_LIMIT: 解压后文件过大: ' + filename);
      }
      if (compSize > 0 && uncompressedSize / compSize > ZIP_MAX_COMPRESSION_RATIO) {
        throw new Error('ZIP_RESOURCE_LIMIT: 压缩率异常: ' + filename);
      }
      const compData = buf.subarray(dataStart, dataEnd);

      let data;
      if (method === 0) {
        // 0 = 存储（stored），直接使用原始字节
        data = Buffer.from(compData);
      } else if (method === 8) {
        // 8 = deflate，DOCX/EPUB 使用 zlib 包装的 deflate（非 raw）
        try {
          data = zlib.inflateSync(compData, { maxOutputLength: ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES });
        } catch (e) {
          const code = e && e.code === 'ERR_BUFFER_TOO_LARGE' ? 'ZIP_RESOURCE_LIMIT' : 'INVALID_ZIP';
          throw new Error(code + ': deflate 解压失败: ' + filename + ' (' + e.message + ')');
        }
      } else {
        throw new Error('UNSUPPORTED_COMPRESSION: 不支持的压缩方式 ' + method + ' (' + filename + ')');
      }
      if (data.length > ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES || totalUncompressed + data.length > ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error('ZIP_RESOURCE_LIMIT: 解压后文件过大: ' + filename);
      }
      totalUncompressed += data.length;
      entries.set(filename, data);
    }

    // 移动到中央目录中的下一个条目
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next < p || next > buf.length) throw new Error('INVALID_ZIP: 中央目录越界');
    p = next;
  }

  return entries;
}

/* ===========================================================================
 * 2) 通用 XML/HTML 实体解码
 * =========================================================================== */

/**
 * 解码常见 XML/HTML 实体：&amp; &lt; &gt; &quot; &apos; &#NN; &#xHH;
 * 注意：&amp; 必须最后处理，避免二次解码。
 * @param {string} str
 * @returns {string}
 */
function decodeEntities(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** 安全地根据码点生成字符，避免非法码点导致异常 */
function safeCodePoint(cp) {
  try {
    if (cp >= 0 && cp <= 0x10ffff) return String.fromCodePoint(cp);
  } catch (e) {
    /* 忽略非法码点 */
  }
  return '';
}

/* ===========================================================================
 * 3) DOCX 解析
 * =========================================================================== */

/**
 * 将单个 DOCX XML 部件（document/header/footer）转为纯文本。
 * 规则：
 *   - <w:t> 内的文本提取出来，相邻文本之间用空格连接
 *   - 遇到 </w:p> 插入换行
 *   - <w:tab/> 视为制表符
 *   - <w:br/> 与 <w:cr/> 视为换行
 *   - 其余 XML 标签全部忽略
 * @param {string} xml
 * @returns {string}
 */
function wordXmlToText(xml) {
  // 先处理制表符与软换行
  let s = xml
    .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
    .replace(/<w:(?:br|cr)\b[^>]*\/?>/gi, '\n');

  let result = '';
  let pendingSpace = false;

  // 顺序扫描：匹配 w:t 标签对 / </w:p> / 其它任意标签
  const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<\/w:p>|<\/?[^>]+>/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) {
      // 命中 <w:t>...</w:t>
      const content = decodeEntities(m[1]);
      if (content.length > 0) {
        if (pendingSpace && result.length > 0) result += ' ';
        result += content;
        pendingSpace = true;
      }
    } else if (m[0] === '</w:p>') {
      // 段落结束 -> 换行
      result += '\n';
      pendingSpace = false;
    }
    // 其它标签：忽略
  }

  return result;
}

/** 从 docProps/core.xml 提取 <dc:title> 作为书名（best-effort） */
function extractDocxTitle(entries) {
  const core = entries.get('docProps/core.xml');
  if (!core) return '';
  const m = core.toString('utf8').match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * 解析 DOCX：读取正文与页眉/页脚（若存在）。
 * @param {Map<string, Buffer>} entries
 * @returns {{ text: string, title: string }}
 */
function extractDocx(entries) {
  const main = entries.get('word/document.xml');
  if (!main) {
    throw new Error('INVALID_DOCX: 缺少 word/document.xml');
  }

  let text = wordXmlToText(main.toString('utf8'));

  // 页眉/页脚（best-effort，按常见命名顺序追加）
  const extraParts = ['word/header1.xml', 'word/header2.xml', 'word/footer1.xml'];
  const extras = [];
  for (const name of extraParts) {
    const b = entries.get(name);
    if (b) extras.push(wordXmlToText(b.toString('utf8')));
  }
  if (extras.length > 0) {
    text = text + '\n\n' + extras.join('\n\n');
  }

  return { text: text, title: extractDocxTitle(entries) };
}

/* ===========================================================================
 * 4) EPUB 解析
 * =========================================================================== */

/** 从属性字符串中解析属性为小写键 -> 值 的映射 */
function parseAttrs(str) {
  const attrs = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"|([\w:-]+)\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    const name = m[1] || m[3];
    const val = m[2] !== undefined ? m[2] : m[4];
    attrs[name.toLowerCase()] = val;
  }
  return attrs;
}

/** 在 entries 中查找文件，支持 URL 解码回退（EPUB href 可能经过 URL 编码） */
function getEntry(entries, path) {
  if (entries.has(path)) return entries.get(path);
  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path && entries.has(decoded)) return entries.get(decoded);
  } catch (e) {
    /* 解码失败则忽略 */
  }
  return undefined;
}

/** 将 href 相对路径基于 OPF 所在目录解析为 ZIP 内完整路径（处理 ./ ../） */
function resolvePath(baseDir, rel) {
  rel = rel.split('#')[0].split('?')[0]; // 去掉片段与查询
  const parts = (baseDir ? baseDir.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** 将 HTML/XHTML 剥离标签转为纯文本，块级元素替换为换行 */
function htmlToText(html) {
  // 去掉 script / style 内容
  let s = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');

  // 块级/换行元素前插入换行
  s = s.replace(/<\s*(?:br|p|div|h[1-6]|li|tr|blockquote|section|article)\b[^>]*>/gi, '\n');
  s = s.replace(/<\s*\/\s*(?:p|div|h[1-6]|li|tr|blockquote|section|article)\b[^>]*>/gi, '\n');

  s = decodeEntities(s); // 解码实体
  s = s.replace(/<[^>]+>/g, ' '); // 移除剩余标签
  s = s.replace(/[ \t]+/g, ' '); // 折叠连续空白
  s = s.replace(/ ?\n ?/g, '\n'); // 清理换行两侧空格
  return s.trim();
}

/** 判断 media-type / 扩展名是否为 HTML 类内容 */
function isHtmlItem(mediaType, href) {
  if (mediaType && /html/i.test(mediaType)) return true;
  return /\.(x?html?|htm)$/i.test(href);
}

/**
 * 解析 EPUB：
 *   1. 读取 META-INF/container.xml 定位 OPF
 *   2. 解析 OPF 的 manifest 与 spine 顺序
 *   3. 按 spine 顺序抽取 XHTML 文本并以两个空行分隔
 * @param {Map<string, Buffer>} entries
 * @returns {{ text: string, title: string }}
 */
function extractEpub(entries) {
  const container = entries.get('META-INF/container.xml');
  if (!container) {
    throw new Error('INVALID_EPUB: 缺少 META-INF/container.xml');
  }

  const containerXml = container.toString('utf8');
  const rootMatch = containerXml.match(/<rootfile\b[^>]*full-path="([^"]+)"[^>]*>/i);
  if (!rootMatch) {
    throw new Error('INVALID_EPUB: container.xml 中未找到 rootfile 的 full-path');
  }
  const opfPath = rootMatch[1];

  const opfBuf = getEntry(entries, opfPath);
  if (!opfBuf) {
    throw new Error('INVALID_EPUB: 找不到 OPF 文件: ' + opfPath);
  }
  const opfXml = opfBuf.toString('utf8');

  // 解析 manifest 中的 <item>（id, href, media-type）
  const items = [];
  const itemRe = /<item\b([^>]*?)\/?>/gi;
  let im;
  while ((im = itemRe.exec(opfXml)) !== null) {
    const attrs = parseAttrs(im[1]);
    if (attrs.id && attrs.href) {
      items.push({ id: attrs.id, href: attrs.href, mediaType: attrs['media-type'] || '' });
    }
  }

  // 解析 spine 中 <itemref> 的顺序（按 idref）
  const spineIds = [];
  const spineRe = /<itemref\b([^>]*?)\/?>/gi;
  let sm;
  while ((sm = spineRe.exec(opfXml)) !== null) {
    const attrs = parseAttrs(sm[1]);
    if (attrs.idref) spineIds.push(attrs.idref);
  }

  const idMap = new Map();
  for (const it of items) idMap.set(it.id, it);

  // OPF 所在目录，用于相对解析 href
  const opfDir = opfPath.includes('/') ? opfPath.replace(/\/[^/]*$/, '') : '';

  const texts = [];
  for (const id of spineIds) {
    const it = idMap.get(id);
    if (!it) continue;
    if (!isHtmlItem(it.mediaType, it.href)) continue;

    const fullPath = resolvePath(opfDir, it.href);
    const buf = getEntry(entries, fullPath);
    if (!buf) continue;

    const plain = htmlToText(buf.toString('utf8'));
    if (plain.trim().length > 0) texts.push(plain);
  }

  // best-effort 书名：OPF 中的 <dc:title>
  const titleMatch = opfXml.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';

  return { text: texts.join('\n\n'), title: title };
}

/* ===========================================================================
 * 5) 文本清理
 * =========================================================================== */

/**
 * 清理提取出的文本：
 *   - 归一化换行符（\r\n / \r -> \n）
 *   - 3 个及以上连续换行折叠为 2 个（即最多保留一个空行）
 *   - 去除首尾空白
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
  if (typeof text !== 'string') return '';
  let s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/* ===========================================================================
 * 6) 公共 API
 * =========================================================================== */

/**
 * 判断文件名是否为可抽取格式（.docx / .epub，大小写不敏感）。
 * @param {string} filename
 * @returns {boolean}
 */
function isExtractable(filename) {
  return typeof filename === 'string' && /\.(docx|epub)$/i.test(filename);
}

/**
 * 抽取文档为纯文本。
 * @param {string} filename 文件名（用于判断格式）
 * @param {Buffer} buffer   文档的二进制内容
 * @returns {Promise<{ text: string, title: string, format: string }>}
 * @throws 对 PDF / 图片抛 'PDF_OR_IMAGE_NOT_SUPPORTED'；
 *         对其它格式抛 'UNSUPPORTED_FORMAT'。
 */
async function extractDocument(filename, buffer) {
  if (typeof filename !== 'string') {
    throw new Error('UNSUPPORTED_FORMAT');
  }
  const lower = filename.toLowerCase();

  // 产品规则：拒绝 PDF 与图片（避免 OCR 误判）
  if (/\.(pdf|png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(lower)) {
    throw new Error('PDF_OR_IMAGE_NOT_SUPPORTED');
  }

  if (!isExtractable(filename)) {
    throw new Error('UNSUPPORTED_FORMAT');
  }

  if (!Buffer.isBuffer(buffer)) {
    throw new Error('INVALID_INPUT: buffer 必须是 Node.js Buffer');
  }

  const entries = unzip(buffer);

  let parsed;
  if (lower.endsWith('.docx')) {
    parsed = extractDocx(entries);
    parsed.format = 'docx';
  } else {
    parsed = extractEpub(entries);
    parsed.format = 'epub';
  }

  return {
    text: cleanText(parsed.text || ''),
    title: parsed.title || '',
    format: parsed.format,
  };
}

module.exports = {
  isExtractable,
  extractDocument,
  // 以下为内部实现导出，便于测试/复用
  unzip,
};
