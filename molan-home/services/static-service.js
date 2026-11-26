'use strict';

function createStaticService({ MIME, PUBLIC_DIR, PUBLIC_ROOT_FILES, STATIC_CACHE_MAX_BYTES, STATIC_COMPRESSIBLE_EXT, STATIC_COMPRESS_MIN_BYTES, fs, path, responseCors, zlib }) {
  const staticFileCache = new Map();
  let staticFileCacheBytes = 0;

  function entryTotalBytes(entry) {
    if (!entry) return 0;
    let total = entry.data ? entry.data.length : 0;
    if (entry.compressed) {
      for (const buf of Object.values(entry.compressed)) {
        if (buf && buf !== entry.data) total += buf.length;
      }
    }
    return total;
  }

  function evictIfNeeded() {
    while (staticFileCacheBytes > STATIC_CACHE_MAX_BYTES && staticFileCache.size > 1) {
      const oldestPath = staticFileCache.keys().next().value;
      const oldest = staticFileCache.get(oldestPath);
      staticFileCache.delete(oldestPath);
      staticFileCacheBytes -= entryTotalBytes(oldest);
    }
    if (staticFileCacheBytes < 0) staticFileCacheBytes = 0;
  }

  function isPublicStaticPath(normalizedPath) {
    return PUBLIC_ROOT_FILES.has(normalizedPath) || normalizedPath === '/pages' || normalizedPath.startsWith('/pages/');
  }

  function formatEtag(baseEtag, encoding) {
    if (!encoding) return baseEtag;
    const stripped = String(baseEtag || '').replace(/^"|"$/g, '');
    return `"${stripped}-${encoding}"`;
  }

  function ifNoneMatchMatches(req, baseEtag, encoding) {
    const header = String(req && req.headers && req.headers['if-none-match'] || '').trim();
    if (!header) return false;
    const expected = formatEtag(baseEtag, encoding);
    return header === expected || header === baseEtag || header === `W/${expected}` || header === `W/${baseEtag}`;
  }

  function mergeVary(corsHeaders) {
    const out = { ...corsHeaders };
    const existingKey = Object.keys(out).find(k => k.toLowerCase() === 'vary');
    const existing = existingKey ? String(out[existingKey] || '') : '';
    const parts = new Set(existing.split(',').concat(['Accept-Encoding']).map(s => s.trim()).filter(Boolean));
    if (existingKey && existingKey !== 'Vary') delete out[existingKey];
    out.Vary = [...parts].join(', ');
    return out;
  }

  function serveStatic(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch (_) { res.writeHead(400, responseCors(res)); res.end('Bad Request'); return; }
    if (urlPath === '/') urlPath = '/index.html';
    // 带 ?v= 版本参数的静态资源视为不可变，可长缓存；HTML 走 no-cache + ETag 条件协商缓存（支持 304）。
    const versioned = /[?&]v=/.test(String(req.url || ''));
    const normalized = path.posix.normalize('/' + urlPath.replace(/^\/+/, ''));
    if (!isPublicStaticPath(normalized)) {
      res.writeHead(404, responseCors(res)); res.end('Not Found'); return;
    }
    const filePath = path.resolve(PUBLIC_DIR, '.' + normalized);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403, responseCors(res)); res.end('Forbidden'); return; }
    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) { res.writeHead(404, responseCors(res)); res.end('Not Found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      const isHtmlJs = /\.(html?|js|css)$/i.test(filePath);
      const baseEtag = '"' + Math.floor(stat.mtimeMs).toString(16) + '-' + stat.size.toString(16) + '"';
      const preferredEncoding = pickStaticEncoding(req, ext, stat.size);
      if (ifNoneMatchMatches(req, baseEtag, preferredEncoding)) {
        res.writeHead(304, {
          ETag: formatEtag(baseEtag, preferredEncoding),
          ...mergeVary(responseCors(res))
        });
        res.end();
        return;
      }
      const cached = staticFileCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        staticFileCache.delete(filePath);
        staticFileCache.set(filePath, cached);
        return sendStaticAsync(req, res, ext, isHtmlJs, baseEtag, cached, versioned);
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404, responseCors(res)); res.end('Not Found'); return; }
        const entry = { mtimeMs: stat.mtimeMs, size: stat.size, data, cached: false };
        if (STATIC_CACHE_MAX_BYTES > 0 && data.length <= STATIC_CACHE_MAX_BYTES) {
          const previous = staticFileCache.get(filePath);
          if (previous) staticFileCacheBytes -= entryTotalBytes(previous);
          staticFileCache.delete(filePath);
          entry.cached = true;
          staticFileCache.set(filePath, entry);
          staticFileCacheBytes += data.length;
          evictIfNeeded();
        }
        sendStaticAsync(req, res, ext, isHtmlJs, baseEtag, entry, versioned);
      });
    });
  }

  function pickStaticEncoding(req, ext, size) {
    if (!STATIC_COMPRESSIBLE_EXT.has(ext) || size < STATIC_COMPRESS_MIN_BYTES) return '';
    const accept = String(req && req.headers && req.headers['accept-encoding'] || '').toLowerCase();
    if (/\bbr\b/.test(accept)) return 'br';
    if (/\bgzip\b/.test(accept)) return 'gzip';
    return '';
  }

  function recordCompressedBuffer(entry, encoding, compressed) {
    entry.compressed = entry.compressed || {};
    const prev = entry.compressed[encoding];
    if (entry.cached && prev && prev !== entry.data) staticFileCacheBytes -= prev.length;
    entry.compressed[encoding] = compressed;
    if (entry.cached && compressed && compressed !== entry.data) {
      staticFileCacheBytes += compressed.length;
      evictIfNeeded();
    }
  }

  function compressedStaticBody(entry, encoding) {
    if (!encoding) return { body: entry.data, encoding: '' };
    entry.compressed = entry.compressed || {};
    if (!entry.compressed[encoding]) {
      try {
        const compressed = encoding === 'br'
          ? zlib.brotliCompressSync(entry.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
          : zlib.gzipSync(entry.data, { level: 6 });
        recordCompressedBuffer(entry, encoding, compressed);
      } catch (_) {
        recordCompressedBuffer(entry, encoding, entry.data);
      }
    }
    const body = entry.compressed[encoding];
    if (!body || body.length >= entry.data.length) return { body: entry.data, encoding: '' };
    return { body, encoding };
  }

  function compressedStaticBodyAsync(entry, encoding, callback) {
    if (!encoding) return callback({ body: entry.data, encoding: '' });
    entry.compressed = entry.compressed || {};
    if (entry.compressed[encoding]) {
      const body = entry.compressed[encoding];
      if (!body || body.length >= entry.data.length) return callback({ body: entry.data, encoding: '' });
      return callback({ body, encoding });
    }
    const hasAsync = encoding === 'br'
      ? typeof zlib.brotliCompress === 'function'
      : typeof zlib.gzip === 'function';
    if (!hasAsync) return callback(compressedStaticBody(entry, encoding));
    entry._pendingCompress = entry._pendingCompress || {};
    if (entry._pendingCompress[encoding]) {
      entry._pendingCompress[encoding].push(callback);
      return;
    }
    entry._pendingCompress[encoding] = [callback];
    const done = (err, compressed) => {
      const waiters = entry._pendingCompress[encoding] || [];
      delete entry._pendingCompress[encoding];
      const stored = !err && compressed ? compressed : entry.data;
      recordCompressedBuffer(entry, encoding, stored);
      const result = stored && stored.length < entry.data.length
        ? { body: stored, encoding }
        : { body: entry.data, encoding: '' };
      for (const fn of waiters) fn(result);
    };
    if (encoding === 'br') {
      zlib.brotliCompress(entry.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }, done);
    } else {
      zlib.gzip(entry.data, { level: 6 }, done);
    }
  }

  function writeStaticResponse(req, res, ext, isHtmlJs, baseEtag, versioned, body, encoding) {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    const isHtml = /^\.html?$/.test(ext);
    let cacheControl;
    // RFC 9111：HTML 使用 no-cache, must-revalidate（移除 no-store），确保每次必校验新鲜度且未变更时命中 304 零传输。
    if (isHtml) cacheControl = 'no-cache, must-revalidate, max-age=0';
    else if (versioned) cacheControl = 'public, max-age=31536000, immutable';
    else cacheControl = isHtmlJs ? 'no-cache, must-revalidate, max-age=0' : 'public, max-age=86400';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      ...(isHtml ? { 'Pragma': 'no-cache', 'Expires': '0' } : {}),
      'ETag': formatEtag(baseEtag, encoding),
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
      'Content-Length': body.length,
      ...mergeVary(responseCors(res))
    });
    if (req && req.method === 'HEAD') res.end();
    else res.end(body);
  }

  function sendStatic(req, res, ext, isHtmlJs, etag, entry, versioned) {
    const { body, encoding } = compressedStaticBody(entry, pickStaticEncoding(req, ext, entry.data.length));
    writeStaticResponse(req, res, ext, isHtmlJs, etag, versioned, body, encoding);
  }

  function sendStaticAsync(req, res, ext, isHtmlJs, etag, entry, versioned) {
    const wanted = pickStaticEncoding(req, ext, entry.data.length);
    compressedStaticBodyAsync(entry, wanted, ({ body, encoding }) => {
      writeStaticResponse(req, res, ext, isHtmlJs, etag, versioned, body, encoding);
    });
  }

  return {
    isPublicStaticPath,
    serveStatic,
    pickStaticEncoding,
    compressedStaticBody,
    sendStatic,
    getCacheBytes: () => staticFileCacheBytes
  };
}

module.exports = { createStaticService };
