// Not part of the AC suite: captures B2 HITL evidence screenshots into
// plans/mvp/evidence/B2/ (LOCAL, git-ignored). Run manually, not via
// `npm test`. Stands in for the manual "toggle macOS appearance" step (B2.md
// Verify) using the same tab under context/page emulateMedia light vs dark
// under Enabled=Auto (default store) — the manual OS-toggle screenshot in
// real Chrome is a human-only step, noted in HANDOFF.md.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('./helpers/probes');

const EVIDENCE_DIR = path.join(__dirname, '..', 'plans', 'mvp', 'evidence', 'B2');

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test('capture same tab under Auto: light OS (not themed)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://127.0.0.1:4180/light.html');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'auto-light-os.png') });
});

test('capture same tab under Auto: dark OS (live switch, themed)', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('http://127.0.0.1:4180/light.html');
  await page.waitForTimeout(300);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'auto-dark-os.png') });
});
