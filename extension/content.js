// content.js v2 (B3): full lifecycle incl. built-in dark theme detection
// (SPECS §6.2 steps 0-9, all of them now).
try {
  const FIXES = {}; // single module-level constant (AN §step 7 / mistake-proofing)

  // Fallback CSS text verbatim per B2.md step 2 / AN §step 1.
  const FALLBACK_CSS =
    'html, body, body :not(iframe) { background-color:#181a1b !important; border-color:#776e62 !important; color:#e8e6e3 !important; } ' +
    'html, body { opacity:1 !important; transition:none !important; }';

  let applied = false;
  let detectedDark = false; // set only by detector callbacks; reset on OS-scheme change
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

  // Steps 2-6 (settings resolution + engine/detector transition). Called on
  // initial load, on storage.onChanged, and after an OS color-scheme change.
  // Overlapping runs (onChanged while a previous loadStore() — or a
  // previous run's detector callback — is still pending) must not commit
  // stale decisions: only the latest run (matching `runSeq`) may transition
  // state, checked both after `loadStore()` and inside every detector
  // callback below.
  let runSeq = 0;
  async function rerun() {
    const mySeq = ++runSeq;
    BDM_DETECTOR.stopDarkThemeDetector(); // never let two detector runs overlap
    try {
      topHost = BDM_SETTINGS.topHostOf(window);
      store = await BDM_SETTINGS.loadStore();
      if (mySeq !== runSeq) return;
      const r = BDM_SETTINGS.resolve(topHost, store, osDark);

      if (!r.wantDark) {
        // Step 3.
        disableTheme();
        writeHint('skip');
        return;
      }

      if (r.ignoreDark) {
        // Step 4: enable unconditionally, skip detection entirely, leave
        // `detectedDark` untouched (the banner condition already excludes
        // ignoreDark, per SPECS §6.2 step 6 / mistake-proofing).
        enableTheme();
        writeHint('dark');
        return;
      }

      if (readHint() === 'skip') {
        // Step 6: the hint says this site was built-in-dark last time —
        // detect BEFORE enabling, so a still-dark site is never
        // double-themed (engine is never invoked when detection is
        // positive).
        BDM_DETECTOR.runDarkThemeDetector((hasDark) => {
          if (mySeq !== runSeq) return; // superseded run: never transition state
          if (hasDark) {
            detectedDark = true; // stay off; hint is already 'skip'
          } else {
            detectedDark = false;
            enableTheme();
            writeHint('dark');
          }
        });
        return;
      }

      // Step 5: enable first (Dark Reader model), then detect; a positive
      // detection reverses the decision.
      enableTheme();
      BDM_DETECTOR.runDarkThemeDetector((hasDark) => {
        if (mySeq !== runSeq) return;
        if (hasDark) {
          disableTheme(); // gated by `applied`; also drops the (now engine-removed) fallbackNode ref
          detectedDark = true;
          writeHint('skip');
        } else {
          detectedDark = false;
          writeHint('dark');
        }
      });
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
    BDM_DETECTOR.stopDarkThemeDetector();
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
