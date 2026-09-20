// B6a — AC-25: extension/lib/url-match.js unit cases (SPECS-11 §8), loaded
// into a plain page's main world via addScriptTag (no extension involved).
'use strict';

const path = require('node:path');
const { test, expect } = require('./helpers/probes');

const URL_MATCH_PATH = path.join(__dirname, '..', 'extension', 'lib', 'url-match.js');

async function loadURLMatch(page) {
  await page.goto('about:blank');
  await page.addScriptTag({ path: URL_MATCH_PATH });
}

async function matches(page, url, pattern) {
  return page.evaluate(({ url, pattern }) => window.BDM_URL.isURLMatched(url, pattern), { url, pattern });
}

test.describe('exact hostname pattern ("example.com")', () => {
  test('matches example.com and www.example.com only', async ({ page }) => {
    await loadURLMatch(page);
    expect(await matches(page, 'https://example.com/', 'example.com')).toBe(true);
    expect(await matches(page, 'https://www.example.com/', 'example.com')).toBe(true);
    expect(await matches(page, 'https://sub.example.com/', 'example.com')).toBe(false);
    expect(await matches(page, 'https://other.com/', 'example.com')).toBe(false);
  });
});

test.describe('wildcard subdomain pattern ("*.example.com")', () => {
  test('matches any subdomain but not the bare host', async ({ page }) => {
    await loadURLMatch(page);
    expect(await matches(page, 'https://sub.example.com/', '*.example.com')).toBe(true);
    expect(await matches(page, 'https://deep.sub.example.com/', '*.example.com')).toBe(true);
    expect(await matches(page, 'https://example.com/', '*.example.com')).toBe(false);
    expect(await matches(page, 'https://other.com/', '*.example.com')).toBe(false);
  });
});

test.describe('exact-anchored pattern ("^host$")', () => {
  test('matches only the exact host at the root path, no www, no subpaths', async ({ page }) => {
    await loadURLMatch(page);
    expect(await matches(page, 'https://example.com/', '^example.com$')).toBe(true);
    expect(await matches(page, 'https://www.example.com/', '^example.com$')).toBe(false);
    expect(await matches(page, 'https://sub.example.com/', '^example.com$')).toBe(false);
    expect(await matches(page, 'https://example.com/docs', '^example.com$')).toBe(false);
  });
});

test.describe('regex pattern ("/regex/")', () => {
  test('applies the regex against the whole URL', async ({ page }) => {
    await loadURLMatch(page);
    expect(await matches(page, 'https://example.com/', '/example\\.(com|net)/')).toBe(true);
    expect(await matches(page, 'https://example.net/', '/example\\.(com|net)/')).toBe(true);
    expect(await matches(page, 'https://example.org/', '/example\\.(com|net)/')).toBe(false);
  });
});

test.describe('port pattern ("example.com:8080")', () => {
  test('matches only that explicit port', async ({ page }) => {
    await loadURLMatch(page);
    expect(await matches(page, 'http://example.com:8080/', 'example.com:8080')).toBe(true);
    expect(await matches(page, 'http://example.com/', 'example.com:8080')).toBe(false);
    expect(await matches(page, 'http://example.com:9090/', 'example.com:8080')).toBe(false);
  });
});

test.describe('path wildcard pattern ("example.com/docs/*")', () => {
  test('matches subpaths under /docs/ only', async ({ page }) => {
    await loadURLMatch(page);
    expect(await matches(page, 'https://example.com/docs/intro', 'example.com/docs/*')).toBe(true);
    expect(await matches(page, 'https://example.com/docs/a/b', 'example.com/docs/*')).toBe(true);
    expect(await matches(page, 'https://example.com/other', 'example.com/docs/*')).toBe(false);
    expect(await matches(page, 'https://example.com/', 'example.com/docs/*')).toBe(false);
  });
});

test.describe('isURLInList', () => {
  test('true if any pattern in the list matches', async ({ page }) => {
    await loadURLMatch(page);
    const result = await page.evaluate(() =>
      window.BDM_URL.isURLInList('https://sub.example.com/', ['other.com', '*.example.com', 'third.com'])
    );
    expect(result).toBe(true);
  });
});

test.describe('indexURLTemplateList + getURLMatchesFromIndexedList', () => {
  test('the trie returns the same matches as scanning the list directly', async ({ page }) => {
    await loadURLMatch(page);
    const result = await page.evaluate(() => {
      const list = ['example.com', '*.example.com', 'other.com', '/example\\.net/', '^exact.com$'];
      const trie = window.BDM_URL.indexURLTemplateList(list, (pattern) => pattern);
      return {
        subExample: window.BDM_URL.getURLMatchesFromIndexedList('https://sub.example.com/', trie),
        bareExample: window.BDM_URL.getURLMatchesFromIndexedList('https://example.com/', trie),
        net: window.BDM_URL.getURLMatchesFromIndexedList('https://example.net/', trie),
        unrelated: window.BDM_URL.getURLMatchesFromIndexedList('https://nowhere.org/', trie)
      };
    });
    expect(result.subExample.sort()).toEqual(['*.example.com'].sort());
    expect(result.bareExample.sort()).toEqual(['example.com'].sort());
    expect(result.net).toEqual(['/example\\.net/']);
    expect(result.unrelated).toEqual([]);
  });
});
