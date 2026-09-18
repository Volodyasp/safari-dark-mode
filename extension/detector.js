// MIT License
//
// Copyright (c) 2026 Dark Reader Ltd.
//
// Ported (whole-file, same function names and thresholds) from Dark Reader's
// built-in dark theme detector:
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/inject/detector.ts
// commit 3df6a4aacb7285859003eb1af3182e4370280b5e
// modified: hints removed, helpers inlined
(function () {
  const COLOR_SCHEME_META_SELECTOR = 'meta[name="color-scheme"]';

  // rgb(r, g, b) / rgba(r, g, b, a) / transparent -> {r,g,b,a}; whitespace
  // tolerant; anything else (including modern color() / lab() syntax, which
  // Dark Reader's full parser handles but this port does not) -> null,
  // treated as "light" by the caller (SPECS §6.3 residual, accepted).
  function parseColor(css) {
    if (typeof css !== 'string') {
      return null;
    }
    const value = css.trim();
    if (value === 'transparent') {
      return { r: 0, g: 0, b: 0, a: 0 };
    }
    const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (!match) {
      return null;
    }
    const [, r, g, b, a] = match;
    return { r: Number(r), g: Number(g), b: Number(b), a: a === undefined ? 1 : Number(a) };
  }

  // https://en.wikipedia.org/wiki/Relative_luminance
  function getSRGBLightness(r, g, b) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function hasBuiltInDarkTheme() {
    const rootStyle = getComputedStyle(document.documentElement);
    if (rootStyle.filter.includes('invert(1)') || rootStyle.colorScheme === 'dark') {
      return true;
    }

    const CELL_SIZE = 256;
    const MAX_ROW_COUNT = 4;
    const winWidth = innerWidth;
    const winHeight = innerHeight;
    const stepX = Math.floor(winWidth / Math.min(MAX_ROW_COUNT, Math.ceil(winWidth / CELL_SIZE)));
    const stepY = Math.floor(winHeight / Math.min(MAX_ROW_COUNT, Math.ceil(winHeight / CELL_SIZE)));

    const processedElements = new Set();

    for (let y = Math.floor(stepY / 2); y < winHeight; y += stepY) {
      for (let x = Math.floor(stepX / 2); x < winWidth; x += stepX) {
        const element = document.elementFromPoint(x, y);
        if (!element || processedElements.has(element) || element.tagName.toLowerCase() === 'img') {
          continue;
        }
        processedElements.add(element);
        const style = element === document.documentElement ? rootStyle : getComputedStyle(element);
        const bgColor = parseColor(style.backgroundColor);
        if (!bgColor) {
          return false;
        }
        if (bgColor.r === 24 && bgColor.g === 26 && bgColor.b === 27) {
          // Some sites' CSSStyleSheet.disabled / textContent changes are not
          // applied synchronously (upstream comment, e.g. zorin.com). Treat
          // as not having a built-in dark theme.
          return false;
        }
        if (bgColor.a === 1) {
          const bgLightness = getSRGBLightness(bgColor.r, bgColor.g, bgColor.b);
          if (bgLightness > 0.6) {
            return false;
          }
        } else {
          const textColor = parseColor(style.color);
          if (!textColor) {
            return false;
          }
          const textLightness = getSRGBLightness(textColor.r, textColor.g, textColor.b);
          if (textLightness < 0.4) {
            return false;
          }
        }
      }
    }

    const rootColor = parseColor(rootStyle.backgroundColor);
    if (!rootColor) {
      return false;
    }

    const bodyColor = document.body ? parseColor(getComputedStyle(document.body).backgroundColor) : { r: 0, g: 0, b: 0, a: 0 };
    if (!bodyColor) {
      return false;
    }

    if (rootColor.a === 0 && bodyColor.a === 0) {
      const rootTextColor = parseColor(rootStyle.color);
      if (rootTextColor) {
        const textLightness = getSRGBLightness(rootTextColor.r, rootTextColor.g, rootTextColor.b);
        return textLightness > 0.5;
      }
    }

    const rootLightness = 1 - rootColor.a + rootColor.a * getSRGBLightness(rootColor.r, rootColor.g, rootColor.b);
    const finalLightness = (1 - bodyColor.a) * rootLightness + bodyColor.a * getSRGBLightness(bodyColor.r, bodyColor.g, bodyColor.b);

    return finalLightness < 0.5;
  }

  // Pure decision: meta color-scheme, dark class/data-theme, else measure with
  // our own sheets disabled (re-enabled in `finally`).
  function decideDarkTheme() {
    const colorSchemeMeta = document.querySelector(COLOR_SCHEME_META_SELECTOR);
    if (colorSchemeMeta) {
      const content = colorSchemeMeta.content.toLowerCase();
      if (content === 'dark' || content === 'only dark') return true;
      if (content === 'light' || content === 'only light') return false;
    }

    if (
      document.documentElement.classList.contains('dark') ||
      document.body?.classList.contains('dark') ||
      document.documentElement.dataset.theme?.toLowerCase() === 'dark'
    ) {
      return true;
    }

    const drSheets = Array.from(document.styleSheets)
      .filter((s) => s.ownerNode?.classList?.contains('darkreader'))
      .concat(
        Array.isArray(document.adoptedStyleSheets)
          ? Array.from(document.adoptedStyleSheets).filter((s) => s.cssRules?.[0]?.selectorText?.startsWith('#__darkreader'))
          : []
      );
    drSheets.forEach((sheet) => (sheet.disabled = true));
    try {
      return hasBuiltInDarkTheme();
    } finally {
      drSheets.forEach((sheet) => (sheet.disabled = false));
    }
  }

  // The callback runs outside the try so a throwing callback is never
  // reported a second time as `callback(false)`.
  function runCheck(callback) {
    let result = false;
    try {
      result = decideDarkTheme();
    } catch (err) {
      console.warn('[bdm]', err);
    }
    callback(result);
  }

  function hasSomeStyle() {
    if (document.querySelector(COLOR_SCHEME_META_SELECTOR) != null) {
      return true;
    }
    if (document.documentElement.style.backgroundColor || (document.body && document.body.style.backgroundColor)) {
      return true;
    }
    for (const style of document.styleSheets) {
      if (style && style.ownerNode && !(style.ownerNode.classList && style.ownerNode.classList.contains('darkreader'))) {
        return true;
      }
    }
    return false;
  }

  let observer = null;
  let readyStateListener = null;

  function canCheckForStyle() {
    if (
      !(
        document.body &&
        document.body.scrollHeight >= 32 &&
        document.body.clientHeight >= 32 &&
        document.body.childElementCount > 0 &&
        hasSomeStyle()
      )
    ) {
      return false;
    }
    for (const child of document.body.children) {
      if (child.tagName !== 'SCRIPT' && child.tagName !== 'STYLE' && child.tagName !== 'LINK') {
        return true;
      }
    }
    return false;
  }

  function runDarkThemeDetector(callback) {
    stopDarkThemeDetector();

    if (canCheckForStyle()) {
      runCheck(callback);
      return;
    }

    observer = new MutationObserver(() => {
      if (canCheckForStyle()) {
        stopDarkThemeDetector();
        runCheck(callback);
      }
    });
    observer.observe(document.documentElement, { childList: true });

    if (document.readyState !== 'complete') {
      readyStateListener = () => {
        if (document.readyState === 'complete') {
          stopDarkThemeDetector();
          runCheck(callback);
        }
      };
      // readystatechange does not bubble and is not cancellable.
      document.addEventListener('readystatechange', readyStateListener);
    }
  }

  function stopDarkThemeDetector() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (readyStateListener) {
      document.removeEventListener('readystatechange', readyStateListener);
      readyStateListener = null;
    }
  }

  globalThis.BDM_DETECTOR = { runDarkThemeDetector, stopDarkThemeDetector, hasBuiltInDarkTheme, parseColor, getSRGBLightness };
})();
