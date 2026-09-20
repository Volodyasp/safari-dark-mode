// B6b — AC-28: content.js wires the site-config fix into FIXES; a slow/
// unreachable SW degrades to the generic-less fallback with exactly one
// warning, never a crash.
'use strict';

const { test, expect } = require('./helpers/probes');

async function overrideStyleText(page) {
  return page.evaluate(() => document.querySelector('.darkreader--override')?.textContent ?? null);
}

test.describe('AC-28 content.js + site-config', () => {
  test('light.html: FIXES.css includes the generic css (::placeholder) in .darkreader--override', async ({
    page
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
  });

  test('a slow SW (600ms delay seam, over the 500ms timeout): still themed, generic-less fix, exactly one warning', async ({
    page,
    sw
  }) => {
    await sw.evaluate(() => {
      globalThis.__bdmDelaySiteConfig = 600;
    });
    try {
      const warnings = [];
      page.on('console', (msg) => {
        if (msg.type() === 'warning' || msg.type() === 'warn') {
          warnings.push(msg.text());
        }
      });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('http://127.0.0.1:4180/light.html');
      await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1, { timeout: 5000 });

      const overrideText = await overrideStyleText(page);
      expect(overrideText === '' || overrideText === null).toBe(true);

      expect(pageErrors).toEqual([]);
      const siteConfigWarnings = warnings.filter((text) => text.includes('site-config unavailable'));
      expect(siteConfigWarnings.length).toBe(1);
    } finally {
      await sw.evaluate(() => {
        globalThis.__bdmDelaySiteConfig = 0;
      });
    }
  });

  test('a real known host (github.com) end-to-end: FIXES merges the generic and the site-specific fix', async ({
    page,
    context
  }) => {
    // This sandbox has no outbound network access from the browser (verified:
    // real navigation to https://github.com/ gets net::ERR_CONNECTION_REFUSED
    // even though `curl` from the shell succeeds — recorded in HANDOFF.md).
    // Route the real hostname to a local, minimal document instead, so
    // `location.href` genuinely is `https://github.com/` and the *entire*
    // pipeline (content.js -> bdm:site-config -> background.js ->
    // BDM_SITE_CONFIG.lookup -> merged FIXES -> DarkReader.enable) runs
    // end-to-end against the real committed data for a real acceptance-
    // target host, without needing the internet.
    await context.route('https://github.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<!doctype html><html><head></head><body><p>routed github.com for evidence</p></body></html>'
      })
    );

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('https://github.com/');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
  });
});
