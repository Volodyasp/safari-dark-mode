# Architecture

## Files
```
extension/manifest.json      MV3 manifest
extension/background.js      runtime.onMessage 'bdm:fetch' only -> fetch -> data-URL reply
extension/lib/api.js         captures native sendMessage before vendor wraps it
extension/lib/settings.js    DEFAULTS, resolve(), storage.local read/write helpers
extension/detector.js        built-in-dark-theme detector (Dark Reader port, MIT)
extension/content.js         per-frame lifecycle (owns tab state)
extension/popup/*            popup.html/js/css (site + defaults settings)
extension/vendor/*           vendored darkreader.js + LICENSE (generated, git-ignored)
scripts/                     vendor.js, icons.js (pretest); safari-convert.sh, safari-build.sh
tests/                       Playwright e2e: helpers/ (harness, probes), fixtures/, b1..b4 specs
safari/                      converter-generated Xcode project (references extension/ live)
```
Content-script load order (fixed, one array in the manifest): `lib/api.js` →
`vendor/darkreader.js` → `lib/settings.js` → `detector.js` → `content.js`.
`lib/api.js` must run first because the vendored engine wraps
`chrome.runtime.sendMessage` with a shim that returns nothing.

## Per-document sequence (every frame; only the top frame answers status)
1. Read the `sessionStorage` flash-prevention hint synchronously; inject a
   fallback dark stylesheet if the hint (or a guess from the OS scheme, when
   there's no hint yet) says this tab wants dark.
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
