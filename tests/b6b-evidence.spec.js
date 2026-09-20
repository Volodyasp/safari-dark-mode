// Not part of the AC suite: captures B6b HITL evidence into
// plans/v1.1/evidence/B6b/ (LOCAL, git-ignored). Run manually, not via
// `npm test`. This sandbox has no outbound network access from the browser
// (verified: real https://github.com/ navigation gets
// net::ERR_CONNECTION_REFUSED even though `curl` from the shell succeeds —
// see HANDOFF.md), so this stands in for the "Chrome real-site check" by
// routing the real hostname to a local document (same technique as
// tests/b6b-content.spec.js's github.com test): `location.href` is
// genuinely `https://github.com/`, so the full content.js -> SW ->
// site-config -> merged FIXES -> DarkReader.enable pipeline runs for real
// against the real committed data. It does NOT substitute for the human's
// own visual "matches Dark Reader's look" judgment call on the real site,
// which needs actual internet + a human (PENDING HUMAN, see HANDOFF.md).
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { test } = require('./helpers/probes');

const EVIDENCE_DIR = path.join(__dirname, '..', 'plans', 'v1.1', 'evidence', 'B6b');

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test('capture github.com (routed locally) themed with its merged site fix', async ({ page, context }) => {
  await context.route('https://github.com/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><head><title>github.com (routed)</title></head><body style="min-height:600px"><h1>github.com</h1><p>Locally routed for B6b evidence — see HANDOFF.md.</p></body></html>'
    })
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('https://github.com/');
  await page.waitForSelector('html[data-darkreader-mode="dynamic"]');
  await page.screenshot({ path: path.join(EVIDENCE_DIR, 'github-routed-themed.png') });
});
