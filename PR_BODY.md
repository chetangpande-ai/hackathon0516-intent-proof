Title: Add Playwright screenshots, screenshot script, and README flow diagram

Summary:
- Adds a Playwright script (`scripts/screenshot.js`) to capture site screenshots.
- Captured screenshots saved to `docs/screenshots/index.png` and `docs/screenshots/demo-fintech.png`.
- Updates `README.md` with a Screenshots section and a Mermaid flow diagram describing the app workflow.

Files changed:
- `scripts/screenshot.js` (new)
- `docs/screenshots/index.png` (new)
- `docs/screenshots/demo-fintech.png` (new)
- `README.md` (updated)

How to test:
1. Install dependencies: `npm install` and `npm run playwright:install`.
2. Start the server: `npm start` (defaults to port 4173).
3. Run the screenshot script: `node scripts/screenshot.js` (or set `BASE_URL` to another host).
4. Verify screenshots appear under `docs/screenshots` and README shows images and the mermaid diagram.

Notes:
- The Playwright CLI/browser install was run during development; if CI needs Playwright browsers, ensure `npm run playwright:install` is invoked.
- I pushed these changes to branch `add/screenshots-readme` and this PR is ready for review.
