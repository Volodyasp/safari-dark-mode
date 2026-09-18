// B3 — AC-12a, AC-13, AC-14, AC-15, AC-10b, and an AC-9 re-check with a
// built-in-dark frame. Every test that expects theming/detection first
// establishes `wantDark` explicitly (headless Chromium defaults to light).
'use strict';

const { test, expect, storageSet, readHint, darkreaderNodeCount, isThemed, modeLog } = require('./helpers/probes');

test.describe('AC-12a built-in dark sites are left untouched', () => {
  test('dark-meta.html: 0 .darkreader nodes, hint === "skip"', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' }); // fresh defaults => wantDark, not from Off
    await page.goto('http://127.0.0.1:4180/dark-meta.html');
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');
    await expect.poll(() => darkreaderNodeCount(page)).toBe(0);
  });

  test('dark-bg.html: 0 .darkreader nodes, hint === "skip"', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');
    await expect.poll(() => darkreaderNodeCount(page)).toBe(0);
  });

  test('light.html is unaffected: themed, hint === "dark"', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => readHint(page)).toBe('dark');
  });
});

test.describe('AC-10b no fallback flash on a detected-dark page\'s next load', () => {
  test('after hint === "skip", the next load never injects the fallback', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');

    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    const flag = await page.evaluate(() => window.__bdmProbe.fallbackAtFirstScript);
    expect(flag).toBe(false);
  });
});

test.describe('AC-13 Ignore Dark Mode forces theming of a built-in-dark site', () => {
  test('site ignoreDark:true themes dark-bg.html, hint === "dark"', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { sites: { '127.0.0.1': { ignoreDark: true } } });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => readHint(page)).toBe('dark');
  });

  test('defaults.ignoreDark:true themes dark-bg.html, hint === "dark"', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: true } });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => readHint(page)).toBe('dark');
  });
});

test.describe('AC-14 CSP-restricted pages degrade gracefully', () => {
  test('csp.html is themed; only CSP inline-script console errors; no pageerror', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/csp.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);

    expect(pageErrors).toEqual([]);
    // Chrome 153's actual wording is "Executing inline script violates the
    // following Content Security Policy directive ..." (SPECS AC-14 says
    // "Refused to execute inline script", an older Chrome message string;
    // recorded as a FACT correction in HANDOFF.md). Both this page's own
    // `script-src 'self'` header (blocking our deliberate inline <script>)
    // and the vendored engine's own inline proxy-script injection (blocked
    // by a separate, synthetic extension CSP — pre-existing, documented in
    // B1's HANDOFF section) produce this exact phrasing.
    const cspViolationPattern = /violates the following Content Security Policy directive/;
    // The browser's own /favicon.ico request 404s on every fixture (no favicon
    // served); it can land after the theming assertion and is unrelated to CSP.
    const faviconPattern = /404 \(Not Found\)/;
    const nonCspErrors = consoleErrors.filter(
      (text) => !cspViolationPattern.test(text) && !faviconPattern.test(text)
    );
    expect(nonCspErrors).toEqual([]);
    expect(consoleErrors.some((text) => cspViolationPattern.test(text) && text.includes("script-src 'self'"))).toBe(
      true
    );

    // The external, same-origin script (allowed by `script-src 'self'')
    // still ran, proving the page degrades gracefully rather than breaking.
    await expect(page.locator('body')).toContainText('csp.js ran');
  });
});

test.describe('AC-15 two-phase: engine runs once on a detected-dark page, never again', () => {
  test('first load: dynamic mode appears then hint becomes "skip"; repeat load: never dynamic', async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect.poll(() => modeLog(page)).toContain('dynamic');
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');

    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await page.waitForTimeout(500); // let a full rerun (incl. detection) settle
    expect(await modeLog(page)).toEqual([]);
  });
});

test.describe('AC-9 re-check with a built-in-dark same-origin frame', () => {
  test('top on: #same (dark-bg) stays untouched after detection, #cross (light) is themed', async ({
    page,
    sw
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storageSet(sw, { defaults: { enabled: 'on', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/iframe-dark.html');

    const sameFrame = page.frame({ url: /127\.0\.0\.1.*\/dark-bg\.html/ });
    const crossFrame = page.frame({ url: /localhost.*\/light\.html/ });

    await expect.poll(() => darkreaderNodeCount(sameFrame), { timeout: 5000 }).toBe(0);
    await expect.poll(() => isThemed(crossFrame)).toBe(true);
  });
});

test.describe('detectedDark symmetry (P1-1)', () => {
  test('ignoreDark on->off re-detects; then navigating to light.html shows detectedDark reset via hint', async ({
    page,
    sw
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });

    await storageSet(sw, { sites: { '127.0.0.1': { ignoreDark: true } } });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => readHint(page)).toBe('dark');

    await storageSet(sw, { sites: { '127.0.0.1': { ignoreDark: false } } });
    await expect.poll(() => darkreaderNodeCount(page)).toBe(0);
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');

    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => readHint(page)).toBe('dark');
  });
});
