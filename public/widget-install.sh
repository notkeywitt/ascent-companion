#!/bin/zsh
# Installs the Ascent desktop widget. Home's "Open desktop widget" button gives
# you the command that runs this. Source: desktop-widget/ in the repo.
set -euo pipefail
BASE="https://ascent-companion.vercel.app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Ascent Widget…"
curl -fsSL "$BASE/AscentWidget.zip" -o "$TMP/AscentWidget.zip"
mkdir -p "$HOME/Applications"
pkill -x AscentWidget 2>/dev/null || true
rm -rf "$HOME/Applications/Ascent Widget.app"
ditto -x -k "$TMP/AscentWidget.zip" "$HOME/Applications"
xattr -dr com.apple.quarantine "$HOME/Applications/Ascent Widget.app" 2>/dev/null || true
open "$HOME/Applications/Ascent Widget.app"
echo "Done. The widget is open. Sign in with Google once."
