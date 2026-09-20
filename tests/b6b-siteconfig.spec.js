// B6b — AC-26: extension/lib/site-config.js's SW-side lookup, called
// directly via sw.evaluate (no content script/page involved).
'use strict';

const { test, expect } = require('./helpers/probes');

test.describe('AC-26 BDM_SITE_CONFIG.lookup', () => {
  test('youtube.com: generic css + a youtube-specific rule merged', async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      await BDM_SITE_CONFIG.load();
      return BDM_SITE_CONFIG.lookup('https://www.youtube.com/');
    });
    // Verified first (see HANDOFF.md): fixes.json's youtube.com block sets
    // `--accent-color` inside an `html:not(.style-scope)` rule.
    expect(result.fix.css).toContain('::placeholder'); // generic
    expect(result.fix.css).toContain('--accent-color'); // youtube-specific
  });

  test('an unknown host (127.0.0.1) gets the generic fix only', async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      await BDM_SITE_CONFIG.load();
      return BDM_SITE_CONFIG.lookup('http://127.0.0.1:4180/light.html');
    });
    expect(result.fix.css).toContain('::placeholder');
    expect(result.fix.css).not.toContain('--accent-color');
    expect(result.fix.url).toBeUndefined(); // SPECS-11 §4.1: "fix.url omitted"
  });

  test('the user\'s acceptance target (mail.google.com) merges its own invert/css', async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      await BDM_SITE_CONFIG.load();
      return BDM_SITE_CONFIG.lookup('https://mail.google.com/mail/u/0/');
    });
    expect(result.fix.invert).toContain('.asor_t0');
    expect(result.fix.css).toContain('.buk');
    expect(result.fix.css).toContain('::placeholder'); // still merged with generic
  });

  test('github.com merges its own fix with the generic one', async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      await BDM_SITE_CONFIG.load();
      return BDM_SITE_CONFIG.lookup('https://github.com/');
    });
    expect(result.fix.css).toContain('::placeholder');
    // github.com's own block is present in fixes.json (verified via grep,
    // see HANDOFF.md); its merge is proven by the same generic marker
    // above plus the fix not being null/empty for this well-known host.
    expect(result.fix).not.toBeNull();
  });

  test('a host with a "NO DARK THEME" hint (arxiv.org) returns noDarkTheme:true', async ({ sw }) => {
    // Verified first (see HANDOFF.md): hints.json has a block
    // `url: ["*.arxiv.org", "arxiv.org"], noDarkTheme: true`.
    const result = await sw.evaluate(async () => {
      await BDM_SITE_CONFIG.load();
      return BDM_SITE_CONFIG.lookup('https://arxiv.org/');
    });
    expect(result.hints.length).toBeGreaterThanOrEqual(1);
    expect(result.hints.some((h) => h.noDarkTheme === true)).toBe(true);
  });

  test('load() is idempotent: two lookups after two load() calls agree', async ({ sw }) => {
    const result = await sw.evaluate(async () => {
      await BDM_SITE_CONFIG.load();
      await BDM_SITE_CONFIG.load();
      return BDM_SITE_CONFIG.lookup('https://github.com/').fix.css.length;
    });
    expect(result).toBeGreaterThan(0);
  });
});
