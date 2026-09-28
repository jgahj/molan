const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const diffchecker = require('../pages/diffchecker.js');

test('MolanDiffChecker.tokenize 正确切分中文字符、英文字词、标点与空白', () => {
  const text = '在当今AI时代，我们必须去名词化与拆排比！';
  const tokens = diffchecker.tokenize(text);
  assert.ok(tokens.length > 10, 'Token 数量应准确分解');
  assert.ok(tokens.includes('在'));
  assert.ok(tokens.includes('AI'));
  assert.ok(tokens.includes('！'));
  assert.ok(tokens.includes('，'));
});

test('MolanDiffChecker.lcsTokenDiff 精确提取词级/字级删减与新增', () => {
  const origTokens = diffchecker.tokenize('这其实是一种非常重要的能力。');
  const revTokens = diffchecker.tokenize('这是关键能力。');
  const diff = diffchecker.lcsTokenDiff(origTokens, revTokens);

  const dels = diff.filter(d => d.type === 'del').map(d => d.val);
  const adds = diff.filter(d => d.type === 'add').map(d => d.val);
  const eqs = diff.filter(d => d.type === 'eq').map(d => d.val);

  assert.ok(eqs.includes('这是') || (eqs.includes('这') && eqs.includes('是')));
  assert.ok(dels.some(v => v.includes('其实') || v.includes('非常重要')));
  assert.ok(adds.some(v => v.includes('关键')));
});

test('MolanDiffChecker.alignLines 正确执行行对齐与增删占位', () => {
  const linesA = [
    '第一段：时代在召唤。',
    '第二段：我们必须做出改变。',
    '第三段：删去这一段。'
  ];
  const linesB = [
    '第一段：立即开始。',
    '第二段：我们要改。',
    '第四段：新增的一段。'
  ];

  const aligned = diffchecker.alignLines(linesA, linesB);
  assert.ok(aligned.length >= 3);

  // 第一段修改
  assert.equal(aligned[0].type, 'mod');
  assert.equal(aligned[0].lineA, 1);
  assert.equal(aligned[0].lineB, 1);

  // 统计数据
  const stats = diffchecker.computeStats(aligned, linesA.join('\n'), linesB.join('\n'));
  assert.ok(stats.delCount >= 1);
  assert.ok(stats.addCount >= 1);
  assert.equal(stats.origChars, linesA.join('\n').length);
  assert.equal(stats.revChars, linesB.join('\n').length);
});

test('MolanDiffChecker 并排 (Split) 与单栏 (Unified) HTML 渲染及 XSS 转义', () => {
  const aligned = [
    { type: 'mod', a: '旧文本 <script>alert(1)</script>', b: '新文本 <b>加粗</b>', lineA: 1, lineB: 1 },
    { type: 'eq', a: '不变的一行', b: '不变的一行', lineA: 2, lineB: 2 }
  ];

  const splitHtml = diffchecker.renderDiffSideBySide(aligned);
  assert.match(splitHtml, /mdc-table-split/);
  assert.match(splitHtml, /mdc-del/);
  assert.match(splitHtml, /mdc-ins/);
  assert.doesNotMatch(splitHtml, /<script>alert/);
  assert.match(splitHtml, /&lt;.*script.*&gt;/);

  const unifiedHtml = diffchecker.renderDiffUnified(aligned);
  assert.match(unifiedHtml, /mdc-table-unified/);
  assert.match(unifiedHtml, /mdc-uni-del/);
  assert.match(unifiedHtml, /mdc-uni-add/);
  assert.doesNotMatch(unifiedHtml, /<script>alert/);
});

test('pages/site.js 与 pages/tools.html 包含【进入对比工具】与【复制】双选择', () => {
  const siteCode = fs.readFileSync(path.join(__dirname, '../pages/site.js'), 'utf8');
  assert.match(siteCode, /id="ml-tool-diff"/);
  assert.match(siteCode, /进入对比工具/);
  assert.match(siteCode, /id="ml-tool-copy"/);
  assert.match(siteCode, /已复制全文/);
  assert.match(siteCode, /openDiffcheckerModal/);

  const toolsHtml = fs.readFileSync(path.join(__dirname, '../pages/tools.html'), 'utf8');
  assert.match(toolsHtml, /src="\.\/diffchecker\.js"/);
});

test('completion-platform.js 与 index.html 包含去 AI 味对比工具与复制全文入口', () => {
  const platformCode = fs.readFileSync(path.join(__dirname, '../completion-platform.js'), 'utf8');
  assert.match(platformCode, /data-c-action="tool-diff"/);
  assert.match(platformCode, /进入对比工具/);
  assert.match(platformCode, /已复制全文/);
  assert.match(platformCode, /openDiffcheckerModal/);

  const indexCode = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(indexCode, /toolDiffBtn/);
  assert.match(indexCode, /进入对比工具/);
  assert.match(indexCode, /已复制全文/);
});

test('工作台 (index.html 与 completion-platform.js) 路由 tools 统一重定向到独立工具页 pages/tools.html', () => {
  const indexCode = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.match(indexCode, /if\s*\(page === 'tools'\)\s*\{\s*window\.location\.href = '\.\/pages\/tools\.html'/);
  assert.match(indexCode, /if\s*\(targetPage === 'tools'\)\s*\{\s*window\.location\.href = '\.\/pages\/tools\.html'/);

  const platformCode = fs.readFileSync(path.join(__dirname, '../completion-platform.js'), 'utf8');
  assert.match(platformCode, /function toolsPage\(\)\s*\{\s*if\s*\(typeof window !== 'undefined' && window\.location\)\s*\{\s*window\.location\.href = '\.\/pages\/tools\.html'/);
  assert.match(platformCode, /if\s*\(page === 'tools'\)\s*\{\s*if\s*\(typeof window !== 'undefined' && window\.location\)\s*\{\s*window\.location\.href = '\.\/pages\/tools\.html'/);
});

test('pages/site.js 与 pages/tools.html 严格实施全功能登录后使用拦截与 redirect 回跳机制', () => {
  const siteCode = fs.readFileSync(path.join(__dirname, '../pages/site.js'), 'utf8');
  // 未登录提示与拦截
  assert.match(siteCode, /请先登录后使用 AI 工具/);
  assert.match(siteCode, /ROUTES\.login \+ '\?redirect=' \+ encodeURIComponent\(ROUTES\.tools \+ '\?tool='/);
  // ?tool= 直达未登录拦截
  assert.match(siteCode, /var q = new URLSearchParams\(location\.search\)\.get\('tool'\);/);
  // openWorkbench 未登录拦截
  assert.match(siteCode, /if \(!auth\.token\) \{\s*toast\('请先登录后使用 AI 工具'\);/);
  // 登录页 redirect 回跳支持
  assert.match(siteCode, /var redirect = new URLSearchParams\(location\.search\)\.get\('redirect'\);/);
  assert.match(siteCode, /var redirectParam = new URLSearchParams\(location\.search\)\.get\('redirect'\);/);

  const toolsHtml = fs.readFileSync(path.join(__dirname, '../pages/tools.html'), 'utf8');
  assert.match(toolsHtml, /登录后即可使用完整的 AI 写作工具/);
  assert.match(toolsHtml, /所有工具登录后即可使用/);
});

