#!/bin/sh
# Sets up lead research on a Mac: a launchd job that runs at login and every
# 2 minutes. run.sh asks the app whether a lead is waiting. Install it on the
# office Mac mini, the owner's MacBook, or both; the app gives each run to one.
#
# It uses the monthly check's token, ~/.ascent-monthly-check/token. On the
# office Mac it is already there. On a second Mac, copy that file from the
# office Mac first (same value: Vercel holds one REVIEW_AGENT_TOKEN).
# `install.sh --new-token` makes a fresh token instead; Vercel then needs it,
# and every other Mac needs the new file.
# Safe to run again.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TOKEN_DIR="$HOME/.ascent-monthly-check"
PLIST="$HOME/Library/LaunchAgents/com.ascent.lead-research.plist"
LOG="$HOME/Library/Logs/ascent-lead-research.log"

mkdir -p "$TOKEN_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod 700 "$TOKEN_DIR"

NEW_TOKEN=""
if [ ! -s "$TOKEN_DIR/token" ]; then
  if [ "${1:-}" != "--new-token" ]; then
    echo "No token at $TOKEN_DIR/token."
    echo "Copy that file from the office Mac, then run this again."
    echo "(Or run with --new-token to make one; Vercel and every other Mac then need it.)"
    exit 1
  fi
  (umask 077; openssl rand -hex 32 > "$TOKEN_DIR/token")
  NEW_TOKEN=1
fi
chmod 600 "$TOKEN_DIR/token"
chmod +x "$HERE/run.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ascent.lead-research</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/run.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>120</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Checks every 2 minutes. Log: $LOG"
if [ -n "$NEW_TOKEN" ]; then
  echo "New token made. Put it on Vercel, then redeploy:"
  echo "  npx vercel env add REVIEW_AGENT_TOKEN production --sensitive < $TOKEN_DIR/token"
fi
