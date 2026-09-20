// B6d — flash reduction: the flash-prevention hint and the site-config fix
// cache both moved from per-tab storage to localStorage (shared by every
// tab/frame of the same origin), so a brand-new tab inherits the previous
// decision instead of guessing by OS scheme, and a warm cache lets a repeat
// load of a known origin skip waiting on the service worker entirely.
'use strict';

const { test, expect, storageSet, readHint } = require('./helpers/probes');

// content.js's FIXES_COMMIT literal — must match extension/data/fixes.json's
// "commit" field for the cache to validate. Duplicated here (rather than
// read from disk) so the test exercises exactly the same synchronous string
// comparison content.js does.
const FIXES_COMMIT = '3df6a4aacb7285859003eb1af3182e4370280b5e';

async function overrideStyleText(page) {
  return page.evaluate(() => document.querySelector('.darkreader--override')?.textContent ?? null);
}

async function readFixCache(page) {
  return page.evaluate(() => localStorage.getItem('bdm:fix'));
}

test.describe('B6d hint cross-tab inheritance', () => {
  test('new tab inherits a previous "dark" decision (no OS-guess flash)', async ({ page, context, sw }) => {
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect.poll(() => readHint(page)).toBe('dark');

    // A brand-new tab, under a LIGHT OS scheme (so a pure OS-scheme guess
    // would decide against the fallback) must still see the fallback at
    // first script because localStorage already says 'dark'.
    const page2 = await context.newPage();
    await page2.emulateMedia({ colorScheme: 'light' });
    await page2.goto('http://127.0.0.1:4180/light.html');
    const flag = await page2.evaluate(() => window.__bdmProbe.fallbackAtFirstScript);
    expect(flag).toBe(true);
    await page2.close();
  });

  test('new tab inherits a previous "skip" decision (no wrong-guess flash under dark OS)', async ({
    page,
    context,
    sw
  }) => {
    await storageSet(sw, { defaults: { enabled: 'off', ignoreDark: false } });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect.poll(() => readHint(page)).toBe('skip');

    // A brand-new tab, still under a DARK OS scheme (so a pure OS-scheme
    // guess would insert the fallback) must NOT show the fallback because
    // localStorage already says 'skip'.
    const page2 = await context.newPage();
    await page2.emulateMedia({ colorScheme: 'dark' });
    await page2.goto('http://127.0.0.1:4180/light.html');
    const flag = await page2.evaluate(() => window.__bdmProbe.fallbackAtFirstScript);
    expect(flag).toBe(false);
    await page2.close();
  });
});

test.describe('B6d site-config fix cache', () => {
  test('cache hit: a slow SW (600ms delay seam) is skipped entirely — full fix, no warning, themed fast', async ({
    page,
    sw
  }) => {
    // Prime the cache with a real reply (no delay yet).
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
    await expect.poll(() => readFixCache(page)).not.toBeNull();

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

      const t0 = Date.now();
      await page.goto('http://127.0.0.1:4180/light.html');
      await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
      const elapsed = Date.now() - t0;

      await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
      const siteConfigWarnings = warnings.filter((text) => text.includes('site-config unavailable'));
      expect(siteConfigWarnings.length).toBe(0);
      expect(elapsed).toBeLessThan(200);
    } finally {
      await sw.evaluate(() => {
        globalThis.__bdmDelaySiteConfig = 0;
      });
    }
  });

  test('cache invalidation: wrong commit is ignored — falls back to the (slow) SW path', async ({ page, sw }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.evaluate(() => {
      localStorage.setItem(
        'bdm:fix',
        JSON.stringify({ host: '127.0.0.1', commit: 'not-the-real-commit', fix: { css: '' }, hints: [] })
      );
    });

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
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('http://127.0.0.1:4180/light.html');
      await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1, { timeout: 5000 });
      const siteConfigWarnings = warnings.filter((text) => text.includes('site-config unavailable'));
      expect(siteConfigWarnings.length).toBe(1);
    } finally {
      await sw.evaluate(() => {
        globalThis.__bdmDelaySiteConfig = 0;
      });
    }
  });

  test('cache invalidation: wrong host is ignored', async ({ page }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.evaluate((commit) => {
      localStorage.setItem(
        'bdm:fix',
        JSON.stringify({ host: 'not-this-host', commit, fix: { css: 'html{}' }, hints: [] })
      );
    }, FIXES_COMMIT);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    // The real (uncached) SW reply is used instead of the mismatched entry.
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
  });

  test('an oversize/garbage bdm:fix value is ignored without a page error', async ({ page }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.evaluate(() => {
      localStorage.setItem('bdm:fix', 'not json at all {{{');
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    expect(pageErrors).toEqual([]);

    // Valid JSON, valid host/path/commit, but oversize: must be a cache miss
    // (read-side cap), and the real SW reply is used.
    await page.evaluate((commit) => {
      localStorage.setItem(
        'bdm:fix',
        JSON.stringify({ host: '127.0.0.1', path: '/light.html', commit, fix: { css: 'x'.repeat(70 * 1024) }, hints: [] })
      );
    }, FIXES_COMMIT);
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
    expect(pageErrors).toEqual([]);
  });

  test('cache invalidation: a different path on the same host is a miss', async ({ page, sw }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.evaluate((commit) => {
      localStorage.setItem(
        'bdm:fix',
        JSON.stringify({ host: '127.0.0.1', path: '/other.html', commit, fix: { css: 'html{--bdm-stale:1}' }, hints: [] })
      );
    }, FIXES_COMMIT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
    expect(await overrideStyleText(page)).not.toContain('--bdm-stale');
  });

  test('a malformed fix shape (css not a string) is a miss, not an engine error', async ({ page }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await page.evaluate((commit) => {
      localStorage.setItem(
        'bdm:fix',
        JSON.stringify({ host: '127.0.0.1', path: '/light.html', commit, fix: { css: 42, invert: 'nope' }, hints: [] })
      );
    }, FIXES_COMMIT);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html[data-darkreader-mode="dynamic"]')).toHaveCount(1);
    await expect.poll(() => overrideStyleText(page)).toContain('::placeholder');
    expect(pageErrors).toEqual([]);
  });
});

test.describe('B6d subframe isolation (fix cache)', () => {
  test('a same-origin subframe never writes bdm:fix', async ({ page, sw }) => {
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('http://127.0.0.1:4180/iframe.html');
    await page.waitForTimeout(300);

    await page.evaluate(() => localStorage.setItem('bdm:fix', 'marker'));
    await page.evaluate(() => {
      document.getElementById('same').contentWindow.location.reload();
    });
    await page.waitForTimeout(300);

    expect(await readFixCache(page)).toBe('marker');
  });
});
