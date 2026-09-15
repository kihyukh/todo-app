#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_STAGING="$(mktemp -d "${TMPDIR:-/tmp}/daymark-build.XXXXXX")"
TASK_INSTALL_STAGING=""
TASK_CACHE_BUILD=""
TASK_KEEP_BUILD=0
trap 'rm -rf "$TASK_STAGING"; if [ -n "$TASK_INSTALL_STAGING" ]; then rm -rf "$TASK_INSTALL_STAGING"; fi; if [ -n "$TASK_CACHE_BUILD" ] && [ "$TASK_KEEP_BUILD" = "0" ]; then rm -rf "$TASK_CACHE_BUILD"; fi' EXIT
TASK_MODE="${1:---install}"
if [ "$TASK_MODE" != "--install" ] && [ "$TASK_MODE" != "--no-install" ]; then
  echo "Usage: scripts/build-mac.sh [--install | --no-install]"
  exit 1
fi
TASK_OUTPUT="$TASK_ROOT/build/GreenDay.app"
TASK_INSTALLED="${DAYMARK_INSTALL_PATH:-$HOME/Applications/GreenDay.app}"
TASK_WEB="${DAYMARK_WEB_DIST:-$TASK_ROOT/dist}"

if [ ! -f "$TASK_WEB/index.html" ]; then
  echo "No built web app found. Run npm run build first."
  exit 1
fi

TASK_CACHE_ROOT="$HOME/Library/Caches/GreenDay"
mkdir -p "$TASK_CACHE_ROOT/Builds" "$TASK_CACHE_ROOT/PreviousApps"
TASK_CACHE_BUILD="$(mktemp -d "$TASK_CACHE_ROOT/Builds/build.XXXXXX")"
TASK_APP="$TASK_CACHE_BUILD/GreenDay.app"

# Keep runnable bundles outside the iCloud-managed repository. Finder metadata
# can appear immediately on a copied bundle and invalidate its signature.
mkdir -p "$TASK_APP/Contents/MacOS" "$TASK_APP/Contents/Resources/Web"
swiftc -O -swift-version 5 -target "$(uname -m)-apple-macosx13.0" \
  -framework AppKit -framework WebKit -framework UniformTypeIdentifiers -framework EventKit \
  "$TASK_ROOT/native/Shared/DaymarkStore.swift" \
  "$TASK_ROOT/native/Shared/DaymarkCalendar.swift" \
  "$TASK_ROOT/native/Shared/DaymarkWebBridge.swift" \
  "$TASK_ROOT/native/macOS/main.swift" \
  -o "$TASK_APP/Contents/MacOS/Daymark"
cp -X "$TASK_ROOT/native/macOS/Info.plist" "$TASK_APP/Contents/Info.plist"
swift "$TASK_ROOT/native/macOS/MakeIcon.swift" "$TASK_STAGING/Daymark.iconset"
iconutil -c icns "$TASK_STAGING/Daymark.iconset" -o "$TASK_APP/Contents/Resources/Daymark.icns"
ditto --norsrc --noextattr "$TASK_WEB" "$TASK_APP/Contents/Resources/Web"
codesign --force --deep --sign - "$TASK_APP"
codesign --verify --deep --strict "$TASK_APP"

verify_existing_app() {
  local task_existing_id
  task_existing_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$task_existing_id" != "app.daymark.desktop" ]; then
    echo "Refusing to replace a different app at $1"
    exit 1
  fi
}

mkdir -p "$TASK_ROOT/build"
if [ -L "$TASK_OUTPUT" ]; then
  rm "$TASK_OUTPUT"
elif [ -e "$TASK_OUTPUT" ]; then
  verify_existing_app "$TASK_OUTPUT"
  rm -rf "$TASK_OUTPUT"
fi
ln -s "$TASK_APP" "$TASK_OUTPUT"
TASK_KEEP_BUILD=1
echo "Built $TASK_OUTPUT"
if [ "$TASK_MODE" = "--no-install" ]; then
  echo "Verification build only; installed apps and workspace data were not changed."
  exit 0
fi

mkdir -p "$(dirname "$TASK_INSTALLED")"
TASK_INSTALL_STAGING="$(mktemp -d "$(dirname "$TASK_INSTALLED")/.greenday-install.XXXXXX")"
ditto --norsrc --noextattr "$TASK_APP" "$TASK_INSTALL_STAGING/GreenDay.app"
codesign --verify --deep --strict "$TASK_INSTALL_STAGING/GreenDay.app"
TASK_BACKUP=""
if [ -e "$TASK_INSTALLED" ] || [ -L "$TASK_INSTALLED" ]; then
  verify_existing_app "$TASK_INSTALLED"
  TASK_BACKUP="$(mktemp -d "$TASK_CACHE_ROOT/PreviousApps/greenday.XXXXXX")"
  mv "$TASK_INSTALLED" "$TASK_BACKUP/GreenDay.app"
  echo "Previous app retained at $TASK_BACKUP/GreenDay.app"
fi
if ! mv "$TASK_INSTALL_STAGING/GreenDay.app" "$TASK_INSTALLED"; then
  if [ -n "$TASK_BACKUP" ]; then mv "$TASK_BACKUP/GreenDay.app" "$TASK_INSTALLED"; fi
  echo "Installation failed; the previous app was restored."
  exit 1
fi

# Existing shortcuts may still point at Daymark.app. Keep that path working,
# preserving its previous binary and never moving or renaming workspace data.
TASK_LEGACY="$HOME/Applications/Daymark.app"
if [ -z "${DAYMARK_INSTALL_PATH:-}" ] && { [ -e "$TASK_LEGACY" ] || [ -L "$TASK_LEGACY" ]; }; then
  verify_existing_app "$TASK_LEGACY"
  if [ -L "$TASK_LEGACY" ]; then
    rm "$TASK_LEGACY"
  else
    TASK_LEGACY_BACKUP="$(mktemp -d "$TASK_CACHE_ROOT/PreviousApps/daymark.XXXXXX")"
    mv "$TASK_LEGACY" "$TASK_LEGACY_BACKUP/Daymark.app"
    echo "Previous Daymark app retained at $TASK_LEGACY_BACKUP/Daymark.app"
  fi
  ln -s "$TASK_INSTALLED" "$TASK_LEGACY"
fi
rm "$TASK_OUTPUT"
ln -s "$TASK_INSTALLED" "$TASK_OUTPUT"
TASK_KEEP_BUILD=0
echo "Installed $TASK_INSTALLED"
