'use strict';

function createStaticService({ MIME, PUBLIC_DIR, PUBLIC_ROOT_FILES, STATIC_CACHE_MAX_BYTES, STATIC_COMPRESSIBLE_EXT, STATIC_COMPRESS_MIN_BYTES, fs, path, responseCors, zlib }) {
  const staticFileCache = new Map();
  let staticFileCacheBytes = 0;

  function isPublicStaticPath(normalizedPath) {
    return PUBLIC_ROOT_FILES.has(normalizedPath) || normalizedPath === '/pages' || normalizedPath.startsWith('/pages/');
  }

  function serveStatic(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch (_) { res.writeHead(400, responseCors(res)); res.end('Bad Request'); return; }
    if (urlPath === '/') urlPath = '/index.html';
    // 带 ?v= 版本参数的静态资源视为不可变，可长缓存；HTML 始终协商缓存。
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
      const etag = '"' + Math.floor(stat.mtimeMs).toString(16) + '-' + stat.size.toString(16) + '"';
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ETag: etag, ...responseCors(res) }); res.end(); return;
      }
      const cached = staticFileCache.get(filePath);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        staticFileCache.delete(filePath);
        staticFileCache.set(filePath, cached);
        return sendStatic(req, res, ext, isHtmlJs, etag, cached, versioned);
      }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404, responseCors(res)); res.end('Not Found'); return; }
        const entry = { mtimeMs: stat.mtimeMs, size: stat.size, data };
        if (STATIC_CACHE_MAX_BYTES > 0 && data.length <= STATIC_CACHE_MAX_BYTES) {
          const previous = staticFileCache.get(filePath);
          if (previous) staticFileCacheBytes -= previous.data.length;
          staticFileCache.delete(filePath);
          staticFileCache.set(filePath, entry);
          staticFileCacheBytes += data.length;
          while (staticFileCacheBytes > STATIC_CACHE_MAX_BYTES && staticFileCache.size) {
            const oldestPath = staticFileCache.keys().next().value;
            const oldest = staticFileCache.get(oldestPath);
            staticFileCache.delete(oldestPath);
            staticFileCacheBytes -= oldest ? oldest.data.length : 0;
          }
        }
        sendStatic(req, res, ext, isHtmlJs, etag, entry, versioned);
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

  function compressedStaticBody(entry, encoding) {
    if (!encoding) return { body: entry.data, encoding: '' };
    entry.compressed = entry.compressed || {};
    if (!entry.compressed[encoding]) {
      try {
        entry.compressed[encoding] = encoding === 'br'
          ? zlib.brotliCompressSync(entry.data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
          : zlib.gzipSync(entry.data, { level: 6 });
      } catch (_) { entry.compressed[encoding] = entry.data; }
    }
    const body = entry.compressed[encoding];
    if (!body || body.length >= entry.data.length) return { body: entry.data, encoding: '' };
    return { body, encoding };
  }

  function sendStatic(req, res, ext, isHtmlJs, etag, entry, versioned) {
    const isHtml = /^\.html?$/.test(ext);
    const { body, encoding } = compressedStaticBody(entry, pickStaticEncoding(req, ext, entry.data.length));
    let cacheControl;
    if (isHtml) cacheControl = 'public, max-age=0, must-revalidate';
    else if (versioned) cacheControl = 'public, max-age=31536000, immutable';
    else cacheControl = isHtmlJs ? 'public, max-age=0, must-revalidate' : 'public, max-age=86400';
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': cacheControl,
      'ETag': etag,
      'Vary': 'Accept-Encoding',
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
      'Content-Length': body.length,
      ...responseCors(res)
    });
    res.end(body);
  }

  return { isPublicStaticPath, serveStatic, pickStaticEncoding, compressedStaticBody, sendStatic };
}

module.exports = { createStaticService };
