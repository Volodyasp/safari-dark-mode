// B2 — unit-ish tests for extension/lib/settings.js (BDM_SETTINGS), run in a
// plain page with a stub __bdm.api.storage.local (no extension involved).
'use strict';

const path = require('node:path');
const { test, expect } = require('./helpers/probes');

const SETTINGS_PATH = path.join(__dirname, '..', 'extension', 'lib', 'settings.js');

async function loadSettings(page) {
  await page.goto('about:blank');
  await page.evaluate(() => {
    const data = {};
    window.__bdm = {
      api: {
        storage: {
          local: {
            get: async (keys) => {
              const result = {};
              for (const key of keys) {
                if (key in data) result[key] = data[key];
              }
              return result;
            },
            set: async (obj) => {
              Object.assign(data, obj);
            }
          }
        }
      }
    };
  });
  await page.addScriptTag({ path: SETTINGS_PATH });
}

test.describe('BDM_SETTINGS.DEFAULTS', () => {
  test('is enabled:auto, ignoreDark:false', async ({ page }) => {
    await loadSettings(page);
    const defaults = await page.evaluate(() => window.BDM_SETTINGS.DEFAULTS);
    expect(defaults).toEqual({ enabled: 'auto', ignoreDark: false });
  });
});

test.describe('BDM_SETTINGS.resolve', () => {
  test('matrix over enabled x osDark', async ({ page }) => {
    await loadSettings(page);
    const results = await page.evaluate(() => {
      const store = { v: 1, defaults: { enabled: 'auto', ignoreDark: false }, sites: {} };
      const cases = [];
      for (const enabled of ['default', 'auto', 'on', 'off']) {
        for (const osDark of [true, false]) {
          const testStore =
            enabled === 'default'
              ? store
              : { ...store, sites: { host: { enabled } } };
          const r = window.BDM_SETTINGS.resolve('host', testStore, osDark);
          cases.push({ enabled, osDark, wantDark: r.wantDark, resolvedEnabled: r.enabled });
        }
      }
      return cases;
    });

    const expected = [
      { enabled: 'default', osDark: true, wantDark: true, resolvedEnabled: 'auto' },
      { enabled: 'default', osDark: false, wantDark: false, resolvedEnabled: 'auto' },
      { enabled: 'auto', osDark: true, wantDark: true, resolvedEnabled: 'auto' },
      { enabled: 'auto', osDark: false, wantDark: false, resolvedEnabled: 'auto' },
      { enabled: 'on', osDark: true, wantDark: true, resolvedEnabled: 'on' },
      { enabled: 'on', osDark: false, wantDark: true, resolvedEnabled: 'on' },
      { enabled: 'off', osDark: true, wantDark: false, resolvedEnabled: 'off' },
      { enabled: 'off', osDark: false, wantDark: false, resolvedEnabled: 'off' }
    ];
    expect(results).toEqual(expected);
  });

  test('siteIgnoreDark falls back to defaults.ignoreDark', async ({ page }) => {
    await loadSettings(page);
    const r = await page.evaluate(() => {
      const store = { v: 1, defaults: { enabled: 'on', ignoreDark: true }, sites: {} };
      return window.BDM_SETTINGS.resolve('host', store, false);
    });
    expect(r.ignoreDark).toBe(true);
    expect(r.siteIgnoreDark).toBeNull();
  });
});

test.describe('BDM_SETTINGS.withSiteField', () => {
  test('deletes the field and the empty site object', async ({ page }) => {
    await loadSettings(page);
    const result = await page.evaluate(() => {
      const withField = window.BDM_SETTINGS.withSiteField({}, 'a.com', 'enabled', 'on');
      const withDeleted = window.BDM_SETTINGS.withSiteField(withField, 'a.com', 'enabled', null);
      return { withField, withDeleted };
    });
    expect(result.withField).toEqual({ 'a.com': { enabled: 'on' } });
    expect(result.withDeleted).toEqual({});
  });

  test('keeps the site object when another field remains', async ({ page }) => {
    await loadSettings(page);
    const result = await page.evaluate(() => {
      const sites = { 'a.com': { enabled: 'on', ignoreDark: true } };
      return window.BDM_SETTINGS.withSiteField(sites, 'a.com', 'enabled', null);
    });
    expect(result).toEqual({ 'a.com': { ignoreDark: true } });
  });

  test('ignores host === "" and does not mutate the input', async ({ page }) => {
    await loadSettings(page);
    const result = await page.evaluate(() => {
      const sites = { 'a.com': { enabled: 'on' } };
      const next = window.BDM_SETTINGS.withSiteField(sites, '', 'enabled', 'off');
      return { next, sitesUnchanged: sites };
    });
    expect(result.next).toEqual({ 'a.com': { enabled: 'on' } });
    expect(result.sitesUnchanged).toEqual({ 'a.com': { enabled: 'on' } });
  });
});

test.describe('BDM_SETTINGS.normalizeStore', () => {
  test('drops invalid fields/hosts and falls back to defaults', async ({ page }) => {
    await loadSettings(page);
    const normalized = await page.evaluate(() =>
      window.BDM_SETTINGS.normalizeStore({ sites: 'x', defaults: { enabled: 'weird' } })
    );
    expect(normalized).toEqual({ v: 1, defaults: { enabled: 'auto', ignoreDark: false }, sites: {} });
  });

  test('drops an invalid host entry but keeps a valid sibling', async ({ page }) => {
    await loadSettings(page);
    const normalized = await page.evaluate(() =>
      window.BDM_SETTINGS.normalizeStore({
        sites: { '': { enabled: 'on' }, 'ok.com': { enabled: 'on' }, 'bad.com': { enabled: 'nope' } }
      })
    );
    expect(normalized.sites).toEqual({ 'ok.com': { enabled: 'on' } });
  });

  test('undefined/null input normalizes to an empty, default store', async ({ page }) => {
    await loadSettings(page);
    const normalized = await page.evaluate(() => window.BDM_SETTINGS.normalizeStore(undefined));
    expect(normalized).toEqual({ v: 1, defaults: { enabled: 'auto', ignoreDark: false }, sites: {} });
  });
});
