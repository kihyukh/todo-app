#!/bin/bash
set -euo pipefail

TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_MODE="${1:---export}"
if [ "$TASK_MODE" = "--help" ] || [ "$TASK_MODE" = "-h" ]; then
  cat <<'USAGE'
Usage: scripts/release-ios.sh [--export | --upload]

Requires a paid Apple Developer team signed into Xcode and:
  DAYMARK_DEVELOPMENT_TEAM=your_team_id

Optional: DAYMARK_DISPLAY_NAME, DAYMARK_VERSION, DAYMARK_BUILD_NUMBER,
DAYMARK_IOS_BUNDLE_IDENTIFIER, DAYMARK_IOS_ARCHIVE_PATH, DAYMARK_IOS_EXPORT_PATH.

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
DAYMARK_SKIP_WEB_BUILD=0 DAYMARK_IOS_CODE_SIGNING_ALLOWED=YES \
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
