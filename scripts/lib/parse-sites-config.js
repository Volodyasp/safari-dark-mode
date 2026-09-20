// MIT License
//
// Copyright (c) 2026 Dark Reader Ltd.
//
// Node ESM port of Dark Reader's sites-fixes-config parser, used at build
// time only by scripts/import-fixes.js (never shipped to the extension).
// Ported from:
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/generators/utils/parse.ts (parseSitesFixesConfig)
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/utils/text.ts (parseArray)
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/generators/dynamic-theme.ts (fixes command map)
// https://github.com/darkreader/darkreader/blob/3df6a4aacb7285859003eb1af3182e4370280b5e/src/generators/detector-hints.ts (hints command map)
// commit 3df6a4aacb7285859003eb1af3182e4370280b5e
// modified: only the whole-config parse path is ported (parseSitesFixesConfig);
// the runtime trie-index/lookup path (indexSitesFixesConfig, getSitesFixesFor)
// is out of scope for the build-time importer and is not ported here.

// text.ts parseArray: one URL/value per non-blank line, trimmed.
export function parseArray(text) {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s);
}

// generators/utils/parse.ts parseSitesFixesConfig, verbatim logic.
// `options.commands` is accepted for signature fidelity with upstream but,
// as in upstream, unused inside the function body.
export function parseSitesFixesConfig(text, options) {
  const sites = [];

  const blocks = text.replace(/\r/g, '').split(/^\s*={2,}\s*$/gm);
  blocks.forEach((block) => {
    const lines = block.split('\n');
    const commandIndices = [];
    lines.forEach((ln, i) => {
      if (ln.match(/^[A-Z]+(\s[A-Z]+){0,2}$/)) {
        commandIndices.push(i);
      }
    });

    if (commandIndices.length === 0) {
      return;
    }

    const siteFix = {
      url: parseArray(lines.slice(0, commandIndices[0]).join('\n'))
    };

    commandIndices.forEach((commandIndex, i) => {
      const command = lines[commandIndex].trim();
      const valueText = lines
        .slice(commandIndex + 1, i === commandIndices.length - 1 ? lines.length : commandIndices[i + 1])
        .join('\n');
      const prop = options.getCommandPropName(command);
      if (!prop) {
        return;
      }
      const value = options.parseCommandValue(command, valueText);
      siteFix[prop] = value;
    });

    sites.push(siteFix);
  });

  return sites;
}

// generators/dynamic-theme.ts command map.
const dynamicThemeFixesCommands = {
  INVERT: 'invert',
  CSS: 'css',
  'IGNORE INLINE STYLE': 'ignoreInlineStyle',
  'IGNORE IMAGE ANALYSIS': 'ignoreImageAnalysis',
  'IGNORE CSS URL': 'ignoreCSSUrl'
};

export function parseDynamicThemeFixes(text) {
  return parseSitesFixesConfig(text, {
    commands: Object.keys(dynamicThemeFixesCommands),
    getCommandPropName: (command) => dynamicThemeFixesCommands[command],
    parseCommandValue: (command, value) => {
      if (command === 'CSS') {
        return value.trim();
      }
      return parseArray(value);
    }
  });
}

// generators/detector-hints.ts command map.
const detectorHintsCommands = {
  TARGET: 'target',
  MATCH: 'match',
  'NO DARK THEME': 'noDarkTheme',
  'SYSTEM THEME': 'systemTheme',
  IFRAME: 'iframe'
};

export function parseDetectorHints(text) {
  return parseSitesFixesConfig(text, {
    commands: Object.keys(detectorHintsCommands),
    getCommandPropName: (command) => detectorHintsCommands[command],
    parseCommandValue: (command, value) => {
      if (command === 'TARGET') {
        return value.trim();
      }
      if (command === 'NO DARK THEME' || command === 'SYSTEM THEME') {
        return true;
      }
      return parseArray(value);
    }
  });
}
