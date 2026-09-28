/**
 * 马良写作 Clone —— 零依赖 Node 服务
 * 1) 托管 public/ 下的前端静态文件
 * 2) /api/chat 作为 DeepSeek 代理，密钥仅存在于服务端，前端绝不接触
 *
 * 启动： node server.js   （或 npm start）
 * 默认端口 3000，可用 PORT 环境变量覆盖
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
// ⚠️ 安全：密钥只留在服务端。生产环境请改用环境变量 DEEPSEEK_API_KEY。
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || 'sk-e6f2c4187bbc46bda12037e4ca9d65e0';
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('请求体不是合法 JSON')); }
    });
    req.on('error', reject);
  });
}

function handleChat(req, res) {
  readBody(req)
    .then(payload => {
      const model = payload.model || 'deepseek-chat';
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (!messages.length) throw new Error('messages 不能为空');
      const temperature = typeof payload.temperature === 'number' ? payload.temperature : 0.85;
      const max_tokens = payload.max_tokens || 2000;

      const body = JSON.stringify({ model, messages, stream: true, temperature, max_tokens });
      const u = new URL(DEEPSEEK_URL);
      const options = {
        method: 'POST',
        hostname: u.hostname,
        path: u.pathname,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + DEEPSEEK_KEY,
          'Accept': 'text/event-stream'
        }
      };

      const upstream = https.request(options, upRes => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*'
        });
        upRes.pipe(res);
      });

      upstream.on('error', e => {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '上游模型调用失败：' + e.message }));
      });

      // 客户端断开时中止上游请求，避免浪费额度
      req.on('close', () => { try { upstream.destroy(); } catch (_) {} });

      upstream.write(body);
      upstream.end();
    })
    .catch(e => {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: e.message }));
    });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === '/api/chat') return handleChat(req, res);
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, key: DEEPSEEK_KEY ? 'set' : 'missing' }));
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
    });
    return res.end();
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('🖌  马良写作 Clone 已启动 → http://localhost:' + PORT);
});
