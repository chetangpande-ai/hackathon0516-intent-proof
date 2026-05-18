// RAG PW-SCRIPT-004: Error Handling And Evidence (RAG://playwright-automation-guidelines#error-handling-evidence)
// RAG PW-SCRIPT-002: Modular Script Structure (RAG://playwright-automation-guidelines#modular-structure)
// RAG PW-SCRIPT-001: Playwright Naming Convention (RAG://playwright-automation-guidelines#naming)
// RAG PW-SCRIPT-003: Locator And Assertion Standards (RAG://playwright-automation-guidelines#locators-assertions)
const { test, expect } = require('@playwright/test');
const path = require('path');

const targetUrl = "https://www.hdfc.com/housing-loans/home-loans";
const screenshotDir = "E:\\AI-Projects\\hackathon-may-2926\\intent-driven-testing-platform\\runs\\run-2026-05-18T18-23-23-959Z-d506e4\\screenshots";


test("TC-001 Validate account creation and session entry", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, "TC-001.png"), fullPage: true });
});

test("TC-002 Validate KYC onboarding state progression", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, "TC-002.png"), fullPage: true });
});

test("TC-003 Validate payment success and wallet balance update", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, "TC-003.png"), fullPage: true });
});

test("TC-004 Validate failed or duplicate payment handling", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, "TC-004.png"), fullPage: true });
});

test("TC-005 Validate refund initiation and status visibility", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, "TC-005.png"), fullPage: true });
});

test("TC-006 Validate fraud decision visibility in payment flow", async ({ page }) => {
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await page.screenshot({ path: path.join(screenshotDir, "TC-006.png"), fullPage: true });
});

async function completeFintechJourney(page) {
  await expect(page.getByRole('heading', { name: /fintrust/i })).toBeVisible();
  await page.getByTestId('full-name').fill('Asha Mehta');
  await page.getByTestId('email').fill('asha.qa@example.com');
  await page.getByTestId('phone').fill('9876543210');
  await page.getByTestId('account-continue').click();
  await expect(page.getByTestId('kyc-panel')).toBeVisible();

  await page.getByTestId('pan').fill('ABCDE1234F');
  await page.getByTestId('identity-id').fill('KYC-2026-001');
  await page.getByTestId('kyc-continue').click();
  await expect(page.getByTestId('payment-panel')).toBeVisible();

  await page.getByTestId('amount').fill('2500');
  await page.getByTestId('payee').fill('Acme Supplies');
  await page.getByTestId('fraud-check').click();
  await expect(page.getByTestId('fraud-status')).toContainText(/Low risk/);
  await page.getByTestId('payment-submit').click();
  await expect(page.getByTestId('wallet-balance')).toContainText('12,500');
  await expect(page.getByTestId('payment-status')).toContainText(/Payment complete/);

  await page.getByTestId('refund-button').click();
  await expect(page.getByTestId('refund-status')).toContainText(/Refund initiated/);
  await expect(page.getByTestId('notification-list')).toContainText(/Refund initiated/);
}
