// Inspect the editor right panel - check rp-footer visibility.
const { chromium } = require('C:\\Users\\lyh\\Desktop\\小说专属网页\\molan-home\\node_modules\\playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**/*', async (route) => {
    const resp = await route.fetch();
    const headers = { ...resp.headers() };
    headers['cache-control'] = 'no-store';
    await route.fulfill({ response: resp, headers });
  });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[PAGEERR]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('[CONSOLEERR]', m.text()); });

  // Pre-seed localStorage with a sample novel so editor loads
  await page.addInitScript(() => {
    const sample = {
      id: 'n_demo',
      title: 'Demo',
      volumes: [{
        id: 'v1', title: '第一卷', chapters: [{
          id: 'c1', title: '第1章', sub: '', scenes: [{ id: 's1', name: '场景一', content: '<p>demo content</p>' }]
        }]
      }],
      outline: { book: { title: 'Demo', oneLine: 'demo', themes: [] }, volume: { title: 'v1', synopsis: '' }, chapters: [{ num: 1, status: 'writing', title: '第1章', synopsis: 'demo', wordCount: 0, mark: '', storyline: '' }] },
      currentChapterId: 'c1',
      currentSceneId: 's1',
      sceneProps: { summary: 'demo', outline: '', notes: '' },
      knowledge: { entities: [], edges: [] },
      inspirations: [],
      history: [], aiMessages: [], chatSessions: [], recycleBin: [], aiCallLog: [],
      settings: { fontSize: 16, lineHeight: 1.8, theme: 'light', fontFamily: 'system', autosave: true, exportFormat: 'txt', think: false, reasoningEffort: '', models: { default: 'v4-flash', continuation: 'v4-flash', polish: 'v4-flash' }, dailyGoal: 2000, todayWords: 0, todayDate: '' },
      modelSources: [{ id: 'ds', name: 'DeepSeek', models: ['v4-flash', 'v4-pro'], active: true, endpoint: 'deepseek' }],
      aiRole: 'generation', aiStyle: '',
      updatedAt: Date.now()
    };
    localStorage.setItem('molan_editor_novels', JSON.stringify({ 'n_demo': sample }));
    localStorage.setItem('molan_editor_current', 'n_demo');
  });

  await page.goto('http://localhost:3000/pages/editor.html?nid=n_demo', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Inspect rp-footer
  const result = await page.evaluate(() => {
    const out = {};
    const footer = document.querySelector('.rp-footer');
    out.footerExists = !!footer;
    if (footer) {
      const r = footer.getBoundingClientRect();
      const cs = getComputedStyle(footer);
      out.footerRect = { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
      out.footerDisplay = cs.display;
      out.footerVisibility = cs.visibility;
      out.footerOpacity = cs.opacity;
      out.footerHTML = footer.outerHTML.substring(0, 400);
    }
    out.panelRect = (() => {
      const p = document.querySelector('.editor-right-panel');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    })();
    out.inputbarRect = (() => {
      const p = document.querySelector('.rp-inputbar');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    })();
    out.modelBtnRect = (() => {
      const p = document.querySelector('#aiModelSelect');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })();
    out.thinkSegRect = (() => {
      const p = document.querySelector('#aiThinkSeg');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
      out.thinkSegHTML = p.outerHTML.substring(0, 400);
    })();
    return out;
  });

  console.log('=== rp-footer / panel inspection ===');
  console.log(JSON.stringify(result, null, 2));

  await page.screenshot({ path: 'C:\\Users\\lyh\\Desktop\\小说专属网页\\scripts\\debug_right_panel.png', fullPage: false });
  console.log('screenshot saved');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });