const { chromium } = require('playwright-core');

(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const p = await b.newPage({ viewport: { width: 375, height: 667 } });
  const testState = {
    novel: { title: '太初剑仙', intro: '一剑断万古。', type: '玄幻' },
    state: {
      title: '太初剑仙',
      volumes: [{ id: 'vol_1', title: '第一卷', chapters: [{ id: 'chap_1', title: '第一章', scenes: [{ id: 'sc_1', name: '场景1', content: '测试正文' }] }] }],
      currentChapterId: 'chap_1', currentSceneId: 'sc_1', outline: {}, history: [], foreshadows: []
    }
  };
  await p.goto('http://127.0.0.1:3000/index.html');
  await p.evaluate(s => localStorage.setItem('molan_guest_novel_state', JSON.stringify(s)), testState);
  await p.goto('http://127.0.0.1:3000/index.html#editor', { waitUntil: 'networkidle' });

  const rail = await p.$('#editorRailToggle');
  const toggle = await p.$('[data-completion-action="toggle-nav"]');

  if (rail) console.log('rail box:', await rail.boundingBox());
  if (toggle) console.log('toggle box:', await toggle.boundingBox());

  await b.close();
})();
