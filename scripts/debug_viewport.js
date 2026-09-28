// Test at various viewport sizes to reproduce "footer disappeared" bug
const { chromium } = require('C:\\Users\\lyh\\Desktop\\小说专属网页\\molan-home\\node_modules\\playwright-core');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  for (const vp of [{width:1920,height:1080}, {width:1440,height:900}, {width:1280,height:800}, {width:1280,height:720}, {width:1024,height:600}]) {
    const ctx = await browser.newContext({ viewport: vp });
    await ctx.route('**/*', async (route) => {
      const resp = await route.fetch();
      const headers = { ...resp.headers() };
      headers['cache-control'] = 'no-store';
      await route.fulfill({ response: resp, headers });
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log(`[${vp.w}x${vp.h} PAGEERR]`, e.message));

    await page.addInitScript(() => {
      const sample = {
        id: 'n_demo', title: 'Demo', updatedAt: Date.now(),
        volumes: [{ id: 'v1', title: 'V1', chapters: [{ id: 'c1', title: 'C1', sub: '', scenes: [{ id: 's1', name: 'S1', content: '<p>x</p>' }] }] }],
        outline: { book: { title: 'D', oneLine: 'd', themes: [] }, volume: { title: 'v', synopsis: '' }, chapters: [{ num: 1, status: 'writing', title: 'C1', synopsis: '', wordCount: 0, mark: '', storyline: '' }] },
        currentChapterId: 'c1', currentSceneId: 's1',
        sceneProps: { summary: '', outline: '', notes: '' }, knowledge: { entities: [], edges: [] },
        inspirations: [], history: [], aiMessages: [], chatSessions: [], recycleBin: [], aiCallLog: [],
        settings: { fontSize: 16, lineHeight: 1.8, theme: 'light', fontFamily: 'system', autosave: true, exportFormat: 'txt', think: false, reasoningEffort: '', models: { default: 'v4-flash', continuation: 'v4-flash', polish: 'v4-flash' }, dailyGoal: 2000, todayWords: 0, todayDate: '' },
        modelSources: [{ id: 'ds', name: 'DeepSeek', models: ['v4-flash','v4-pro'], active: true, endpoint: 'deepseek' }],
        aiRole: 'generation', aiStyle: ''
      };
      localStorage.setItem('molan_editor_novels', JSON.stringify({ 'n_demo': sample }));
      localStorage.setItem('molan_editor_current', 'n_demo');
    });

    await page.goto('http://localhost:3000/pages/editor.html?nid=n_demo', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    const r = await page.evaluate(() => {
      const panel = document.querySelector('.editor-right-panel');
      const footer = document.querySelector('.rp-footer');
      const ib = document.querySelector('.rp-inputbar');
      const pr = panel ? panel.getBoundingClientRect() : null;
      const fr = footer ? footer.getBoundingClientRect() : null;
      const ir = ib ? ib.getBoundingClientRect() : null;
      const vh = window.innerHeight;
      return {
        vh,
        panelBottom: pr && pr.bottom,
        footerBottom: fr && fr.bottom,
        footerVisibleInViewport: fr ? (fr.top < vh && fr.bottom > 0) : false,
        footerCutByPanel: fr && pr ? (fr.bottom > pr.bottom) : null,
        inputBarBottom: ir && ir.bottom,
        footerCutoff: fr ? (fr.bottom - vh) : null
      };
    });
    console.log(`vp ${vp.width}x${vp.height}:`, JSON.stringify(r));

    if (vp.width === 1280 && vp.height === 720) {
      await page.screenshot({ path: 'C:\\Users\\lyh\\Desktop\\小说专属网页\\scripts\\debug_720p.png' });
    }

    await ctx.close();
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });