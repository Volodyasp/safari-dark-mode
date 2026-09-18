// Playwright fixtures for loading extension/ as an unpacked extension in the
// bundled Chromium (SPECS §8, AN §Validation). B1 specs import test/expect
// from here directly; B2+ specs import from tests/helpers/probes.js, which
// wraps this file's `ext` fixture to also install the flash-detection recorder.
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { chromium, test: base, expect } = require('@playwright/test');
const { startServers, stopServers } = require('./server');

const EXTENSION_PATH = path.join(__dirname, '..', '..', 'extension');
const PROFILE_DIR = path.join(__dirname, '..', '.profile');
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures');

// AC-3's cross-origin fixture uses a real-shaped https origin (not IP/loopback,
// not in the vendored engine's `localAliases`/`localSubDomains` block-list —
// see HANDOFF.md B1 finding) so the vendored darkreader.js's own
// `shouldIgnoreCors` gate lets its CSS-fetch bridge through. Nothing on the
// network actually resolves `cdn.example`; this route serves tests/fixtures/
// for it instead, from both page navigations and the background service
// worker's own `fetch()` (fetchAsDataUrl).
async function routeCdnExample(context) {
  await context.route('https://cdn.example/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const filePath = path.join(FIXTURES_DIR, pathname);
    if (!filePath.startsWith(FIXTURES_DIR)) {
      await route.fulfill({ status: 403, body: 'Forbidden' });
      return;
    }
    try {
      const body = fs.readFileSync(filePath);
      await route.fulfill({ status: 200, contentType: 'text/css', body });
    } catch {
      await route.fulfill({ status: 404, body: 'Not found' });
    }
  });
}

async function storageSet(sw, obj) {
  await sw.evaluate((data) => chrome.storage.local.set(data), obj);
}

async function storageClear(sw) {
  await sw.evaluate(() => chrome.storage.local.clear());
}

const test = base.extend({
  servers: [
    async ({}, use) => {
      const servers = await startServers();
      await use(servers);
      await stopServers(servers);
    },
    { scope: 'worker' }
  ],

  ext: [
    async ({ servers }, use) => {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
      fs.mkdirSync(PROFILE_DIR, { recursive: true });

      const context = await chromium.launchPersistentContext(PROFILE_DIR, {
        channel: 'chromium',
        headless: !process.env.HEADED,
        args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`]
      });

      await routeCdnExample(context);

      const sw =
        context.serviceWorkers().find((w) => w.url().includes('background.js')) ??
        (await context.waitForEvent('serviceworker', (w) => w.url().includes('background.js')));

      const extensionId = new URL(sw.url()).host;

      await use({ context, sw, extensionId });
      await context.close();
    },
    { scope: 'worker' }
  ],

  context: async ({ ext }, use) => {
    await use(ext.context);
  },

  sw: async ({ ext }, use) => {
    await use(ext.sw);
  },

  extensionId: async ({ ext }, use) => {
    await use(ext.extensionId);
  },

  page: async ({ ext }, use) => {
    const page = await ext.context.newPage();
    await use(page);
    await page.close();
  },

  // Automatic per-test isolation: never let one test's storage leak into the next.
  storageClearedPerTest: [
    async ({ sw }, use) => {
      await storageClear(sw);
      await use();
    },
    { auto: true }
  ]
});

module.exports = { test, expect, storageSet, storageClear };
