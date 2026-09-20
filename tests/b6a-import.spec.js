// B6a — AC-24: the committed data files and the importer's idempotency.
// Node-side only: no browser/extension needed, so this imports `test`
// straight from @playwright/test rather than tests/helpers/probes.js — the
// latter's `page`/`ext` fixtures would launch the persistent Chromium
// context (with the extension loaded) for nothing (documented in
// HANDOFF.md's B6a section, per B6a.md's note).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(REPO_ROOT, 'extension', 'data');
const PINNED_COMMIT = '3df6a4aacb7285859003eb1af3182e4370280b5e';

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test.describe('AC-24 committed data files', () => {
  test('fixes.json: pinned commit, generic css, site count', () => {
    const fixes = readJSON(path.join(DATA_DIR, 'fixes.json'));
    expect(fixes.commit).toBe(PINNED_COMMIT);
    expect(fixes.generic.css).toContain('::placeholder');
    expect(fixes.sites.length).toBeGreaterThanOrEqual(2500);
    expect(fixes.count).toBe(fixes.sites.length);
  });

  test('fixes.json: the user\'s two acceptance-target hosts are present', () => {
    const fixes = readJSON(path.join(DATA_DIR, 'fixes.json'));
    const allURLs = fixes.sites.flatMap((s) => s.url);
    expect(allURLs).toContain('mail.google.com');
    expect(allURLs).toContain('github.com');
  });

  test('hints.json: pinned commit, hint count', () => {
    const hints = readJSON(path.join(DATA_DIR, 'hints.json'));
    expect(hints.commit).toBe(PINNED_COMMIT);
    expect(hints.hints.length).toBeGreaterThanOrEqual(200);
    expect(hints.count).toBe(hints.hints.length);
  });
});

test.describe('AC-24 importer idempotency', () => {
  test('two runs to a scratch dir produce byte-identical output', () => {
    const tmpBase = path.join(REPO_ROOT, 'tests', '.tmp');
    const run1 = path.join(tmpBase, 'b6a-run1');
    const run2 = path.join(tmpBase, 'b6a-run2');
    fs.rmSync(run1, { recursive: true, force: true });
    fs.rmSync(run2, { recursive: true, force: true });

    const importScript = path.join(REPO_ROOT, 'scripts', 'import-fixes.js');
    execFileSync('node', [importScript, '--out', run1], { cwd: REPO_ROOT, stdio: 'pipe' });
    execFileSync('node', [importScript, '--out', run2], { cwd: REPO_ROOT, stdio: 'pipe' });

    const fixes1 = fs.readFileSync(path.join(run1, 'fixes.json'));
    const fixes2 = fs.readFileSync(path.join(run2, 'fixes.json'));
    const hints1 = fs.readFileSync(path.join(run1, 'hints.json'));
    const hints2 = fs.readFileSync(path.join(run2, 'hints.json'));

    expect(fixes1.equals(fixes2)).toBe(true);
    expect(hints1.equals(hints2)).toBe(true);

    // Also matches what's actually committed, so the two data files aren't stale.
    const committedFixes = fs.readFileSync(path.join(DATA_DIR, 'fixes.json'));
    const committedHints = fs.readFileSync(path.join(DATA_DIR, 'hints.json'));
    expect(fixes1.equals(committedFixes)).toBe(true);
    expect(hints1.equals(committedHints)).toBe(true);

    fs.rmSync(run1, { recursive: true, force: true });
    fs.rmSync(run2, { recursive: true, force: true });
  });
});
