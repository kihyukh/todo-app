#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_MODE="${1:---export}"
if [ "$TASK_MODE" = "--help" ] || [ "$TASK_MODE" = "-h" ]; then
  cat <<'USAGE'
Usage: scripts/release-ios.sh [--export | --upload]

Requires a paid Apple Developer team signed into Xcode and:
  DAYMARK_DEVELOPMENT_TEAM=your_team_id
  DAYMARK_IOS_BUNDLE_IDENTIFIER=your_registered_bundle_id
  DAYMARK_VERSION=your_version
  DAYMARK_BUILD_NUMBER=your_unused_build_number
  VITE_PUBLIC_PRIVACY_URL=published_https_privacy_url
  VITE_PUBLIC_SUPPORT_URL=published_https_support_url

Optional: DAYMARK_DISPLAY_NAME, DAYMARK_IOS_ARCHIVE_PATH, DAYMARK_IOS_EXPORT_PATH.
The archive always uses a fresh build of this repository's dist directory.

--export (default) builds a signed archive and exports an App Store IPA locally.
--upload builds and uploads to App Store Connect for processing/TestFlight.
Upload does not submit the app for review or release it publicly.
USAGE
  exit 0
fi
if [ "$TASK_MODE" != "--export" ] && [ "$TASK_MODE" != "--upload" ]; then
  echo "Usage: scripts/release-ios.sh [--export | --upload]"
  exit 1
fi
if [[ ! "${DAYMARK_DEVELOPMENT_TEAM:-}" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Set DAYMARK_DEVELOPMENT_TEAM to your Apple Developer team ID."
  echo "Sign in through Xcode > Settings > Apple Accounts first."
  echo "For an unsigned simulator build, use npm run build:ios instead."
  exit 1
fi
if [[ ! "${DAYMARK_IOS_BUNDLE_IDENTIFIER:-}" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo "Set DAYMARK_IOS_BUNDLE_IDENTIFIER to the identifier registered for this app."
  exit 1
fi
if [[ ! "${DAYMARK_VERSION:-}" =~ ^[0-9]+(\.[0-9]+){0,2}$ ]] || \
   [[ ! "${DAYMARK_BUILD_NUMBER:-}" =~ ^[1-9][0-9]*$ ]]; then
  echo "Set DAYMARK_VERSION (for example 1.0.0) and an unused positive DAYMARK_BUILD_NUMBER."
  exit 1
fi
if [ -n "${DAYMARK_WEB_DIST:-}" ] && [ "$DAYMARK_WEB_DIST" != "$TASK_ROOT/dist" ]; then
  echo "Release archives use the fresh repository dist directory; unset DAYMARK_WEB_DIST."
  exit 1
fi
export VITE_PUBLIC_PRIVACY_URL="${DAYMARK_PUBLIC_PRIVACY_URL:-${VITE_PUBLIC_PRIVACY_URL:-}}"
export VITE_PUBLIC_SUPPORT_URL="${DAYMARK_PUBLIC_SUPPORT_URL:-${VITE_PUBLIC_SUPPORT_URL:-}}"
node "$TASK_ROOT/scripts/verify-public-urls.mjs"
TASK_XCODE_MAJOR="$(xcodebuild -version | awk '/^Xcode / { split($2, value, "."); print value[1]; exit }')"
TASK_IOS_SDK_MAJOR="$(xcrun --sdk iphoneos --show-sdk-version | cut -d. -f1)"
if [[ ! "$TASK_XCODE_MAJOR" =~ ^[0-9]+$ ]] || \
   [[ ! "$TASK_IOS_SDK_MAJOR" =~ ^[0-9]+$ ]] || \
   [ "$TASK_XCODE_MAJOR" -lt 26 ] || [ "$TASK_IOS_SDK_MAJOR" -lt 26 ]; then
  echo "App Store uploads currently require Xcode 26 or later and the iOS 26 SDK or later."
  exit 1
fi
TASK_ARCHIVE="${DAYMARK_IOS_ARCHIVE_PATH:-$TASK_ROOT/build/Daymark.xcarchive}"
TASK_EXPORT="${DAYMARK_IOS_EXPORT_PATH:-$TASK_ROOT/build/app-store}"
TASK_OPTIONS="$(mktemp "${TMPDIR:-/tmp}/daymark-export.XXXXXX")"
trap 'rm -f "$TASK_OPTIONS"' EXIT
TASK_DESTINATION="export"
if [ "$TASK_MODE" = "--upload" ]; then
  TASK_DESTINATION="upload"
fi

# Xcode uses the signed-in account. No passwords or API keys belong in the repo.
plutil -create xml1 "$TASK_OPTIONS"
plutil -insert method -string app-store-connect "$TASK_OPTIONS"
plutil -insert destination -string "$TASK_DESTINATION" "$TASK_OPTIONS"
plutil -insert teamID -string "$DAYMARK_DEVELOPMENT_TEAM" "$TASK_OPTIONS"
plutil -insert signingStyle -string automatic "$TASK_OPTIONS"
plutil -insert manageAppVersionAndBuildNumber -bool NO "$TASK_OPTIONS"
plutil -insert uploadSymbols -bool YES "$TASK_OPTIONS"
plutil -insert testFlightInternalTestingOnly -bool NO "$TASK_OPTIONS"

# A release always rebuilds the bundled UI, even if a prior debug build skipped it.
DAYMARK_SKIP_WEB_BUILD=0 DAYMARK_WEB_DIST="$TASK_ROOT/dist" DAYMARK_IOS_CODE_SIGNING_ALLOWED=YES \
  DAYMARK_IOS_ALLOW_PROVISIONING_UPDATES=1 DAYMARK_IOS_ARCHIVE_PATH="$TASK_ARCHIVE" \
  bash "$TASK_ROOT/scripts/build-ios.sh" --archive

xcodebuild -exportArchive -archivePath "$TASK_ARCHIVE" \
  -exportPath "$TASK_EXPORT" -exportOptionsPlist "$TASK_OPTIONS" \
  -allowProvisioningUpdates

if [ "$TASK_MODE" = "--upload" ]; then
  echo "Uploaded to App Store Connect. Check build processing before TestFlight distribution."
else
  echo "Exported App Store package: $TASK_EXPORT"
fi
