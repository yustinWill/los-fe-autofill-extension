#!/bin/sh
# Cut a new testable build of the extension.
#
# Two things have to happen together, and forgetting either is the usual way a
# test run measures the OLD code:
#
#   1. autofill-bundle.js is REGENERATED from popup.js + driver-v2.js. It is the
#      paste-in form used by browser sessions; nothing rebuilds it automatically.
#   2. manifest.json's patch version is bumped, so Chrome's extension page shows
#      a version that visibly changed after you hit Reload. Without it a stale
#      service worker or cached popup is indistinguishable from a working reload.
#
# Then: chrome://extensions → the extension's Reload button (⟳).
# The popup is re-read on every open; a hard reload of the TAB is only needed if
# a content script changed.
set -e
cd "$(dirname "$0")"

./build-bundle.sh

node -e "
const fs = require('fs'), f = 'manifest.json';
const m = JSON.parse(fs.readFileSync(f, 'utf8'));
const p = m.version.split('.');
p[2] = +p[2] + 1;
m.version = p.join('.');
fs.writeFileSync(f, JSON.stringify(m, null, 2) + '\n');
console.log('extension version -> ' + m.version);
"

# The version to quote in the commit subject is the one AFTER the bump. Printing
# it here because reading it off the pre-bump manifest is how `4074334` came to
# say "v1.0.56" over a manifest reading 1.0.57 — which then made `git log`
# understate the shipped version and produced a wrong unreleased-commit count.
echo
echo "Commit subject: chore(release): v$(node -p "require('./manifest.json').version") — <what changed>"
echo
echo "Next: chrome://extensions -> Reload (⟳) on 'LOS Form Autofill'"
