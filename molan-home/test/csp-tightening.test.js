'use strict';

/**
 * CSP 收紧专项测试（2026-10-15）：
 * script-src 移除 'unsafe-inline' 的前提是全部内联脚本已外移。
 * 本文件守住三条红线：
 *   1. server.js 两处 CSP 的 script-src 均为 'self'（style-src 保留
 *      'unsafe-inline'：内联 style 属性 + Tailwind 浏览器版运行时注入样式）；
 *   2. 全部对外 HTML 不得残留内联 <script> 块 / javascript: URI / 行内 on* 处理器；
 *   3. 外移产物（boot-head.js、boot-scripts.js、pages/js/*.js）存在且被带 ?v= 引用。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readHtmlFiles() {
  const files = [];
  for (const f of fs.readdirSync(ROOT)) {
    if (f.endsWith('.html')) files.push(path.join(ROOT, f));
  }
  const pagesDir = path.join(ROOT, 'pages');
  for (const f of fs.readdirSync(pagesDir)) {
    if (f.endsWith('.html')) files.push(path.join(pagesDir, f));
  }
  return files;
}

test('CSP：两处定义的 script-src 均为 self（不含 unsafe-inline），style-src 保留 unsafe-inline', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // 覆盖两种写法：对象字面量 'Content-Security-Policy': "..." 与 headers['Content-Security-Policy'] = "..."
  const policies = server.match(/"[^"]*script-src[^"]*"/g) || [];
  assert.ok(policies.length >= 2, 'server.js 应至少有两处 CSP 定义（同源 + 跨源放宽）');
  for (const policy of policies) {
    const m = policy.match(/script-src ([^;"]*)/);
    assert.ok(m, `CSP 缺少 script-src 指令：${policy}`);
    assert.ok(!m[1].includes('unsafe-inline'), `script-src 不得包含 unsafe-inline：${m[1]}`);
    assert.match(m[1], /'self'/);
  }
  assert.ok(server.includes("style-src 'self' 'unsafe-inline'"), 'style-src 应保留 unsafe-inline（内联样式与 Tailwind 运行时注入）');
});

test('CSP：全部 HTML 无内联脚本块、无 javascript: URI、无行内 on* 事件处理器', () => {
  const htmlFiles = readHtmlFiles();
  assert.ok(htmlFiles.length >= 15, `应覆盖根目录与 pages/ 下全部 HTML，实际 ${htmlFiles.length} 个`);
  for (const file of htmlFiles) {
    const rel = path.relative(ROOT, file);
    const html = fs.readFileSync(file, 'utf8');
    // 1. 每个 <script> 标签必须带 src（外移后不应有无 src 的内联块）
    const scriptTags = html.match(/<script\b[^>]*>/g) || [];
    for (const tag of scriptTags) {
      assert.match(tag, /\bsrc=/, `${rel} 存在无 src 的内联脚本标签：${tag}`);
    }
    // 2. 标签内不得出现 javascript: URI（正文散文提及不算）
    const tags = html.match(/<[a-zA-Z][^>]*>/g) || [];
    for (const tag of tags) {
      assert.ok(!/javascript:/i.test(tag), `${rel} 标签残留 javascript: URI：${tag}`);
      // 3. 标签内不得出现行内 on* 事件处理器（data-on-* / aria-* 不受影响：前缀非空白+on）
      assert.ok(!/\son[a-z]+\s*=/i.test(tag), `${rel} 标签残留行内 on* 事件处理器：${tag}`);
    }
  }
});

test('CSP：外移产物存在且被带版本戳引用', () => {
  // 1. 引导脚本：index.html 以 ?v= 引用，文件存在
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const f of ['boot-head.js', 'boot-scripts.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} 必须存在`);
    assert.ok(html.includes(`./${f}?v=`), `index.html 必须以 ?v= 引用 ./${f}`);
  }
  // 2. 页面脚本：pages/js/<slug>.js 存在且被对应 HTML 以 ?v= 引用
  const PAGE_SCRIPTS = {
    'about.html': 'about.js',
    'admin-login.html': 'admin-login.js',
    'blog.html': 'blog.js',
    'contact.html': 'contact.js',
    'docs.html': 'docs.js',
    'editor.html': 'editor.js',
    'features.html': 'features.js',
    'login.html': 'login.js',
    'pricing.html': 'pricing.js',
    'quality-evolution-report.html': 'quality-evolution-report.js',
    'tools.html': 'tools.js'
  };
  for (const [htmlName, jsName] of Object.entries(PAGE_SCRIPTS)) {
    const jsPath = path.join(ROOT, 'pages', 'js', jsName);
    assert.ok(fs.existsSync(jsPath), `pages/js/${jsName} 必须存在`);
    const pageHtml = fs.readFileSync(path.join(ROOT, 'pages', htmlName), 'utf8');
    assert.ok(pageHtml.includes(`./js/${jsName}?v=`), `pages/${htmlName} 必须以 ?v= 引用 ./js/${jsName}`);
  }
  // 3. login 页提交守卫（原 onsubmit 外移后的等价物）
  const loginJs = fs.readFileSync(path.join(ROOT, 'pages', 'js', 'login.js'), 'utf8');
  assert.match(loginJs, /getElementById\('loginForm'\)/);
  assert.match(loginJs, /addEventListener\('submit'[\s\S]*preventDefault/);
});

test('CSP：引导脚本与页面脚本均通过语法检查可解析', () => {
  const { execFileSync } = require('node:child_process');
  const candidates = [
    path.join(ROOT, 'boot-head.js'),
    path.join(ROOT, 'boot-scripts.js'),
    ...fs.readdirSync(path.join(ROOT, 'pages', 'js')).map(f => path.join(ROOT, 'pages', 'js', f))
  ].filter(f => f.endsWith('.js'));
  for (const file of candidates) {
    execFileSync(process.execPath, ['--check', file]);
  }
  assert.ok(candidates.length >= 13, `至少 13 个外移脚本，实际 ${candidates.length}`);
});
