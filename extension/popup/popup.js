// Popup (SPECS §6.1, §5). Classic script; loads after ../lib/api.js and
// ../lib/settings.js (popup.html script order). Popup only ever SENDS
// messages — it never registers `onMessage` (NFR-7 / mistake-proofing).
(function () {
  const api = __bdm.api;

  const els = {
    siteSection: document.getElementById('site-section'),
    host: document.getElementById('host'),
    banner: document.getElementById('banner'),
    ignoreDetected: document.getElementById('ignore-detected'),
    siteEnabled: document.getElementById('site-enabled'),
    siteIgnore: document.getElementById('site-ignore'),
    unavailable: document.getElementById('unavailable'),
    defaultEnabled: document.getElementById('default-enabled'),
    defaultIgnore: document.getElementById('default-ignore')
  };

  const siteEnabledDefaultOption = els.siteEnabled.querySelector('option[value="default"]');
  const siteIgnoreDefaultOption = els.siteIgnore.querySelector('option[value="default"]');

  function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }

  // The active tab's id, resolved once: explicit `?tabId=` (popup opened as
  // an extension page, e.g. by tests) wins over the real toolbar-popup tab.
  async function resolveTabId() {
    const fromQuery = Number(new URLSearchParams(location.search).get('tabId'));
    if (fromQuery) {
      return fromQuery;
    }
    const [activeTab] = await api.tabs.query({ active: true, currentWindow: true });
    return activeTab?.id;
  }

  // Unavailable when: the tab can't be found, its URL isn't http(s) (chrome://,
  // closed tab, etc.), the top frame throws/rejects, or it never replies.
  async function fetchStatus(tabId) {
    if (!tabId) {
      return null;
    }

    let tab;
    try {
      tab = await api.tabs.get(tabId);
    } catch {
      tab = null;
    }
    // `url` is absent without the `tabs` permission for browser-internal
    // pages (chrome://…), so those fall through to the sendMessage throw
    // below; this check only catches schemes host_permissions do expose.
    if (tab?.url && !/^https?:/.test(tab.url)) {
      return null;
    }

    try {
      const status = await api.tabs.sendMessage(tabId, { type: 'bdm:status' }, { frameId: 0 });
      if (!status || status.host === '') {
        return null;
      }
      return status;
    } catch {
      return null;
    }
  }

  let tabId;
  let currentHost = null; // never write sites[''] — null until a valid status names a host

  function renderDefaultsSection(defaults) {
    siteEnabledDefaultOption.textContent = `Default (${capitalize(defaults.enabled)})`;
    siteIgnoreDefaultOption.textContent = `Default (${defaults.ignoreDark ? 'On' : 'Off'})`;
    els.defaultEnabled.value = defaults.enabled;
    els.defaultIgnore.value = defaults.ignoreDark ? 'on' : 'off';
  }

  async function render() {
    const [status, store] = await Promise.all([fetchStatus(tabId), BDM_SETTINGS.loadStore()]);
    const defaults = status?.defaults ?? store.defaults;
    renderDefaultsSection(defaults);

    if (!status) {
      currentHost = null;
      els.siteSection.hidden = true;
      els.unavailable.hidden = false;
      return;
    }

    currentHost = status.host;
    els.unavailable.hidden = true;
    els.siteSection.hidden = false;

    els.host.textContent = status.host;

    const bannerVisible = status.wantDark && !status.ignoreDark && status.detectedDark;
    els.banner.hidden = !bannerVisible;

    els.siteEnabled.value = status.siteEnabled ?? 'default';
    els.siteIgnore.value = status.siteIgnoreDark === null ? 'default' : status.siteIgnoreDark ? 'on' : 'off';
  }

  // After a write, the content script re-resolves asynchronously via its own
  // storage.onChanged listener; poll once after it has had time to react,
  // then re-render (picks up a possibly-changed `detectedDark`/`applied`).
  function reRenderSoon() {
    setTimeout(render, 100);
  }

  async function writeSiteField(field, value) {
    if (!currentHost) {
      return; // unavailable / no host yet — never write sites['']
    }
    const store = await BDM_SETTINGS.loadStore();
    const nextSites = BDM_SETTINGS.withSiteField(store.sites, currentHost, field, value);
    await BDM_SETTINGS.saveSites(nextSites);
    reRenderSoon();
  }

  async function writeDefaultsField(field, value) {
    const store = await BDM_SETTINGS.loadStore();
    await BDM_SETTINGS.saveDefaults({ ...store.defaults, [field]: value });
    reRenderSoon();
  }

  els.siteEnabled.addEventListener('change', () => {
    const value = els.siteEnabled.value;
    writeSiteField('enabled', value === 'default' ? null : value);
  });

  els.siteIgnore.addEventListener('change', () => {
    const value = els.siteIgnore.value;
    writeSiteField('ignoreDark', value === 'default' ? null : value === 'on');
  });

  els.ignoreDetected.addEventListener('click', () => {
    writeSiteField('ignoreDark', true);
  });

  els.defaultEnabled.addEventListener('change', () => {
    writeDefaultsField('enabled', els.defaultEnabled.value);
  });

  els.defaultIgnore.addEventListener('change', () => {
    writeDefaultsField('ignoreDark', els.defaultIgnore.value === 'on');
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      render();
    }
  });

  (async () => {
    tabId = await resolveTabId();
    await render();
  })();
})();
