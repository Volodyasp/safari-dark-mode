// B2+ test helpers: wraps B1's `ext` fixture (tests/helpers/extension.js) to
// also install a flash-detection recorder on the persistent (extension)
// context, and re-derives the per-test fixtures from it. B2+ specs import
// `test`/`expect` from here instead of ./extension.js directly.
'use strict';

const { test: base, expect, storageSet, storageClear } = require('./extension');

// Installed once per worker via context.addInitScript, so it runs before any
// page script on every document (including subframes). Fills
// window.__bdmProbe, which light.html's own head script (B1, unmodified)
// reads to set fallbackAtFirstScript.
async function installRecorder(context) {
  await context.addInitScript(() => {
    window.__bdmProbe = { fallbackAtFirstScript: null, modeLog: [] };
    // Guard: addInitScript also runs against the browser's transient
    // placeholder document for a new frame (before any real navigation
    // commits), which can have no <html> element yet.
    if (document.documentElement) {
      const observer = new MutationObserver(() => {
        window.__bdmProbe.modeLog.push(document.documentElement.getAttribute('data-darkreader-mode'));
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-darkreader-mode'] });
    }
  });
}

const test = base.extend({
  ext: [
    async ({ ext }, use) => {
      await installRecorder(ext.context);
      await use(ext);
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
  }
});

async function darkreaderNodeCount(pageOrFrame) {
  return pageOrFrame.evaluate(() => document.querySelectorAll('.darkreader').length);
}

async function readHint(page) {
  return page.evaluate(() => {
    try {
      return sessionStorage.getItem('bdm:hint');
    } catch {
      return null;
    }
  });
}

async function bodyLightness(pageOrFrame) {
  return pageOrFrame.evaluate(() => {
    const match = getComputedStyle(document.body).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return null;
    const [, r, g, b] = match.map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
}

async function isThemed(pageOrFrame) {
  return pageOrFrame.evaluate(() => document.documentElement.getAttribute('data-darkreader-mode') === 'dynamic');
}

module.exports = { test, expect, storageSet, storageClear, darkreaderNodeCount, readHint, bodyLightness, isThemed };
