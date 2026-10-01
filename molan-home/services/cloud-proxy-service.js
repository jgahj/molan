'use strict';
const http = require('node:http');
const https = require('node:https');

function createCloudProxyService({ CLOUD_API_BASE, CLOUD_API_BASE_ERROR, DISSECTION_MAX_BODY_BYTES, MAX_JSON_BODY_BYTES, UPSTREAM_IDLE_TIMEOUT_MS, json, readBody, responseCors }) {
  /** 判断请求是否应由本地服务代理到云端，保留本地同步状态接口不经过代理。 */
  function shouldProxyCloudRequest(req) {
    if (!CLOUD_API_BASE || !req) return false;
    const pathname = String(req.url || '').split('?')[0];
    return pathname.startsWith('/api/') && pathname !== '/api/local-sync/status';
  }

  /** 为云端代理选择与现有接口一致的 JSON 请求体上限。 */
  function cloudProxyBodyLimit(requestUrl) {
    const pathname = String(requestUrl || '').split('?')[0];
    return pathname === '/api/dissection/extract' || pathname.startsWith('/api/dissections') || pathname.startsWith('/api/dissection/')
      ? DISSECTION_MAX_BODY_BYTES
      : MAX_JSON_BODY_BYTES;
  }

  /** 返回本地调试数据来源状态，明确区分云端数据代理和本地数据模式。 */
  function handleLocalSyncStatus(req, res) {
    const configured = !!CLOUD_API_BASE;
    json(res, 200, {
      ok: true,
      mode: configured ? 'cloud-proxy' : 'local',
      dataSource: configured ? 'cloud' : 'local',
      cloudConfigured: configured,
      cloudApiBase: configured ? CLOUD_API_BASE : '',
      cloudConfigError: CLOUD_API_BASE_ERROR || '',
      codeSync: false,
      message: configured ? '本地页面和账户数据使用云端 API，项目代码仍来自本地工作区' : '当前使用本地数据，未连接云端'
    });
  }

  /** 将本地 API 请求转发到云端并保留 JSON、SSE 和文件下载响应。 */
  function handleCloudProxy(req, res) {
    let target;
    try {
      const incoming = new URL(req.url, 'http://molan.local');
      target = new URL(CLOUD_API_BASE);
      target.pathname = incoming.pathname;
      target.search = incoming.search;
    } catch (_) {
      return json(res, 502, { error: '云端同步地址不可用' });
    }

    const methodsWithBody = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const bodyPromise = methodsWithBody.has(String(req.method || '').toUpperCase())
      ? readBody(req, cloudProxyBodyLimit(req.url)).then(body => Buffer.from(JSON.stringify(body), 'utf8'))
      : Promise.resolve(null);

    bodyPromise.then(body => new Promise((resolve, reject) => {
      const transport = target.protocol === 'https:' ? https : http;
      const headers = {};
      ['accept', 'content-type', 'authorization', 'x-requested-with', 'range', 'if-none-match', 'user-agent'].forEach(name => {
        const value = req.headers[name];
        if (value !== undefined) headers[name] = value;
      });
      if (body) {
        headers['content-type'] = headers['content-type'] || 'application/json';
        headers['content-length'] = String(body.length);
      }

      const agent = target.protocol === 'https:'
        ? new https.Agent({ keepAlive: true, timeout: 300000 })
        : new http.Agent({ keepAlive: true, timeout: 300000 });

      const upstream = transport.request({
        method: req.method,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + target.search,
        headers,
        agent
      }, upstreamResponse => {
        const forwarded = {};
        const blocked = new Set([
          'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
          'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-headers', 'access-control-allow-methods',
          'access-control-expose-headers', 'content-security-policy', 'x-frame-options', 'cross-origin-resource-policy'
        ]);
        Object.entries(upstreamResponse.headers).forEach(([name, value]) => {
          if (!blocked.has(name.toLowerCase()) && value !== undefined) forwarded[name.toLowerCase()] = value;
        });
        Object.entries(responseCors(res)).forEach(([name, value]) => { forwarded[name.toLowerCase()] = value; });
        forwarded['cache-control'] = 'no-store';
        forwarded['x-molan-data-source'] = 'cloud';
        const isSse = String(upstreamResponse.headers['content-type'] || '').includes('text/event-stream');
        if (isSse) forwarded['connection'] = 'keep-alive';
        res.writeHead(upstreamResponse.statusCode || 502, forwarded);

        let heartbeatTimer = null;
        if (isSse) {
          let lastActivity = Date.now();
          upstreamResponse.on('data', () => { lastActivity = Date.now(); });
          heartbeatTimer = setInterval(() => {
            if (res.writableEnded || res.destroyed) {
              if (heartbeatTimer) clearInterval(heartbeatTimer);
              return;
            }
            if (Date.now() - lastActivity >= 10000) {
              try { res.write(': keep-alive\n\n'); } catch (_) { if (heartbeatTimer) clearInterval(heartbeatTimer); }
            }
          }, 5000);
          heartbeatTimer.unref();
        }
        const cleanupHeartbeat = () => {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
          }
        };

        upstreamResponse.on('error', error => {
          cleanupHeartbeat();
          if (!res.writableEnded) res.destroy(error);
        });
        upstreamResponse.once('end', cleanupHeartbeat);
        upstreamResponse.once('close', cleanupHeartbeat);
        res.once('close', cleanupHeartbeat);
        upstreamResponse.pipe(res);
        resolve();
      });
      if (UPSTREAM_IDLE_TIMEOUT_MS > 0) upstream.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => upstream.destroy(new Error('云端响应空闲超时')));
      upstream.once('error', error => {
        if (res.headersSent) {
          if (!res.writableEnded) res.destroy(error);
          return;
        }
        reject(error);
      });
      res.once('close', () => { if (!res.writableEnded) upstream.destroy(); });
      if (body) upstream.end(body); else upstream.end();
    })).catch(error => {
      if (res.destroyed || res.writableEnded) return;
      const detail = error && error.message ? String(error.message).slice(0, 160) : '连接失败';
      json(res, 502, { error: '云端数据服务暂时不可用，请检查本地云端同步配置', detail });
    });
  }
  return { shouldProxyCloudRequest, cloudProxyBodyLimit, handleLocalSyncStatus, handleCloudProxy };
}

module.exports = { createCloudProxyService };
