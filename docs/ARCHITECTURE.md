# Architecture

## Files
```
extension/manifest.json      MV3 manifest
extension/background.js      'bdm:fetch' (fetch -> data-URL) and 'bdm:site-config' (fix + hints per URL)
extension/proxy.js           page-world (MAIN) stylesheet/CustomElementRegistry proxy (Dark Reader port)
extension/lib/api.js         captures native sendMessage before vendor wraps it
extension/lib/settings.js    DEFAULTS, resolve(), storage.local read/write helpers
extension/lib/url-match.js   Dark Reader URL pattern matching + trie (SW only)
extension/lib/site-config.js SW: loads data/*.json, merges generic + most specific site fix
extension/data/*.json        upstream dynamic-theme fixes (2909 sites) + detector hints, pinned commit
extension/detector.js        built-in-dark-theme detector (Dark Reader port, MIT)
extension/content.js         per-frame lifecycle (owns tab state)
extension/popup/*            popup.html/js/css (site + defaults settings)
extension/vendor/*           vendored darkreader.js + LICENSE (generated, git-ignored)
scripts/                     vendor.js, icons.js (pretest); import-fixes.js; safari-convert.sh, safari-build.sh
tests/                       Playwright e2e: helpers/ (harness, probes), fixtures/, b1..b6c specs
safari/                      converter-generated Xcode project (references extension/ live)
```
Content scripts: first entry `proxy.js` in the page's MAIN world (Chrome MV3
blocks the engine's inline proxy `<script>` on every page; the proxy lets
CSSOM-inserted rules, adopted stylesheets and shadow roots be themed). Second
entry, isolated world, fixed order: `lib/api.js` → `vendor/darkreader.js` →
`lib/settings.js` → `detector.js` → `content.js`. `lib/api.js` must run first
because the vendored engine wraps `chrome.runtime.sendMessage` with a shim
that returns nothing. `content.js` asks the SW for the site fix (500 ms
timeout, falls back to no fix) and passes `{...fix}` once to `enable()`.

## Per-document sequence (every frame; only the top frame answers status)
1. Read the `localStorage` flash-prevention hint synchronously (B6d: moved
   from `sessionStorage`, per-tab, to `localStorage`, shared by every tab of
   the same origin — a brand-new tab now inherits the last decision instead
   of guessing by OS scheme alone); inject a fallback dark stylesheet if the
   hint (or a guess from the OS scheme, when there's no hint yet) says this
   tab wants dark. Also read the `localStorage` site-fix cache (B6d):
   `{host, commit, fix, hints}`, written by the top frame after a real
   `bdm:site-config` reply. On a hit (`host`/`commit` match), `FIXES` is
   filled from the cache immediately and `rerun()` doesn't wait on the SW at
   all; the real `bdm:site-config` request still fires in the background and
   refreshes the cache for the next load.
2. Load settings from `storage.local`, resolve `wantDark`/`ignoreDark` for
   this frame's top-level host.
3. Not wanting dark: disable, drop the fallback, hint = `skip`.
4. Wanting dark + ignoring built-in dark mode: enable unconditionally, hint
   = `dark`.
5. Wanting dark, not ignoring, no `skip` hint yet: enable first, then run
   the detector; a positive detection reverses it (disable, hint = `skip`).
6. Wanting dark, hint already `skip`: detect first — a still-dark page is
   never re-themed; only a negative detection enables (hint = `dark`).
7. `storage.onChanged` and OS-scheme changes re-run steps 2-6.
8. The top frame answers a status request synchronously; other frames don't.

## Message contracts
| Message | Direction | Reply |
|---|---|---|
| `bdm:status` | popup → content (top frame, `frameId:0`) | `{host, defaults, siteEnabled, siteIgnoreDark, enabled, ignoreDark, wantDark, osDark, applied, detectedDark}` |
| `bdm:fetch` | content → background | `{ok:true, dataUrl}` or `{ok:false, error}` |
| `bdm:site-config` | content → background | `{fix, hints, commit}` (`commit` added in B6d: fixes.json's pinned commit, lets content.js validate its `localStorage` fix cache without asking the SW again) |
| (settings) | any → `storage.local` | no message; both popup and content listen to `storage.onChanged` |

## Storage (`storage.local`, v1)
```
{ v: 1,
  defaults: { enabled: 'auto'|'on'|'off', ignoreDark: boolean },
  sites: { [hostname]: { enabled?: 'auto'|'on'|'off', ignoreDark?: boolean } } }
```
Missing or invalid data normalizes to `{v:1, defaults:{enabled:'auto',
ignoreDark:false}, sites:{}}`. Host = exact top-level hostname (no
subdomain grouping).
