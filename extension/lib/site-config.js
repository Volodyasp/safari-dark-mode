// SW-only: loads the bundled data/fixes.json + data/hints.json once,
// indexes them with extension/lib/url-match.js (must be `importScripts`'d
// first), and answers per-document lookups. Stateless/derived (AN-11 §a):
// nothing here survives an SW restart except the ability to rebuild the
// same index again from the same bundled files, so no `storage.session` is
// needed. Loaded via `importScripts` in background.js; classic script.
//
// Merge semantics (`findRelevantFix`/`combineFixes`) are a verbatim port of:
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/inject/dynamic-theme/fixes.ts
// commit 3df6a4aacb7285859003eb1af3182e4370280b5e
(function () {
  const api = globalThis.browser ?? globalThis.chrome;

  let generic = null;
  let sites = [];
  let hints = [];
  let sitesTrie = null;
  let hintsTrie = null;
  let loadPromise = null;

  // Builds a BDM_URL trie over every pattern in `entries[].url`, mapping
  // each pattern back to the index of the entry it belongs to (an entry can
  // list several patterns; matches on any of them resolve to the same
  // entry index, and BDM_URL's own de-duplication collapses repeats).
  function buildTrie(entries) {
    const patterns = [];
    const entryIndexByPatternIndex = [];
    entries.forEach((entry, entryIndex) => {
      (entry.url || []).forEach((pattern) => {
        entryIndexByPatternIndex.push(entryIndex);
        patterns.push(pattern);
      });
    });
    return globalThis.BDM_URL.indexURLTemplateList(patterns, (_pattern, patternIndex) => entryIndexByPatternIndex[patternIndex]);
  }

  function matchedEntries(url, trie, entries) {
    if (!trie) {
      return [];
    }
    return globalThis.BDM_URL.getURLMatchesFromIndexedList(url, trie).map((entryIndex) => entries[entryIndex]);
  }

  // inject/dynamic-theme/fixes.ts findRelevantFix, L14-34: exactly one site
  // fix besides the generic (fixes[0]), chosen by the longest FIRST url
  // pattern (legacy specificity) among the fixes whose url list matches.
  function findRelevantFix(url, fixes) {
    if (!Array.isArray(fixes) || fixes.length === 0 || fixes[0].url[0] !== '*') {
      return null;
    }
    let maxSpecificity = 0;
    let maxSpecificityIndex = null;
    for (let i = 1; i < fixes.length; i++) {
      if (globalThis.BDM_URL.isURLInList(url, fixes[i].url)) {
        const specificity = fixes[i].url[0].length;
        if (maxSpecificityIndex === null || maxSpecificity < specificity) {
          maxSpecificity = specificity;
          maxSpecificityIndex = i;
        }
      }
    }
    return maxSpecificityIndex;
  }

  // inject/dynamic-theme/fixes.ts combineFixes, L41-61: concatenates the
  // array fields, joins css with '\n', ORs the two disable*Proxy flags.
  function combineFixes(fixes) {
    if (fixes.length === 0 || fixes[0].url[0] !== '*') {
      return null;
    }
    const combineArrays = (arrays) => arrays.filter(Boolean).flat();
    return {
      url: [],
      invert: combineArrays(fixes.map((fix) => fix.invert)),
      css: fixes.map((fix) => fix.css).filter(Boolean).join('\n'),
      ignoreInlineStyle: combineArrays(fixes.map((fix) => fix.ignoreInlineStyle)),
      ignoreImageAnalysis: combineArrays(fixes.map((fix) => fix.ignoreImageAnalysis)),
      ignoreCSSUrl: combineArrays(fixes.map((fix) => fix.ignoreCSSUrl)),
      disableStyleSheetsProxy: fixes.some((fix) => fix.disableStyleSheetsProxy),
      disableCustomElementRegistryProxy: fixes.some((fix) => fix.disableCustomElementRegistryProxy)
    };
  }

  // Idempotent: concurrent/repeated calls all await the same fetch.
  async function load() {
    if (loadPromise) {
      return loadPromise;
    }
    loadPromise = (async () => {
      try {
        const [fixesRes, hintsRes] = await Promise.all([
          fetch(api.runtime.getURL('data/fixes.json')),
          fetch(api.runtime.getURL('data/hints.json'))
        ]);
        const fixesData = await fixesRes.json();
        const hintsData = await hintsRes.json();
        generic = fixesData.generic;
        sites = fixesData.sites;
        hints = hintsData.hints;
        sitesTrie = buildTrie(sites);
        hintsTrie = buildTrie(hints);
      } catch (err) {
        console.warn('[bdm]', err);
        generic = null;
        sites = [];
        hints = [];
        sitesTrie = null;
        hintsTrie = null;
      }
    })();
    return loadPromise;
  }

  function lookup(url) {
    if (!generic) {
      return { fix: null, hints: [] };
    }

    const candidates = [generic, ...matchedEntries(url, sitesTrie, sites)];
    const relevantIndex = findRelevantFix(url, candidates);
    const selected = relevantIndex === null ? [generic] : [generic, candidates[relevantIndex]];
    const combined = combineFixes(selected);
    if (combined) {
      delete combined.url; // SPECS-11 §4.1: "fix.url omitted"
    }

    return { fix: combined, hints: matchedEntries(url, hintsTrie, hints) };
  }

  globalThis.BDM_SITE_CONFIG = { load, lookup };
})();
