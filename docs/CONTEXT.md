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
- **Flash prevention via a same-origin `localStorage` hint, not storage.**
  Reading `storage.local` is asynchronous, so the very first paint uses a
  synchronous `localStorage` hint (written by the top frame only) plus a
  pre-injected fallback stylesheet, both established in local design/review
  notes kept outside this repository (not published; summarized here and in
  `docs/ARCHITECTURE.md`). B6d moved this from `sessionStorage` (per-tab) to
  `localStorage` (shared by every tab of the same origin) so a brand-new tab
  inherits the last real decision instead of guessing by OS scheme alone;
  B6d also added a `localStorage` cache of the merged site fix, so a repeat
  load of a known origin skips waiting on the service worker entirely.
- **Detection is a whole-file port of Dark Reader's own detector**, minus
  its "hints" configuration (out of scope) — same thresholds, so behaviour
  matches what Dark Reader itself would decide for a given page.
- **Popup asks the content script directly** (`tabs.sendMessage` with
  `frameId: 0`), rather than through the background script, so status is
  always the frame's own live state.

## Site fixes
Dark Reader's per-site fixes (`dynamic-theme-fixes.config`, 2909 sites) and
detector hints are imported at a pinned upstream commit
(`npm run import-fixes`) and applied per page: the generic `*` block plus the
most specific matching site block. Sites without a block get the generic one.

## Accepted residuals
These are known, deliberate trade-offs, not bugs:
- The vendored engine refuses to proxy-fetch cross-origin stylesheets from
  `localhost`, loopback IPs, or non-default ports (its own built-in
  anti-probing rule) — real https sites on standard ports are unaffected.
- A page with a restrictive `script-src` CSP blocks the engine's inline
  cross-origin-detection script; the engine falls back to degraded
  handling for that page's stylesheets rather than failing outright.
- A genuinely brand-new origin's very first load (no other tab has ever
  decided for it, and no cached fix exists yet) still guesses by OS scheme
  before settings finish loading, so it can show one wrong-color flash;
  every load after that, in any tab of that origin, doesn't (B6d).
- The site-fix cache can lag one load behind a real per-site fix change: if
  a cached entry's `commit` still matches but the SW's fresh reply for that
  same load differs (which cannot currently happen — `fixes.json` only
  changes via `npm run import-fixes`, which always bumps `commit` — but
  would if the merge logic itself changed keeping the same commit), the
  cached fix is still what gets applied for that load; the background
  request already refreshes the cache, so the very next load is correct.
  The cache is keyed by host + pathname (+ commit): a different path on the
  same host is a miss and waits for the SW, never a wrong hit.
- Safari does not support `match_about_blank` (the converter reports it as
  unsupported for this Safari version), so `about:blank`/`srcdoc` frames
  may not receive the content script there; Chrome is unaffected.
