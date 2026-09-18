# MEMORY — root causes, what worked / failed

- darkreader@4.9.132 `shouldIgnoreCors` (vendor L276-297) refuses cross-origin CSS for http / non-default port / localhost / IP hosts BEFORE calling `setFetchMethod`'s fetcher → tests use `https://cdn.example` served via Playwright `context.route` (which does intercept extension SW `fetch()`).
- Playwright `context.addInitScript` runs before `<html>` exists → observe `document` for `documentElement` first; use `attributeOldValue` to recover transient attribute values within one microtask batch.
- Chrome 153 CSP message text: "violates the following Content Security Policy directive" (not "Refused to execute inline script").
- `chrome.tabs.get` returns no `url` for chrome:// tabs without the `tabs` permission; `<all_urls>` does not cover them.
- safari-web-extension-converter: `--bundle-identifier` goes to the extension target, app target id is derived from `--app-name` (different casing) → build fails on embedded-bundle prefix check; fix by rewriting the app target id post-conversion (scripts/safari-convert.sh).
- AC-3 flake root cause: reading bridged cross-origin styling right after `data-darkreader-mode` appears; bridged sheet lands asynchronously → poll.
