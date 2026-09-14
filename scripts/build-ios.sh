#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_DERIVED="${DAYMARK_IOS_DERIVED_DATA:-$TASK_ROOT/build/ios}"
TASK_MODE="${1:---simulator}"
if [ "$TASK_MODE" != "--simulator" ] && [ "$TASK_MODE" != "--archive" ]; then
  echo "Usage: scripts/build-ios.sh [--simulator | --archive]"
  exit 1
fi
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "XcodeGen is required. Install it with brew install xcodegen."
  exit 1
fi
if [ "${DAYMARK_SKIP_WEB_BUILD:-0}" != "1" ]; then
  (cd "$TASK_ROOT" && VITE_APP_NAME="${DAYMARK_DISPLAY_NAME:-Daymark}" VITE_APP_VERSION="${DAYMARK_VERSION:-1.0.0}" npm run build)
fi
xcodegen generate --spec "$TASK_ROOT/native/project.yml"
TASK_SETTINGS=(
  "DAYMARK_DISPLAY_NAME=${DAYMARK_DISPLAY_NAME:-Daymark}"
  "PRODUCT_BUNDLE_IDENTIFIER=${DAYMARK_IOS_BUNDLE_IDENTIFIER:-app.daymark.mobile}"
  "MARKETING_VERSION=${DAYMARK_VERSION:-1.0.0}"
  "CURRENT_PROJECT_VERSION=${DAYMARK_BUILD_NUMBER:-1}"
  "CODE_SIGNING_ALLOWED=${DAYMARK_IOS_CODE_SIGNING_ALLOWED:-NO}"
)
if [ -n "${DAYMARK_WEB_DIST:-}" ]; then
  TASK_SETTINGS+=("DAYMARK_WEB_DIST=$DAYMARK_WEB_DIST")
fi
if [ -n "${DAYMARK_DEVELOPMENT_TEAM:-}" ]; then
  TASK_SETTINGS+=("DEVELOPMENT_TEAM=$DAYMARK_DEVELOPMENT_TEAM")
fi
if [ "${DAYMARK_IOS_ALLOW_PROVISIONING_UPDATES:-0}" = "1" ]; then
  TASK_SETTINGS+=(-allowProvisioningUpdates)
fi
if [ "$TASK_MODE" = "--archive" ]; then
  TASK_ARCHIVE="${DAYMARK_IOS_ARCHIVE_PATH:-$TASK_ROOT/build/Daymark.xcarchive}"
  xcodebuild -project "$TASK_ROOT/native/Daymark.xcodeproj" -scheme Daymark \
    -configuration Release -destination 'generic/platform=iOS' \
    -derivedDataPath "$TASK_DERIVED" -archivePath "$TASK_ARCHIVE" \
    "${TASK_SETTINGS[@]}" archive
  echo "Archive: $TASK_ARCHIVE"
  echo "Signing defaults off; distribution signing and App Store upload are separate steps."
else
  xcodebuild -project "$TASK_ROOT/native/Daymark.xcodeproj" -scheme Daymark \
    -configuration "${DAYMARK_IOS_CONFIGURATION:-Debug}" \
    -destination 'generic/platform=iOS Simulator' -derivedDataPath "$TASK_DERIVED" \
    "${TASK_SETTINGS[@]}" build
  echo "Simulator app: $TASK_DERIVED/Build/Products/${DAYMARK_IOS_CONFIGURATION:-Debug}-iphonesimulator/Daymark.app"
fi
