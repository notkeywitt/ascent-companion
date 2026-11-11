#!/bin/sh
# Sets up batch-add analysis on the office Mac: a launchd job that runs at
# login and every 10 minutes. run.sh asks the app whether a run is due.
# It shares the monthly check's token (~/.ascent-monthly-check/token, made here
# if missing). Safe to run again.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
TOKEN_DIR="$HOME/.ascent-monthly-check"
PLIST="$HOME/Library/LaunchAgents/com.ascent.tool-batch.plist"
LOG="$HOME/Library/Logs/ascent-tool-batch.log"

mkdir -p "$TOKEN_DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod 700 "$TOKEN_DIR"

NEW_TOKEN=""
if [ ! -s "$TOKEN_DIR/token" ]; then
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
  <key>Label</key><string>com.ascent.tool-batch</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/run.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>600</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Checks every 10 minutes. Log: $LOG"
if [ -n "$NEW_TOKEN" ]; then
  echo "New token made. Put it on Vercel, then redeploy:"
  echo "  npx vercel env add REVIEW_AGENT_TOKEN production --sensitive < $TOKEN_DIR/token"
fi
