#!/bin/sh
# Sets up the updater on a Mac: a launchd job that keeps this repo copy on
# the newest main, every 10 minutes and at login (update.sh). Run it once on
# each Mac that runs the Claude Code scripts. Safe to run again.
# It uses the monthly check's token (~/.ascent-monthly-check/token) only to
# report which code the Mac runs to the AI Scripts page.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.ascent.mac-update.plist"
LOG="$HOME/Library/Logs/ascent-mac-update.log"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod +x "$HERE/update.sh"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ascent.mac-update</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$HERE/update.sh</string>
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
echo "Updater installed. Every 10 minutes it moves this folder to the newest main. Log: $LOG"
