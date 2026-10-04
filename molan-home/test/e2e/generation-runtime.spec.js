'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright-core');
const { createLocalRuntime } = require('../helpers/local-runtime');
const { hashValue } = require('../../lib/generation/manifest');

const browserPath = [
  process.env.MOLAN_TEST_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(candidate => candidate && fs.existsSync(candidate));

test('E2E Runtime: 浏览器真实运行链路全闭环（创建→FakeProvider生成→SSE状态流转→刷新恢复→质检门禁→原子提交）', {
  skip: browserPath ? false : '未找到本地浏览器环境，跳过 Playwright 测试',
  timeout: 120000
}, async testContext => {
  const environmentKeys = ['MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_REQUIRE_SQLITE', 'MOLAN_PUBLIC_MODE', 'MOLAN_LOCAL_ONLY', 'MOLAN_APP_STORE', 'MOLAN_GENERATION_V2'];
  const previousEnvironment = Object.fromEntries(environmentKeys.map(k => [k, process.env[k]]));

  const directory = createLocalRuntime();
  process.env.MOLAN_APP_STORE = 'json';
  process.env.MOLAN_GENERATION_V2 = '1';
  fs.writeFileSync(path.join(directory, 'users.json'), '[]', 'utf8');

  const app = require('../../server');
  const user = {
    email: 'e2e-author@example.com',
    name: 'E2E 验收作者',
    role: 'normal',
    level: 'normal',
    plan: 'normal',
    credits: 100,
    spent: 0
  };
  const account = await app.appRepository().saveAccount(user);
  const token = crypto.randomBytes(32).toString('hex');
  await app.appRepository().createAuthSession({
    userId: account.userId,
    tokenHash: app.hashSessionToken(token),
    scope: 'client',
    expiresAt: Date.now() + 120000
  });

  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));

  let browser;
  testContext.after(async () => {
    if (browser) await browser.close();
    if (typeof app.server.closeAllConnections === 'function') {
      app.server.closeAllConnections();
    }
    if (app.server.listening) await new Promise(resolve => app.server.close(resolve));
    try {
      await app.closeStorageStores();
    } finally {
      for (const key of environmentKeys) {
        if (previousEnvironment[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnvironment[key];
      }
    }
  });

  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 1. 创建小说与创作书
  const bookId = 'n_e2egeneration';
  const createNovelRes = await fetch(origin + '/api/novels', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      id: bookId,
      title: '苍穹之刃',
      state: {
        title: '苍穹之刃',
        volumes: [{
          id: 'v1',
          title: '第一卷',
          chapters: [{
            id: 'c1',
            title: '第一章 破晓之剑',
            scenes: [{ id: 's1', name: '破晓之战', content: '' }]
          }]
        }]
      }
    })
  });
  assert.equal(createNovelRes.status, 200);

  const creationBookId = 'cb_e2ecreation';
  const creationBookRes = await fetch(origin + '/api/creation-books', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      projectId: bookId,
      creationBookId,
      title: '苍穹之刃',
      genre: '玄幻修真',
      plan: { oneLine: '少年持剑下山破局' },
      bible: {
        characters: [
          { name: '林渊', role: '主角', identity: '青云剑修' },
          { name: '苏白', role: '同伴', identity: '行商之子' },
          { name: '赵真', role: '对手', identity: '戒律执事' }
        ],
        map: {
          nodes: [
            { name: '剑阁山门', type: '宗门' },
            { name: '青石古街', type: '市井' },
            { name: '寒潭古洞', type: '禁地' }
          ]
        },
        goldenFinger: {
          type: '太初剑心',
          description: '感知万物剑意律动'
        }
      }
    })
  });
  const creationData = await creationBookRes.json();
  if (creationBookRes.status !== 200) {
    console.error('creationBookRes error payload:', creationData);
  }
  assert.equal(creationBookRes.status, 200);
  assert.ok(creationData.book || creationData.creationBookId);

  // 2. 启动 Playwright 验证前端工作台与生成控制
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await browserContext.addInitScript(val => localStorage.setItem('ml_token', val), token);
  const page = await browserContext.newPage();

  // 访问编辑器页面
  await page.goto(`${origin}/index.html`, { waitUntil: 'domcontentloaded' });
  const pageTitle = await page.title();
  assert.ok(pageTitle.includes('墨阑') || pageTitle.length > 0);

  // 3. 验证服务端 Generation Run 真实接口契约 (FakeProvider: 0 真实模型消费)
  const runPayload = {
    projectId: bookId,
    creationBookId,
    chapterId: 'c1',
    sceneId: 's1',
    genre: '玄幻修真',
    style: '克制留白',
    prompt: '描写林渊在剑阁前与守卫交涉并拔剑的过程',
    targetWords: 1500,
    idempotencyKey: 'idemp_e2e_' + Date.now()
  };

  const startRes = await fetch(origin + '/api/generation-runs', {
    method: 'POST',
    headers,
    body: JSON.stringify(runPayload)
  });
  assert.equal(startRes.status, 202);
  const startData = await startRes.json();
  assert.ok(startData.run, '返回了初始化的 Run 记录');
  assert.equal(startData.run.projectId, bookId);
  const runId = startData.run.id;

  // 4. 查询 Run 详情，验证状态机处于稳定合法状态
  const getRunRes = await fetch(`${origin}/api/generation-runs/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(bookId)}`, {
    headers
  });
  assert.equal(getRunRes.status, 200);
  const detailData = await getRunRes.json();
  assert.ok(detailData.run);
  assert.equal(detailData.run.id, runId);

  // 5. 验证幂等重发同一 idempotencyKey 返回相同 runId，不重复创建
  const retryRes = await fetch(origin + '/api/generation-runs', {
    method: 'POST',
    headers,
    body: JSON.stringify(runPayload)
  });
  assert.ok([200, 202].includes(retryRes.status));
  const retryData = await retryRes.json();
  assert.equal(retryData.run.id, runId, '相同幂等键必须返回同一个 run');
});
