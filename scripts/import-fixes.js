// Build-time importer: downloads Dark Reader's site-fixes and detector-hints
// configs at a pinned upstream commit, parses them, validates every URL
// pattern with extension/lib/url-match.js, and writes the stable,
// committed data files extension/data/{fixes.json,hints.json} (SPECS-11
// NFR-13 — generated but committed, so the public repo builds from a clone
// without any network beyond `npm ci`). Never edit those JSON files by hand;
// rerun `npm run import-fixes` instead.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_COMMIT = '3df6a4aacb7285859003eb1af3182e4370280b5e';

const CONFIG_FILES = {
  fixes: 'dynamic-theme-fixes.config',
  hints: 'detector-hints.config'
};

const LOCAL_FALLBACK_DIR = path.join(__dirname, '..', 'refsrc', 'darkreader', '3df6a4a', 'src', 'config');

function parseArgs(argv) {
  const args = {
    commit: process.env.IMPORT_COMMIT || DEFAULT_COMMIT,
    out: path.join(__dirname, '..', 'extension', 'data')
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--commit=')) {
      args.commit = arg.slice('--commit='.length);
    } else if (arg.startsWith('--out=')) {
      args.out = path.resolve(arg.slice('--out='.length));
    } else if (arg === '--out' && argv[i + 1]) {
      args.out = path.resolve(argv[i + 1]);
      i++;
    } else if (arg === '--commit' && argv[i + 1]) {
      args.commit = argv[i + 1];
      i++;
    }
  }
  return args;
}

// Network fetch is the primary path (NFR-13: the pinned commit is recorded
// in the output, not "latest"); the local refsrc copy at the same pinned
// commit is a fallback (and, incidentally, a way to verify the network copy
// matches — see HANDOFF.md) so this script still works offline for the
// default commit.
async function fetchConfig(commit, filename) {
  const url = `https://raw.githubusercontent.com/darkreader/darkreader/${commit}/src/config/${filename}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return { text: await res.text(), source: url };
  } catch (err) {
    const localPath = path.join(LOCAL_FALLBACK_DIR, filename);
    if (commit === DEFAULT_COMMIT && fs.existsSync(localPath)) {
      console.warn(`import-fixes: network fetch failed (${err.message}); using local fallback ${localPath}`);
      return { text: fs.readFileSync(localPath, 'utf8'), source: `file://${localPath}` };
    }
    throw err;
  }
}

function isValidPattern(pattern) {
  const BDM_URL = globalThis.BDM_URL;
  if (BDM_URL.isRegExp(pattern)) {
    return BDM_URL.createRegExp(pattern) !== null;
  }
  return BDM_URL.preparePattern(pattern) !== null;
}

// Splits `list` into entries whose every URL pattern is valid vs. entries to
// skip (with a warning) — an entry with zero patterns is also invalid (it
// could never match anything).
function validateURLPatterns(list, kind) {
  const valid = [];
  const skipped = [];
  for (const entry of list) {
    const patterns = entry.url || [];
    const allValid = patterns.length > 0 && patterns.every(isValidPattern);
    if (allValid) {
      valid.push(entry);
    } else {
      skipped.push(entry);
      console.warn(`import-fixes: skipping ${kind} with invalid URL pattern(s): ${JSON.stringify(patterns)}`);
    }
  }
  return { valid, skipped };
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  require('../extension/lib/url-match.js'); // sets globalThis.BDM_URL (classic script, side-effect require)
  const { parseDynamicThemeFixes, parseDetectorHints } = await import('./lib/parse-sites-config.js');

  const [fixesConfig, hintsConfig] = await Promise.all([
    fetchConfig(args.commit, CONFIG_FILES.fixes),
    fetchConfig(args.commit, CONFIG_FILES.hints)
  ]);

  const parsedFixes = parseDynamicThemeFixes(fixesConfig.text);
  const parsedHints = parseDetectorHints(hintsConfig.text);

  const { valid: validFixes } = validateURLPatterns(parsedFixes, 'fix');
  const { valid: validHints } = validateURLPatterns(parsedHints, 'hint');

  const genericIndex = validFixes.findIndex((f) => f.url.length === 1 && f.url[0] === '*');
  if (genericIndex === -1) {
    console.error('import-fixes: no generic (*) fix block found in the parsed config — aborting');
    process.exit(1);
  }
  const generic = validFixes[genericIndex];
  const sites = validFixes.filter((_, i) => i !== genericIndex);

  const fixesOut = {
    commit: args.commit,
    generatedFrom: fixesConfig.source,
    count: sites.length,
    generic,
    sites
  };
  const hintsOut = {
    commit: args.commit,
    generatedFrom: hintsConfig.source,
    count: validHints.length,
    hints: validHints
  };

  fs.mkdirSync(args.out, { recursive: true });
  writeJSON(path.join(args.out, 'fixes.json'), fixesOut);
  writeJSON(path.join(args.out, 'hints.json'), hintsOut);

  console.log(`import-fixes: wrote ${sites.length} site fixes + 1 generic fix -> ${path.join(args.out, 'fixes.json')}`);
  console.log(`import-fixes: wrote ${validHints.length} hints -> ${path.join(args.out, 'hints.json')}`);
}

main().catch((err) => {
  console.error('import-fixes: failed:', err);
  process.exit(1);
});
