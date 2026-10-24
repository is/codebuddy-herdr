#!/usr/bin/env bash
# install-dev.sh - install the codebuddy-herdr plugin into CodeBuddy as a LIVE
# SYMLINK (dev mode). CodeBuddy keeps a hash-based plugin cache; a full restart
# can replace the symlink with a copy, so re-run this script to restore it.
#
# Steps:
#   1. Resolve the plugin source dir (this repo = parent of this script).
#   2. Install the plugin locally if it is not already installed.
#   3. Replace CodeBuddy's cache copy AND package-sources copy with symlinks to
#      the source, so edits apply via /reload-plugins.
#   4. Enable the plugin.
#
# Usage:  bash script/install-dev.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$(cd "$SCRIPT_DIR/.." && pwd)"

CB_HOME="${CODEBUDDY_HOME:-$HOME/.codebuddy}"
INSTALLED_JSON="$CB_HOME/plugins/installed_plugins.json"

PLUGIN_NAME=$(node -e 'const fs = require("fs"); console.log(JSON.parse(fs.readFileSync(process.argv[1], "utf8")).name)' "$SOURCE/.codebuddy-plugin/plugin.json")

echo "Plugin source: $SOURCE"
echo "Plugin name:   $PLUGIN_NAME"

# 1) Install locally if not already present.
if [ ! -f "$INSTALLED_JSON" ] || ! node -e 'const fs = require("fs"); const [installed, name] = process.argv.slice(1); const data = JSON.parse(fs.readFileSync(installed, "utf8")); process.exit(Object.keys(data.plugins || {}).some((key) => key.startsWith(`${name}@`)) ? 0 : 1)' "$INSTALLED_JSON" "$PLUGIN_NAME"; then
  echo "Plugin not installed yet; installing locally (codebuddy plugin add)..."
  codebuddy plugin add "$SOURCE" -y || true
fi

# 2) Locate the installed cache path (the runtime load path) from the registry.
CACHE_PATH=$(node -e 'const fs = require("fs"); const [installed, name] = process.argv.slice(1); const data = JSON.parse(fs.readFileSync(installed, "utf8")); const entry = Object.entries(data.plugins || {}).find(([key]) => key.startsWith(`${name}@`)); if (entry) console.log(entry[1][0].installPath)' "$INSTALLED_JSON" "$PLUGIN_NAME")

if [ -z "$CACHE_PATH" ]; then
  echo "ERROR: could not find installPath for $PLUGIN_NAME in $INSTALLED_JSON" >&2
  exit 1
fi

# 3) Derive the package-sources (re-extract source) path from the cache path.
#    cache/           <market>/<name>/<version>
#    package-sources/<market>/versions/<version>/package
VERSION_DIR="$(basename "$CACHE_PATH")"
CACHE_PARENT="$(dirname "$CACHE_PATH")"
MARKET_PARENT="$(dirname "$CACHE_PARENT")"
MARKET="$(basename "$MARKET_PARENT")"
CACHE_ROOT="$(dirname "$MARKET_PARENT")"
ROOT="$(dirname "$CACHE_ROOT")"
PKG_SRC="$ROOT/package-sources/$MARKET/versions/$VERSION_DIR/package"

echo "Cache path:      $CACHE_PATH"
echo "Package-sources: $PKG_SRC"

relink() {
  local target="$1" linkname="$2"
  if [ -L "$linkname" ] && [ "$(readlink -f "$linkname")" = "$(readlink -f "$target")" ]; then
    echo "  already linked: $linkname"
    return
  fi
  rm -rf "$linkname"
  ln -s "$target" "$linkname"
  echo "  linked: $linkname -> $target"
}

relink "$SOURCE" "$CACHE_PATH"
relink "$SOURCE" "$PKG_SRC"

# 4) Enable the plugin.
PLUGIN_ID=$(node -e 'const fs = require("fs"); const [installed, name] = process.argv.slice(1); const data = JSON.parse(fs.readFileSync(installed, "utf8")); const key = Object.keys(data.plugins || {}).find((candidate) => candidate.startsWith(`${name}@`)); if (key) console.log(key)' "$INSTALLED_JSON" "$PLUGIN_NAME")
echo "Enabling $PLUGIN_ID ..."
codebuddy plugin enable "$PLUGIN_ID" || true

echo
echo "Done. Run /reload-plugins (or start a new session) to load the plugin."
echo "Edits to $SOURCE now apply live via /reload-plugins."
