// Not part of the AC suite: captures B3 HITL evidence screenshots into
// plans/mvp/evidence/B3/ (LOCAL, git-ignored). Run manually, not via
// `npm test`. Stands in for the manual github.com/youtube.com/wikipedia.org
// check (human-only step, noted in HANDOFF.md): dark-bg.html demonstrates a
// built-in-dark page staying untouched (detector correctly backs off), and
// light.html demonstrates an ordinary page still themed normally.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('./helpers/probes');

const EVIDENCE_DIR = path.join(__dirname, '..', 'plans', 'mvp', 'evidence', 'B3');

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test('capture dark-bg.html left untouched by the engine', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/dark-bg.html');
  await page.waitForFunction(() => sessionStorage.getItem('bdm:hint') === 'skip');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'dark-bg-untouched.png') });
});

test('capture light.html still themed normally', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/light.html');
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'light-still-themed.png') });
});
