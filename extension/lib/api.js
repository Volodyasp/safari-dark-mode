// FIRST content script (and loaded by the popup): captures the native
// runtime.sendMessage before vendor/darkreader.js wraps chrome.runtime with a
// side-effecting shim that returns nothing (AN §Namespace + vendor wrapper).
// Idempotent: safe to load twice (manifest loads it once per frame; popup.html
// loads it again as a separate document).
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  if (globalThis.__bdm && globalThis.__bdm.api === api) {
    return;
  }
  globalThis.__bdm = {
    api,
    sendMessage: api.runtime.sendMessage.bind(api.runtime)
  };
})();
