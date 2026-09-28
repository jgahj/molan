const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3000';

const routes = [
  '/',
  '/index.html',
  '/index.html#overview',
  '/index.html#novels',
  '/index.html#editor',
  '/index.html#dissect',
  '/index.html#story-workbench',
  '/index.html#project-docs',
  '/index.html#skills',
  '/index.html#resources',
  '/index.html#settings',
  '/index.html#pricing',
  '/index.html#login',
  '/pages/editor.html',
  '/pages/novels.html',
  '/pages/dissect.html',
  '/pages/project-docs.html',
  '/pages/skills.html',
  '/pages/story-workbench.html',
  '/pages/admin.html',
  '/pages/tools.html',
  '/pages/pricing.html',
  '/pages/features.html'
];

async function runAudit() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];

  for (const route of routes) {
    const pageUrl = BASE_URL + route;
    console.log(`Auditing: ${route} ...`);
    
    // Test both Desktop (1440x900) and Mobile (375x667)
    for (const viewport of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 375, height: 667 }]) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
      const page = await context.newPage();

      const consoleErrors = [];
      const pageErrors = [];
      const failedRequests = [];

      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });

      page.on('pageerror', err => {
        pageErrors.push(err.message || String(err));
      });

      page.on('requestfailed', req => {
        failedRequests.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText || 'failed'}`);
      });

      page.on('response', resp => {
        if (resp.status() >= 400 && !resp.url().includes('/api/auth/me')) {
          failedRequests.push(`${resp.status()} ${resp.url()}`);
        }
      });

      let loadOk = true;
      let loadError = null;
      try {
        await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 8000 });
        await page.waitForTimeout(600);
      } catch (e) {
        loadOk = false;
        loadError = e.message;
      }

      // Check horizontal overflow (layout bug)
      let hasHorizontalOverflow = false;
      let scrollWidth = 0;
      let innerWidth = 0;
      let invisibleOrClippedTexts = [];
      let interactiveElementsStats = {};

      if (loadOk) {
        try {
          const layoutCheck = await page.evaluate(() => {
            const docEl = document.documentElement;
            const overflow = docEl.scrollWidth > window.innerWidth + 2;
            
            // Check for buttons with no visible label or aria-label
            const buttons = Array.from(document.querySelectorAll('button, a.btn, [role="button"]'));
            const emptyButtons = buttons.filter(b => {
              const text = (b.innerText || b.getAttribute('aria-label') || b.title || '').trim();
              const hasSvg = b.querySelector('svg, img, i');
              return !text && !hasSvg && b.offsetWidth > 0 && b.offsetHeight > 0;
            }).map(b => b.outerHTML.slice(0, 100));

            // Check for broken images
            const brokenImages = Array.from(document.querySelectorAll('img')).filter(img => {
              return img.naturalWidth === 0 && img.offsetWidth > 0;
            }).map(img => img.src || img.getAttribute('src'));

            // Check modal / dialog visibility and positioning
            const modals = Array.from(document.querySelectorAll('.modal, .dialog, [role="dialog"], .drawer')).filter(m => {
              const style = window.getComputedStyle(m);
              return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            }).map(m => ({
              className: m.className,
              zIndex: window.getComputedStyle(m).zIndex,
              rect: m.getBoundingClientRect()
            }));

            // Check color contrast / invisible text (color matching background)
            const textNodes = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            let cur;
            while ((cur = walker.nextNode())) {
              if (cur.children.length === 0 && cur.innerText && cur.innerText.trim().length > 0) {
                const cs = window.getComputedStyle(cur);
                if (cs.display !== 'none' && cs.visibility !== 'hidden') {
                  if (cs.color === cs.backgroundColor && cs.color !== 'rgba(0, 0, 0, 0)') {
                    textNodes.push({ text: cur.innerText.slice(0, 30), color: cs.color, bg: cs.backgroundColor });
                  }
                }
              }
            }

            return {
              scrollWidth: docEl.scrollWidth,
              innerWidth: window.innerWidth,
              overflow,
              emptyButtonsCount: emptyButtons.length,
              emptyButtonsSamples: emptyButtons.slice(0, 3),
              brokenImagesCount: brokenImages.length,
              brokenImages,
              modals,
              invisibleTextNodes: textNodes.slice(0, 5)
            };
          });

          hasHorizontalOverflow = layoutCheck.overflow;
          scrollWidth = layoutCheck.scrollWidth;
          innerWidth = layoutCheck.innerWidth;
          interactiveElementsStats = layoutCheck;
        } catch (e) {
          // ignore evaluate errors
        }
      }

      results.push({
        route,
        viewport: viewport.name,
        width: viewport.width,
        loadOk,
        loadError,
        consoleErrors,
        pageErrors,
        failedRequests,
        hasHorizontalOverflow,
        scrollWidth,
        innerWidth,
        interactiveElementsStats
      });

      await context.close();
    }
  }

  await browser.close();

  const outPath = path.resolve(__dirname, 'ui_audit_result.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf8');
  console.log('UI Audit finished. Results saved to:', outPath);
}

runAudit().catch(err => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
