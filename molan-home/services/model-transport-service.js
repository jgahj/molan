'use strict';

function createModelTransportService({ UPSTREAM_CONNECT_TIMEOUT_MS, UPSTREAM_IDLE_TIMEOUT_MS, http, https, providerUrlGuard, tls }) {
  function openUpstream(targetURL, proxyURL, reqOptions, cb) {
    const isLocalOrHost = /^(https?:\/\/)?(127\.0\.0\.1|localhost|8\.138\.128\.184|::1)(:\d+)?(\/|$)/i.test(targetURL);
    providerUrlGuard.validateProviderTarget(targetURL, { allowLocal: isLocalOrHost || Boolean(reqOptions && reqOptions.allowLocal) })
      .then(validated => openValidatedUpstream(validated, proxyURL, reqOptions, cb))
      .catch(error => cb(error));
  }

  function openValidatedUpstream(validatedTarget, proxyURL, reqOptions, cb) {
    const u = validatedTarget.url;
    const isHttps = u.protocol === 'https:';
    const port = validatedTarget.port;
    const tlsServername = require('node:net').isIP(validatedTarget.hostname) ? undefined : validatedTarget.hostname;
    const connectAddress = validatedTarget.addresses[0].address;
    const connectHost = validatedTarget.addresses[0].family === 6 ? `[${connectAddress}]` : connectAddress;
    const configureRequest = request => {
      let connected = false;
      const connectTimer = setTimeout(() => request.destroy(new Error('上游连接超时')), UPSTREAM_CONNECT_TIMEOUT_MS);
      request.once('socket', socket => {
        const clearConnectTimer = () => {
          if (connected) return;
          connected = true;
          clearTimeout(connectTimer);
        };
        if (socket.connecting) socket.once('connect', clearConnectTimer);
        else clearConnectTimer();
        socket.once('error', clearConnectTimer);
      });
      if (UPSTREAM_IDLE_TIMEOUT_MS > 0) request.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => request.destroy(new Error('上游响应空闲超时')));
      return request;
    };
  
    const client = isHttps ? https : http;
    if (!proxyURL) {
      const upstream = configureRequest(client.request({
        method: reqOptions.method || 'POST',
        hostname: validatedTarget.hostname, port,
        lookup: validatedTarget.lookup,
        ...(isHttps && tlsServername ? { servername: tlsServername } : {}),
        path: u.pathname + (u.search || ''),
        headers: reqOptions.headers
      }, reqOptions.onResponse));
      cb(null, upstream);
      return;
    }
  
    const p = new URL(proxyURL);
    if (p.protocol !== 'http:') throw new Error('MOLAN_PROXY 仅支持 http:// 代理地址');
    const proxyPort = p.port ? Number(p.port) : 80;
    const connectHeaders = {};
    if (p.username) {
      connectHeaders['Proxy-Authorization'] = 'Basic ' + Buffer.from(p.username + ':' + p.password).toString('base64');
    }
    let settled = false;
    const finish = (error, upstream) => {
      if (settled) return;
      settled = true;
      cb(error, upstream);
    };
    const connectReq = http.request({
      method: 'CONNECT',
      host: p.hostname,
      port: proxyPort,
      path: connectHost + ':' + port,
      headers: connectHeaders
    });
    connectReq.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS, () => connectReq.destroy(new Error('代理连接超时')));
    connectReq.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        finish(new Error('代理 CONNECT 失败: HTTP ' + res.statusCode));
        return;
      }
      if (head && head.length) socket.unshift(head);
      if (isHttps) {
        const tlsSocket = tls.connect({ socket, ...(tlsServername ? { servername: tlsServername } : {}), timeout: UPSTREAM_CONNECT_TIMEOUT_MS });
        tlsSocket.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS, () => tlsSocket.destroy(new Error('TLS 连接超时')));
        tlsSocket.once('secureConnect', () => {
          tlsSocket.removeAllListeners('timeout');
          if (UPSTREAM_IDLE_TIMEOUT_MS > 0) {
            tlsSocket.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => tlsSocket.destroy(new Error('上游响应空闲超时')));
          } else {
            tlsSocket.setTimeout(0);
          }
          const upstream = configureRequest(https.request({
            method: reqOptions.method || 'POST',
            hostname: validatedTarget.hostname, port,
            ...(tlsServername ? { servername: tlsServername } : {}),
            path: u.pathname + (u.search || ''),
            headers: reqOptions.headers,
            createConnection: () => tlsSocket
          }, reqOptions.onResponse));
          finish(null, upstream);
        });
        tlsSocket.once('error', error => finish(error));
        return;
      }
      socket.removeAllListeners('timeout');
      if (UPSTREAM_IDLE_TIMEOUT_MS > 0) {
        socket.setTimeout(UPSTREAM_IDLE_TIMEOUT_MS, () => socket.destroy(new Error('上游响应空闲超时')));
      } else {
        socket.setTimeout(0);
      }
      const upstream = configureRequest(http.request({
        method: reqOptions.method || 'POST',
        hostname: u.hostname, port,
        path: u.pathname + (u.search || ''),
        headers: reqOptions.headers,
        createConnection: () => socket
      }, reqOptions.onResponse));
      finish(null, upstream);
    });
    connectReq.once('error', error => finish(error));
    connectReq.end();
  }

  return { openUpstream, openValidatedUpstream };
}

module.exports = { createModelTransportService };
