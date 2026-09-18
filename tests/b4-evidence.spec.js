// Not part of the AC suite: captures B4 HITL evidence screenshots into
// plans/mvp/evidence/B4/ (LOCAL, git-ignored). Run manually, not via
// `npm test`. Stands in for the manual toolbar-popup-in-real-Chrome and
// github.com checks (human-only, noted in HANDOFF.md).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('./helpers/probes');

const EVIDENCE_DIR = path.join(__dirname, '..', 'plans', 'mvp', 'evidence', 'B4');

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

async function getTabId(sw, url) {
  const tabs = await sw.evaluate((u) => chrome.tabs.query({ url: u }), url);
  return tabs[0].id;
}

// Popup opened via context.newPage() gets the default (large) viewport;
// shrink it to something popup-shaped so the evidence screenshots aren't
// mostly whitespace. The 320px body width itself comes from popup.css.
async function openPopupForScreenshot(context, extensionId, tabId) {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 480 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tabId=${tabId}`);
  return popup;
}

test('capture popup on light.html', async ({ page, context, sw, extensionId }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/light.html');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-darkreader-mode') === 'dynamic');
  const tabId = await getTabId(sw, page.url());

  const popup = await openPopupForScreenshot(context, extensionId, tabId);
  await popup.waitForSelector('#site-section:not([hidden])');
  await popup.screenshot({ path: path.join(EVIDENCE_DIR, 'popup-light.png') });
  await popup.close();
});

test('capture popup on dark-bg.html with the banner', async ({ page, context, sw, extensionId }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('http://127.0.0.1:4180/dark-bg.html');
  await page.waitForFunction(() => sessionStorage.getItem('bdm:hint') === 'skip');
  const tabId = await getTabId(sw, page.url());

  const popup = await openPopupForScreenshot(context, extensionId, tabId);
  await popup.waitForSelector('#banner:not([hidden])');
  await popup.screenshot({ path: path.join(EVIDENCE_DIR, 'popup-dark-bg-banner.png') });

  await popup.locator('#ignore-detected').click();
  await popup.waitForFunction(() => document.getElementById('banner').hidden);
  await popup.screenshot({ path: path.join(EVIDENCE_DIR, 'popup-after-ignore-detected.png') });
  await popup.close();
});

test('capture popup unavailable state', async ({ context, extensionId }) => {
  const popup = await openPopupForScreenshot(context, extensionId, 999999);
  await popup.waitForSelector('#unavailable:not([hidden])');
  await popup.screenshot({ path: path.join(EVIDENCE_DIR, 'popup-unavailable.png') });
  await popup.close();
});
