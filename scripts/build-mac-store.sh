#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_MODE="${1:---unsigned}"
if [ "$TASK_MODE" = "--help" ] || [ "$TASK_MODE" = "-h" ]; then
  cat <<'USAGE'
Usage: scripts/build-mac-store.sh [--unsigned | --signed]

Creates a universal Mac App Store Xcode archive, without installing or launching it.
--unsigned (default) verifies compilation/resources without a Developer account.
--signed requires DAYMARK_DEVELOPMENT_TEAM, DAYMARK_COPYRIGHT,
VITE_PUBLIC_PRIVACY_URL, and VITE_PUBLIC_SUPPORT_URL.

Optional: DAYMARK_DISPLAY_NAME, DAYMARK_VERSION, DAYMARK_BUILD_NUMBER,
DAYMARK_MAC_BUNDLE_IDENTIFIER, DAYMARK_MAC_ARCHIVE_PATH, DAYMARK_MAC_DERIVED_DATA,
DAYMARK_WEB_DIST, DAYMARK_SKIP_WEB_BUILD=1, DAYMARK_MAC_ALLOW_PROVISIONING_UPDATES=1.
Archives and derived data default to ~/Library/Caches/GreenDay/AppStore/macOS.
Use scripts/release-mac.sh to export or upload a signed archive.
USAGE
  exit 0
fi
if [ "$TASK_MODE" != "--unsigned" ] && [ "$TASK_MODE" != "--signed" ]; then
  echo "Usage: scripts/build-mac-store.sh [--unsigned | --signed]"
  exit 1
fi
export VITE_PUBLIC_PRIVACY_URL="${DAYMARK_PUBLIC_PRIVACY_URL:-${VITE_PUBLIC_PRIVACY_URL:-}}"
export VITE_PUBLIC_SUPPORT_URL="${DAYMARK_PUBLIC_SUPPORT_URL:-${VITE_PUBLIC_SUPPORT_URL:-}}"
TASK_SIGNING=NO
if [ "$TASK_MODE" = "--signed" ]; then
  if [[ ! "${DAYMARK_DEVELOPMENT_TEAM:-}" =~ ^[A-Z0-9]{10}$ ]]; then
    echo "Set DAYMARK_DEVELOPMENT_TEAM to your Apple Developer team ID and sign in to Xcode."
    exit 1
  fi
  if [ -z "${DAYMARK_COPYRIGHT:-}" ]; then
    echo "Set DAYMARK_COPYRIGHT to the actual publisher's copyright notice."
    exit 1
  fi
  TASK_SIGNING=YES
  node "$TASK_ROOT/scripts/verify-public-urls.mjs"
fi
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen is required. Install it with brew install xcodegen."
  exit 1
fi
if ! xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1; then
  echo "Select a full Xcode installation with the macOS SDK before archiving."
  exit 1
fi
TASK_VERSION="${DAYMARK_VERSION:-1.0.0}"
TASK_BUILD="${DAYMARK_BUILD_NUMBER:-1}"
if [[ ! "$TASK_VERSION" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || [[ ! "$TASK_BUILD" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]]; then
  echo "DAYMARK_VERSION and DAYMARK_BUILD_NUMBER must contain one to three numeric components."
  exit 1
fi
if [ "${DAYMARK_SKIP_WEB_BUILD:-0}" != "1" ]; then
  (cd "$TASK_ROOT" && VITE_APP_NAME="${DAYMARK_DISPLAY_NAME:-GreenDay}" \
    VITE_APP_VERSION="$TASK_VERSION" VITE_NATIVE_APP=1 npm run build)
fi
TASK_WEB="${DAYMARK_WEB_DIST:-$TASK_ROOT/dist}"
node "$TASK_ROOT/scripts/verify-web-release.mjs" "$TASK_WEB" --native
TASK_WEB="$(cd "$TASK_WEB" && pwd)"
TASK_CACHE="$HOME/Library/Caches/GreenDay/AppStore/macOS"
TASK_DERIVED="${DAYMARK_MAC_DERIVED_DATA:-$TASK_CACHE/DerivedData}"
TASK_ARCHIVE="${DAYMARK_MAC_ARCHIVE_PATH:-$TASK_CACHE/GreenDay.xcarchive}"
mkdir -p "$(dirname "$TASK_ARCHIVE")" "$(dirname "$TASK_DERIVED")"
xcodegen generate --spec "$TASK_ROOT/native/project.yml"
TASK_SETTINGS=(
  "DAYMARK_DISPLAY_NAME=${DAYMARK_DISPLAY_NAME:-GreenDay}"
  "DAYMARK_COPYRIGHT=${DAYMARK_COPYRIGHT:-Copyright owner not configured}"
  "PRODUCT_BUNDLE_IDENTIFIER=${DAYMARK_MAC_BUNDLE_IDENTIFIER:-app.daymark.desktop}"
  "MARKETING_VERSION=$TASK_VERSION"
  "CURRENT_PROJECT_VERSION=$TASK_BUILD"
  "DAYMARK_WEB_DIST=$TASK_WEB"
  "ARCHS=arm64 x86_64"
  "ONLY_ACTIVE_ARCH=NO"
  "CODE_SIGNING_ALLOWED=$TASK_SIGNING"
)
if [ "$TASK_SIGNING" = "YES" ]; then
  TASK_SETTINGS+=("DEVELOPMENT_TEAM=$DAYMARK_DEVELOPMENT_TEAM")
  if [ "${DAYMARK_MAC_ALLOW_PROVISIONING_UPDATES:-0}" = "1" ]; then
    TASK_SETTINGS+=(-allowProvisioningUpdates)
  fi
else
  TASK_SETTINGS+=("CODE_SIGNING_REQUIRED=NO")
fi
xcodebuild -project "$TASK_ROOT/native/Daymark.xcodeproj" -scheme DaymarkMac \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "$TASK_DERIVED" -archivePath "$TASK_ARCHIVE" \
  "${TASK_SETTINGS[@]}" archive
echo "Mac archive: $TASK_ARCHIVE"
if [ "$TASK_SIGNING" = "NO" ]; then
  echo "Unsigned verification archive only. Distribution signing and sandbox runtime validation remain required."
fi
