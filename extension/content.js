// content.js v0 (B1): always-on engine wiring. B2 replaces this with the full
// settings-aware lifecycle (AN §Runtime sequence); B3 adds detection.
try {
  const FIXES = {}; // single module-level constant (AN §step 7 / mistake-proofing)

  const bgFetch = async (url) => {
    const r = await __bdm.sendMessage({ type: 'bdm:fetch', url });
    if (!r?.ok) {
      throw new Error(r?.error ?? 'fetch-failed');
    }
    return fetch(r.dataUrl);
  };

  DarkReader.setFetchMethod(bgFetch);
  DarkReader.enable({}, FIXES);

  __bdm.api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('bdm:')) {
      return undefined;
    }
    // B2 replaces this with the bdm:status handler.
    return undefined;
  });
} catch (err) {
  console.warn('[bdm]', err);
}
