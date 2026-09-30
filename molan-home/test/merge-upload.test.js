// 回归验证：网页端旧版「省Token」通道已移除，AI 请求只能进入统一计费接口。
const fs = require('fs');
const path = require('path');

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const app = read('app.js');
const home = read('index.html');
const server = read('server.js');
const generationRoutes = read('routes/generation.js');

function check(name, condition) {
  if (!condition) {
    console.error('FAIL: ' + name);
    process.exit(1);
  }
  console.log('PASS: ' + name);
}

check('主页没有旧网页 AI 按钮', !home.includes('webModeBtn'));
check('主页脚本没有旧网页 AI 分支', !app.includes('/api/web-chat') && !app.includes('webMode'));
check('旧网页 AI POST 接口明确关闭', server.includes("json(res, 410, { error: '网页版 AI 已关闭"));
check('统一模型接口仍由 /api/chat 处理', generationRoutes.includes("method === 'POST' && url === '/api/chat'") && server.includes('generation: createGenerationRoutes(') && server.includes('domainRoutes.generation.dispatchCore(req, res, u)'));

console.log('网页 AI 计费绕过回归检查通过');
