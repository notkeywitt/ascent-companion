#!/bin/zsh
# Builds "Ascent Widget.app" from AscentWidget.swift with the Command Line
# Tools (no Xcode), then installs it in ~/Applications.
#
#   ./build.sh            build + install
#   ./build.sh --login    also start it at every login (a LaunchAgent)
set -euo pipefail
cd "$(dirname "$0")"

APP="build/Ascent Widget.app"
rm -rf build
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# One build per chip, joined, so the zip runs on Apple silicon and Intel Macs.
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos13.0" -o "build/AscentWidget-$arch" AscentWidget.swift \
    -framework AppKit -framework WebKit
done
lipo -create build/AscentWidget-arm64 build/AscentWidget-x86_64 -output "$APP/Contents/MacOS/AscentWidget"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.ascentbuildingco.widget</string>
  <key>CFBundleName</key><string>Ascent Widget</string>
  <key>CFBundleExecutable</key><string>AscentWidget</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>Ascent Widget</string>
    <key>CFBundleURLSchemes</key><array><string>ascentwidget</string></array>
  </dict></array>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST

# The app icon, from the Assistant's own 512px icon.
ICON_SRC="../public/icon-512.png"
if [[ -f "$ICON_SRC" ]]; then
  SET="build/AppIcon.iconset"; mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$ICON_SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2)); [[ $d -le 512 ]] && sips -z $d $d "$ICON_SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns" || true
fi

# Ad-hoc signature (signed by this Mac, not by Apple) so macOS will run it.
codesign --force --sign - "$APP"

# The copy the Home button's installer downloads (public/widget-install.sh).
# Commit it after a rebuild; it is the only way a Mac without a compiler gets
# the app.
ditto -c -k --keepParent "$APP" ../public/AscentWidget.zip

mkdir -p ~/Applications
pkill -x AscentWidget 2>/dev/null || true
rm -rf ~/Applications/"Ascent Widget.app"
cp -R "$APP" ~/Applications/
echo "Installed ~/Applications/Ascent Widget.app"

if [[ "${1:-}" == "--login" ]]; then
  PL=~/Library/LaunchAgents/com.ascentbuildingco.widget.plist
  cat > "$PL" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ascentbuildingco.widget</string>
  <key>ProgramArguments</key><array><string>$HOME/Applications/Ascent Widget.app/Contents/MacOS/AscentWidget</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$PL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PL"
  echo "Starts at login: $PL"
else
  open ~/Applications/"Ascent Widget.app"
fi
