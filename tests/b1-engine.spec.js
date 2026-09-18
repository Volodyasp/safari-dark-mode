// B1 — AC-1..4: extension loads, engine themes same-origin and cross-origin
// pages, and the background fetch bridge (fetchAsDataUrl) enforces its
// contract (bad URLs, oversize bodies) without breaking other frames.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('./helpers/extension');

const VENDOR_DIR = path.join(__dirname, '..', 'extension', 'vendor');

function parseRgbLightness(rgbString) {
  const match = rgbString.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

test.describe('AC-1 extension skeleton', () => {
  test('vendor files exist and the service worker is the background script', async ({ sw }) => {
    expect(sw.url()).toContain('background.js');
    expect(fs.existsSync(path.join(VENDOR_DIR, 'darkreader.js'))).toBe(true);
    expect(fs.existsSync(path.join(VENDOR_DIR, 'LICENSE'))).toBe(true);
  });
});

test.describe('AC-2 same-origin theming', () => {
  test('light.html is themed dark', async ({ page }) => {
    // B2 made content.js settings-aware (Enabled=Auto by default); establish
    // wantDark explicitly since headless Chromium defaults to light (AN
    // §Testing strategy / mistake-proofing, applies retroactively to B1's
    // own specs once content.js v1 landed).
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 5000 });

    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(parseRgbLightness(bg)).toBeLessThan(0.5);
  });
});

test.describe('AC-3 cross-origin CSS bridge', () => {
  test('cors.html: cross-origin stylesheet is themed via the fetch proxy', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (msg) => consoleMessages.push(msg.text()));

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/cors.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 5000 });

    const bg = await page.evaluate(() => getComputedStyle(document.getElementById('cors-box')).backgroundColor);
    expect(parseRgbLightness(bg)).toBeLessThan(0.5);

    const corsErrors = consoleMessages.filter((text) => text.includes('Embedded Dark Reader cannot access'));
    expect(corsErrors).toEqual([]);
  });
});

test.describe('AC-4 background fetch bridge boundary', () => {
  test('non-http(s) URLs are rejected', async ({ sw }) => {
    const fileResult = await sw.evaluate(() => fetchAsDataUrl('file:///etc/hosts'));
    expect(fileResult.ok).toBe(false);

    const chromeResult = await sw.evaluate(() => fetchAsDataUrl('chrome://version'));
    expect(chromeResult.ok).toBe(false);
  });

  test('oversize bodies are rejected as too-large', async ({ sw }) => {
    const result = await sw.evaluate(() => fetchAsDataUrl('http://127.0.0.1:4180/big.bin'));
    expect(result.ok).toBe(false);
    expect(result.error).toBe('too-large');
  });

  test('other pages keep working after a rejected fetch', async ({ page, sw }) => {
    await sw.evaluate(() => fetchAsDataUrl('file:///etc/hosts'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('http://127.0.0.1:4180/light.html');
    await expect(page.locator('html')).toHaveAttribute('data-darkreader-mode', 'dynamic', { timeout: 5000 });
  });
});
