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

    // Extension content scripts run in an isolated JS world: they share the
    // DOM with this (main-world) addInitScript, but not JS objects or
    // prototypes, so patching Element.prototype here would never see their
    // setAttribute calls. MutationObserver operates on the shared DOM
    // itself, so it works across worlds — but its callback is a microtask
    // batch, so when the engine enables then immediately reverses itself
    // within one synchronous tick (AC-15's positive-detection case), both
    // mutations arrive in a single callback invocation. Reconstruct the
    // value produced by each individual mutation from `attributeOldValue`
    // instead of just sampling the end state.
    function attachAttributeObserver() {
      const observer = new MutationObserver((records) => {
        records.forEach((record, i) => {
          const isLast = i === records.length - 1;
          const valueAfterThisMutation = isLast
            ? document.documentElement.getAttribute('data-darkreader-mode')
            : records[i + 1].oldValue;
          window.__bdmProbe.modeLog.push(valueAfterThisMutation);
        });
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-darkreader-mode'],
        attributeOldValue: true
      });
    }

    // addInitScript runs before the HTML parser has created <html>, so
    // document.documentElement is null at this point for a real navigation
    // (confirmed empirically) — wait for it via a MutationObserver on
    // `document` itself, which always exists, instead of skipping setup.
    if (document.documentElement) {
      attachAttributeObserver();
    } else {
      const rootObserver = new MutationObserver(() => {
        if (document.documentElement) {
          rootObserver.disconnect();
          attachAttributeObserver();
        }
      });
      rootObserver.observe(document, { childList: true });
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

// The recorder's log of every `data-darkreader-mode` value seen since the
// current document started (AC-15: a repeat load of a detected-dark page
// must never show `'dynamic'` in this log — the engine never ran).
async function modeLog(page) {
  return page.evaluate(() => window.__bdmProbe?.modeLog ?? []);
}

module.exports = { test, expect, storageSet, storageClear, darkreaderNodeCount, readHint, bodyLightness, isThemed, modeLog };
