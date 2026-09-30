'use strict';

function createDissectionInputService({ DISSECTION_CHUNK_CHARS, DISSECTION_DEPTH_LIMITS, DISSECTION_MAX_UNITS, DISSECTION_NOISE_ANCHORED, DISSECTION_NOISE_ANYWHERE, DISSECTION_STAGE_CONTEXT_CHARS, DISSECTION_STAGE_FRACTION, crypto }) {
  function dissectionId() {
    return 'd_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
  }

  function dissectionWordCount(text) {
    return String(text || '').replace(/\s/g, '').length;
  }

  function cleanDissectionText(text) {
    const value = String(text || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    if (!value) return '';
    const lines = value.split('\n');
    const kept = [];
    for (let line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { kept.push(''); continue; }
      const short = trimmed.length <= 80;
      // 无句末标点才可能被视为噪音行（正文短句一般带 。！？…）
      const noSentenceEnd = !/[。！？…!?…]/.test(trimmed.replace(/[「」“”‘’【】《》（）()]/g, ''));
      // 行首锚定噪音（短行 + 无句末标点）：整行删除
      if (short && noSentenceEnd && DISSECTION_NOISE_ANCHORED.test(trimmed)) continue;
      // 行内强噪音（网址/群号/ps/有话说/导航，且整行很短）：整行删除
      if (short && noSentenceEnd && DISSECTION_NOISE_ANYWHERE.test(trimmed)) continue;
      // 行首网址/广告前缀裁剪：仅裁掉行首的前缀片段，保留后续正文
      const inline = trimmed.match(/^[^\u4e00-\u9fff]{0,4}(?:本书首发|最新网址|请记住本站|欢迎访问|http:\/\/|https:\/\/|www\.)[^\s，。；！？、,]{0,20}[\s，。；！？、,]{0,2}/);
      if (inline && inline[0] && inline[0].length <= 40) line = trimmed.slice(inline[0].length).trim();
      // 统一折叠行内多余空格（不影响中文语义）
      line = line.replace(/[ \t\u3000]{2,}/g, ' ');
      if (line) kept.push(line);
    }
    // 折叠连续空行：最多保留一个空行（段间隔）
    return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function splitDissectionText(text, maxChars) {
    const value = String(text || '');
    const out = [];
    for (let start = 0; start < value.length; start += maxChars) {
      out.push(value.slice(start, start + maxChars));
    }
    return out.length ? out : [''];
  }

  function dissectionChapterTitle(line) {
    const value = String(line || '').trim();
    const match = value.match(/^(?:[#>*-]\s*)?(?:(?:第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*(?:章|节|回|卷|部|篇))(?:\s*[-:：.、]?\s*[^\n]{0,120})?|(?:(?:chapter|part|book)\s*(?:no\.?\s*)?[0-9ivxlc]+)(?:\s*[-:：.、]?\s*[^\n]{0,120})?)$/i);
    return match ? value.replace(/^[#>*-]\s*/, '').trim() : '';
  }

  function buildDissectionChunks(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n').trim();
    const markers = [];
    let offset = 0;
    source.split('\n').forEach(line => {
      const title = dissectionChapterTitle(line);
      if (title) markers.push({ index: offset, title });
      offset += line.length + 1;
    });
    const chunks = [];
    if (markers.length) {
      if (markers[0].index > 0) {
        const preface = source.slice(0, markers[0].index).trim();
        if (preface) splitDissectionText(preface, DISSECTION_CHUNK_CHARS).forEach((part, partIndex) => {
          chunks.push({ index: chunks.length + 1, label: '开篇前置' + (partIndex ? '（续）' : ''), text: part, chapterId: 'preface', chapterPart: partIndex });
        });
      }
      for (let i = 0; i < markers.length; i += 1) {
        const start = markers[i].index;
        const end = i + 1 < markers.length ? markers[i + 1].index : source.length;
        const chapter = source.slice(start, end).trim();
        if (!chapter) continue;
        splitDissectionText(chapter, DISSECTION_CHUNK_CHARS).forEach((part, partIndex) => {
          chunks.push({ index: chunks.length + 1, label: markers[i].title + (partIndex ? '（续）' : ''), text: part, chapterId: 'chapter-' + (i + 1), chapterPart: partIndex });
        });
      }
    } else {
      splitDissectionText(source, DISSECTION_CHUNK_CHARS).forEach((part, index) => {
        chunks.push({ index: index + 1, label: '片段 ' + (index + 1), text: part, chapterId: 'segment-' + (index + 1), chapterPart: 0 });
      });
    }
    return chunks;
  }

  function dissectionUnitHeader(line) {
    const value = String(line || '').trim();
    if (!value || value.length > 80) return null;
    const norm = value.replace(/^[#>*-]\s*/, '');
    if (/^第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*(?:卷|部|篇)(?:\s*[-:：.、]?\s*[^\n]{0,60})?$/.test(norm)) return { type: 'volume', title: norm };
    if (/^(?:第\s*[0-9零一二三四五六七八九十百千万两〇○]+\s*(?:章|节|回)(?:\s*[-:：.、]?\s*[^\n]{0,80})?|(?:chapter|part|book)\s*(?:no\.?\s*)?[0-9ivxlc]+(?:\s*[-:：.、]?\s*[^\n]{0,80})?)$/i.test(norm)) return { type: 'chapter', title: norm };
    return null;
  }

  function splitUnitParts(text, baseOffset) {
    const parts = [];
    let start = 0;
    const len = text.length;
    while (start < len) {
      if (len - start <= DISSECTION_CHUNK_CHARS) { parts.push({ text: text.slice(start), start: baseOffset + start, end: baseOffset + len }); break; }
      const windowStart = start + 4000;
      const windowEnd = Math.min(start + DISSECTION_CHUNK_CHARS, len);
      const boundary = text.slice(windowStart, windowEnd).lastIndexOf('\n\n');
      if (boundary >= 2000) {
        const cut = windowStart + boundary;
        parts.push({ text: text.slice(start, cut), start: baseOffset + start, end: baseOffset + cut });
        start = cut;
      } else {
        parts.push({ text: text.slice(start, windowEnd), start: baseOffset + start, end: baseOffset + windowEnd });
        start = windowEnd;
      }
    }
    return parts.filter(p => p.text.trim());
  }

  function buildDissectionUnits(text) {
    const source = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!source) return [];
    const lines = source.split('\n');
    const headers = [];
    let offset = 0;
    lines.forEach(line => {
      const info = dissectionUnitHeader(line);
      if (info) headers.push({ type: info.type, title: info.title, offset });
      offset += line.length + 1;
    });
    const units = [];
    const pushUnits = (segText, baseOffset, type, title, parentId) => {
      if (!String(segText || '').trim()) return;
      splitUnitParts(segText, baseOffset).forEach((p, pi) => {
        const ordinal = units.length + 1;
        const text = p.text.trim();
        if (!text) return;
        const baseTitle = pi === 0 ? title : (title + '（续' + pi + '）');
        units.push({
          unitId: type + '-' + String(ordinal).padStart(4, '0'),
          ordinal,
          unitType: type,
          title: baseTitle || (type === 'preface' ? '前言' : (type === 'segment' ? '片段 ' + ordinal : '第 ' + ordinal + ' 单元')),
          parentId: parentId || '',
          text,
          sourceStart: p.start,
          sourceEnd: p.end,
          textHash: crypto.createHash('sha1').update(text).digest('hex').slice(0, 16),
          charCount: dissectionWordCount(text),
          tokenEstimate: Math.ceil(text.length / 1.3)
        });
      });
    };
    if (!headers.length) {
      // 无任何标题：按段落边界生成 segment，绝不丢弃、不按 0 章处理
      pushUnits(source, 0, 'segment', '', '');
      if (units.length > DISSECTION_MAX_UNITS) throw new Error('输入单元数 ' + units.length + ' 超出当前容量上限 ' + DISSECTION_MAX_UNITS + '，请分段输入');
      return units;
    }
    if (headers[0].offset > 0) pushUnits(source.slice(0, headers[0].offset), 0, 'preface', '前言', '');
    let currentVolume = '';
    for (let i = 0; i < headers.length; i += 1) {
      const h = headers[i];
      const start = h.offset;
      const end = i + 1 < headers.length ? headers[i + 1].offset : source.length;
      if (h.type === 'volume') {
        const before = units.length;
        pushUnits(source.slice(start, end), start, 'volume', h.title, '');
        currentVolume = units[before] ? units[before].unitId : '';
      } else {
        pushUnits(source.slice(start, end), start, 'chapter', h.title, currentVolume);
      }
    }
    if (units.length > DISSECTION_MAX_UNITS) throw new Error('输入单元数 ' + units.length + ' 超出当前容量上限 ' + DISSECTION_MAX_UNITS + '，请分段输入');
    return units;
  }

  function chooseDissectionChunks(chunks, depth) {
    const base = DISSECTION_DEPTH_LIMITS[depth] || DISSECTION_DEPTH_LIMITS.standard;
    let limit = Math.min(chunks.length, base);
    if (depth === 'deep') {
      // ★ 千万字级深拆：采样片数随全书规模提升（约 8%，封顶 240 片），
      // 避免"深拆千万字仍只抽样固定 60 片、大量区域从未进入分析"。
      limit = Math.min(chunks.length, Math.max(base, Math.min(240, Math.ceil(chunks.length * 0.08))));
    }
    if (chunks.length <= limit) return chunks.slice();
    const indexes = new Set();
    // 先锁定开篇、首个危机附近、中段、后段和结尾，再用均匀采样补齐，
    // 避免“抽样数量很多但只集中在书前”的失真结果。
    const anchors = [0, 1, 2, Math.floor(chunks.length * 0.1), Math.floor(chunks.length * 0.25), Math.floor(chunks.length * 0.5), Math.floor(chunks.length * 0.75), Math.floor(chunks.length * 0.9), chunks.length - 1];
    anchors.forEach(index => { if (index >= 0 && index < chunks.length && indexes.size < limit) indexes.add(index); });
    for (let i = 0; indexes.size < limit && i < limit * 3; i += 1) {
      indexes.add(Math.round(i * (chunks.length - 1) / Math.max(1, limit * 3 - 1)));
    }
    return [...indexes].sort((a, b) => a - b).map(index => chunks[index]);
  }

  function dissectionContext(chunks, maxChars = 220000) {
    let output = '';
    for (const chunk of chunks) {
      const block = '\n\n===== ' + chunk.label + ' / #' + chunk.index + ' =====\n' + chunk.text;
      if (output.length + block.length > maxChars) {
        const remaining = maxChars - output.length;
        if (remaining > 300) output += block.slice(0, remaining);
        break;
      }
      output += block;
    }
    return output;
  }

  function dissectionContextForStage(stage, chunks, depth) {
    const maxChars = DISSECTION_STAGE_CONTEXT_CHARS[stage] || 180000;
    if (depth === 'deep') {
      const fraction = DISSECTION_STAGE_FRACTION[stage] || 0;
      if (fraction > 0 && chunks.length > 12) {
        const offset = Math.floor(chunks.length * fraction);
        const rotated = chunks.slice(offset).concat(chunks.slice(0, offset));
        return dissectionContext(rotated, maxChars);
      }
    }
    return dissectionContext(chunks, maxChars);
  }

  function normalizeDissectionSource(body) {
    return normalizeDissectionInput(body).source;
  }

  function parseDissectionChineseNumber(value) {
    const clean = String(value || '').replace(/[\s　]/g, '');
    if (!clean || !/^[零〇○一二三四五六七八九十百千万两]+$/u.test(clean)) return null;
    const digits = { 零: 0, 〇: 0, '○': 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const units = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
    let total = 0;
    let section = 0;
    for (const char of clean) {
      if (Object.prototype.hasOwnProperty.call(units, char)) {
        total += (section || 1) * units[char];
        section = 0;
      } else section = section * 10 + digits[char];
    }
    return total + section;
  }

  function parseDissectionOrderNumber(value) {
    const clean = String(value || '').trim().replace(/[０-９]/gu, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
    if (/^\d+$/.test(clean)) return Number(clean);
    const chinese = parseDissectionChineseNumber(clean);
    if (chinese !== null) return chinese;
    const roman = clean.toUpperCase();
    if (!/^[IVXLCDM]+$/.test(roman)) return null;
    const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    for (let index = 0; index < roman.length; index += 1) total += values[roman[index]] < (values[roman[index + 1]] || 0) ? -values[roman[index]] : values[roman[index]];
    return total;
  }

  function dissectionFileOrderNumbers(value) {
    const pathValue = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
    const numbers = [];
    pathValue.split('/').filter(Boolean).forEach((segment, index, segments) => {
      const clean = index === segments.length - 1 ? segment.replace(/\.[^.]+$/, '') : segment;
      const heading = clean.match(/第\s*([0-9０-９零〇○一二三四五六七八九十百千万两]+)\s*(?:章|节|回|集|卷|部|篇)/u);
      const named = clean.match(/(?:chapter|part|book|volume|vol)[\s_-]*(?:no\.?[\s_-]*)?([0-9０-９ivxlcdm]+)/i);
      const generic = clean.match(/(?:^|[^0-9０-９])([0-9０-９]+)(?=[^0-9０-９]|$)/u);
      const match = heading || named || generic;
      const number = match ? parseDissectionOrderNumber(match[1]) : null;
      if (number !== null) numbers.push(number);
    });
    return numbers;
  }

  function dissectionPathHasVolume(value) {
    return String(value || '').replace(/\\/g, '/').split('/').some(segment => {
      const clean = segment.replace(/\.[^.]+$/, '');
      return /第\s*[0-9０-９零〇○一二三四五六七八九十百千万两]+\s*(?:卷|部|篇)/u.test(clean)
        || /(?:volume|vol)[\s_-]*[0-9０-９ivxlcdm]+/i.test(clean);
    });
  }

  function firstDissectionChapterNumber(value) {
    for (const line of String(value || '').replace(/\r\n?/g, '\n').split('\n')) {
      const title = dissectionChapterTitle(line);
      if (!title) continue;
      const match = title.match(/^第\s*([0-9０-９零〇○一二三四五六七八九十百千万两]+)\s*(?:章|节|回|集|卷|部|篇)/u)
        || title.match(/^(?:chapter|part|book)\s*(?:no\.?\s*)?([0-9０-９ivxlcdm]+)/i);
      if (match) return parseDissectionOrderNumber(match[1]);
    }
    return null;
  }

  function compareDissectionFileOrder(left, right) {
    const leftNumber = firstDissectionChapterNumber(left.text);
    const rightNumber = firstDissectionChapterNumber(right.text);
    const leftPathNumbers = dissectionFileOrderNumbers(left.name);
    const rightPathNumbers = dissectionFileOrderNumbers(right.name);
    const leftNumbers = leftNumber === null
      ? leftPathNumbers
      : dissectionPathHasVolume(left.name) && leftPathNumbers.length
        ? leftPathNumbers.length > 1 ? [...leftPathNumbers.slice(0, -1), leftNumber] : [...leftPathNumbers, leftNumber]
        : [leftNumber];
    const rightNumbers = rightNumber === null
      ? rightPathNumbers
      : dissectionPathHasVolume(right.name) && rightPathNumbers.length
        ? rightPathNumbers.length > 1 ? [...rightPathNumbers.slice(0, -1), rightNumber] : [...rightPathNumbers, rightNumber]
        : [rightNumber];
    if (leftNumbers.length !== rightNumbers.length || leftNumbers.some((value, index) => value !== rightNumbers[index])) {
      if (!leftNumbers.length) return 1;
      if (!rightNumbers.length) return -1;
      for (let index = 0; index < Math.min(leftNumbers.length, rightNumbers.length); index += 1) {
        if (leftNumbers[index] !== rightNumbers[index]) return leftNumbers[index] - rightNumbers[index];
      }
      return leftNumbers.length - rightNumbers.length;
    }
    if (leftNumbers.length || rightNumbers.length) return 0;
    return String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN', { numeric: true, sensitivity: 'base' });
  }

  function normalizeDissectionInput(body) {
    const parts = [];
    const seen = new Set();
    const sourceFiles = [];
    let duplicateFileCount = 0;
    let ignoredFileCount = 0;
    const files = Array.isArray(body && body.files) ? body.files.slice(0, 500).filter(file => file && typeof file === 'object') : [];
    const orderedFiles = files.map((file, index) => ({ file, index }))
      .sort((left, right) => compareDissectionFileOrder(left.file, right.file) || left.index - right.index)
      .map(item => item.file);
    // F002：清洗统计（去噪行数/去噪字符）
    let removedNoiseChars = 0;
    orderedFiles.forEach(file => {
      const name = String(file.name || '未命名文件').replace(/[\r\n]+/g, ' ').slice(0, 200);
      const rawText = String(file.text || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
      const text = cleanDissectionText(rawText);
      removedNoiseChars += Math.max(0, dissectionWordCount(rawText) - dissectionWordCount(text));
      const sha1 = crypto.createHash('sha1').update(text).digest('hex');
      const meta = {
        name,
        size: Math.max(0, Number(file.size) || 0),
        lastModified: Math.max(0, Number(file.lastModified) || 0),
        encoding: String(file.encoding || 'utf-8').slice(0, 24),
        chars: text.length,
        sha1,
        included: false,
        reason: ''
      };
      if (!text) {
        meta.reason = 'empty';
        ignoredFileCount += 1;
        sourceFiles.push(meta);
        return;
      }
      if (seen.has(sha1)) {
        meta.reason = 'duplicate';
        duplicateFileCount += 1;
        sourceFiles.push(meta);
        return;
      }
      seen.add(sha1);
      meta.included = true;
      sourceFiles.push(meta);
      parts.push('===== 文件：' + name + ' =====\n' + text);
    });
    const pastedRaw = String(body && body.text || '').replace(/\uFEFF/g, '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim();
    const pasted = cleanDissectionText(pastedRaw);
    removedNoiseChars += Math.max(0, dissectionWordCount(pastedRaw) - dissectionWordCount(pasted));
    let pastedIncluded = false;
    let pastedSha1 = '';
    if (pasted) {
      pastedSha1 = crypto.createHash('sha1').update(pasted).digest('hex');
      if (!seen.has(pastedSha1)) {
        parts.push('===== 粘贴内容 =====\n' + pasted);
        pastedIncluded = true;
      } else {
        duplicateFileCount += 1;
      }
    }
    return {
      source: parts.join('\n\n'),
      sourceFiles,
      duplicateFileCount,
      ignoredFileCount,
      pastedChars: pasted.length,
      pastedSha1,
      pastedIncluded,
      removedNoiseChars
    };
  }

  return { dissectionId, dissectionWordCount, cleanDissectionText, splitDissectionText, dissectionChapterTitle, buildDissectionChunks, dissectionUnitHeader, splitUnitParts, buildDissectionUnits, chooseDissectionChunks, dissectionContext, dissectionContextForStage, normalizeDissectionSource, parseDissectionChineseNumber, parseDissectionOrderNumber, dissectionFileOrderNumbers, dissectionPathHasVolume, firstDissectionChapterNumber, compareDissectionFileOrder, normalizeDissectionInput };
}

module.exports = { createDissectionInputService };
