// content.js v1 (B2): settings-aware lifecycle, live updates, flash
// prevention (SPECS §6.2 steps 0-9, minus the detector). B3 adds detection —
// see the "// B3: detection" seam in rerun() below, which currently always
// enables on any `wantDark` regardless of `ignoreDark` or a prior 'skip'
// hint (steps 4/5/6 collapse into one branch until B3 exists).
try {
  const FIXES = {}; // single module-level constant (AN §step 7 / mistake-proofing)

  // Fallback CSS text verbatim per B2.md step 2 / AN §step 1.
  const FALLBACK_CSS =
    'html, body, body :not(iframe) { background-color:#181a1b !important; border-color:#776e62 !important; color:#e8e6e3 !important; } ' +
    'html, body { opacity:1 !important; transition:none !important; }';

  let applied = false;
  let detectedDark = false; // B3 sets this from the detector; always false in v1 (SPECS §4.2)
  let fallbackNode = null;
  let osDark = matchMedia('(prefers-color-scheme: dark)').matches;
  let topHost = '';
  let store = null;

  function readHint() {
    try {
      return sessionStorage.getItem('bdm:hint');
    } catch {
      return null;
    }
  }

  // Only the top frame writes: sessionStorage is shared by same-origin frames
  // of the tab, and a subframe must never overwrite the top's hint.
  function writeHint(value) {
    if (window !== window.top) {
      return;
    }
    try {
      sessionStorage.setItem('bdm:hint', value);
    } catch {
      // ignore (e.g. SecurityError in a sandboxed/opaque-origin frame)
    }
  }

  function insertFallbackNode() {
    fallbackNode = document.createElement('style');
    fallbackNode.className = 'darkreader darkreader--fallback';
    fallbackNode.media = 'screen';
    fallbackNode.textContent = FALLBACK_CSS;
    (document.head ?? document.documentElement).appendChild(fallbackNode);
  }

  function removeFallbackNode() {
    fallbackNode?.parentNode?.removeChild(fallbackNode);
    fallbackNode = null;
  }

  // AN §step 7(i): if head exists and our node's parent isn't head, move it
  // there; if head is still null, leave it where it is (on documentElement).
  function placeFallbackNodeBeforeEnable() {
    if (fallbackNode && document.head && fallbackNode.parentNode !== document.head) {
      document.head.appendChild(fallbackNode);
    }
  }

  const bgFetch = async (url) => {
    const r = await __bdm.sendMessage({ type: 'bdm:fetch', url });
    if (!r?.ok) {
      throw new Error(r?.error ?? 'fetch-failed');
    }
    return fetch(r.dataUrl);
  };
  DarkReader.setFetchMethod(bgFetch); // once, before any enable() call

  function enableTheme() {
    placeFallbackNodeBeforeEnable();
    if (!applied) {
      DarkReader.enable({}, FIXES);
      applied = true;
    }
  }

  function disableTheme() {
    if (applied) {
      DarkReader.disable();
      applied = false;
    }
    removeFallbackNode();
  }

  // Steps 2-6 (settings resolution + engine transition). Called on initial
  // load, on storage.onChanged, and after an OS color-scheme change.
  // Overlapping runs (onChanged while a previous loadStore() is pending)
  // must not commit stale decisions: only the latest run may transition.
  let runSeq = 0;
  async function rerun() {
    const mySeq = ++runSeq;
    try {
      topHost = BDM_SETTINGS.topHostOf(window);
      store = await BDM_SETTINGS.loadStore();
      if (mySeq !== runSeq) return;
      const r = BDM_SETTINGS.resolve(topHost, store, osDark);

      if (!r.wantDark) {
        disableTheme();
        writeHint('skip');
        return;
      }

      // B3: detection — steps 5/6 split here (detect-before-enable when
      // hint === 'skip', detect-after-enable otherwise, and `ignoreDark`
      // skips detection entirely). v1 has no detector.js yet, so any
      // `wantDark` enables unconditionally.
      enableTheme();
      writeHint('dark');
    } catch (err) {
      console.warn('[bdm]', err);
    }
  }

  // Step 1, sync at document_start: read the hint, insert the fallback
  // before any async work so the very first paint is never a flash.
  const hint = readHint();
  if (hint === 'dark' || (hint == null && osDark)) {
    insertFallbackNode();
  }

  rerun();

  __bdm.api.storage.onChanged.addListener((_changes, area) => {
    if (area === 'local') {
      rerun();
    }
  });

  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    osDark = e.matches;
    detectedDark = false;
    setTimeout(rerun, 50);
  });

  __bdm.api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('bdm:')) {
      return undefined;
    }
    if (msg.type === 'bdm:status') {
      if (window !== window.top) {
        return undefined; // only the top frame answers (SPECS §4.2)
      }
      const currentStore = store ?? BDM_SETTINGS.normalizeStore(undefined);
      const r = BDM_SETTINGS.resolve(topHost, currentStore, osDark);
      sendResponse({
        host: topHost,
        defaults: currentStore.defaults,
        siteEnabled: r.siteEnabled,
        siteIgnoreDark: r.siteIgnoreDark,
        enabled: r.enabled,
        ignoreDark: r.ignoreDark,
        wantDark: r.wantDark,
        osDark,
        applied,
        detectedDark
      });
      // No `return true`: the status is computed synchronously above and
      // `sendResponse` is called before this listener returns.
      return undefined;
    }
    return undefined;
  });
} catch (err) {
  console.warn('[bdm]', err);
}
