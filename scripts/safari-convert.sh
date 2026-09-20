#!/usr/bin/env bash
# Converts extension/ into a Safari app-extension Xcode project under
# safari/ (SPECS §10, AN §Safari wrapper). No --copy-resources: the
# generated project references extension/ live, so it stays in sync with
# the same unbundled source Chrome loads.
set -euo pipefail
cd "$(dirname "$0")/.."

xcrun safari-web-extension-converter extension \
  --project-location safari \
  --app-name "Browser Dark Mode" \
  --bundle-identifier com.vladimir.browser-dark-mode \
  --swift \
  --macos-only \
  --no-open \
  --no-prompt \
  --force

# The converter applies --bundle-identifier to the extension target but
# derives the container app's id from --app-name ("com.vladimir.Browser-Dark-Mode"),
# and xcodebuild then rejects the embedded extension because its id is not
# prefixed with the app's id (case-sensitive). Align the app target.
PBXPROJ="safari/Browser Dark Mode/Browser Dark Mode.xcodeproj/project.pbxproj"
sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = "com\.vladimir\.Browser-Dark-Mode";/PRODUCT_BUNDLE_IDENTIFIER = "com.vladimir.browser-dark-mode";/' "$PBXPROJ"
grep -q 'PRODUCT_BUNDLE_IDENTIFIER = "com.vladimir.browser-dark-mode";' "$PBXPROJ"

# The converter emits 10.14 for the extension target (rejected by Xcode 26
# under automatic signing) and the current SDK version for the app target.
# Pin both to macOS 15.4 = Safari 18.4, the minimum this extension supports.
sed -i '' 's/MACOSX_DEPLOYMENT_TARGET = [0-9.]*;/MACOSX_DEPLOYMENT_TARGET = 15.4;/' "$PBXPROJ"
grep -q 'MACOSX_DEPLOYMENT_TARGET = 15.4;' "$PBXPROJ"
