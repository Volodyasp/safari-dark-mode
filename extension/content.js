// content.js v2 (B3): full lifecycle incl. built-in dark theme detection
// (SPECS §6.2 steps 0-9, all of them now).
try {
  // FIXES is a single module-level constant (AN §step 7 / mistake-proofing):
  // the engine's diff-vs-recreate check (node_modules/darkreader/
  // darkreader.js L8837 `if (prevTheme && prevFixes)`, L8854
  // `JSON.stringify(fixes) !== JSON.stringify(prevFixes)`) only takes the
  // fast path when the fixes content is unchanged between calls, but we
  // keep the exact same object reference too (never reassigned once set)
  // so there is no risk of an incidental key-order difference between two
  // independently-built objects ever being mistaken for a real change.
  // `null` until the site-config lookup resolves (B6b); set exactly once,
  // by `rerun()`, before the first `enableTheme()` call.
  let FIXES = null;
  let siteConfigHints = [];

  // Resolves to `fallbackValue` (and warns once) if `promise` doesn't
  // settle within `ms`, or if it rejects — whichever happens first, exactly
  // once (SPECS-11 §7 error handling).
  function withTimeout(promise, ms, fallbackValue) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.warn('[bdm] site-config unavailable');
          resolve(fallbackValue);
        }
      }, ms);
      promise.then(
        (value) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(value);
          }
        },
        () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            console.warn('[bdm] site-config unavailable');
            resolve(fallbackValue);
          }
        }
      );
    });
  }

  // B6d flash-reduction fix cache (SPECS-11 §4.2 delta): the pinned commit
  // `extension/data/fixes.json` was generated at. `content.js` cannot fetch
  // that file itself (no `web_accessible_resources`, and doing so from every
  // frame would defeat the whole point of caching), so this is a literal
  // duplicate of that file's top-level "commit" field — the only way to
  // validate a cached entry's `commit` synchronously, without waiting on the
  // very SW round-trip the cache exists to avoid. Residual: if the pinned
  // commit is ever bumped (`scripts/import-fixes.js`'s `IMPORT_COMMIT`
  // default, or a future `update-engine`) without updating this constant to
  // match, the cache silently stops being used (every read fails the
  // `commit` check) and every load falls back to asking the SW — no crash,
  // no wrong theme, just no speed-up until the two are back in sync.
  const FIXES_COMMIT = '3df6a4aacb7285859003eb1af3182e4370280b5e';
  const FIX_CACHE_KEY = 'bdm:fix';
  const FIX_CACHE_MAX_CHARS = 64 * 1024;

  // Read at document_start, once, synchronously, by every frame. `host`
  // matches against THIS frame's own `location.hostname`, not `topHost`:
  // `localStorage` is strictly origin-scoped, so any frame that can even see
  // an entry already shares the writer's origin — "own hostname" and
  // "topHost" coincide for every frame where the cache is reachable at all,
  // which makes a `topHost` comparison redundant (and wrong for a
  // same-origin subframe checking against a *different* top-level site's
  // cache key, which it could never see anyway).
  // Shallow shape check: the entry is page-writable, so a malformed `fix`
  // must degrade to a cache miss (SW path), not reach the engine.
  function isValidFixShape(fix) {
    if (!fix || typeof fix !== 'object') return false;
    if (fix.css !== undefined && typeof fix.css !== 'string') return false;
    for (const key of ['invert', 'ignoreInlineStyle', 'ignoreImageAnalysis', 'ignoreCSSUrl']) {
      if (fix[key] !== undefined && !Array.isArray(fix[key])) return false;
    }
    return true;
  }

  // Path is part of the key: 19 hosts ship path-scoped fixes (apple.com/shop
  // vs apple.com/macos, docs/drive/play.google.com), so a host-only hit would
  // serve the wrong section's fix. Pathname equality is stricter than the
  // matcher (extra misses on trailing-slash variants, never a wrong hit).
  function readFixCache() {
    try {
      const raw = localStorage.getItem(FIX_CACHE_KEY);
      if (!raw || raw.length > FIX_CACHE_MAX_CHARS) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        parsed.host !== location.hostname ||
        parsed.path !== location.pathname ||
        parsed.commit !== FIXES_COMMIT ||
        !isValidFixShape(parsed.fix) ||
        !Array.isArray(parsed.hints)
      ) {
        return null;
      }
      return { fix: parsed.fix, hints: parsed.hints };
    } catch {
      return null;
    }
  }

  // Top frame only, after a REAL (non-timeout-fallback) bdm:site-config
  // reply. Never re-enables anything now — this only affects the NEXT load
  // of this origin. Skips a degraded reply (`fix: null`, i.e. the SW's own
  // `data/*.json` load failed) so a transient SW failure is never cached as
  // a confirmed empty fix.
  function writeFixCache(reply) {
    if (window !== window.top || !reply || !reply.fix) {
      return;
    }
    try {
      const entry = {
        host: location.hostname,
        path: location.pathname,
        commit: reply.commit,
        fix: reply.fix,
        hints: reply.hints ?? [],
      };
      const serialized = JSON.stringify(entry);
      if (serialized.length > FIX_CACHE_MAX_CHARS) {
        return;
      }
      localStorage.setItem(FIX_CACHE_KEY, serialized);
    } catch {
      // ignore (quota, circular structures, SecurityError, etc.)
    }
  }

  // The real request always fires (background cache maintenance), in
  // parallel with the synchronous document_start work below (never delays
  // the fallback injection) — regardless of whether this load ends up using
  // a cached fix instead of waiting for this to resolve.
  const siteConfigRequest = __bdm.sendMessage({ type: 'bdm:site-config', url: location.href });
  siteConfigRequest.then(writeFixCache, () => {});

  // On a cache hit, `rerun()`'s `Promise.all([loadStore(), siteConfigPromise])`
  // below only ever waits on `loadStore()` — `Promise.resolve(cached)`
  // settles on the next microtask. On a miss, unchanged: the 500 ms timeout
  // fallback against the real request. Decided once, synchronously, before
  // any async work — same "computed once per document" spirit as `FIXES`.
  const cachedSiteConfig = readFixCache();
  const siteConfigPromise = cachedSiteConfig ? Promise.resolve(cachedSiteConfig) : withTimeout(siteConfigRequest, 500, { fix: null, hints: [] });

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

  // B6d: moved from `sessionStorage` (per-tab) to `localStorage` (shared by
  // every tab of the same origin) — a brand-new tab now inherits the most
  // recent decision instead of guessing by OS scheme alone, which is what
  // caused a wrong-guess flash whenever the guess and the real decision
  // disagreed (e.g. `Enabled=On` + light OS, or a `skip` site under dark
  // OS). One-release legacy fallback: if `localStorage` has no value yet,
  // read the old `sessionStorage` key once — the very next `writeHint()`
  // (which only ever targets `localStorage` now) completes the migration
  // for that origin without any explicit forward-write needed.
  function readHint() {
    try {
      const value = localStorage.getItem('bdm:hint');
      if (value !== null) {
        return value;
      }
    } catch {
      // fall through to the legacy read below
    }
    try {
      return sessionStorage.getItem('bdm:hint');
    } catch {
      return null;
    }
  }

  // Only the top frame writes: the hint is shared by same-origin frames
  // (and now same-origin tabs too), and a subframe must never overwrite it.
  function writeHint(value) {
    if (window !== window.top) {
      return;
    }
    try {
      localStorage.setItem('bdm:hint', value);
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
      const [freshStore, siteConfig] = await Promise.all([BDM_SETTINGS.loadStore(), siteConfigPromise]);
      if (mySeq !== runSeq) return;
      store = freshStore;
      if (FIXES === null) {
        // Computed exactly once per document, before the first enable().
        FIXES = siteConfig.fix ? { ...siteConfig.fix } : {};
      }
      siteConfigHints = siteConfig.hints ?? [];
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
        }, siteConfigHints);
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
      }, siteConfigHints);
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
