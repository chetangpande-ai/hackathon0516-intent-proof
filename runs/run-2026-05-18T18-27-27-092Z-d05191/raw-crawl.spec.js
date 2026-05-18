const { test, expect } = require('@playwright/test');

test('raw observed crawl for release-readiness agent', async ({ page }) => {
  await page.goto("https://www.apollo247.com/", { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Apollo 247 - Online Doct/i);
  await page.screenshot({ path: 'raw-crawl-observe.png', fullPage: true });
});
