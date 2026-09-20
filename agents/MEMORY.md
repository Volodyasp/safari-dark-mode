# MEMORY — root causes, what worked / failed

- darkreader@4.9.132 `shouldIgnoreCors` (vendor L276-297) refuses cross-origin CSS for http / non-default port / localhost / IP hosts BEFORE calling `setFetchMethod`'s fetcher → tests use `https://cdn.example` served via Playwright `context.route` (which does intercept extension SW `fetch()`).
- Playwright `context.addInitScript` runs before `<html>` exists → observe `document` for `documentElement` first; use `attributeOldValue` to recover transient attribute values within one microtask batch.
- Chrome 153 CSP message text: "violates the following Content Security Policy directive" (not "Refused to execute inline script").
- `chrome.tabs.get` returns no `url` for chrome:// tabs without the `tabs` permission; `<all_urls>` does not cover them.
- safari-web-extension-converter: `--bundle-identifier` goes to the extension target, app target id is derived from `--app-name` (different casing) → build fails on embedded-bundle prefix check; fix by rewriting the app target id post-conversion (scripts/safari-convert.sh).
- AC-3 flake root cause: reading bridged cross-origin styling right after `data-darkreader-mode` appears; bridged sheet lands asynchronously → poll.
- Chrome MV3 applies the EXTENSION's CSP to inline <script> inserted by content scripts → darkreader's inline proxy never runs on any page; fix = `content_scripts[].world: "MAIN"` entry (extension/proxy.js) installed on `__darkreader__cleanUp`, neutraliser `<script type="text/plain" class="darkreader--proxy">` so the engine's own injection is a no-op.
- Classic-script SW: top-level `let` is NOT a globalThis property; test seams must be `var` (or explicit `globalThis.x`).
- Detector hints: upstream `detectUsingHint` never calls back when `target` is missing (systemTheme-only hints); harmless enable-first upstream, fatal for detect-first → answer callback(false).
- `noDarkTheme` hint means "site has no dark theme" ⇒ detector answers false ⇒ theme applied (not "never theme").
