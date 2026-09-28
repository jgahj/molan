const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.MOLAN_DATA_DIR = fsTempDir();
process.env.MOLAN_CONFIG_DIR = process.env.MOLAN_DATA_DIR;
process.env.MOLAN_LOCAL_ONLY = '0';
process.env.MOLAN_REQUIRE_SQLITE = '0';
process.env.MOLAN_PUBLIC_MODE = '0';

let upstream;
let app;
let upstreamBase = '';
let appBase = '';
const requests = [];

/** 创建临时目录，隔离代理测试与本地账户数据。 */
function fsTempDir() {
  const fs = require('node:fs');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'molan-cloud-proxy-'));
}

/** 启动 HTTP 服务并返回实际监听地址。 */
function listen(server, host) {
  return new Promise(resolve => server.listen(0, host, () => resolve(server.address())));
}

/** 读取代理接口的响应文本和状态，兼容 JSON 与 SSE。 */
async function request(pathname, options) {
  const response = await fetch(appBase + pathname, options);
  return { response, text: await response.text() };
}

test.before(async () => {
  upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
      const isStream = req.headers.accept === 'text/event-stream';
      const body = isStream
        ? 'data: {"choices":[{"delta":{"content":"云端流式内容"}}]}\n\ndata: [DONE]\n\n'
        : JSON.stringify({ ok: true, source: 'upstream', method: req.method, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'Content-Type': isStream ? 'text/event-stream' : 'application/json', 'X-Upstream-Test': 'yes' });
      res.end(body);
    });
  });
  const upstreamAddress = await listen(upstream, '127.0.0.1');
  upstreamBase = 'http://127.0.0.1:' + upstreamAddress.port;
  process.env.MOLAN_CLOUD_API_BASE = upstreamBase;
  ({ server: app } = require('../server'));
  const appAddress = await listen(app, '127.0.0.1');
  appBase = 'http://127.0.0.1:' + appAddress.port;
});

test.after(async () => {
  await new Promise(resolve => app.close(resolve));
  await new Promise(resolve => upstream.close(resolve));
});

test('local sync status exposes cloud data mode without syncing project code', async () => {
  const result = await request('/api/local-sync/status');
  assert.equal(result.response.status, 200);
  const body = JSON.parse(result.text);
  assert.equal(body.mode, 'cloud-proxy');
  assert.equal(body.dataSource, 'cloud');
  assert.equal(body.codeSync, false);
  assert.equal(body.cloudApiBase, upstreamBase);
  assert.match(body.message, /项目代码仍来自本地工作区/);
  assert.equal(requests.length, 0);
});

test('benchmark execution rejects cloud proxy mode before forwarding', async () => {
  const count = requests.length;
  const result = await request('/api/benchmark/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(result.response.status, 409);
  assert.equal(requests.length, count);
});

test('proxy forwards authenticated GET and JSON POST while keeping the local response boundary', async () => {
  const getResult = await request('/api/health?from=local', { headers: { Authorization: 'Bearer cloud-token' } });
  assert.equal(getResult.response.status, 200);
  assert.equal(getResult.response.headers.get('x-molan-data-source'), 'cloud');
  assert.equal(JSON.parse(getResult.text).source, 'upstream');

  const postResult = await request('/api/novels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer cloud-token' },
    body: JSON.stringify({ title: '本地调试作品' })
  });
  assert.equal(postResult.response.status, 200);
  const postRequest = requests.find(item => item.method === 'POST' && item.url === '/api/novels');
  assert.equal(postRequest.authorization, 'Bearer cloud-token');
  assert.deepEqual(JSON.parse(postRequest.body), { title: '本地调试作品' });
});

test('proxy preserves streaming responses for local AI debugging', async () => {
  const result = await request('/api/chat', {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '测试' }] })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('content-type'), 'text/event-stream');
  assert.match(result.text, /云端流式内容/);
});
