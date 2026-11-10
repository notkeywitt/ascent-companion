#!/bin/sh
# Sets up the monthly invoice check on this Mac: a token in
# ~/.ascent-monthly-check/ and a launchd job that runs at login and every hour.
# run.sh decides whether today is a review day. Safe to run again; it keeps
# the token.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.ascent-monthly-check"
PLIST="$HOME/Library/LaunchAgents/com.ascent.monthly-check.plist"
LOG="$HOME/Library/Logs/ascent-monthly-check.log"

mkdir -p "$DIR" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod 700 "$DIR"

NEW_TOKEN=""
if [ ! -s "$DIR/token" ]; then
  (umask 077; openssl rand -hex 32 > "$DIR/token")
  NEW_TOKEN=1
fi
chmod 600 "$DIR/token"
chmod +x "$HERE/run.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ascent.monthly-check</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/run.sh</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "Installed. Checks at login and every hour; runs on review days after 9 am. Log: $LOG"
if [ -n "$NEW_TOKEN" ]; then
  echo "New token made. Put it on Vercel, then redeploy:"
  echo "  npx vercel env add REVIEW_AGENT_TOKEN production --sensitive < $DIR/token"
fi
