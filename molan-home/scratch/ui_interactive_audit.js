const { chromium } = require('playwright-core');
const fs = require('fs');

async function testInteractions() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const auditLog = [];

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      auditLog.push({ type: 'console_' + msg.type(), text: msg.text() });
    }
  });

  page.on('pageerror', err => {
    auditLog.push({ type: 'pageerror', text: err.message });
  });

  // 1. Visit index.html
  await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 2. Test Dark Mode toggle
  const themeBtn = await page.$('#themeToggle, .theme-toggle, [data-action="toggle-theme"], .header-theme-btn');
  console.log('Theme toggle button found:', Boolean(themeBtn));
  if (themeBtn) {
    const initialTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light');
    await themeBtn.click();
    await page.waitForTimeout(400);
    const toggledTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`Theme toggled from ${initialTheme} to ${toggledTheme}`);

    // Check dark mode styles
    const darkIssues = await page.evaluate(() => {
      const issues = [];
      // check white backgrounds that didn't adapt
      const elements = Array.from(document.querySelectorAll('div, section, aside, header, main, nav'));
      elements.forEach(el => {
        const cs = window.getComputedStyle(el);
        if (cs.backgroundColor === 'rgb(255, 255, 255)' && el.offsetWidth > 200 && el.offsetHeight > 100) {
          issues.push({ tag: el.tagName, class: el.className, id: el.id, bg: cs.backgroundColor });
        }
      });
      return issues.slice(0, 10);
    });
    auditLog.push({ step: 'dark_mode_check', toggledTheme, issues: darkIssues });
  }

  // 3. Test Navigation to SPA tabs
  const navTabs = ['#overview', '#novels', '#editor', '#dissect', '#story-workbench', '#project-docs', '#skills', '#resources', '#settings', '#pricing'];
  for (const tab of navTabs) {
    await page.goto('http://127.0.0.1:3000/index.html' + tab, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const tabState = await page.evaluate((tabName) => {
      // Check visible panels
      const visiblePanels = Array.from(document.querySelectorAll('[data-page], .page-view, .tab-pane, section'))
        .filter(el => {
          const cs = window.getComputedStyle(el);
          return cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetHeight > 0;
        })
        .map(el => ({ tag: el.tagName, id: el.id, class: el.className }));

      // Check empty state
      const emptyState = document.querySelector('.empty-state, .empty-container, .no-data');

      // Check if sidebar nav item is active
      const activeNav = document.querySelector(`a[href="${tabName}"].active, .nav-item.active`);

      return {
        tab: tabName,
        visiblePanelsCount: visiblePanels.length,
        hasEmptyState: Boolean(emptyState),
        activeNavText: activeNav?.innerText || null
      };
    }, tab);

    auditLog.push({ step: 'spa_tab_' + tab, tabState });
  }

  // 4. Test editor direct load
  await page.goto('http://127.0.0.1:3000/pages/editor.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const editorDirectState = await page.evaluate(() => {
    return {
      title: document.title,
      hasEditorContainer: Boolean(document.querySelector('#editor, .editor-container, .editor-layout, #editorPage')),
      toolbarButtons: Array.from(document.querySelectorAll('.toolbar button, .editor-toolbar button')).length,
      leftSidebarVisible: Boolean(document.querySelector('.editor-sidebar, .sidebar-left')),
      rightAIVisible: Boolean(document.querySelector('.ai-panel, .ai-drawer, .sidebar-right'))
    };
  });
  auditLog.push({ step: 'editor_direct_html', editorDirectState });

  // 5. Test novels page direct load
  await page.goto('http://127.0.0.1:3000/pages/novels.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  const novelsState = await page.evaluate(() => {
    const brokenImg = document.querySelector('img[src*="404"], img:not([naturalWidth])');
    return {
      title: document.title,
      cardsCount: document.querySelectorAll('.novel-card, .book-card').length,
      hasCreateBtn: Boolean(document.querySelector('#createBtn, .btn-create, [data-action="create"]')),
      hasFilter: Boolean(document.querySelector('.filter-bar, .filter-select, select'))
    };
  });
  auditLog.push({ step: 'novels_direct_html', novelsState });

  await browser.close();

  fs.writeFileSync('c:/Users/lyh/Desktop/小说专属网页/molan-home/scratch/ui_interactive_result.json', JSON.stringify(auditLog, null, 2), 'utf8');
  console.log('Interactive audit finished!');
}

testInteractions().catch(console.error);
