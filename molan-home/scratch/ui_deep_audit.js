const { chromium } = require('playwright-core');
const fs = require('fs');

async function deepAudit() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const issues = [];

  page.on('console', msg => {
    if (msg.type() === 'error') {
      issues.push({ type: 'CONSOLE_ERROR', url: page.url(), text: msg.text() });
    }
  });

  page.on('pageerror', err => {
    issues.push({ type: 'PAGE_ERROR', url: page.url(), text: err.message });
  });

  // 1. Load main page
  await page.goto('http://127.0.0.1:3000/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // 2. Test theme toggle
  console.log('Testing theme toggle...');
  const themeButton = await page.$('button[data-action="theme"]');
  if (!themeButton) {
    issues.push({ type: 'VISUAL_BUG', message: 'Theme toggle button data-action="theme" not found on page' });
  } else {
    // Click theme toggle to turn on dark mode
    await themeButton.click();
    await page.waitForTimeout(300);

    const isDim = await page.evaluate(() => document.body.classList.contains('theme-dim'));
    if (!isDim) {
      issues.push({ type: 'INTERACTION_BUG', message: 'Clicking theme button failed to add .theme-dim to body' });
    } else {
      // Check for visual contrast bugs in dark mode across all sub-panels
      const tabs = ['overview', 'novels', 'editor', 'dissect', 'story-workbench', 'project-docs', 'skills', 'resources', 'settings', 'pricing'];
      for (const tab of tabs) {
        // click sidebar link
        const link = await page.$(`a[href="#${tab}"], [data-page="${tab}"]`);
        if (link) {
          await link.click();
          await page.waitForTimeout(300);
          
          // Check for hardcoded white backgrounds in dark mode
          const unadapted = await page.evaluate((currentTab) => {
            const bad = [];
            const all = Array.from(document.querySelectorAll('div, section, article, .card, .panel, .box, input, textarea, select'));
            for (const el of all) {
              if (el.offsetWidth > 150 && el.offsetHeight > 40) {
                const cs = window.getComputedStyle(el);
                if (cs.backgroundColor === 'rgb(255, 255, 255)' || cs.backgroundColor === 'rgb(251, 251, 249)') {
                  bad.push({
                    tab: currentTab,
                    tag: el.tagName,
                    class: el.className,
                    id: el.id,
                    bg: cs.backgroundColor,
                    color: cs.color
                  });
                }
              }
            }
            return bad.slice(0, 5);
          }, tab);

          if (unadapted.length > 0) {
            issues.push({
              type: 'THEME_CONTRAST_BUG',
              tab,
              message: `Dark mode has ${unadapted.length} unadapted white/light background elements in #${tab}`,
              samples: unadapted
            });
          }
        }
      }
    }
  }

  // 3. Switch back to light mode and test Modals
  if (themeButton) {
    await themeButton.click();
    await page.waitForTimeout(200);
  }

  // Test "创建小说" modal
  console.log('Testing create novel modal...');
  await page.goto('http://127.0.0.1:3000/index.html#novels', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const createBtn = await page.$('button[data-action="new-novel"], button:has-text("创建小说"), button:has-text("新建作品")');
  if (createBtn) {
    await createBtn.click();
    await page.waitForTimeout(300);

    const modalState = await page.evaluate(() => {
      const modal = document.querySelector('.modal, .dialog, [role="dialog"], #actionModal');
      if (!modal) return { visible: false };
      const cs = window.getComputedStyle(modal);
      return {
        visible: cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0',
        title: modal.querySelector('.modal-title, h2, h3')?.innerText || null,
        hasInputs: modal.querySelectorAll('input, textarea').length,
        hasConfirm: Boolean(modal.querySelector('button.primary, [data-action="confirm"], button[type="submit"]')),
        hasCancel: Boolean(modal.querySelector('[data-action="cancel"], .btn-cancel, button:has-text("取消")'))
      };
    });

    if (!modalState.visible) {
      issues.push({ type: 'INTERACTION_BUG', message: 'Create novel modal did not become visible after clicking create button' });
    }

    // Try closing modal
    const closeBtn = await page.$('.modal-close, [data-action="close"], button:has-text("取消")');
    if (closeBtn) {
      await closeBtn.click();
      await page.waitForTimeout(200);
    }
  }

  // 4. Test Mobile Responsive Viewport (375x667)
  console.log('Testing mobile responsiveness...');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('http://127.0.0.1:3000/index.html#editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const mobileEditorState = await page.evaluate(() => {
    const docEl = document.documentElement;
    const body = document.body;
    const isOverflowing = docEl.scrollWidth > window.innerWidth || body.scrollWidth > window.innerWidth;
    
    // Check if sidebar has mobile toggle or is overlapping editor
    const sidebar = document.querySelector('.site-sidebar, .sidebar, aside');
    const cs = sidebar ? window.getComputedStyle(sidebar) : null;
    
    return {
      scrollWidth: docEl.scrollWidth,
      innerWidth: window.innerWidth,
      isOverflowing,
      sidebarWidth: sidebar?.offsetWidth || 0,
      sidebarDisplay: cs?.display || null
    };
  });

  if (mobileEditorState.isOverflowing) {
    issues.push({
      type: 'LAYOUT_OVERFLOW_BUG',
      viewport: 'mobile',
      message: `Horizontal overflow on mobile #editor: scrollWidth (${mobileEditorState.scrollWidth}px) exceeds innerWidth (${mobileEditorState.innerWidth}px)`
    });
  }

  await browser.close();

  fs.writeFileSync('c:/Users/lyh/Desktop/小说专属网页/molan-home/scratch/ui_deep_audit_result.json', JSON.stringify(issues, null, 2), 'utf8');
  console.log('Deep audit finished! Found issues:', issues.length);
}

deepAudit().catch(console.error);
