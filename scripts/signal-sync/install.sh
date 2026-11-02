#!/bin/sh
# Sets up signal_sync.py on the office Mac mini: a venv, ~/.ascent-signal/,
# and a launchd job that runs at login and every hour. Safe to run again; it
# keeps the secret.
# Which chats are sent is set on the Ascent app's AscentBot page. See README.md.
set -eu

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$HOME/.ascent-signal"
PLIST="$HOME/Library/LaunchAgents/com.ascent.signal-sync.plist"
LOG="$HOME/Library/Logs/ascent-signal-sync.log"

mkdir -p "$DIR/archive" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
chmod 700 "$DIR"

if [ ! -x "$DIR/venv/bin/python" ]; then
  /usr/bin/python3 -m venv "$DIR/venv"
fi
"$DIR/venv/bin/pip" install --quiet --upgrade pip
"$DIR/venv/bin/pip" install --quiet sqlcipher3-wheels cryptography

cp "$HERE/signal_sync.py" "$DIR/signal_sync.py"

if [ -f "$DIR/secret" ]; then chmod 600 "$DIR/secret"; fi

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ascent.signal-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DIR/venv/bin/python</string>
    <string>$DIR/signal_sync.py</string>
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

echo "Installed. Runs at login and every hour. Log: $LOG"
[ -f "$DIR/secret" ] || echo "Still to do: put SIGNAL_IMPORT_SECRET in $DIR/secret (see README.md)."
