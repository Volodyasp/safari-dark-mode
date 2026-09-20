// Not part of the AC suite: captures B6c HITL evidence into
// plans/v1.1/evidence/B6c/ (LOCAL, git-ignored). Run manually, not via
// `npm test`. This is Playwright's bundled Chromium, not Safari — the
// Safari temporary-install/Web-Inspector/Gmail visual checks are human-only
// (see HANDOFF.md PENDING HUMAN).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('./helpers/probes');

const EVIDENCE_DIR = path.join(__dirname, '..', 'plans', 'v1.1', 'evidence', 'B6c');

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test('capture csp-cssom.html before run(): themed, boxes not yet created', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/csp-cssom.html');
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'csp-cssom-before-run.png') });
});

test('capture csp-cssom.html after run(): shadow box, last-sheet box, adopted box all dark', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/csp-cssom.html');
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.evaluate(() => window.__cspCssom.run());
  await page.waitForFunction(() => {
    const shadow = document.getElementById('host-1').shadowRoot.querySelector('.sbox');
    return getComputedStyle(shadow).borderRadius === '7px';
  });
  await page.waitForTimeout(300); // let all three boxes finish repainting
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'csp-cssom-after-run.png') });
});
