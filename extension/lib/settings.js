// Settings resolution (SPECS §4.1, §5). Shared by content scripts and the
// popup (both plain classic scripts, no bundler) — uses globalThis.__bdm.api,
// set up by lib/api.js, which must load first.
(function () {
  const ENABLED_VALUES = new Set(['auto', 'on', 'off']);

  const DEFAULTS = { enabled: 'auto', ignoreDark: false };

  // Any shape -> {v:1, defaults:{enabled, ignoreDark}, sites:{host:{enabled?, ignoreDark?}}}.
  // Invalid fields/hosts are dropped rather than rejected (SPECS §5: missing/invalid store
  // yields the defaults, no install-time seeding required).
  function normalizeStore(raw) {
    const rawDefaults = raw && typeof raw === 'object' ? raw.defaults : undefined;
    const defaults = normalizeDefaults(rawDefaults);

    const rawSites = raw && typeof raw === 'object' ? raw.sites : undefined;
    const sites = normalizeSites(rawSites);

    return { v: 1, defaults, sites };
  }

  function normalizeDefaults(rawDefaults) {
    const defaults = { ...DEFAULTS };
    if (!rawDefaults || typeof rawDefaults !== 'object') {
      return defaults;
    }
    if (ENABLED_VALUES.has(rawDefaults.enabled)) {
      defaults.enabled = rawDefaults.enabled;
    }
    if (typeof rawDefaults.ignoreDark === 'boolean') {
      defaults.ignoreDark = rawDefaults.ignoreDark;
    }
    return defaults;
  }

  function normalizeSites(rawSites) {
    const sites = {};
    if (!rawSites || typeof rawSites !== 'object') {
      return sites;
    }
    for (const host of Object.keys(rawSites)) {
      if (host === '') {
        continue;
      }
      const rawSite = rawSites[host];
      if (!rawSite || typeof rawSite !== 'object') {
        continue;
      }
      const site = {};
      if (ENABLED_VALUES.has(rawSite.enabled)) {
        site.enabled = rawSite.enabled;
      }
      if (typeof rawSite.ignoreDark === 'boolean') {
        site.ignoreDark = rawSite.ignoreDark;
      }
      if (Object.keys(site).length > 0) {
        sites[host] = site;
      }
    }
    return sites;
  }

  // Pure: {enabled, ignoreDark, wantDark, siteEnabled, siteIgnoreDark}.
  function resolve(host, store, osDark) {
    const site = store?.sites?.[host];
    const defaults = store?.defaults ?? DEFAULTS;

    const siteEnabled = site?.enabled ?? null;
    const siteIgnoreDark = typeof site?.ignoreDark === 'boolean' ? site.ignoreDark : null;

    const enabled = siteEnabled ?? defaults.enabled;
    const ignoreDark = siteIgnoreDark ?? defaults.ignoreDark;
    const wantDark = enabled === 'on' || (enabled === 'auto' && osDark);

    return { enabled, ignoreDark, wantDark, siteEnabled, siteIgnoreDark };
  }

  async function loadStore() {
    try {
      const raw = await globalThis.__bdm.api.storage.local.get(['v', 'defaults', 'sites']);
      return normalizeStore(raw);
    } catch {
      return normalizeStore(undefined);
    }
  }

  async function saveDefaults(defaults) {
    await globalThis.__bdm.api.storage.local.set({ defaults });
  }

  async function saveSites(sites) {
    await globalThis.__bdm.api.storage.local.set({ sites });
  }

  // Pure copy of `sites` with `sites[host][field]` set to `value`, or deleted when
  // `value === null` (dropping the site object too if it becomes empty). Ignores
  // host === '' (never persist a setting for an unknown/unavailable page).
  function withSiteField(sites, host, field, value) {
    if (host === '') {
      return sites;
    }
    const next = { ...sites };
    const nextSite = { ...(next[host] ?? {}) };

    if (value === null) {
      delete nextSite[field];
    } else {
      nextSite[field] = value;
    }

    if (Object.keys(nextSite).length === 0) {
      delete next[host];
    } else {
      next[host] = nextSite;
    }

    return next;
  }

  // Own hostname when this window is the top frame; otherwise the hostname of the
  // outermost recorded ancestor origin. Never throws (SPECS §4.1).
  function topHostOf(win) {
    try {
      if (win === win.top) {
        return win.location.hostname;
      }
      const ancestorOrigins = win.location.ancestorOrigins;
      const outermost = ancestorOrigins && ancestorOrigins.length > 0 ? ancestorOrigins[ancestorOrigins.length - 1] : '';
      if (outermost && outermost !== 'null') {
        return new URL(outermost).hostname;
      }
    } catch {
      // fall through to the own-hostname fallback below
    }
    try {
      return win.location.hostname;
    } catch {
      return '';
    }
  }

  globalThis.BDM_SETTINGS = {
    DEFAULTS,
    normalizeStore,
    resolve,
    loadStore,
    saveDefaults,
    saveSites,
    withSiteField,
    topHostOf
  };
})();
