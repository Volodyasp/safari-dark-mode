// Not part of the AC suite: captures B1 HITL evidence screenshots into
// plans/mvp/evidence/B1/ (LOCAL, git-ignored). Run manually, not via `npm test`.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('./helpers/extension');

const EVIDENCE_DIR = path.join(__dirname, '..', 'plans', 'mvp', 'evidence', 'B1');

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test('capture light.html themed screenshot', async ({ page }) => {
  // B2 made content.js settings-aware; establish wantDark explicitly.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/light.html');
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'light-themed.png') });
});

test('capture cors.html screenshot', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/cors.html');
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'cors.png') });
});
