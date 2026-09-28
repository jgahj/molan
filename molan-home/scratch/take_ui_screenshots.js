const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

async function takeScreenshots() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  const pagesToShot = [
    { hash: '', name: 'home' },
    { hash: '#overview', name: 'overview' },
    { hash: '#novels', name: 'novels' },
    { hash: '#editor', name: 'editor' },
    { hash: '#dissect', name: 'dissect' },
    { hash: '#skills', name: 'skills' },
    { hash: '#resources', name: 'resources' },
    { hash: '#settings', name: 'settings' },
    { hash: '#pricing', name: 'pricing' },
    { hash: '#login', name: 'login' },
    { hash: '#admin-login', name: 'admin-login' }
  ];

  for (const item of pagesToShot) {
    const url = 'http://127.0.0.1:3000/index.html' + item.hash;
    console.log(`Shooting: ${item.name} ...`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    // Light mode
    await page.screenshot({ path: path.join(outDir, `${item.name}_light.png`), fullPage: false });

    // Dark mode
    await page.evaluate(() => {
      document.body.classList.add('theme-dim');
      localStorage.setItem('molan_theme', 'dim');
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(outDir, `${item.name}_dark.png`), fullPage: false });

    // Reset back to light mode
    await page.evaluate(() => {
      document.body.classList.remove('theme-dim');
      localStorage.setItem('molan_theme', 'light');
    });
  }

  await browser.close();
  console.log('All screenshots saved to:', outDir);
}

takeScreenshots().catch(console.error);
