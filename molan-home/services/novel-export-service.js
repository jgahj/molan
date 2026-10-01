'use strict';

function createNovelExportService({ novelExport, json, responseCors }) {
  /** 严格解析导出文档序号范围；范围为 1-based 且包含两端。 */
  function parseNovelExportRange(req) {
    const params = new URL(req.url, 'http://localhost').searchParams;
    const parsed = { fromChapter: null, toChapter: null, hasRange: false };
    for (const key of ['fromChapter', 'toChapter']) {
      const values = params.getAll(key);
      if (values.length > 1) return { ok: false };
      if (!values.length) continue;
      const value = values[0];
      if (!/^[1-9][0-9]*$/.test(value)) return { ok: false };
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) return { ok: false };
      parsed[key] = number;
      parsed.hasRange = true;
    }
    if (parsed.fromChapter !== null && parsed.toChapter !== null && parsed.fromChapter > parsed.toChapter) {
      return { ok: false };
    }
    return { ok: true, range: parsed };
  }
  
  /** 合并编辑器正文与 PG 已提交章节，再渲染可下载文档。 */
  function sendNovelExport(res, id, sourceState, committedChapters, format, range) {
    const normalizedFormat = String(format || '').trim().toLowerCase();
    const extensions = { txt: 'txt', epub: 'epub', docx: 'docx' };
    if (!Object.prototype.hasOwnProperty.call(extensions, normalizedFormat)) {
      return json(res, 400, { error: '导出格式仅支持 TXT、EPUB、DOCX', code: 'export_format_invalid' });
    }
    const state = sourceState && typeof sourceState === 'object' && !Array.isArray(sourceState) ? sourceState : {};
    const committed = new Map((Array.isArray(committedChapters) ? committedChapters : []).map(chapter => [Number(chapter.chapterNo), chapter]));
    const sourceChapters = Array.isArray(state.chapters)
      ? state.chapters
      : (Array.isArray(state.volumes) ? state.volumes.flatMap(volume =>
        (Array.isArray(volume && volume.chapters) ? volume.chapters : []).map(chapter => ({ ...chapter, volumeTitle: chapter.volumeTitle || volume.title || '' }))
      ) : []);
    const chapters = [];
    const represented = new Set();
    sourceChapters.forEach((chapter, index) => {
      const chapterNo = Number(chapter && (chapter.number || chapter.chapterNo || chapter.chapterIndex)) || index + 1;
      const committedChapter = committed.get(chapterNo);
      represented.add(chapterNo);
      chapters.push(committedChapter
        ? { ...chapter, chapterNo, content: committedChapter.content }
        : { ...chapter, chapterNo });
    });
    for (const chapter of committed.values()) {
      if (!represented.has(Number(chapter.chapterNo))) {
        chapters.push({ chapterNo: Number(chapter.chapterNo), title: `第${Number(chapter.chapterNo)}章`, content: String(chapter.content || '') });
      }
    }
    chapters.sort((left, right) => {
      const leftNo = Number(left.number || left.chapterNo || left.chapterIndex) || 0;
      const rightNo = Number(right.number || right.chapterNo || right.chapterIndex) || 0;
      return leftNo - rightNo;
    });
    const exportInput = {
      ...state,
      id: state.id || id,
      title: state.title || '未命名小说',
      chapters
    };
    let document;
    let body;
    try {
      document = novelExport.buildExportDocument(exportInput);
      if (!document.chapters.length && !range.hasRange) {
        return json(res, 409, { error: '没有可读取的章节正文，已阻止导出', code: 'export_content_blocked', blocked: true });
      }
      const fromChapter = range.fromChapter || 1;
      const toChapter = range.toChapter || document.chapters.length;
      if (fromChapter > document.chapters.length || toChapter > document.chapters.length || fromChapter > toChapter) {
        return json(res, 400, { error: '章节范围超出导出文档边界', code: 'export_range_invalid' });
      }
      const selectedChapters = document.chapters.slice(fromChapter - 1, toChapter);
      if (!selectedChapters.length || selectedChapters.every(chapter => !chapter.content.trim())) {
        return json(res, 409, { error: '选定范围没有可读取的章节正文，已阻止导出', code: 'export_content_blocked', blocked: true });
      }
      body = novelExport.exportBook({ ...document, chapters: selectedChapters }, normalizedFormat);
    } catch (error) {
      return json(res, 422, { error: error && error.message || '小说导出失败', code: 'export_build_failed' });
    }
    const baseName = String(document.title || id).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 100) || id;
    const filename = `${baseName}.${extensions[normalizedFormat]}`;
    const fallbackName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || `novel.${extensions[normalizedFormat]}`;
    const contentTypes = {
      txt: 'text/plain; charset=utf-8',
      epub: 'application/epub+zip',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    res.writeHead(200, {
      'Content-Type': contentTypes[normalizedFormat],
      'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': body.length,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      ...responseCors(res)
    });
    return res.end(body);
  }
  return { parseNovelExportRange, sendNovelExport };
}

module.exports = { createNovelExportService };
