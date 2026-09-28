const { chromium } = require('playwright-core');
const path = require('path');

async function testEditorWithNovel() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  await page.goto('http://127.0.0.1:3000/index.html#novels', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // Set up a guest novel state in localStorage or mock novel
  await page.evaluate(() => {
    const novelState = {
      novel: {
        id: 'n_test_1',
        title: '万象星辰诀',
        type: '玄幻修真',
        intro: '少年自微末崛起，以星辰淬体，破诸天神魔。'
      },
      state: {
        title: '万象星辰诀',
        volumes: [
          {
            id: 'v1',
            title: '第一卷：星起微末',
            chapters: [
              {
                id: 'c1',
                title: '第1章：残破星盘',
                scenes: [
                  {
                    id: 's1',
                    title: '场景1：悬崖惊变',
                    content: '<p>暴雨倾盆，狂风如刀割般撕裂着青石崖边的古树。</p><p>林渊浑身浴血，指节泛白，死死扣住石缝中的半截残破星盘。</p>'
                  }
                ]
              },
              {
                id: 'c2',
                title: '第2章：引星入体',
                scenes: [
                  {
                    id: 's2',
                    title: '场景1：古洞避雨',
                    content: '<p>山洞深处，星辉流转。</p>'
                  }
                ]
              }
            ]
          }
        ],
        knowledge: { entities: [], edges: [] }
      }
    };
    localStorage.setItem('molan_guest_novel_state', JSON.stringify(novelState));
  });

  // Navigate to editor
  await page.goto('http://127.0.0.1:3000/index.html#editor', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Screenshot light
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'editor_active_light.png') });

  // Toggle dark
  const themeBtn = await page.$('button[data-action="theme"]');
  if (themeBtn) {
    await themeBtn.click();
    await page.waitForTimeout(300);
  } else {
    await page.evaluate(() => document.body.classList.add('theme-dim'));
  }
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'editor_active_dark.png') });

  // Test mobile view
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(__dirname, 'screenshots', 'editor_active_mobile.png') });

  await browser.close();
  console.log('Editor test with novel completed!');
}

testEditorWithNovel().catch(console.error);
