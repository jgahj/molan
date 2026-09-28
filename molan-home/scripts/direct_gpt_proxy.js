const http = require('http');
const net = require('net');

const LISTEN_HOST = process.env.MOLAN_DIRECT_PROXY_HOST || '127.0.0.1';
const LISTEN_PORT = Number(process.env.MOLAN_DIRECT_PROXY_PORT || 7897);
const TARGET_HOST = process.env.MOLAN_DIRECT_PROXY_TARGET_HOST || '192.220.47.188';
const TARGET_PORT = Number(process.env.MOLAN_DIRECT_PROXY_TARGET_PORT || 8080);

function parseTarget(value) {
  const raw = String(value || '').trim();
  const separator = raw.lastIndexOf(':');
  if (separator <= 0) return null;
  const host = raw.slice(0, separator).replace(/^\[/, '').replace(/\]$/, '');
  const port = Number(raw.slice(separator + 1));
  if (!host || !port) return null;
  return { host, port };
}

function reject(socket, statusCode, statusText) {
  try {
    socket.end(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\n\r\n`);
  } catch (_) {}
}

const server = http.createServer((req, res) => {
  let target;
  try { target = new URL(req.url); } catch (_) {
    res.writeHead(400, { Connection: 'close' });
    res.end('Bad Request');
    return;
  }
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const headers = { ...req.headers };
  delete headers.connection;
  delete headers['proxy-connection'];
  headers.host = target.host;
  const transport = target.protocol === 'https:' ? require('https') : http;
  const upstream = transport.request({
    method: req.method,
    hostname: target.hostname,
    port,
    path: target.pathname + target.search,
    headers,
    timeout: 0
  }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.setTimeout(0);
  upstream.once('error', () => {
    if (!res.headersSent) res.writeHead(502, { Connection: 'close' });
    res.end();
  });
  req.pipe(upstream);
});

server.on('connect', (request, clientSocket, head) => {
  const target = parseTarget(request.url);
  if (!target) {
    reject(clientSocket, 400, 'Bad Request');
    return;
  }
  const upstream = net.connect(target.port, target.host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  clientSocket.setTimeout(0);
  upstream.setTimeout(0);
  const closeBoth = () => {
    try { clientSocket.destroy(); } catch (_) {}
    try { upstream.destroy(); } catch (_) {}
  };
  clientSocket.once('error', closeBoth);
  upstream.once('error', closeBoth);
});

server.on('clientError', (_error, socket) => reject(socket, 400, 'Bad Request'));
server.maxConnections = 64;
server.timeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 0;
server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`Molan direct GPT relay listening on ${LISTEN_HOST}:${LISTEN_PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
