# Product context

## Intent
A personal, minimal alternative to third-party dark-mode extensions (the
closed-source "Noir" app is the UI model this copies): darken every website
by default, without needing a per-site dark theme from each site, while
staying out of the way of sites that already have their own good dark mode.

## Target users
The author, on their own machine(s) (Chrome primary, Safari secondary). Not
built for distribution via the Chrome Web Store or the App Store — see the
non-goals in `README.md`.

## Defaults (Noir semantics)
- Enabled: **Auto** — follow the OS light/dark appearance.
- Ignore Built-In Dark Mode: **Off** — a site with its own working dark
  theme is left alone; the popup's "Ignore Detected Dark Mode" button
  overrides this per site.
- Per-site overrides for either setting take precedence over the defaults
  and can also be reset back to "Default".

## Key decisions
- **One unbundled `extension/` for both browsers.** Plain ES2020 classic
  scripts, no bundler, no TypeScript, no framework — the same files load in
  Chrome and (via a converter-generated wrapper) Safari.
- **Content script owns tab state; background is a fetch proxy only.** No
  background/service-worker map of tab state (which MV3's service-worker
  lifecycle would make fragile) — each frame's content script resolves its
  own settings and answers the popup directly.
- **Flash prevention via a same-tab session hint, not storage.** Reading
  `storage.local` is asynchronous, so the very first paint uses a
  synchronous `sessionStorage` hint (written by the top frame only) plus a
  pre-injected fallback stylesheet, both established in local design/review
  notes kept outside this repository (not published; summarized here and in
  `docs/ARCHITECTURE.md`).
- **Detection is a whole-file port of Dark Reader's own detector**, minus
  its "hints" configuration (out of scope) — same thresholds, so behaviour
  matches what Dark Reader itself would decide for a given page.
- **Popup asks the content script directly** (`tabs.sendMessage` with
  `frameId: 0`), rather than through the background script, so status is
  always the frame's own live state.

## Accepted residuals
These are known, deliberate trade-offs, not bugs:
- The vendored engine refuses to proxy-fetch cross-origin stylesheets from
  `localhost`, loopback IPs, or non-default ports (its own built-in
  anti-probing rule) — real https sites on standard ports are unaffected.
- A page with a restrictive `script-src` CSP blocks the engine's inline
  cross-origin-detection script; the engine falls back to degraded
  handling for that page's stylesheets rather than failing outright.
- A tab's very first load in a fresh session guesses by OS scheme before
  settings finish loading, so it can show one wrong-color flash; repeat
  loads in that tab don't.
- Safari does not support `match_about_blank` (the converter reports it as
  unsupported for this Safari version), so `about:blank`/`srcdoc` frames
  may not receive the content script there; Chrome is unaffected.
