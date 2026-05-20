const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

async function run() {
  const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
    const base = process.env.BASE_URL || 'http://localhost:4173';

    const targets = [
      { url: `${base}/`, name: 'index' },
      { url: `${base}/demo-fintech`, name: 'demo-fintech' }
    ];

    for (const t of targets) {
      console.log('Opening', t.url);
      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(500);
      const outPath = path.join(outDir, `${t.name}.png`);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log('Saved', outPath);
    }
  } finally {
    await browser.close();
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
