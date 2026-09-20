// B6b — AC-27: extension/detector.js's hint-driven detection branch, loaded
// into a plain page's main world via addScriptTag (no extension involved).
'use strict';

const path = require('node:path');
const { test, expect } = require('./helpers/probes');

const DETECTOR_PATH = path.join(__dirname, '..', 'extension', 'detector.js');

async function loadDetector(page) {
  await page.goto('about:blank');
  await page.addScriptTag({ path: DETECTOR_PATH });
}

test.describe('AC-27 runDarkThemeDetector(cb, hints)', () => {
  test('noDarkTheme:true resolves false synchronously', async ({ page }) => {
    await loadDetector(page);
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let calledSync = true;
          window.BDM_DETECTOR.runDarkThemeDetector((hasDark) => {
            resolve({ hasDark, calledSync });
          }, [{ noDarkTheme: true }]);
          calledSync = false; // if the callback already ran, this line never executes first
        })
    );
    expect(result.hasDark).toBe(false);
    expect(result.calledSync).toBe(true);
  });

  test('systemTheme:true + OS dark resolves true', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await loadDetector(page);
    const hasDark = await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.BDM_DETECTOR.runDarkThemeDetector(resolve, [{ systemTheme: true }]);
        })
    );
    expect(hasDark).toBe(true);
  });

  test('systemTheme:true + OS light (no target): resolves false so a detect-first load still gets themed', async ({
    page
  }) => {
    // Real hint blocks with `systemTheme:true` and nothing else exist in
    // hints.json (e.g. `{"url":["msn.com"],"systemTheme":true}`). Upstream
    // would call `detectUsingHint` with `hint.target === undefined` and never
    // call back (harmless there: enable-first). Our detect-first path (hint
    // 'skip') would never theme the page, so the port answers false.
    await page.emulateMedia({ colorScheme: 'light' });
    await loadDetector(page);
    await page.evaluate(() => {
      document.body.innerHTML = '<div style="min-height:200px">light page</div>';
    });
    const result = await page.evaluate(
      () =>
        new Promise((resolve) => {
          window.BDM_DETECTOR.runDarkThemeDetector(resolve, [{ systemTheme: true }]);
        })
    );
    expect(result).toBe(false);
  });

  test('target/match hint resolves true once the target starts matching, ~200ms later', async ({ page }) => {
    await loadDetector(page);
    const elapsed = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const start = Date.now();
          window.BDM_DETECTOR.runDarkThemeDetector((hasDark) => {
            resolve({ hasDark, elapsed: Date.now() - start });
          }, [{ target: 'html', match: ['[data-theme="dark"]'] }]);
          setTimeout(() => {
            document.documentElement.setAttribute('data-theme', 'dark');
          }, 200);
        })
    );
    expect(elapsed.hasDark).toBe(true);
    expect(elapsed.elapsed).toBeGreaterThanOrEqual(150);
  });

  test('stopDarkThemeDetector before a hint-driven match cancels it', async ({ page }) => {
    await loadDetector(page);
    const fired = await page.evaluate(
      () =>
        new Promise((resolve) => {
          let calls = 0;
          window.BDM_DETECTOR.runDarkThemeDetector(() => {
            calls++;
          }, [{ target: 'html', match: ['[data-theme="dark"]'] }]);
          window.BDM_DETECTOR.stopDarkThemeDetector();
          document.documentElement.setAttribute('data-theme', 'dark');
          setTimeout(() => resolve(calls), 300);
        })
    );
    expect(fired).toBe(0);
  });

  test('without hints, falls back to plain MVP-style measurement (no regression)', async ({ page }) => {
    await loadDetector(page);
    const hasDark = await page.evaluate(
      () =>
        new Promise((resolve) => {
          document.documentElement.style.backgroundColor = '#111111';
          document.documentElement.style.color = '#dddddd';
          document.body.innerHTML = '<div style="min-height:200px">dark</div>';
          window.BDM_DETECTOR.runDarkThemeDetector(resolve);
        })
    );
    expect(hasDark).toBe(true);
  });
});
