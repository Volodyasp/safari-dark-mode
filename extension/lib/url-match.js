// MIT License
//
// Copyright (c) 2026 Dark Reader Ltd.
//
// Verbatim classic-script port of Dark Reader's URL pattern matching and
// trie index (the subset used by this extension's site-fix lookup):
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/utils/url.ts
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/utils/cache.ts (cachedFactory)
// commit 3df6a4aacb7285859003eb1af3182e4370280b5e
// modified: only isURLMatched/isURLInList/matchURLPattern/prepareURL/
// preparePattern/isRegExp/createRegExp/indexURLTemplateList/
// getURLMatchesFromIndexedList are ported (the functions this extension's
// site-fix lookup and build-time import validation need); parseURL,
// getAbsoluteURL, isRelativeHrefOnAbsolutePath, isPDF, isURLEnabled,
// isLocalFile and the DOM-dependent `anchor`/fixBaseURL helper are not
// ported (unused here; some depend on `document`, which the SW doesn't have).
//
// Surface: loaded via `importScripts` in the background service worker, and
// via `require()`/`addScriptTag` in node/Playwright tests — never added to
// the content-script load order (SPECS-11 §3/§4.1). Classic script; no ESM
// export; safe to load in a plain `<script>` tag, `importScripts`, or a
// CommonJS `require()` (it only assigns to `globalThis`, so it behaves the
// same in all three).
(function () {
  // utils/cache.ts cachedFactory, verbatim.
  function cachedFactory(factory, size) {
    const cache = new Map();
    return (key) => {
      if (cache.has(key)) {
        return cache.get(key);
      }
      const value = factory(key);
      cache.set(key, value);
      if (cache.size > size) {
        const first = cache.keys().next().value;
        cache.delete(first);
      }
      return value;
    };
  }

  const URL_CACHE_SIZE = 32;
  const prepareURL = cachedFactory((url) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    const { hostname, pathname, protocol, port } = parsed;
    const hostParts = hostname.split('.').reverse();
    const pathParts = pathname.split('/').slice(1);
    if (!pathParts[pathParts.length - 1]) {
      pathParts.splice(pathParts.length - 1, 1);
    }
    return { hostParts, pathParts, port, protocol };
  }, URL_CACHE_SIZE);

  const URL_MATCH_CACHE_SIZE = 32 * 1024;
  const preparePattern = cachedFactory((pattern) => {
    if (!pattern) {
      return null;
    }

    const exactStart = pattern.startsWith('^');
    const exactEnd = pattern.endsWith('$');
    if (exactStart) {
      pattern = pattern.substring(1);
    }
    if (exactEnd) {
      pattern = pattern.substring(0, pattern.length - 1);
    }

    let protocol = '';
    const protocolIndex = pattern.indexOf('://');
    if (protocolIndex > 0) {
      protocol = pattern.substring(0, protocolIndex + 1);
      pattern = pattern.substring(protocolIndex + 3);
    }

    const slashIndex = pattern.indexOf('/');
    const host = slashIndex < 0 ? pattern : pattern.substring(0, slashIndex);

    let hostName = host;

    let isIPv6 = false;
    let ipV6End = -1;
    if (host.startsWith('[')) {
      ipV6End = host.indexOf(']');
      if (ipV6End > 0) {
        isIPv6 = true;
      }
    }

    let port = '*';
    const portIndex = host.lastIndexOf(':');
    if (portIndex >= 0 && (!isIPv6 || ipV6End < portIndex)) {
      hostName = host.substring(0, portIndex);
      port = host.substring(portIndex + 1);
    }

    if (isIPv6) {
      try {
        const ipV6URL = new URL(`http://${hostName}`);
        hostName = ipV6URL.hostname;
      } catch {
        // keep hostName as-is
      }
    }

    const hostParts = hostName.split('.').reverse();

    const path = slashIndex < 0 ? '' : pattern.substring(slashIndex + 1);
    const pathParts = path.split('/');
    if (!pathParts[pathParts.length - 1]) {
      pathParts.splice(pathParts.length - 1, 1);
    }

    return { hostParts, pathParts, port, exactStart, exactEnd, protocol };
  }, URL_MATCH_CACHE_SIZE);

  function matchURLPattern(url, pattern) {
    const u = prepareURL(url);
    const p = preparePattern(pattern);
    return matchPreparedURLPattern(u, p);
  }

  function matchPreparedURLPattern(u, p) {
    if (
      !(u && p) ||
      p.hostParts.length > u.hostParts.length ||
      (p.exactStart && p.hostParts.length !== u.hostParts.length) ||
      (p.exactEnd && p.pathParts.length !== u.pathParts.length) ||
      (p.port !== '*' && p.port !== u.port) ||
      (p.protocol && p.protocol !== u.protocol)
    ) {
      return false;
    }

    for (let i = 0; i < p.hostParts.length; i++) {
      const pHostPart = p.hostParts[i];
      const uHostPart = u.hostParts[i];
      if (pHostPart !== '*' && pHostPart !== uHostPart) {
        return false;
      }
    }

    if (
      p.hostParts.length >= 2 &&
      p.hostParts.at(-1) !== '*' &&
      (p.hostParts.length < u.hostParts.length - 1 ||
        (p.hostParts.length === u.hostParts.length - 1 && u.hostParts.at(-1) !== 'www'))
    ) {
      return false;
    }

    if (p.pathParts.length === 0) {
      return true;
    }

    if (p.pathParts.length > u.pathParts.length) {
      return false;
    }

    for (let i = 0; i < p.pathParts.length; i++) {
      const pPathPart = p.pathParts[i];
      const uPathPart = u.pathParts[i];
      if (pPathPart !== '*' && pPathPart !== uPathPart) {
        return false;
      }
    }

    return true;
  }

  function isRegExp(pattern) {
    return pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2;
  }

  const REGEXP_CACHE_SIZE = 1024;
  const createRegExp = cachedFactory((pattern) => {
    if (pattern.startsWith('/')) {
      pattern = pattern.substring(1);
    }
    if (pattern.endsWith('/')) {
      pattern = pattern.substring(0, pattern.length - 1);
    }
    try {
      return new RegExp(pattern);
    } catch {
      return null;
    }
  }, REGEXP_CACHE_SIZE);

  function isURLMatched(url, urlTemplate) {
    if (isRegExp(urlTemplate)) {
      const regexp = createRegExp(urlTemplate);
      return regexp ? regexp.test(url) : false;
    }
    return matchURLPattern(url, urlTemplate);
  }

  function isURLInList(url, list) {
    for (let i = 0; i < list.length; i++) {
      if (isURLMatched(url, list[i])) {
        return true;
      }
    }
    return false;
  }

  function indexURLTemplateList(list, assign = () => true) {
    const trie = {
      key: '',
      hostNodes: new Map(),
      pathNodes: new Map(),
      hardPatterns: [],
      regexps: [],
      data: null
    };

    const templateIndices = new Map();

    const patterns = [];
    list.forEach((u, i) => {
      if (isRegExp(u)) {
        const r = createRegExp(u);
        if (r) {
          trie.regexps.push({ regexp: r, data: assign(list[i], i) });
        }
      } else {
        const p = preparePattern(u);
        if (p) {
          if (p.exactStart || p.exactEnd || (p.port && p.port !== '*') || p.protocol) {
            trie.hardPatterns.push({ pattern: p, data: assign(list[i], i) });
            return;
          }
          patterns.push(p);
          templateIndices.set(p, i);
        }
      }
    });

    patterns.forEach((pattern) => {
      const listIndex = templateIndices.get(pattern);
      const data = assign(list[listIndex], listIndex);

      let node = trie;
      pattern.hostParts.forEach((p) => {
        const nodes = node.hostNodes;
        if (nodes.has(p)) {
          node = nodes.get(p);
        } else {
          node = { key: p, hostNodes: new Map(), pathNodes: new Map(), data: null };
          nodes.set(p, node);
        }
      });
      let lastHostNode = node.hostNodes.get('');
      if (!lastHostNode) {
        lastHostNode = { key: '', hostNodes: new Map(), pathNodes: new Map(), data: null };
        node.hostNodes.set('', lastHostNode);
      }
      node = lastHostNode;

      if (pattern.pathParts.length === 0) {
        node.data = data;
        return;
      }

      pattern.pathParts.forEach((p) => {
        const nodes = node.pathNodes;
        if (nodes.has(p)) {
          node = nodes.get(p);
        } else {
          node = { key: p, hostNodes: new Map(), pathNodes: new Map(), data: null };
          nodes.set(p, node);
        }
      });
      let lastPathNode = node.pathNodes.get('');
      if (!lastPathNode) {
        lastPathNode = { key: '', hostNodes: new Map(), pathNodes: new Map(), data: null };
        node.pathNodes.set('', lastPathNode);
      }
      lastPathNode.data = data;
    });
    return trie;
  }

  function getURLMatchesFromIndexedList(url, trie, breakOnFirstMatch = false) {
    const found = new Set();
    const matches = [];

    const push = (data) => {
      if (!found.has(data)) {
        found.add(data);
        matches.push(data);
      }
    };

    for (const r of trie.regexps) {
      if (r.regexp.test(url)) {
        push(r.data);
        if (breakOnFirstMatch) {
          return matches;
        }
      }
    }

    const u = prepareURL(url);
    if (!u) {
      return matches;
    }

    for (const p of trie.hardPatterns) {
      if (matchPreparedURLPattern(u, p.pattern)) {
        push(p.data);
        if (breakOnFirstMatch) {
          return matches;
        }
      }
    }

    const matchHost = (node, index) => {
      const finalHostNode = node.hostNodes.get('');
      const noMoreHostParts = index === u.hostParts.length;
      const value = noMoreHostParts ? '' : u.hostParts[index];

      if (
        finalHostNode &&
        (noMoreHostParts || node.key === '*' || (index === u.hostParts.length - 1 && value === 'www'))
      ) {
        if (finalHostNode.data) {
          push(finalHostNode.data);
          if (breakOnFirstMatch) {
            return;
          }
        }
        matchPath(finalHostNode, 0);
      }

      if (noMoreHostParts) {
        return;
      }

      const nodes = node.hostNodes;
      const wildcardNode = nodes.get('*');
      if (wildcardNode) {
        matchHost(wildcardNode, index + 1);
      }

      if (breakOnFirstMatch && matches.length > 0) {
        return;
      }

      const keyNode = nodes.get(value);
      if (keyNode) {
        matchHost(keyNode, index + 1);
      }
    };

    const matchPath = (node, index) => {
      const finalPathNode = node.pathNodes.get('');
      const noMorePathParts = index === u.pathParts.length;
      const value = noMorePathParts ? '' : u.pathParts[index];

      if (finalPathNode && finalPathNode.data) {
        push(finalPathNode.data);
      }

      if (noMorePathParts) {
        return;
      }

      const nodes = node.pathNodes;
      const wildcardNode = nodes.get('*');
      if (wildcardNode) {
        matchPath(wildcardNode, index + 1);
      }

      if (breakOnFirstMatch && matches.length > 0) {
        return;
      }

      const keyNode = nodes.get(value);
      if (keyNode) {
        matchPath(keyNode, index + 1);
      }
    };

    matchHost(trie, 0);

    return matches;
  }

  globalThis.BDM_URL = {
    isURLMatched,
    isURLInList,
    matchURLPattern,
    prepareURL,
    preparePattern,
    isRegExp,
    createRegExp,
    indexURLTemplateList,
    getURLMatchesFromIndexedList
  };
})();
