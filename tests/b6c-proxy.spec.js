// B6c — AC-28a/AC-28b: extension/proxy.js (MAIN-world stylesheet proxy).
// Negative control (step 1 RED run) is recorded in HANDOFF.md, not here —
// this file is the GREEN spec, run against the finished proxy.js + manifest
// entry.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect, storageSet } = require('./helpers/probes');

const PROXY_PATH = path.join(__dirname, '..', 'extension', 'proxy.js');
const MANIFEST_PATH = path.join(__dirname, '..', 'extension', 'manifest.json');

async function installProbe(page) {
  await page.addInitScript(() => {
    window.__bdmCspProbe = { allowed: [], updateSheet: [] };
    document.addEventListener('__darkreader__inlineScriptsAllowed', () => {
      window.__bdmCspProbe.allowed.push(document.documentElement.getAttribute('data-darkreader-mode'));
    });
    document.addEventListener(
      '__darkreader__updateSheet',
      (e) => {
        window.__bdmCspProbe.updateSheet.push(e.target.id);
      },
      true // capture phase, per the batch's spec
    );
  });
}

// `hostId` reaches into a shadow root's `.sbox`; `elementId` reads a plain
// element directly. Returns computed border-radius (string) and background
// lightness (0=black .. 1=white, or null if unparseable).
async function computedBoxState(page, { hostId, elementId }) {
  return page.evaluate(
    ({ hostId, elementId }) => {
      const el = hostId ? document.getElementById(hostId).shadowRoot.querySelector('.sbox') : document.getElementById(elementId);
      const style = getComputedStyle(el);
      const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      const lightness = match
        ? (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255
        : null;
      return { borderRadius: style.borderRadius, lightness };
    },
    { hostId, elementId }
  );
}

async function darkreaderProxyCount(page) {
  return page.evaluate(() => document.querySelectorAll('.darkreader--proxy').length);
}

async function insertRuleIsNative(page) {
  return page.evaluate(() =>
    Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype, 'insertRule').value.toString().includes('[native code]')
  );
}

async function anyDarkreaderOwnedSheet(page) {
  return page.evaluate(() => Array.from(document.styleSheets).some((s) => s.ownerNode?.classList.contains('darkreader')));
}

test.describe('AC-28a/AC-28b: csp-cssom.html end to end', () => {
  test('shadow DOM, last-sheet insertRule, and adopted stylesheets are all themed via the MAIN-world proxy', async ({
    page,
    sw
  }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await installProbe(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/csp-cssom.html');

    // AC-28a: themed, #base-box dark.
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect
      .poll(() => computedBoxState(page, { elementId: 'base-box' }).then((s) => s.lightness))
      .toBeLessThan(0.5);

    // run() round 1: last sheet is the page's own #base style (proof the
    // fixture is set up so that, without the proxy, page-authored
    // insertRule would land on the engine's own override sheet instead).
    const round1 = await page.evaluate(() => window.__cspCssom.run());
    expect(round1.lastSheetOwner).toBe('base');

    for (const target of [
      { hostId: 'host-1' },
      { elementId: 'sheet-box-1' },
      { elementId: 'adopted-box-1' }
    ]) {
      await expect
        .poll(async () => (await computedBoxState(page, target)).borderRadius, { timeout: 2000 })
        .toBe('7px');
      await expect
        .poll(async () => (await computedBoxState(page, target)).lightness, { timeout: 2000 })
        .toBeLessThan(0.5);
    }

    // AC-28b(i): while themed, insertRule is patched, no sheet is
    // ownerNode-classed `darkreader` (the engine's own override sheet is
    // hidden from document.styleSheets by the very same proxy), and the
    // neutraliser element is not double-installed.
    expect(await insertRuleIsNative(page)).toBe(false);
    expect(await anyDarkreaderOwnedSheet(page)).toBe(false);
    expect(await darkreaderProxyCount(page)).toBe(0);

    // AC-28b(ii): exactly one inlineScriptsAllowed (with the attribute
    // already present) and one updateSheet (target `base`, from round 1's
    // insertRule) so far.
    let probe = await page.evaluate(() => window.__bdmCspProbe);
    expect(probe.allowed).toEqual(['dynamic']);
    expect(probe.updateSheet).toEqual(['base']);

    // AC-28b(iii): Off -> native prototypes restored, no .darkreader nodes.
    await storageSet(sw, { sites: { '127.0.0.1': { enabled: 'off' } } });
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(0);
    expect(await insertRuleIsNative(page)).toBe(true);
    expect(await page.evaluate(() => document.querySelectorAll('.darkreader').length)).toBe(0);

    // On -> reinstalled; hint is 'skip' after Off, so this re-enable goes
    // through the detect-first path (SPECS-mvp §6.2 step 6) — no
    // `networkidle`, just the default locator timeout.
    await storageSet(sw, { sites: { '127.0.0.1': { enabled: 'on' } } });
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);

    const round2 = await page.evaluate(() => window.__cspCssom.run());
    expect(round2.round).toBe(2);
    for (const target of [{ hostId: 'host-2' }, { elementId: 'sheet-box-2' }, { elementId: 'adopted-box-2' }]) {
      await expect
        .poll(async () => (await computedBoxState(page, target)).borderRadius, { timeout: 2000 })
        .toBe('7px');
      await expect
        .poll(async () => (await computedBoxState(page, target)).lightness, { timeout: 2000 })
        .toBeLessThan(0.5);
    }

    probe = await page.evaluate(() => window.__bdmCspProbe);
    expect(probe.allowed).toEqual(['dynamic', 'dynamic']);
    expect(probe.updateSheet).toEqual(['base', 'base']);

    // AC-28b(iv): zero CSP console errors, zero page errors, for the whole
    // scenario above.
    expect(pageErrors).toEqual([]);
    const cspErrors = consoleErrors.filter((text) => /Content Security Policy/.test(text));
    expect(cspErrors).toEqual([]);
  });
});

test.describe('AC-28b(v): the extension-synthesized CSP error is gone on an ordinary page too', () => {
  test('light.html: themed, zero Content-Security-Policy console errors', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);

    const cspErrors = consoleErrors.filter((text) => /Content Security Policy/.test(text));
    expect(cspErrors).toEqual([]);
  });
});

test.describe('NFR-15 static checks (no browser needed)', () => {
  test('proxy.js: exactly one chrome|browser line (the world guard); no __bdm/DarkReader/eval/Function/postMessage', () => {
    const lines = fs.readFileSync(PROXY_PATH, 'utf8').split('\n');
    const codeLines = lines.filter((l) => !l.trim().startsWith('//'));

    const chromeBrowserLines = codeLines.filter((l) => /\b(chrome|browser)\b/.test(l));
    expect(chromeBrowserLines.length).toBe(1);
    expect(chromeBrowserLines[0]).toContain('runtime');

    const forbidden = codeLines.filter((l) => /\b__bdm\b|\bDarkReader\b|\beval\s*\(|new Function|postMessage/.test(l));
    expect(forbidden).toEqual([]);
  });

  test('manifest.json: first content_scripts entry deep-equals SPECS-11 §3', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    expect(manifest.content_scripts[0]).toEqual({
      matches: ['<all_urls>'],
      js: ['proxy.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
      world: 'MAIN'
    });
    expect(manifest.content_scripts[1]).toEqual({
      matches: ['<all_urls>'],
      js: ['lib/api.js', 'vendor/darkreader.js', 'lib/settings.js', 'detector.js', 'content.js'],
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true
    });
    expect(manifest.content_scripts.length).toBe(2);
  });
});
