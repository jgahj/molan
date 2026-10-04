'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright-core');

const browserPath = [
  process.env.MOLAN_TEST_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(candidate => candidate && fs.existsSync(candidate));

test('E2E Design System: 页面真实挂载 tokens.css 与深浅色主题切换', {
  skip: browserPath ? false : '未找到本地浏览器环境，跳过 Playwright 测试',
  timeout: 60000
}, async testContext => {
  const rootDir = path.resolve(__dirname, '..', '..');

  // 极轻量静态文件服务器托管 pages/ 静态页面
  const server = http.createServer((req, res) => {
    const rawUrl = new URL(req.url, 'http://127.0.0.1');
    const safePath = path.normalize(path.join(rootDir, rawUrl.pathname));
    if (!safePath.startsWith(rootDir) || !fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(safePath).toLowerCase();
    const contentType = ext === '.html' ? 'text/html; charset=utf-8'
      : ext === '.css' ? 'text/css; charset=utf-8'
      : ext === '.js' ? 'application/javascript; charset=utf-8'
      : 'text/plain';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(safePath));
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  let browser;
  testContext.after(async () => {
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });

  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  const page = await browser.newPage();

  // 1. 访问 novels.html 并验证 tokens 渲染
  await page.goto(`http://127.0.0.1:${port}/pages/novels.html`);

  const initialLightStyles = await page.evaluate(() => {
    const style = window.getComputedStyle(document.documentElement);
    return {
      canvas: style.getPropertyValue('--canvas').trim(),
      paper: style.getPropertyValue('--paper').trim(),
      ink: style.getPropertyValue('--ink').trim()
    };
  });

  assert.equal(initialLightStyles.canvas.toLowerCase(), '#f3f3f0');
  assert.equal(initialLightStyles.paper.toLowerCase(), '#ffffff');

  // 2. 动态触发深色主题切换，验证 tokens 响应
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
  });

  const darkStyles = await page.evaluate(() => {
    const style = window.getComputedStyle(document.documentElement);
    return {
      canvas: style.getPropertyValue('--canvas').trim(),
      paper: style.getPropertyValue('--paper').trim(),
      ink: style.getPropertyValue('--ink').trim()
    };
  });

  assert.equal(darkStyles.canvas.toLowerCase(), '#171716');
  assert.equal(darkStyles.paper.toLowerCase(), '#242422');

  // 3. 访问 skills.html 验证 unified tokens
  await page.goto(`http://127.0.0.1:${port}/pages/skills.html`);
  const skillsTokens = await page.evaluate(() => {
    const style = window.getComputedStyle(document.documentElement);
    return {
      green: style.getPropertyValue('--green').trim(),
      amber: style.getPropertyValue('--amber').trim(),
      radiusMd: style.getPropertyValue('--radius-md').trim()
    };
  });

  assert.equal(skillsTokens.green.toLowerCase(), '#25845a');
  assert.equal(skillsTokens.amber.toLowerCase(), '#a86b20');
  assert.equal(skillsTokens.radiusMd, '6px');
});
