// B3 — unit-ish tests for extension/detector.js (BDM_DETECTOR), loaded into
// a plain page's main world via addScriptTag (no extension involved).
'use strict';

const path = require('node:path');
const { test, expect } = require('./helpers/probes');

const DETECTOR_PATH = path.join(__dirname, '..', 'extension', 'detector.js');

async function loadDetector(page) {
  await page.goto('about:blank');
  await page.addScriptTag({ path: DETECTOR_PATH });
}

test.describe('BDM_DETECTOR.parseColor', () => {
  test('parses rgb/rgba/transparent, rejects modern syntax', async ({ page }) => {
    await loadDetector(page);
    const results = await page.evaluate(() => {
      const D = window.BDM_DETECTOR;
      return {
        rgb: D.parseColor('rgb(24, 26, 27)'),
        rgba: D.parseColor('rgba(0,0,0,0)'),
        transparent: D.parseColor('transparent'),
        modern: D.parseColor('color(srgb 1 1 1)')
      };
    });
    expect(results.rgb).toEqual({ r: 24, g: 26, b: 27, a: 1 });
    expect(results.rgba).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(results.transparent).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(results.modern).toBeNull();
  });
});

test.describe('BDM_DETECTOR.getSRGBLightness', () => {
  test('white = 1, black = 0', async ({ page }) => {
    await loadDetector(page);
    const results = await page.evaluate(() => ({
      white: window.BDM_DETECTOR.getSRGBLightness(255, 255, 255),
      black: window.BDM_DETECTOR.getSRGBLightness(0, 0, 0)
    }));
    expect(results.white).toBeCloseTo(1, 10);
    expect(results.black).toBe(0);
  });
});

test.describe('BDM_DETECTOR.hasBuiltInDarkTheme', () => {
  test('true for a dark inline root style', async ({ page }) => {
    await loadDetector(page);
    const result = await page.evaluate(() => {
      document.documentElement.style.backgroundColor = '#111111';
      document.documentElement.style.color = '#dddddd';
      document.body.style.margin = '0';
      document.body.innerHTML = '<div style="min-height:200px">dark</div>';
      return window.BDM_DETECTOR.hasBuiltInDarkTheme();
    });
    expect(result).toBe(true);
  });

  test('false for the default light page', async ({ page }) => {
    await loadDetector(page);
    const result = await page.evaluate(() => {
      document.body.innerHTML = '<div style="min-height:200px">light</div>';
      return window.BDM_DETECTOR.hasBuiltInDarkTheme();
    });
    expect(result).toBe(false);
  });
});
