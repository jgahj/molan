'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createLocalRuntime } = require('./helpers/local-runtime');
const materialSchema = require('../lib/project-material-schema');

const browserPath = [
  process.env.MOLAN_TEST_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].find(candidate => candidate && fs.existsSync(candidate));

test('真实浏览器：正文候选→提取→确认→正式提交→投影同步→刷新与文风版本', {
  skip: browserPath ? false : '未找到本地浏览器；不下载依赖', timeout: 120000
}, async context => {
  const environmentKeys = ['MOLAN_DATA_DIR', 'MOLAN_CONFIG_DIR', 'MOLAN_REQUIRE_SQLITE', 'MOLAN_PUBLIC_MODE', 'MOLAN_LOCAL_ONLY', 'MOLAN_APP_STORE'];
  const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  const directory = createLocalRuntime();
  process.env.MOLAN_APP_STORE = 'json';
  fs.writeFileSync(path.join(directory, 'users.json'), '[]', 'utf8');
  const app = require('../server');
  const user = { email: 'workbench-browser@example.com', name: '工作台验收作者', role: 'normal', level: 'normal', plan: 'normal', credits: 10, spent: 0 };
  const account = await app.appRepository().saveAccount(user);
  const token = crypto.randomBytes(32).toString('hex');
  await app.appRepository().createAuthSession({ userId: account.userId, tokenHash: app.hashSessionToken(token),
    scope: 'client', expiresAt: Date.now() + 120000 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let browser;
  context.after(async () => {
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
  const bookId = 'n_workbenchbrowser';
  const created = await fetch(origin + '/api/novels', { method: 'POST', headers, body: JSON.stringify({
    id: bookId, title: '江湖记事', state: { title: '江湖记事', volumes: [{ id: 'volume', title: '第一卷', chapters: [{
      id: 'chapter', title: '第一章', scenes: [{ id: 'scene', name: '渡口', content: '<p>旧稿正文。</p>' }]
    }] }] }
  }) });
  assert.equal(created.status, 200);
  browser = await chromium.launch({ executablePath: browserPath, headless: true });
  const browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await browserContext.addInitScript(value => localStorage.setItem('ml_token', value), token);
  const page = await browserContext.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text() + ' ' + JSON.stringify(message.location()));
  });
  page.on('response', response => {
    if (response.status() >= 400) errors.push(response.status() + ' ' + response.url());
  });
  await page.goto(origin + '/pages/story-workbench.html?nid=' + bookId);
  assert.equal(new URL(page.url()).pathname, '/pages/story-workbench.html');
  assert.equal(await page.title(), '故事记忆与文风工作台 · 墨阑');
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('故事状态'));
  assert.match(await page.locator('body').innerText(), /版本化正文与记忆确认/);
  assert.match(await page.locator('#original').textContent(), /旧稿正文/);
  await page.locator('#draft').fill('师妹接过玉佩。\n老者说：“你师父已经死了。”');
  await page.locator('#saveDraft').click();
  await page.waitForFunction(() => document.querySelector('#draftStatus').textContent.includes('已保存候选版本 1'));
  await page.locator('#rewriteConstraints summary').click();
  await page.locator('#rewriteLockedPropositions').fill('主角已经杀死师父');
  await page.locator('#rewriteForbiddenAnswers').fill('师父确已死亡');
  await page.locator('#checkRewrite').click();
  await page.waitForFunction(() => document.querySelector('#rewriteReport').textContent.includes('约束冲突'));
  assert.equal(await page.locator('#createChangeset').isDisabled(), true);
  await page.locator('#rewriteLockedPropositions').fill('师妹接过玉佩');
  await page.locator('#checkRewrite').click();
  await page.waitForFunction(() => document.querySelector('#rewriteReport').textContent.includes('约束检查通过'));
  assert.equal(await page.locator('#createChangeset').isDisabled(), false);
  await page.locator('#extract').click();
  await page.waitForSelector('[data-fact]');
  assert.ok((await page.locator('#extraction').textContent()).includes('claim'));
  page.once('dialog', dialog => dialog.accept('作者核对：玉佩确已交付，不确认老者说法'));
  await page.locator('[data-fact]').first().click();
  await page.waitForFunction(() => document.querySelector('#operationsInput').value.includes('INSERT_FACT'));
  await page.locator('#createChangeset').click();
  await page.waitForSelector('#review:not([hidden])');
  await page.locator('#authorConfirm').check();
  await page.locator('#approve').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('作者确认已记录'));
  await page.locator('#commit').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('正文与记忆已提交'));
  await page.locator('[data-tab="operations"]').click();
  const factId = await page.evaluate(async book => {
    const response = await fetch('/api/books/' + book + '/memory', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('ml_token') }
    });
    const result = await response.json();
    return result.memory[0] && result.memory[0].id;
  }, bookId);
  assert.ok(factId);
  await page.locator('#impactType').selectOption('fact');
  await page.locator('#impactTarget').fill(factId);
  await page.locator('#analyzeImpact').click();
  await page.waitForFunction(() => document.querySelector('#impactAnalysisReport').textContent.includes('totalImpactCount'));
  assert.match(await page.locator('#impactAnalysisReport').textContent(), new RegExp(factId));
  await page.locator('#process').click();
  await page.waitForFunction(() => document.querySelector('#projectionReport').textContent.includes('"synced": true'));
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('故事状态'));
  assert.match(await page.locator('#original').textContent(), /师妹接过玉佩/);
  await page.locator('[data-tab="styles"]').click();
  await page.locator('#styleName').fill('冷静叙述');
  await page.locator('#styleRules').fill('第三人称');
  await page.locator('#stylePositive').fill('雨水沿着剑鞘落下。');
  await page.locator('#styleForm button[type="submit"]').click();
  await page.waitForSelector('[data-style]');
  await page.locator('[data-style]').first().click();
  assert.equal(await page.locator('#stylePositive').inputValue(), '雨水沿着剑鞘落下。');

  const placeCreate = await fetch(origin + '/api/novels/' + bookId + '/resources/place', {
    method: 'POST', headers, body: JSON.stringify({ id: 'place-history-ui', payload: { name: '旧渡口' } })
  });
  const placeCreated = await placeCreate.json();
  assert.equal(placeCreate.status, 201, JSON.stringify(placeCreated));
  const placeUpdate = await fetch(origin + '/api/novels/' + bookId + '/resources/place/place-history-ui', {
    method: 'PATCH', headers: { ...headers, 'If-Match': placeCreated.resource.etag },
    body: JSON.stringify({ payload: { name: '新渡口' } })
  });
  assert.equal(placeUpdate.status, 200);
  await page.goto(origin + '/pages/project-docs.html?nid=' + bookId);
  assert.equal(new URL(page.url()).pathname, '/pages/project-docs.html');
  assert.equal(await page.title(), '作品资料中心 · 墨阑');
  await page.waitForFunction(() => document.querySelector('#projectTitle').textContent === '江湖记事');
  await page.locator('[data-zone="world"]').click();
  await page.locator('#requirementSelect').selectOption('__all__');
  await page.locator('#kindSelect').selectOption('place');
  await page.waitForSelector('[data-history-id="place-history-ui"]');
  await page.locator('[data-history-id="place-history-ui"]').click();
  await page.waitForFunction(() => !document.querySelector('#resourceHistoryPanel').hidden);
  assert.match(await page.locator('#resourceHistoryList').textContent(), /v2[\s\S]*v1/);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-restore-revision="1"]').click();
  await page.waitForFunction(() => document.querySelector('#resourceFormStatus').textContent.includes('新版本 v3'));
  assert.match(await page.locator('#resourcePayload').inputValue(), /旧渡口/);
  assert.equal(await page.locator('#resourceDialog .docs-dialog__card').evaluate(element => element.scrollTop), 0);
  const docsScreenshot = path.join(directory, 'project-docs-history.png');
  await page.screenshot({ path: docsScreenshot, fullPage: true });
  console.log('PROJECT_DOCS_SCREENSHOT=' + docsScreenshot);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const docsMobileScreenshot = path.join(directory, 'project-docs-mobile.png');
  await page.screenshot({ path: docsMobileScreenshot });
  console.log('PROJECT_DOCS_MOBILE_SCREENSHOT=' + docsMobileScreenshot);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('#resourceCloseBtn').click();

  let activeZone = 'world';
  assert.equal(materialSchema.requirements.length, 49);
  for (const requirement of materialSchema.requirements) {
    const zone = materialSchema.categoryById[requirement.categoryId].zone;
    if (zone !== activeZone) {
      await page.locator(`[data-zone="${zone}"]`).click();
      activeZone = zone;
    }
    await page.locator('#requirementSelect').selectOption(requirement.id);
    await page.waitForFunction(({ id, label }) => {
      const select = document.querySelector('#requirementSelect');
      return select && select.value === id && document.querySelector('#resourceTitle').textContent === label;
    }, { id: requirement.id, label: requirement.label });
    await page.locator('#newResourceBtn').click();
    const renderedPaths = await page.locator('#structuredFields .structured-field').evaluateAll(elements =>
      elements.map(element => element.dataset.field));
    assert.deepEqual(renderedPaths, requirement.fieldPaths, `${requirement.id} schema fields render in the UI`);
    await page.locator('#resourceCloseBtn').click();
  }

  await page.locator('[data-zone="base"]').click();
  await page.locator('#requirementSelect').selectOption('A01');
  await page.locator('#newResourceBtn').click();
  await page.locator('.structured-field[data-field="profile.title"]').fill('浏览器录入的作品名');
  await page.waitForFunction(() => {
    try {
      return JSON.parse(document.querySelector('#resourcePayload').value).requirementData['profile.title'] === '浏览器录入的作品名';
    } catch (_) { return false; }
  });
  const docsSchemaDesktop = path.join(directory, 'project-docs-schema-49.png');
  await page.screenshot({ path: docsSchemaDesktop, fullPage: true });
  console.log('PROJECT_DOCS_SCHEMA_DESKTOP=' + docsSchemaDesktop);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const docsSchemaMobile = path.join(directory, 'project-docs-schema-mobile.png');
  await page.screenshot({ path: docsSchemaMobile });
  console.log('PROJECT_DOCS_SCHEMA_MOBILE=' + docsSchemaMobile);
  await page.locator('#resourceForm button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#docsToast').textContent === '资料已保存');
  const savedMaterial = await (await page.evaluate(async () => {
    const response = await fetch('/api/novels/' + encodeURIComponent(new URLSearchParams(location.search).get('nid')) + '/resources/profile', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('ml_token') }
    });
    return response.json();
  }));
  assert.ok(savedMaterial.resources.some(resource => resource.payload.requirementData['profile.title'] === '浏览器录入的作品名'));

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(origin + '/pages/story-workbench.html?nid=' + bookId);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('故事状态'));

  const memoryResponse = await fetch(origin + '/api/books/' + bookId + '/memory', { headers });
  assert.equal(memoryResponse.status, 200);
  const memory = await memoryResponse.json();
  assert.equal(memory.memory.length, 1);
  const evidenceResponse = await fetch(origin + '/api/books/' + bookId + '/memory/records?type=evidence', { headers });
  assert.equal(evidenceResponse.status, 200);
  const evidence = await evidenceResponse.json();
  assert.equal(evidence.records.filter(record => record.modality === 'claim').length, 1);
  const projectionResponse = await fetch(origin + '/api/books/' + bookId + '/projections', { headers });
  assert.equal(projectionResponse.status, 200);
  const projection = await projectionResponse.json();
  assert.equal(projection.projections.projectedStateVersion, 2);
  assert.deepEqual(errors, []);
  await page.locator('[data-tab="draft"]').click();
  const screenshot = path.join(directory, 'story-workbench.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log('WORKBENCH_SCREENSHOT=' + screenshot);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  const workbenchMobileScreenshot = path.join(directory, 'story-workbench-mobile.png');
  await page.screenshot({ path: workbenchMobileScreenshot });
  console.log('WORKBENCH_MOBILE_SCREENSHOT=' + workbenchMobileScreenshot);
  assert.deepEqual(errors, []);
});
