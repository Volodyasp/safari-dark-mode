// MIT License
//
// Copyright (c) 2026 Dark Reader Ltd.
//
// MAIN-world stylesheet proxy — runs with page privileges only (NFR-15):
// no reference to chrome/browser (except the world guard below), __bdm,
// DarkReader, BDM_*; no eval/Function; no postMessage/message relay; no
// window globals; listens to and dispatches only __darkreader__* DOM
// events. Ported from Dark Reader's:
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/inject/dynamic-theme/stylesheet-proxy.ts
// (the `injectProxy` function body below is the vendored engine's own
// compiled copy, node_modules/darkreader/darkreader.js L7334-7774, which is
// byte-for-byte what upstream's stylesheet-proxy.ts compiles to for this
// pinned commit — copied from there rather than retranspiled from the .ts
// source, so the two edits below apply to the exact code this extension's
// vendored engine actually dispatches)
// commit 3df6a4aacb7285859003eb1af3182e4370280b5e
// modified: the `__darkreader__cleanUp` listener that `injectProxy` used to
// register for itself is dropped (moved to the outer controller below,
// which needs to run its own install/uninstall bookkeeping around it); the
// function now `return`s its `cleanUp` restorer instead of self-managing
// it. This controller replaces Dark Reader's MV3-only
// `inject/dynamic-theme/mv3-proxy.ts` (our vendored engine is the plain npm
// build, which never dispatches the `__darkreader__stylesheetProxy__arg`
// event that controller listens for — see plans/v1.1/HANDOFF.md for why).
(function () {
  // P1 world guard: a MAIN-world page script never has `chrome.runtime.id`/
  // `browser.runtime.id` defined (no extension APIs there). If this file
  // ends up running in an ISOLATED world instead (a browser that ignores
  // `content_scripts.world`), one of those IS defined, and this file must
  // stay completely inert there (Safari fallback = the engine's own inline
  // injection, i.e. today's status quo).
  if (globalThis.chrome?.runtime?.id || globalThis.browser?.runtime?.id) {
    return;
  }

    function injectProxy(
        enableStyleSheetsProxy,
        enableCustomElementRegistryProxy
    ) {
        document.dispatchEvent(
            new CustomEvent("__darkreader__inlineScriptsAllowed")
        );
        const cleaners = [];
        function cleanUp() {
            cleaners.forEach((clean) => clean());
            cleaners.splice(0);
        }
        function documentEventListener(type, listener, options) {
            document.addEventListener(type, listener, options);
            cleaners.push(() => document.removeEventListener(type, listener));
        }
        function disableConflictingPlugins() {
            const disableWPDarkMode = () => {
                if (window?.WPDarkMode?.deactivate) {
                    window.WPDarkMode.deactivate();
                }
            };
            disableWPDarkMode();
        }
        documentEventListener(
            "__darkreader__disableConflictingPlugins",
            disableConflictingPlugins
        );
        function overrideProperty(cls, prop, overrides) {
            const proto = cls.prototype;
            const oldDescriptor = Object.getOwnPropertyDescriptor(proto, prop);
            if (!oldDescriptor) {
                return;
            }
            const newDescriptor = {...oldDescriptor};
            Object.keys(overrides).forEach((key) => {
                const factory = overrides[key];
                newDescriptor[key] = factory(oldDescriptor[key]);
            });
            Object.defineProperty(proto, prop, newDescriptor);
            cleaners.push(() =>
                Object.defineProperty(proto, prop, oldDescriptor)
            );
        }
        function override(cls, prop, factory) {
            overrideProperty(cls, prop, {value: factory});
        }
        function isDRElement(element) {
            return element?.classList?.contains("darkreader");
        }
        function isDRSheet(sheet) {
            return isDRElement(sheet.ownerNode);
        }
        const updateSheetEvent = new CustomEvent("__darkreader__updateSheet");
        const adoptedSheetChangeEvent = new CustomEvent(
            "__darkreader__adoptedStyleSheetChange"
        );
        const shadowDomAttachingEvent = new CustomEvent(
            "__darkreader__shadowDomAttaching",
            {bubbles: true}
        );
        const adoptedSheetOwners = new WeakMap();
        const adoptedDeclarationSheets = new WeakMap();
        function onAdoptedSheetChange(sheet) {
            const owners = adoptedSheetOwners.get(sheet);
            owners?.forEach((node) => {
                if (node.isConnected) {
                    node.dispatchEvent(adoptedSheetChangeEvent);
                } else {
                    owners.delete(node);
                }
            });
        }
        function reportSheetChange(sheet) {
            if (sheet.ownerNode && !isDRSheet(sheet)) {
                sheet.ownerNode.dispatchEvent(updateSheetEvent);
            }
            if (adoptedSheetOwners.has(sheet)) {
                onAdoptedSheetChange(sheet);
            }
        }
        function reportSheetChangeAsync(sheet, promise) {
            const {ownerNode} = sheet;
            if (
                ownerNode &&
                !isDRSheet(sheet) &&
                promise &&
                promise instanceof Promise
            ) {
                promise.then(() => ownerNode.dispatchEvent(updateSheetEvent));
            }
            if (adoptedSheetOwners.has(sheet)) {
                if (promise && promise instanceof Promise) {
                    promise.then(() => onAdoptedSheetChange(sheet));
                }
            }
        }
        override(
            CSSStyleSheet,
            "addRule",
            (native) =>
                function (selector, style, index) {
                    native.call(this, selector, style, index);
                    reportSheetChange(this);
                    return -1;
                }
        );
        override(
            CSSStyleSheet,
            "insertRule",
            (native) =>
                function (rule, index) {
                    const returnValue = native.call(this, rule, index);
                    reportSheetChange(this);
                    return returnValue;
                }
        );
        override(
            CSSStyleSheet,
            "deleteRule",
            (native) =>
                function (index) {
                    native.call(this, index);
                    reportSheetChange(this);
                }
        );
        override(
            CSSStyleSheet,
            "removeRule",
            (native) =>
                function (index) {
                    native.call(this, index);
                    reportSheetChange(this);
                }
        );
        override(
            CSSStyleSheet,
            "replace",
            (native) =>
                function (cssText) {
                    const returnValue = native.call(this, cssText);
                    reportSheetChangeAsync(this, returnValue);
                    return returnValue;
                }
        );
        override(
            CSSStyleSheet,
            "replaceSync",
            (native) =>
                function (cssText) {
                    native.call(this, cssText);
                    reportSheetChange(this);
                }
        );
        override(
            Element,
            "attachShadow",
            (native) =>
                function (options) {
                    this.dispatchEvent(shadowDomAttachingEvent);
                    return native.call(this, options);
                }
        );
        const shouldWrapHTMLElement =
            location.hostname === "baidu.com" ||
            location.hostname.endsWith(".baidu.com");
        if (shouldWrapHTMLElement) {
            override(
                Element,
                "getElementsByTagName",
                (native) =>
                    function (tagName) {
                        if (tagName !== "style") {
                            return native.call(this, tagName);
                        }
                        const getCurrentElementValue = () => {
                            const elements = native.call(this, tagName);
                            return Object.setPrototypeOf(
                                [...elements].filter(
                                    (element) =>
                                        element && !isDRElement(element)
                                ),
                                NodeList.prototype
                            );
                        };
                        let elements = getCurrentElementValue();
                        const nodeListBehavior = {
                            get: function (_, property) {
                                return getCurrentElementValue()[property];
                            }
                        };
                        elements = new Proxy(elements, nodeListBehavior);
                        return elements;
                    }
            );
        }
        const shouldProxyChildNodes = ["brilliant.org", "www.vy.no"].includes(
            location.hostname
        );
        if (shouldProxyChildNodes) {
            overrideProperty(Node, "childNodes", {
                get: (native) =>
                    function () {
                        const childNodes = native.call(this);
                        return Object.setPrototypeOf(
                            [...childNodes].filter((element) => {
                                return !isDRElement(element);
                            }),
                            NodeList.prototype
                        );
                    }
            });
        }
        function resolveCustomElement(tag) {
            customElements.whenDefined(tag).then(() => {
                document.dispatchEvent(
                    new CustomEvent("__darkreader__isDefined", {detail: {tag}})
                );
            });
        }
        documentEventListener("__darkreader__addUndefinedResolver", (e) =>
            resolveCustomElement(e.detail.tag)
        );
        if (enableCustomElementRegistryProxy) {
            override(
                CustomElementRegistry,
                "define",
                (native) =>
                    function (name, constructor, options) {
                        resolveCustomElement(name);
                        native.call(this, name, constructor, options);
                    }
            );
        }
        let blobURLAllowed = null;
        function checkBlobURLSupport() {
            if (blobURLAllowed != null) {
                document.dispatchEvent(
                    new CustomEvent("__darkreader__blobURLCheckResponse", {
                        detail: {blobURLAllowed}
                    })
                );
                return;
            }
            const svg =
                '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="transparent"/></svg>';
            const bytes = new Uint8Array(svg.length);
            for (let i = 0; i < svg.length; i++) {
                bytes[i] = svg.charCodeAt(i);
            }
            const blob = new Blob([bytes], {type: "image/svg+xml"});
            const objectURL = URL.createObjectURL(blob);
            const image = new Image();
            image.onload = () => {
                blobURLAllowed = true;
                sendBlobURLCheckResponse();
            };
            image.onerror = () => {
                blobURLAllowed = false;
                sendBlobURLCheckResponse();
            };
            image.src = objectURL;
        }
        function sendBlobURLCheckResponse() {
            document.dispatchEvent(
                new CustomEvent("__darkreader__blobURLCheckResponse", {
                    detail: {blobURLAllowed}
                })
            );
        }
        documentEventListener(
            "__darkreader__blobURLCheckRequest",
            checkBlobURLSupport
        );
        if (enableStyleSheetsProxy) {
            overrideProperty(Document, "styleSheets", {
                get: (native) =>
                    function () {
                        let filteredSheetsCache = null;
                        let docSheets = null;
                        const didChange = (newSheets) => {
                            if (
                                !filteredSheetsCache ||
                                !docSheets ||
                                docSheets.length !== newSheets.length
                            ) {
                                return true;
                            }
                            for (let i = 0; i < docSheets.length; i++) {
                                if (docSheets[i] !== newSheets[i]) {
                                    return true;
                                }
                            }
                            return false;
                        };
                        const getCurrentValue = () => {
                            const nativeDocSheets = native.call(this);
                            if (!didChange(nativeDocSheets)) {
                                return filteredSheetsCache;
                            }
                            docSheets = Array.from(nativeDocSheets);
                            const filteredSheets = docSheets.filter(
                                (styleSheet) =>
                                    styleSheet.ownerNode &&
                                    !isDRSheet(styleSheet)
                            );
                            filteredSheets.item = (item) =>
                                filteredSheets[item];
                            filteredSheetsCache = Object.setPrototypeOf(
                                filteredSheets,
                                StyleSheetList.prototype
                            );
                            return filteredSheetsCache;
                        };
                        const styleSheetListBehavior = {
                            get: function (_, property) {
                                return getCurrentValue()[property];
                            }
                        };
                        return new Proxy(
                            getCurrentValue(),
                            styleSheetListBehavior
                        );
                    }
            });
        }
        const adoptedSheetsSourceProxies = new WeakMap();
        const adoptedSheetsProxySources = new WeakMap();
        const adoptedSheetsChangeEvent = new CustomEvent(
            "__darkreader__adoptedStyleSheetsChange"
        );
        const adoptedSheetOverrideCache = new WeakSet();
        const adoptedSheetsSnapshots = new WeakMap();
        const isDRAdoptedSheetOverride = (sheet) => {
            if (!sheet || !sheet.cssRules) {
                return false;
            }
            if (adoptedSheetOverrideCache.has(sheet)) {
                return true;
            }
            if (
                sheet.cssRules.length > 0 &&
                sheet.cssRules[0].cssText.startsWith(
                    "#__darkreader__adoptedOverride"
                )
            ) {
                adoptedSheetOverrideCache.add(sheet);
                return true;
            }
            return false;
        };
        const areArraysEqual = (a, b) => {
            return a.length === b.length && a.every((x, i) => x === b[i]);
        };
        const onAdoptedSheetsChange = (node) => {
            const prev = adoptedSheetsSnapshots.get(node);
            const curr = (node.adoptedStyleSheets || []).filter(
                (s) => !isDRAdoptedSheetOverride(s)
            );
            adoptedSheetsSnapshots.set(node, curr);
            if (!prev || !areArraysEqual(prev, curr)) {
                curr.forEach((sheet) => {
                    if (!adoptedSheetOwners.has(sheet)) {
                        adoptedSheetOwners.set(sheet, new Set());
                    }
                    adoptedSheetOwners.get(sheet).add(node);
                    for (const rule of sheet.cssRules) {
                        const declaration = rule.style;
                        if (declaration) {
                            adoptedDeclarationSheets.set(declaration, sheet);
                        }
                    }
                });
                node.dispatchEvent(adoptedSheetsChangeEvent);
            }
        };
        const proxyAdoptedSheetsArray = (node, source) => {
            if (adoptedSheetsProxySources.has(source)) {
                return source;
            }
            if (adoptedSheetsSourceProxies.has(source)) {
                return adoptedSheetsSourceProxies.get(source);
            }
            const proxy = new Proxy(source, {
                deleteProperty(target, property) {
                    delete target[property];
                    return true;
                },
                set(target, property, value) {
                    target[property] = value;
                    if (property === "length") {
                        onAdoptedSheetsChange(node);
                    }
                    return true;
                }
            });
            adoptedSheetsSourceProxies.set(source, proxy);
            adoptedSheetsProxySources.set(proxy, source);
            return proxy;
        };
        [Document, ShadowRoot].forEach((ctor) => {
            overrideProperty(ctor, "adoptedStyleSheets", {
                get: (native) =>
                    function () {
                        const source = native.call(this);
                        return proxyAdoptedSheetsArray(this, source);
                    },
                set: (native) =>
                    function (source) {
                        if (adoptedSheetsProxySources.has(source)) {
                            source = adoptedSheetsProxySources.get(source);
                        }
                        native.call(this, source);
                        onAdoptedSheetsChange(this);
                    }
            });
        });
        const adoptedDeclarationChangeEvent = new CustomEvent(
            "__darkreader__adoptedStyleDeclarationChange"
        );
        ["setProperty", "removeProperty"].forEach((key) => {
            override(CSSStyleDeclaration, key, (native) => {
                return function (...args) {
                    const returnValue = native.apply(this, args);
                    const sheet = adoptedDeclarationSheets.get(this);
                    if (sheet) {
                        const owners = adoptedSheetOwners.get(sheet);
                        if (owners) {
                            owners.forEach((node) => {
                                node.dispatchEvent(
                                    adoptedDeclarationChangeEvent
                                );
                            });
                        }
                    }
                    return returnValue;
                };
            });
        });
        return cleanUp;
    }

  // P2-P5: one permanent `document` listener for `__darkreader__cleanUp`
  // (the vendored engine dispatches it synchronously at two points: once
  // right before its own blocked inline-script attempt on every full
  // enable(), with `data-darkreader-mode` already set; once from
  // `removeProxy()` on disable(), after that attribute was removed — see
  // plans/v1.1/HANDOFF.md for the exact line numbers). This is the entire
  // protocol the MAIN world can observe from this engine build.
  let uninstall = null;

  document.addEventListener('__darkreader__cleanUp', () => {
    // P3: undo the previous install, if any, first.
    if (uninstall) {
      uninstall();
      uninstall = null;
    }

    const head = document.head;
    if (!head) {
      return;
    }

    // P4: the neutraliser. `createOrUpdateScript` (vendored engine
    // L8175-8183) reuses any existing `.darkreader--proxy` element in
    // head and only appends text + re-inserts it; a <script> whose `type`
    // is not a JavaScript MIME type is never executed per the HTML "prepare
    // the script element" algorithm (returns before the CSP check), so this
    // produces no console error and no CSP violation report. The engine
    // removes this element itself on both the enable path (L8387) and the
    // disable path (L8954) — this file never removes or tracks it.
    if (!head.querySelector('script.darkreader--proxy')) {
      const neutraliser = document.createElement('script');
      neutraliser.className = 'darkreader darkreader--proxy';
      neutraliser.type = 'text/plain';
      head.appendChild(neutraliser);
    }

    // P5: only the enable path sets `data-darkreader-mode` (removed again
    // before the disable path's cleanUp dispatch) — that attribute is the
    // only signal distinguishing the two cleanUp calls, so it is the only
    // thing gating a (re)install.
    if (document.documentElement?.hasAttribute('data-darkreader-mode')) {
      // Both proxy flags are always true: the site-fixes config has no
      // `DISABLE STYLE SHEETS PROXY`/`DISABLE CUSTOM ELEMENT REGISTRY
      // PROXY` command (0 occurrences in the pinned config, and B6a's
      // parser doesn't even recognise those commands), so `content.js`
      // never sets `disableStyleSheetsProxy`/`disableCustomElementRegistryProxy`.
      uninstall = injectProxy(true, true);
    }
  });
})();
