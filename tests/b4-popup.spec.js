// B4 — AC-16..19 + AC-12b: popup renders site/defaults settings, writes
// follow the UI->storage table (SPECS §5), and unavailable states degrade
// without console errors.
'use strict';

const { test, expect, storageSet, readHint, isThemed } = require('./helpers/probes');

async function getTabId(sw, url) {
  const tabs = await sw.evaluate((u) => chrome.tabs.query({ url: u }), url);
  return tabs[0].id;
}

async function openPopup(context, extensionId, tabId, errors) {
  const popup = await context.newPage();
  if (errors) {
    popup.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    popup.on('pageerror', (err) => errors.push(err.message));
  }
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tabId=${tabId}`);
  return popup;
}

test.describe('AC-16 site section renders host, default labels, and the site override', () => {
  test('fresh store: host, "Default (Auto)"/"Default (Off)" labels, value "default"', async ({
    page,
    context,
    sw,
    extensionId
  }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    const tabId = await getTabId(sw, page.url());
    const errors = [];
    const popup = await openPopup(context, extensionId, tabId, errors);

    await expect(popup.locator('#host')).toHaveText('127.0.0.1');
    await expect(popup.locator('#site-enabled')).toHaveValue('default');
    await expect(popup.locator('#site-enabled option[value="default"]')).toHaveText('Default (Auto)');
    await expect(popup.locator('#site-ignore')).toHaveValue('default');
    await expect(popup.locator('#site-ignore option[value="default"]')).toHaveText('Default (Off)');

    expect(errors).toEqual([]);
    await popup.close();
  });

  test('after a site override, popup reflects it on (re)open', async ({ page, context, sw, extensionId }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    const tabId = await getTabId(sw, page.url());
    await storageSet(sw, { sites: { '127.0.0.1': { enabled: 'on' } } });

    const popup = await openPopup(context, extensionId, tabId);
    await expect(popup.locator('#site-enabled')).toHaveValue('on');
    await popup.close();
  });
});

test.describe('AC-17 writes follow the UI -> storage table', () => {
  test('site-enabled and site-ignore selects', async ({ page, context, sw, extensionId }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    const tabId = await getTabId(sw, page.url());
    const popup = await openPopup(context, extensionId, tabId);

    await popup.locator('#site-enabled').selectOption('auto');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('sites')))
      .toEqual({ sites: { '127.0.0.1': { enabled: 'auto' } } });

    await popup.locator('#site-enabled').selectOption('on');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('sites')))
      .toEqual({ sites: { '127.0.0.1': { enabled: 'on' } } });

    await popup.locator('#site-ignore').selectOption('on');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('sites')))
      .toEqual({ sites: { '127.0.0.1': { enabled: 'on', ignoreDark: true } } });

    await popup.locator('#site-enabled').selectOption('default');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('sites')))
      .toEqual({ sites: { '127.0.0.1': { ignoreDark: true } } });

    await popup.locator('#site-ignore').selectOption('default');
    await expect.poll(() => sw.evaluate(() => chrome.storage.local.get('sites'))).toEqual({ sites: {} });

    await popup.close();
  });

  test('default-enabled and default-ignore selects', async ({ page, context, sw, extensionId }) => {
    await page.goto('http://127.0.0.1:4180/light.html');
    const tabId = await getTabId(sw, page.url());
    const popup = await openPopup(context, extensionId, tabId);

    await popup.locator('#default-enabled').selectOption('off');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('defaults')))
      .toEqual({ defaults: { enabled: 'off', ignoreDark: false } });

    await popup.locator('#default-ignore').selectOption('on');
    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('defaults')))
      .toEqual({ defaults: { enabled: 'off', ignoreDark: true } });

    await popup.close();
  });
});

test.describe('AC-12b popup status reports detectedDark (banner visibility)', () => {
  test('dark-bg.html: banner visible (detectedDark true)', async ({ page, context, sw, extensionId }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');

    const tabId = await getTabId(sw, page.url());
    const popup = await openPopup(context, extensionId, tabId);
    await expect(popup.locator('#banner')).toBeVisible();
    await popup.close();
  });

  test('light.html: banner hidden (detectedDark false)', async ({ page, context, sw, extensionId }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await page.waitForFunction(() => document.documentElement.getAttribute('data-darkreader-mode') === 'dynamic');

    const tabId = await getTabId(sw, page.url());
    const popup = await openPopup(context, extensionId, tabId);
    await expect(popup.locator('#banner')).toBeHidden();
    await popup.close();
  });
});

test.describe('AC-18 "Ignore Detected Dark Mode" themes the site without reload', () => {
  test('click sets ignoreDark:true, themes the tab live, hides the banner', async ({
    page,
    context,
    sw,
    extensionId
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/dark-bg.html');
    await expect.poll(() => readHint(page), { timeout: 5000 }).toBe('skip');

    const tabId = await getTabId(sw, page.url());
    const errors = [];
    const popup = await openPopup(context, extensionId, tabId, errors);
    await expect(popup.locator('#banner')).toBeVisible();

    await popup.locator('#ignore-detected').click();

    await expect
      .poll(() => sw.evaluate(() => chrome.storage.local.get('sites')))
      .toEqual({ sites: { '127.0.0.1': { ignoreDark: true } } });
    await expect.poll(() => isThemed(page)).toBe(true);
    await expect(popup.locator('#banner')).toBeHidden();

    expect(errors).toEqual([]);
    await popup.close();
  });
});

test.describe('AC-19 unavailable pages', () => {
  test('a closed/nonexistent tab id shows #unavailable; storage untouched', async ({ context, sw, extensionId }) => {
    const before = await sw.evaluate(() => chrome.storage.local.get(null));
    const errors = [];
    const popup = await openPopup(context, extensionId, 999999, errors);

    await expect(popup.locator('#unavailable')).toBeVisible();
    await expect(popup.locator('#site-section')).toBeHidden();
    await expect(popup.locator('#defaults-section')).toBeVisible();

    const after = await sw.evaluate(() => chrome.storage.local.get(null));
    expect(after).toEqual(before);
    expect(errors).toEqual([]);
    await popup.close();
  });

  test('a chrome:// tab shows #unavailable; storage untouched', async ({ context, sw, extensionId }) => {
    const before = await sw.evaluate(() => chrome.storage.local.get(null));
    const chromeTabId = await sw.evaluate(async () => {
      const tab = await chrome.tabs.create({ url: 'chrome://version', active: false });
      return tab.id;
    });

    const errors = [];
    const popup = await openPopup(context, extensionId, chromeTabId, errors);
    await expect(popup.locator('#unavailable')).toBeVisible();
    await expect(popup.locator('#site-section')).toBeHidden();
    await expect(popup.locator('#defaults-section')).toBeVisible();

    const after = await sw.evaluate(() => chrome.storage.local.get(null));
    expect(after).toEqual(before);
    expect(errors).toEqual([]);

    await popup.close();
    await sw.evaluate((id) => chrome.tabs.remove(id), chromeTabId);
  });
});
