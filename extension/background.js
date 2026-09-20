// Background = CORS fetch proxy + (B6b) site-config lookup. No
// onMessageExternal (SPECS §9 security boundary).
//
// importScripts note (SPECS-11 §3 says 'lib/settings.js','lib/url-match.js',
// 'lib/site-config.js'): `lib/settings.js` is NOT imported here yet.
// Checked: every one of its functions (loadStore/saveDefaults/saveSites/
// topHostOf) reads `globalThis.__bdm.api`, which only exists where
// `lib/api.js` has run — a content-script-only file, never loaded in the
// SW. Importing the *file* wouldn't throw by itself (the IIFE only
// assigns `globalThis.BDM_SETTINGS` at load time; nothing inside the
// function bodies runs yet), but the moment anything in the SW actually
// *called* one of its functions it would throw immediately
// (`Cannot read properties of undefined (reading 'api')`). Nothing in this
// batch's site-config feature needs it, so importing it now would be dead
// weight sitting on a landmine. `plans/v1.1/v11-PLAN.md`'s own batch table
// assigns "lib/settings.js v2 ... SW-safe: no `__bdm`" to B7 — that is
// where this gets fixed and where importing it here becomes safe.
importScripts('lib/url-match.js', 'lib/site-config.js');

const api = globalThis.browser ?? globalThis.chrome;

// top-level on purpose: test seam (AC-28) via sw.evaluate — `var`, not
// `let`/`const`: a classic script's top-level `let`/`const` bindings live
// in the script's lexical scope, not as a `globalThis` property, so
// `sw.evaluate(() => { globalThis.__bdmDelaySiteConfig = 600; })` would
// silently create an unrelated property and never reach this variable.
var __bdmDelaySiteConfig = 0;

const MAX_BYTES = 10 * 1024 * 1024;

// top-level on purpose: test seam (AC-4) via sw.evaluate
async function fetchAsDataUrl(url) {
  try {
    if (!/^https?:/.test(url)) {
      return { ok: false, error: 'bad-url' };
    }

    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, error: `http-${response.status}` };
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength !== null && Number(contentLength) > MAX_BYTES) {
      return { ok: false, error: 'too-large' };
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) {
      return { ok: false, error: 'too-large' };
    }

    const mime = (response.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim();
    const base64 = arrayBufferToBase64(buffer);
    return { ok: true, dataUrl: `data:${mime};base64,${base64}` };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err) };
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32 * 1024;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// SPECS-11 §4.2: content -> SW {type, url}; SW loads (once) then looks up.
// Reply shape (B6d delta): {fix, hints, commit} — `commit` (fixes.json's
// pinned commit, forwarded by BDM_SITE_CONFIG.lookup()) lets content.js
// validate its own localStorage fix cache without re-asking the SW. No
// logic change here: this function already forwards whatever lookup()
// returns.
async function handleSiteConfig(url) {
  await BDM_SITE_CONFIG.load();
  if (__bdmDelaySiteConfig > 0) {
    await new Promise((resolve) => setTimeout(resolve, __bdmDelaySiteConfig));
  }
  return BDM_SITE_CONFIG.lookup(url);
}

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'bdm:fetch') {
    fetchAsDataUrl(msg.url).then(sendResponse);
    return true;
  }
  if (msg?.type === 'bdm:site-config') {
    handleSiteConfig(msg.url).then(sendResponse);
    return true;
  }
  return undefined;
});
