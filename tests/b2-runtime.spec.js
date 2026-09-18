// B2 — AC-5..11 (+AC-11b): settings resolution, live updates, flash
// prevention. Every test that expects theming establishes `wantDark`
// explicitly first (emulateMedia or storageSet) — headless Chromium defaults
// to light, and storage/sessionStorage are isolated per test/page.
'use strict';

const { test, expect, storageSet, darkreaderNodeCount, readHint, isThemed } = require('./helpers/probes');

test.describe('AC-5 defaults (Enabled=Auto follows OS scheme)', () => {
  test('dark OS => themed', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });
  });

  test('light OS => not themed', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');
  });
});

test.describe('AC-6 site override', () => {
  test('enabled:on + light OS => themed', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storageSet(sw, { sites: { '127.0.0.1': { enabled: 'on' } } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });
  });

  test('enabled:off + dark OS => not themed', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { sites: { '127.0.0.1': { enabled: 'off' } } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');
  });

  test('removing the override reverts to default behaviour', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { sites: { '127.0.0.1': { enabled: 'off' } } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');

    await storageSet(sw, { sites: {} });
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });
  });
});

test.describe('AC-7 live on/off toggling without reload', () => {
  test('on -> off removes the attribute and all .darkreader nodes; off -> on re-applies', async ({
    page,
    sw
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('http://127.0.0.1:4180/light.html');

    await storageSet(sw, { defaults: { enabled: 'on', ignoreDark: false } });
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });

    await storageSet(sw, { defaults: { enabled: 'off', ignoreDark: false } });
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');
    expect(await darkreaderNodeCount(page)).toBe(0);

    await storageSet(sw, { defaults: { enabled: 'on', ignoreDark: false } });
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });
  });

  test('repeated toggles: at most one fallback node, no duplicate user-agent style', async ({
    page,
    sw
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('http://127.0.0.1:4180/light.html');

    for (let i = 0; i < 3; i++) {
      await storageSet(sw, { defaults: { enabled: 'on', ignoreDark: false } });
      await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });
      await storageSet(sw, { defaults: { enabled: 'off', ignoreDark: false } });
      await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');
    }

    const fallbackCount = await page.evaluate(() => document.querySelectorAll('.darkreader--fallback').length);
    expect(fallbackCount).toBeLessThanOrEqual(1);
    const userAgentCount = await page.evaluate(() => document.querySelectorAll('.darkreader--user-agent').length);
    expect(userAgentCount).toBeLessThanOrEqual(1);
  });
});

test.describe('AC-8 live OS scheme change under Auto', () => {
  test('light -> dark applies, dark -> light removes, within 1500ms', async ({ page, sw }) => {
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.waitForTimeout(200);
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 1500 });

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 1500 });
  });
});

test.describe('AC-9 iframes resolve settings by top host', () => {
  test('top off => neither the same-origin nor cross-origin frame is themed', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storageSet(sw, { defaults: { enabled: 'off', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/iframe.html');
    await page.waitForTimeout(500);

    const sameFrame = page.frame({ url: /127\.0\.0\.1.*\/light\.html/ });
    const crossFrame = page.frame({ url: /localhost.*\/light\.html/ });
    expect(await isThemed(sameFrame)).toBe(false);
    expect(await isThemed(crossFrame)).toBe(false);
  });

  test('top on + light OS => both frames themed (top host governs the cross-origin frame)', async ({
    page,
    sw
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storageSet(sw, {
      defaults: { enabled: 'auto', ignoreDark: false },
      sites: { '127.0.0.1': { enabled: 'on' } }
    });
    await page.goto('http://127.0.0.1:4180/iframe.html');

    const sameFrame = page.frame({ url: /127\.0\.0\.1.*\/light\.html/ });
    const crossFrame = page.frame({ url: /localhost.*\/light\.html/ });
    await expect.poll(() => isThemed(sameFrame)).toBe(true);
    await expect.poll(() => isThemed(crossFrame)).toBe(true);
  });

  test('negative: sites.localhost=off does not affect the localhost frame embedded under a 127.0.0.1 top', async ({
    page,
    sw
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storageSet(sw, {
      defaults: { enabled: 'auto', ignoreDark: false },
      sites: { '127.0.0.1': { enabled: 'on' }, localhost: { enabled: 'off' } }
    });
    await page.goto('http://127.0.0.1:4180/iframe.html');

    const crossFrame = page.frame({ url: /localhost.*\/light\.html/ });
    await expect.poll(() => isThemed(crossFrame)).toBe(true);
  });
});

test.describe('AC-10a fallback (flash prevention) across reloads of the same tab', () => {
  test('second load: fallback exists when the first inline script runs', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });

    await page.goto('http://127.0.0.1:4180/light.html');
    const flag = await page.evaluate(() => window.__bdmProbe.fallbackAtFirstScript);
    expect(flag).toBe(true);
  });

  test('after switching off: fallback stays absent across reloads', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });

    await storageSet(sw, { defaults: { enabled: 'off', ignoreDark: false } });
    await expect(page.locator('html')).not.toHaveAttribute('data-darkreader-mode', 'dynamic');

    await page.goto('http://127.0.0.1:4180/light.html');
    await page.goto('http://127.0.0.1:4180/light.html');
    const flag = await page.evaluate(() => window.__bdmProbe.fallbackAtFirstScript);
    expect(flag).toBe(false);
  });
});

test.describe('AC-11 hint values', () => {
  test('hint is "dark" after theming, "skip" after Off', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect.poll(() => readHint(page)).toBe('dark');

    await storageSet(sw, { defaults: { enabled: 'off', ignoreDark: false } });
    await expect.poll(() => readHint(page)).toBe('skip');
  });
});

test.describe('AC-11b bdm:status and subframe hint isolation', () => {
  test('chrome.tabs.sendMessage with frameId 0 resolves the top-frame status', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 2000 });

    const tabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1:4180/light.html' });
      return tabs[0].id;
    });

    const status = await sw.evaluate(
      (id) => chrome.tabs.sendMessage(id, { type: 'bdm:status' }, { frameId: 0 }),
      tabId
    );
    expect(status.host).toBe('127.0.0.1');
    expect(status.applied).toBe(true);
    expect(status.wantDark).toBe(true);
  });

  test('same-origin subframe never writes the hint', async ({ page, sw }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await storageSet(sw, { defaults: { enabled: 'auto', ignoreDark: false } });
    await page.goto('http://127.0.0.1:4180/iframe.html');
    await page.waitForTimeout(300);

    await page.evaluate(() => sessionStorage.setItem('bdm:hint', 'marker'));
    await page.evaluate(() => {
      document.getElementById('same').contentWindow.location.reload();
    });
    await page.waitForTimeout(300);

    const hint = await page.evaluate(() => sessionStorage.getItem('bdm:hint'));
    expect(hint).toBe('marker');
  });
});
