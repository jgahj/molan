'use strict';

function createHttpRequestService({ MAX_JSON_BODY_BYTES, responseCors, shouldFlushWrites, flushWrites }) {
  function requestError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
  }
  
  function decodePathParam(value) {
    try { return decodeURIComponent(String(value || '')); }
    catch (_) { throw requestError(400, '请求路径编码非法'); }
  }
  
  function respondError(res, error, fallbackStatus = 400) {
    const status = Number(error && error.status) || fallbackStatus;
    if (!res.headersSent) json(res, status, { error: error && error.message ? error.message : '请求失败' });
    else if (!res.writableEnded) { try { res.end(); } catch (_) {} }
  }
  
  function json(res, status, obj) {
    const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
    const send = (sendStatus = status, sendBody = body) => {
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      res.writeHead(sendStatus, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(sendBody),
        ...responseCors(res)
      });
      res.end(sendBody);
    };
    // PG 模式下 SQLite 只是可重建的同步兼容镜像。凡是请求触发了镜像写入，
    // 必须在返回成功响应前等到对应的 PostgreSQL 事务完成。
    const isRead = res.req && (res.req.method === 'GET' || res.req.method === 'HEAD');
    const isError = status >= 400;
    if (!isRead && !isError && shouldFlushWrites()) {
      const flush = flushWrites().then(
        () => ({ status: 'saved' }),
        () => ({ status: 'failed' })
      );
      let timeoutHandle;
      const safeTimeout = new Promise(resolve => {
        timeoutHandle = setTimeout(() => resolve({ status: 'timeout' }), 30000);
      });
      void Promise.race([flush, safeTimeout]).then(result => {
        clearTimeout(timeoutHandle);
        if (result.status === 'saved') return send();
        const message = result.status === 'timeout'
          ? 'PostgreSQL 写回超时，数据持久化状态未确认，请先刷新后再重试'
          : 'PostgreSQL 写回失败，数据持久化未确认';
        send(503, JSON.stringify({ error: message }));
      });
      return;
    }
    send();
  }
  
  function readBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        req.resume();
        reject(requestError(413, '请求体过大，单次最多支持 ' + Math.floor(maxBytes / 1024 / 1024) + ' MB'));
        return;
      }
      const chunks = [];
      let total = 0;
      let settled = false;
      const fail = error => {
        if (settled) return;
        settled = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.resume();
        reject(error);
      };
      const onData = chunk => {
        if (settled) return;
        total += chunk.length;
        if (total > maxBytes) { fail(requestError(413, '请求体过大，单次最多支持 ' + Math.floor(maxBytes / 1024 / 1024) + ' MB')); return; }
        chunks.push(chunk);
      };
      const onEnd = () => {
        if (settled) return;
        settled = true;
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
        catch (_) { reject(requestError(400, '请求体不是合法 JSON')); }
      };
      req.on('data', onData);
      req.on('end', onEnd);
      req.on('error', error => fail(error));
      req.on('aborted', () => fail(requestError(400, '请求已中断')));
    });
  }
  return { requestError, decodePathParam, respondError, json, readBody };
}

module.exports = { createHttpRequestService };
