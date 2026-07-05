#!/bin/sh
# Self-heal the electron binary install. npm's blocked/buggy postinstall
# (allow-scripts; Node 26 install.js cache-hits then exits without
# extracting) can leave node_modules/electron without path.txt or with a
# partial dist/. Idempotent and fast when healthy. macOS arm64 only — this
# is a dev-machine shell (README.md).
set -eu
cd "$(dirname "$0")/node_modules/electron"

rel="Electron.app/Contents/MacOS/Electron"
if [ -f path.txt ] && [ -x "dist/$(cat path.txt)" ]; then
  exit 0
fi

version=$(node -p "require('./package.json').version")
find_zip() {
  ls "$HOME/Library/Caches/electron/"*/"electron-v$version-darwin-arm64.zip" 2>/dev/null | head -1
}

zip=$(find_zip)
if [ -z "$zip" ]; then
  # install.js downloads to the cache even when its extraction silently no-ops.
  node install.js || true
  zip=$(find_zip)
fi
if [ -z "$zip" ]; then
  echo "ensure-electron: no cached electron zip and install.js did not produce one" >&2
  exit 1
fi

rm -rf dist
mkdir dist
ditto -x -k "$zip" dist
printf '%s' "$rel" > path.txt
echo "ensure-electron: repaired electron install (v$version)"
