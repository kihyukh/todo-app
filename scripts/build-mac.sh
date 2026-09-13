#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_STAGING="$(mktemp -d "${TMPDIR:-/tmp}/daymark-build.XXXXXX")"
trap 'rm -rf "$TASK_STAGING"' EXIT
TASK_APP="$TASK_STAGING/Daymark.app"
TASK_OUTPUT="$TASK_ROOT/build/Daymark.app"
TASK_INSTALLED="${DAYMARK_INSTALL_PATH:-$HOME/Applications/Daymark.app}"
TASK_WEB="${DAYMARK_WEB_DIST:-$TASK_ROOT/dist}"

if [ ! -f "$TASK_WEB/index.html" ]; then
  echo "No built web app found. Run npm run build first."
  exit 1
fi

mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources/Web"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macosx13.0" \
  -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
  "$TASK_ROOT/native/Shared/DaymarkStore.swift" \
  "$TASK_ROOT/native/Shared/DaymarkWebBridge.swift" \
  "$TASK_ROOT/native/macOS/main.swift" \
  -o "$TASK_APP/Contents/MacOS/Daymark"
cp -X "$TASK_ROOT/native/macOS/Info.plist" "$TASK_APP/Contents/Info.plist"
swift "$TASK_ROOT/native/macOS/MakeIcon.swift" "$TASK_STAGING/Daymark.iconset"
iconutil -c icns "$TASK_STAGING/Daymark.iconset" -o "$TASK_APP/Contents/Resources/Daymark.icns"
ditto --norsrc --noextattr "$TASK_WEB" "$TASK_APP/Contents/Resources/Web"
codesign --force --deep --sign - "$TASK_APP"
codesign --verify --deep --strict "$TASK_APP"
if [ -e "$TASK_INSTALLED" ]; then
  TASK_EXISTING_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TASK_INSTALLED/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$TASK_EXISTING_ID" != "app.daymark.desktop" ]; then
    echo "Refusing to replace a different app at $TASK_INSTALLED"
    exit 1
  fi
  rm -rf "$TASK_INSTALLED"
fi
mkdir -p "$(dirname "$TASK_INSTALLED")"
ditto --norsrc --noextattr "$TASK_APP" "$TASK_INSTALLED"
codesign --verify --deep --strict "$TASK_INSTALLED"
mkdir -p "$TASK_ROOT/build"
if [ -e "$TASK_OUTPUT" ] || [ -L "$TASK_OUTPUT" ]; then
  rm -rf "$TASK_OUTPUT"
fi
ln -s "$TASK_INSTALLED" "$TASK_OUTPUT"
echo "Built $TASK_OUTPUT"
echo "Installed $TASK_INSTALLED"
