const { test, expect } = require('@playwright/test');

test('raw observed crawl for release-readiness agent', async ({ page }) => {
  await page.goto("https://www.hdfc.com/housing-loans/home-loans", { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Home Loan - Apply Housin/i);
  await page.screenshot({ path: 'raw-crawl-observe.png', fullPage: true });
});
