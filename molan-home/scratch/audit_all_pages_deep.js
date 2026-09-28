const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

async function auditDeep() {
  console.log('========================================================');
  console.log('   墨阑 AI 小说创作平台 · 深度 UI 全覆盖自动化审计');
  console.log('========================================================\n');

  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const auditReport = {
    pagesAudited: 0,
    consoleErrors: [],
    consoleWarnings: [],
    failedRequests: [],
    unlabeledButtons: [],
    overflowIssues: [],
    themeIssues: [],
    brokenImages: [],
    modalIssues: []
  };

  page.on('console', msg => {
    if (msg.type() === 'error') {
      auditReport.consoleErrors.push({ url: page.url(), text: msg.text() });
    } else if (msg.type() === 'warning') {
      auditReport.consoleWarnings.push({ url: page.url(), text: msg.text() });
    }
  });

  page.on('response', resp => {
    if (resp.status() >= 400) {
      auditReport.failedRequests.push({ page: page.url(), status: resp.status(), url: resp.url() });
    }
  });

  // 1. 审计 SPA 主框架所有子路由
  const spaPages = [
    'overview', 'novels', 'editor', 'resources', 'outline',
    'story-workbench', 'project-docs', 'dissect', 'creation',
    'knowledge', 'skills', 'billing', 'docs',
    'account', 'login', 'features', 'blog', 'admin-login', 'admin'
  ];

  console.log(`[Phase 1] 审计 SPA 内部 20 个功能页面路由...`);

  // 先注入一个基础访客作品，防止部分页面缺少状态直接报错
  await page.goto('http://127.0.0.1:3000/index.html#overview', { waitUntil: 'networkidle' });
  await page.evaluate(() => {
    const testState = {
      novel: { title: '太初剑仙', intro: '一剑断万古，逆命登仙峰。', type: '玄幻' },
      state: {
        title: '太初剑仙',
        volumes: [{
          id: 'vol_1', title: '第一卷 问剑青云',
          chapters: [{
            id: 'chap_1', title: '第一章 青云试剑',
            scenes: [{ id: 'sc_1', name: '演武场试锋', content: '<p>青云宗，演武场上风声肃杀。</p>' }]
          }]
        }],
        currentChapterId: 'chap_1',
        currentSceneId: 'sc_1',
        outline: { volume: { done: 1 } },
        history: [],
        foreshadows: []
      }
    };
    localStorage.setItem('molan_guest_novel_state', JSON.stringify(testState));
    window.previewState = window.previewState || {};
    window.previewState.novelId = 'test_book_1';
  });

  for (const pageKey of spaPages) {
    process.stdout.write(`  - 检查页面 #${pageKey} ... `);
    await page.evaluate(pk => {
      if (typeof window.renderPage === 'function') window.renderPage(pk);
      else location.hash = '#' + pk;
    }, pageKey);
    await page.waitForTimeout(300);

    // 检查页面标题与激活菜单状态
    const pageCheck = await page.evaluate(pk => {
      const activeLink = document.querySelector(`.side-link[data-page="${pk}"]`);
      const isEditorOnly = document.body.classList.contains('editor-only-mode');
      const isStandalone = document.getElementById('previewFrame')?.classList.contains('standalone-context');
      const pageTitle = document.getElementById('topPageName')?.textContent.trim();
      const hasStageContent = Boolean(document.getElementById('pageStage')?.firstElementChild);

      // 检查是否有纯图标未标记 aria-label/title 的按钮
      const badButtons = Array.from(document.querySelectorAll('button:not([hidden])'))
        .filter(btn => {
          if (btn.offsetParent === null) return false; // 不可见
          const text = btn.textContent.trim();
          if (text) return false;
          const aria = btn.getAttribute('aria-label');
          const title = btn.getAttribute('title');
          return !aria && !title;
        })
        .map(btn => ({
          html: btn.outerHTML.slice(0, 80),
          classes: btn.className
        }));

      // 检查图片是否有 404 或缺失 alt
      const badImgs = Array.from(document.querySelectorAll('img')).filter(img => !img.alt && !img.getAttribute('aria-hidden')).length;

      return {
        hasActiveLink: Boolean(activeLink?.classList.contains('active')),
        isEditorOnly,
        isStandalone,
        pageTitle,
        hasStageContent,
        badButtons,
        badImgs
      };
    }, pageKey);

    if (pageCheck.badButtons.length > 0) {
      auditReport.unlabeledButtons.push({ page: pageKey, buttons: pageCheck.badButtons });
      console.log(`[WARN: ${pageCheck.badButtons.length} 无标签按钮]`);
    } else {
      console.log(`OK (Title: "${pageCheck.pageTitle}")`);
    }
    auditReport.pagesAudited++;
  }

  // 2. 审计浅色/深色主题切换与对比度
  console.log(`\n[Phase 2] 审计深色模式全局适配与对比度...`);
  await page.evaluate(() => {
    if (typeof window.toggleTheme === 'function') window.toggleTheme();
    else document.body.classList.toggle('theme-dim');
  });
  await page.waitForTimeout(400);

  const darkThemeAudit = await page.evaluate(() => {
    const isDim = document.body.classList.contains('theme-dim');
    const label = document.querySelector('.theme-label')?.textContent.trim();
    const bg = window.getComputedStyle(document.body).backgroundColor;
    // 检查是否有异常的高亮度纯白背景（且非 iframe）
    const brightElements = Array.from(document.querySelectorAll('.panel, .site-header, .app-sidebar, .editor-paper, .editor-nav, .editor-bar'))
      .filter(el => {
        const c = window.getComputedStyle(el).backgroundColor;
        return c === 'rgb(255, 255, 255)' || c === '#ffffff';
      })
      .map(el => el.className);

    return { isDim, label, bg, brightElements };
  });
  console.log(`  -> 深色激活: ${darkThemeAudit.isDim}, 标签: "${darkThemeAudit.label}", 背景: ${darkThemeAudit.bg}`);
  if (darkThemeAudit.brightElements.length > 0) {
    console.log(`  -> 警告: 深色模式下发现未适配的纯白背景容器:`, darkThemeAudit.brightElements);
    auditReport.themeIssues.push(...darkThemeAudit.brightElements);
  } else {
    console.log(`  -> PASS: 关键面板无刺眼纯白背景，深色适配完整。`);
  }

  // 切回浅色
  await page.evaluate(() => window.toggleTheme());
  await page.waitForTimeout(300);

  // 3. 审计弹窗交互 (Modal Lifecycle)
  console.log(`\n[Phase 3] 审计弹窗与浮层交互规范...`);
  // 打开新建小说弹窗
  await page.evaluate(() => {
    window.renderPage('novels');
  });
  await page.waitForTimeout(300);
  const openModalBtn = await page.$('[data-open-modal]');
  if (openModalBtn) {
    await openModalBtn.click();
    await page.waitForTimeout(200);
    let modalOpen = await page.evaluate(() => document.getElementById('modalBackdrop')?.classList.contains('open'));
    console.log(`  -> 点击新建小说: modal open = ${modalOpen}`);

    // 测试 Esc 键关闭
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    modalOpen = await page.evaluate(() => document.getElementById('modalBackdrop')?.classList.contains('open'));
    console.log(`  -> 按下 Escape: modal open = ${modalOpen} (应为 false)`);

    // 重新打开并点击取消
    await openModalBtn.click();
    await page.waitForTimeout(200);
    await page.click('#cancelModal');
    await page.waitForTimeout(200);
    modalOpen = await page.evaluate(() => document.getElementById('modalBackdrop')?.classList.contains('open'));
    console.log(`  -> 点击取消按钮: modal open = ${modalOpen} (应为 false)`);

    // 重新打开并点击右上角 X
    await openModalBtn.click();
    await page.waitForTimeout(200);
    await page.click('#closeModal');
    await page.waitForTimeout(200);
    modalOpen = await page.evaluate(() => document.getElementById('modalBackdrop')?.classList.contains('open'));
    console.log(`  -> 点击右上角 X: modal open = ${modalOpen} (应为 false)`);
  }

  // 4. 审计多端响应式与水平滚动穿透 (Overflow Leakage)
  console.log(`\n[Phase 4] 审计多端响应式 (1440px / 768px / 375px) 布局与水平滚动穿透...`);
  const viewports = [
    { name: '桌面端 1440px', width: 1440, height: 900 },
    { name: '平板端 768px', width: 768, height: 1024 },
    { name: '移动端 375px', width: 375, height: 667 }
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const testKey of ['overview', 'novels', 'editor', 'resources', 'billing']) {
      await page.evaluate(pk => window.renderPage(pk), testKey);
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => {
        return {
          windowInnerWidth: window.innerWidth,
          docScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          hasHScroll: document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth
        };
      });
      if (overflow.hasHScroll) {
        auditReport.overflowIssues.push({ viewport: vp.name, page: testKey, details: overflow });
        console.log(`  -> [WARN] ${vp.name} 页面 #${testKey} 产生非预期横向溢出滚动 (scrollWidth=${overflow.docScrollWidth} > innerWidth=${overflow.windowInnerWidth})`);
      }
    }
    console.log(`  -> ${vp.name} 视口排版适配检测完毕。`);
  }

  // 5. 审计独立页面静态加载 (Standalone HTML Pages)
  console.log(`\n[Phase 5] 审计独立页面静态加载与 404 检测...`);
  const standalonePages = [
    '/pages/tools.html',
    '/pages/story-workbench.html',
    '/pages/project-docs.html',
    '/pages/xuanhuan-reading.html',
    '/pages/xuanhuan-blind.html',
    '/pages/pricing.html',
    '/pages/login.html',
    '/pages/admin-login.html',
    '/pages/admin.html',
    '/pages/docs.html',
    '/pages/features.html',
    '/pages/blog.html',
    '/pages/skills.html',
    '/pages/dissect.html'
  ];

  for (const sp of standalonePages) {
    try {
      const resp = await page.goto('http://127.0.0.1:3000' + sp, { waitUntil: 'domcontentloaded', timeout: 5000 });
      const status = resp ? resp.status() : 0;
      process.stdout.write(`  - ${sp} : HTTP ${status}\n`);
      if (status >= 400) {
        auditReport.failedRequests.push({ page: sp, status, url: sp });
      }
      auditReport.pagesAudited++;
    } catch (err) {
      console.log(`  - ${sp} 加载失败:`, err.message);
    }
  }

  // 6. 最终审计统计输出
  console.log('\n========================================================');
  console.log('                 审计完成与健康度统计');
  console.log('========================================================');
  console.log(`总计审计页面与视图: ${auditReport.pagesAudited}`);
  console.log(`控制台错误 (Console Errors): ${auditReport.consoleErrors.length}`);
  if (auditReport.consoleErrors.length > 0) console.log(auditReport.consoleErrors);
  console.log(`网络失败请求 (Failed Requests): ${auditReport.failedRequests.length}`);
  if (auditReport.failedRequests.length > 0) console.log(auditReport.failedRequests);
  console.log(`无障碍未标记按钮 (Unlabeled Buttons): ${auditReport.unlabeledButtons.length}`);
  if (auditReport.unlabeledButtons.length > 0) console.log(auditReport.unlabeledButtons);
  console.log(`水平滚动溢出缺陷 (Horizontal Overflows): ${auditReport.overflowIssues.length}`);
  if (auditReport.overflowIssues.length > 0) console.log(auditReport.overflowIssues);
  console.log(`深色模式纯白冲突 (Theme Bright Elements): ${auditReport.themeIssues.length}`);
  if (auditReport.themeIssues.length > 0) console.log(auditReport.themeIssues);

  const passed = auditReport.consoleErrors.length === 0 &&
                 auditReport.failedRequests.length === 0 &&
                 auditReport.overflowIssues.length === 0 &&
                 auditReport.unlabeledButtons.length === 0 &&
                 auditReport.themeIssues.length === 0;

  console.log(`\n最终二次审计结论: ${passed ? '★ 完美无瑕！全站无任何已知 UI 缺陷' : '发现潜在可优化项，详情见上方'}`);

  await browser.close();
  return auditReport;
}

auditDeep().catch(e => {
  console.error('Audit Script Failed:', e);
  process.exit(1);
});
