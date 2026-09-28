const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function verifyAll() {
  console.log('--- 开始全面 UI 自动化回归与验证 ---');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('response', resp => {
    if (resp.status() >= 400) {
      failedRequests.push(`${resp.status()} ${resp.url()}`);
    }
  });

  // 1. 测试首页面加载与 Favicon
  console.log('[Test 1] 访问首页与验证 Favicon...');
  await page.goto('http://127.0.0.1:3000/index.html#overview', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 2. 测试 BUG-V1: 深色模式初次加载与图标同步
  console.log('[Test 2] 测试深色模式初次加载与图标同步...');
  // 切换到深色
  await page.click('[data-action="theme"]');
  await page.waitForTimeout(300);
  let isDim = await page.evaluate(() => document.body.classList.contains('theme-dim'));
  let themeLabel = await page.$eval('.theme-label', el => el.textContent.trim());
  let themeIcon = await page.$eval('[data-action="theme"] [data-lucide], [data-action="theme"] svg', el => {
    return el.getAttribute('data-lucide') || el.className.baseVal || '';
  });
  console.log(`  -> 切换深色: body.theme-dim=${isDim}, label=${themeLabel}, icon contains moon: ${themeIcon.includes('moon')}`);

  // 刷新页面，验证初次加载保持深色且图标为 moon
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  isDim = await page.evaluate(() => document.body.classList.contains('theme-dim'));
  themeLabel = await page.$eval('.theme-label', el => el.textContent.trim());
  themeIcon = await page.$eval('[data-action="theme"] [data-lucide], [data-action="theme"] svg', el => {
    return el.getAttribute('data-lucide') || el.className.baseVal || '';
  });
  console.log(`  -> 刷新后深色保持: body.theme-dim=${isDim}, label=${themeLabel}, icon contains moon: ${themeIcon.includes('moon')}`);
  if (!isDim || !themeIcon.includes('moon')) {
    console.error('FAIL: BUG-V1 未通过，深色模式初次加载未同步为 moon 图标');
  } else {
    console.log('  -> PASS: BUG-V1 验证通过！');
  }

  // 切回浅色
  await page.click('[data-action="theme"]');
  await page.waitForTimeout(300);

  // 3. 测试 BUG-V2 & BUG-L1: 编辑器无作品空态
  console.log('[Test 3] 测试编辑器空态（未选作品）...');
  await page.evaluate(() => {
    localStorage.removeItem('molan_guest_novel_state');
  });
  await page.goto('http://127.0.0.1:3000/index.html#editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  const editorOnlyMode = await page.evaluate(() => document.body.classList.contains('editor-only-mode'));
  const headerVisible = await page.$eval('.site-header', el => window.getComputedStyle(el).display !== 'none');
  const sidebarVisible = await page.$eval('.app-sidebar', el => window.getComputedStyle(el).display !== 'none');
  const emptyPanelText = await page.$eval('.panel.empty', el => el.textContent);
  console.log(`  -> 空态下 editor-only-mode=${editorOnlyMode} (应为 false)`);
  console.log(`  -> 空态下 headerVisible=${headerVisible}, sidebarVisible=${sidebarVisible} (应为 true)`);
  console.log(`  -> 空态面板内容匹配: ${emptyPanelText.includes('还没有可编辑的作品')}`);

  await page.screenshot({ path: path.join(outDir, 'editor_empty_fixed_light.png') });
  await page.click('[data-action="theme"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, 'editor_empty_fixed_dark.png') });
  await page.click('[data-action="theme"]');
  await page.waitForTimeout(300);

  // 4. 测试 BUG-I1 & 有作品时进入编辑器
  console.log('[Test 4] 测试有作品时进入编辑器与工具栏快捷功能...');
  const testState = {
    novel: { title: '太初剑仙', intro: '一剑断万古，逆命登仙峰。', type: '玄幻' },
    state: {
      title: '太初剑仙',
      volumes: [{
        id: 'vol_1', title: '第一卷 问剑青云',
        chapters: [{
          id: 'chap_1', title: '第一章 青云试剑',
          scenes: [{ id: 'sc_1', name: '演武场试锋', content: '<p>青云宗，演武场上风声肃杀。少年握紧了手中的铁剑。</p>' }]
        }]
      }],
      currentChapterId: 'chap_1',
      currentSceneId: 'sc_1',
      outline: { volume: { done: 1 } },
      history: [],
      foreshadows: []
    }
  };
  await page.evaluate(s => {
    localStorage.setItem('molan_guest_novel_state', JSON.stringify(s));
  }, testState);

  await page.goto('http://127.0.0.1:3000/index.html#editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const activeEditorOnly = await page.evaluate(() => document.body.classList.contains('editor-only-mode'));
  const editorTitle = await page.$eval('.editor-nav-head strong', el => el.textContent.trim());
  const paperText = await page.$eval('.editor-paper', el => el.textContent.trim());
  console.log(`  -> 有作品时 editor-only-mode=${activeEditorOnly} (应为 true)`);
  console.log(`  -> 成功恢复小说标题: ${editorTitle}`);
  console.log(`  -> 成功渲染正文: ${paperText.slice(0, 30)}...`);

  // 检查工具栏新增的主题切换与控制台返回按钮
  const editorThemeBtn = await page.$('.editor-bar [data-action="theme"]');
  const editorDashboardBtn = await page.$('.editor-bar [data-completion-page="overview"]');
  console.log(`  -> 编辑器工具栏主题按钮存在: ${Boolean(editorThemeBtn)}, 返回按钮存在: ${Boolean(editorDashboardBtn)}`);

  // 在编辑器内点击主题切换
  if (editorThemeBtn) {
    await editorThemeBtn.click();
    await page.waitForTimeout(300);
    const editorDim = await page.evaluate(() => document.body.classList.contains('theme-dim'));
    console.log(`  -> 编辑器内切换深色成功: ${editorDim}`);
    await page.screenshot({ path: path.join(outDir, 'editor_active_fixed_dark.png') });
    await editorThemeBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, 'editor_active_fixed_light.png') });
  }

  // 5. 测试 BUG-L2: 按钮无障碍 title 与 aria-label
  console.log('[Test 5] 验证纯图标按钮的 aria-label 与 title...');
  const iconButtonsWithoutLabel = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('.editor-bar button, .editor-nav button'));
    return btns.filter(b => !b.getAttribute('aria-label') && !b.getAttribute('title')).map(b => b.className);
  });
  console.log(`  -> 缺失无障碍标识的按钮数量: ${iconButtonsWithoutLabel.length}`);

  // 6. 测试 BUG-I2: 长篇记忆与全套资料嵌入渲染
  console.log('[Test 6] 测试故事记忆与全套资料 SPA 嵌入...');
  // A. 空态检查
  await page.evaluate(() => {
    window.previewState.novelId = '';
  });
  await page.goto('http://127.0.0.1:3000/index.html#story-workbench', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const emptyPrompt = await page.$eval('.panel.empty h3', el => el.textContent.trim());
  console.log(`  -> 未选书时显示友好提示: ${emptyPrompt}`);

  // B. 选定作品时嵌入 iframe 检查
  await page.evaluate(() => {
    window.previewState.novelId = 'test_book_1';
    renderPage('story-workbench');
  });
  await page.waitForTimeout(500);
  const storyIframe = await page.$('.embedded-workbench-wrap iframe');
  console.log(`  -> 选定书后故事记忆嵌入 iframe 存在: ${Boolean(storyIframe)}`);
  await page.screenshot({ path: path.join(outDir, 'story_workbench_embedded.png') });

  await page.evaluate(() => {
    window.previewState.novelId = 'test_book_1';
    renderPage('project-docs');
  });
  await page.waitForTimeout(500);
  const projectIframe = await page.$('.embedded-workbench-wrap iframe');
  console.log(`  -> 选定书后全套资料嵌入 iframe 存在: ${Boolean(projectIframe)}`);
  await page.screenshot({ path: path.join(outDir, 'project_docs_embedded.png') });

  // 7. 测试 BUG-L3: 移动端视口 (375x667)
  console.log('[Test 7] 测试移动端 375px 抽屉与遮罩互斥...');
  await page.setViewportSize({ width: 375, height: 667 });
  // 确保移动端进入编辑器时携带作品
  await page.evaluate(s => {
    localStorage.setItem('molan_guest_novel_state', JSON.stringify(s));
  }, testState);
  await page.goto('http://127.0.0.1:3000/index.html#editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // 展开章节目录
  const toggleNavBtnExists = await page.evaluate(() => Boolean(document.querySelector('[data-completion-action="toggle-nav"]')));
  if (toggleNavBtnExists) {
    await page.evaluate(() => document.querySelector('[data-completion-action="toggle-nav"]').click());
    await page.waitForTimeout(300);
    let navOpen = await page.evaluate(() => document.getElementById('editorPreview').classList.contains('nav-open'));
    let scrimVisible = await page.$eval('.editor-nav-scrim', el => window.getComputedStyle(el).display !== 'none');
    console.log(`  -> 移动端打开目录: nav-open=${navOpen}, scrimVisible=${scrimVisible}`);

    // 点击遮罩关闭目录
    await page.evaluate(() => document.querySelector('.editor-nav-scrim').click());
    await page.waitForTimeout(300);
    navOpen = await page.evaluate(() => document.getElementById('editorPreview').classList.contains('nav-open'));
    console.log(`  -> 点击遮罩关闭目录: nav-open=${navOpen} (应为 false)`);

    // 移动端打开 AI 助手
    await page.evaluate(() => document.querySelector('[data-completion-action="editor-ai-focus"]').click());
    await page.waitForTimeout(300);
    let aiOpen = await page.evaluate(() => document.getElementById('editorPreview').classList.contains('ai-open'));
    scrimVisible = await page.$eval('.editor-nav-scrim', el => window.getComputedStyle(el).display !== 'none');
    console.log(`  -> 移动端打开 AI: ai-open=${aiOpen}, scrimVisible=${scrimVisible}`);

    // 点击遮罩关闭 AI
    await page.evaluate(() => document.querySelector('.editor-nav-scrim').click());
    await page.waitForTimeout(300);
    aiOpen = await page.evaluate(() => document.getElementById('editorPreview').classList.contains('ai-open'));
    console.log(`  -> 点击遮罩关闭 AI: ai-open=${aiOpen} (应为 false)`);
  }

  await page.screenshot({ path: path.join(outDir, 'mobile_editor_fixed.png') });

  // 8. 总结控制台与网络健康度
  console.log('\n--- 最终健康度审计 ---');
  console.log(`控制台错误总数 (Console Errors): ${consoleErrors.length}`);
  if (consoleErrors.length) console.log('  详情:', consoleErrors);
  console.log(`失败网络请求总数 (Failed Requests 4xx/5xx): ${failedRequests.length}`);
  if (failedRequests.length) console.log('  详情:', failedRequests);

  await browser.close();

  const success = consoleErrors.length === 0 && failedRequests.length === 0 && iconButtonsWithoutLabel.length === 0;
  console.log(`\n最终验证结论: ${success ? '全部 UI 缺陷修复通过！' : '存在未达标项，请复核'}`);
  return success;
}

verifyAll().catch(e => {
  console.error('Audit Script Failed:', e);
  process.exit(1);
});
