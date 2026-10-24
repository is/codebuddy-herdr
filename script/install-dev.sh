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

PLUGIN_NAME="$(python3 -c "import json;print(json.load(open('$SOURCE/.codebuddy-plugin/plugin.json'))['name'])")"

echo "Plugin source: $SOURCE"
echo "Plugin name:   $PLUGIN_NAME"

# 1) Install locally if not already present.
if [ ! -f "$INSTALLED_JSON" ] || ! python3 -c "import json,sys; d=json.load(open('$INSTALLED_JSON')); sys.exit(0 if any(k.startswith('$PLUGIN_NAME@') for k in d.get('plugins',{})) else 1)"; then
  echo "Plugin not installed yet; installing locally (codebuddy plugin add)..."
  codebuddy plugin add "$SOURCE" -y || true
fi

# 2) Locate the installed cache path (the runtime load path) from the registry.
CACHE_PATH="$(python3 - "$INSTALLED_JSON" "$PLUGIN_NAME" <<'PY'
import json, sys
inst, name = sys.argv[1], sys.argv[2]
d = json.load(open(inst))
for key, entries in d.get('plugins', {}).items():
    if key.startswith(name + '@'):
        print(entries[0]['installPath'])
        break
PY
)"

if [ -z "$CACHE_PATH" ]; then
  echo "ERROR: could not find installPath for $PLUGIN_NAME in $INSTALLED_JSON" >&2
  exit 1
fi

# 3) Derive the package-sources (re-extract source) path from the cache path.
#    cache/           <market>/<name>/<version>
#    package-sources/<market>/versions/<version>/package
VERSION_DIR="$(basename "$CACHE_PATH")"
ROOT="$(dirname "$(dirname "$(dirname "$(dirname "$CACHE_PATH")"))")"
MARKET="$(basename "$(dirname "$(dirname "$CACHE_PATH")"))"
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
PLUGIN_ID="$(python3 - "$INSTALLED_JSON" "$PLUGIN_NAME" <<'PY'
import json, sys
inst, name = sys.argv[1], sys.argv[2]
d = json.load(open(inst))
for key in d.get('plugins', {}):
    if key.startswith(name + '@'):
        print(key)
        break
PY
)"
echo "Enabling $PLUGIN_ID ..."
codebuddy plugin enable "$PLUGIN_ID" || true

echo
echo "Done. Run /reload-plugins (or start a new session) to load the plugin."
echo "Edits to $SOURCE now apply live via /reload-plugins."
