// Allowed by csp-cssom.html's `Content-Security-Policy: script-src 'self'`
// header (external, same-origin script) — exercises exactly the CSSOM
// surface only the MAIN-world proxy (extension/proxy.js) can see: a late
// `attachShadow` on an element already in the DOM, an `insertRule` on the
// last stylesheet (landing in the engine's own override sheet without the
// proxy — the classic Closure/goog.cssom pitfall), and a new adopted
// stylesheet. Round-numbered so `run()` can be called again after an
// Off->On cycle without id collisions.
window.__cspCssom = (function () {
  let round = 0;

  function run() {
    round += 1;
    const n = round;
    const stage = document.getElementById('stage');

    // (A) shadow DOM, attached late (this script runs well after the
    // static #host-n elements were parsed) — no light-DOM mutation.
    const host = document.getElementById(`host-${n}`);
    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML =
      '<style>.sbox{width:100px;height:100px;background:#ffffff;border:1px solid #000;border-radius:7px}</style><div class="sbox"></div>';

    // (B) insertRule into whatever is currently the LAST stylesheet.
    const sheetBox = document.createElement('div');
    sheetBox.id = `sheet-box-${n}`;
    sheetBox.className = 'box';
    stage.appendChild(sheetBox);
    const last = document.styleSheets[document.styleSheets.length - 1];
    last.insertRule(`#sheet-box-${n}{background:#ffffff;border-radius:7px}`, last.cssRules.length);

    // (C) a new adopted stylesheet.
    const adoptedBox = document.createElement('div');
    adoptedBox.id = `adopted-box-${n}`;
    adoptedBox.className = 'box';
    stage.appendChild(adoptedBox);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`#adopted-box-${n}{background:#ffffff;border-radius:7px}`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];

    return {
      round,
      lastSheetOwner: last.ownerNode.id || last.ownerNode.className
    };
  }

  return { run };
})();
