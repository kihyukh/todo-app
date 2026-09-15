#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_MODE="${1:---export}"
if [ "$TASK_MODE" = "--help" ] || [ "$TASK_MODE" = "-h" ]; then
  cat <<'USAGE'
Usage: scripts/release-mac.sh [--export | --upload]

Requires a paid Apple Developer team signed into Xcode and:
  DAYMARK_DEVELOPMENT_TEAM=your_team_id
  DAYMARK_COPYRIGHT=your_publisher_copyright_notice
  DAYMARK_MAC_BUNDLE_IDENTIFIER=your_registered_bundle_id
  DAYMARK_VERSION=your_version
  DAYMARK_BUILD_NUMBER=your_unused_build_number
  VITE_PUBLIC_PRIVACY_URL=https_url_to_your_published_privacy_policy
  VITE_PUBLIC_SUPPORT_URL=https_url_to_your_published_support_page

Optional: DAYMARK_DISPLAY_NAME, DAYMARK_MAC_ARCHIVE_PATH,
DAYMARK_MAC_EXPORT_PATH, DAYMARK_MAC_DERIVED_DATA.

--export (default) builds a signed universal archive and exports a store package locally.
--upload builds and uploads to App Store Connect for processing/TestFlight.
Uploading does not submit the app for review or release it publicly.
Outputs default to ~/Library/Caches/GreenDay/AppStore/macOS.
USAGE
  exit 0
fi
if [ "$TASK_MODE" != "--export" ] && [ "$TASK_MODE" != "--upload" ]; then
  echo "Usage: scripts/release-mac.sh [--export | --upload]"
  exit 1
fi
if [[ ! "${DAYMARK_DEVELOPMENT_TEAM:-}" =~ ^[A-Z0-9]{10}$ ]]; then
  echo "Set DAYMARK_DEVELOPMENT_TEAM to your Apple Developer team ID."
  echo "Sign in through Xcode > Settings > Apple Accounts first."
  echo "For an unsigned verification archive, use scripts/build-mac-store.sh."
  exit 1
fi
if [ -z "${DAYMARK_COPYRIGHT:-}" ]; then
  echo "Set DAYMARK_COPYRIGHT to the actual publisher's copyright notice."
  exit 1
fi
if [[ ! "${DAYMARK_MAC_BUNDLE_IDENTIFIER:-}" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo "Set DAYMARK_MAC_BUNDLE_IDENTIFIER to the identifier registered for this app."
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

TASK_CACHE="$HOME/Library/Caches/GreenDay/AppStore/macOS"
TASK_ARCHIVE="${DAYMARK_MAC_ARCHIVE_PATH:-$TASK_CACHE/GreenDay.xcarchive}"
TASK_EXPORT="${DAYMARK_MAC_EXPORT_PATH:-$TASK_CACHE/Export}"
TASK_OPTIONS="$(mktemp "${TMPDIR:-/tmp}/greenday-mac-export.XXXXXX")"
trap 'rm -f "$TASK_OPTIONS"' EXIT
TASK_DESTINATION=export
if [ "$TASK_MODE" = "--upload" ]; then TASK_DESTINATION=upload; fi

# Automatic signing uses Xcode's signed-in account and its distribution identities.
# Neither a Developer ID build nor the local ad hoc app is a Mac App Store package.
plutil -create xml1 "$TASK_OPTIONS"
plutil -insert method -string app-store-connect "$TASK_OPTIONS"
plutil -insert destination -string "$TASK_DESTINATION" "$TASK_OPTIONS"
plutil -insert teamID -string "$DAYMARK_DEVELOPMENT_TEAM" "$TASK_OPTIONS"
plutil -insert signingStyle -string automatic "$TASK_OPTIONS"
plutil -insert manageAppVersionAndBuildNumber -bool NO "$TASK_OPTIONS"
plutil -insert uploadSymbols -bool YES "$TASK_OPTIONS"
plutil -insert testFlightInternalTestingOnly -bool NO "$TASK_OPTIONS"

# Release always uses the freshly built repository UI; a custom debug dist cannot
# accidentally replace the web resources in a store upload.
DAYMARK_SKIP_WEB_BUILD=0 DAYMARK_WEB_DIST="$TASK_ROOT/dist" \
  DAYMARK_MAC_ALLOW_PROVISIONING_UPDATES=1 DAYMARK_MAC_ARCHIVE_PATH="$TASK_ARCHIVE" \
  bash "$TASK_ROOT/scripts/build-mac-store.sh" --signed
xcodebuild -exportArchive -archivePath "$TASK_ARCHIVE" \
  -exportPath "$TASK_EXPORT" -exportOptionsPlist "$TASK_OPTIONS" \
  -allowProvisioningUpdates
if [ "$TASK_MODE" = "--upload" ]; then
  echo "Uploaded to App Store Connect. Check build processing before TestFlight distribution."
else
  echo "Exported Mac App Store package: $TASK_EXPORT"
fi
