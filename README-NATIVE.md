# Daymark for Mac and iPhone

Daymark’s native shell runs the bundled web interface offline in WKWebView. It adds native image/PDF attachment pickers, Finder/Files folder selection, JSON export, standard Mac editing shortcuts, and file based storage in iCloud Drive. It does not use CloudKit or require a hosted server.

## Mac

```sh
npm install
npm run build
bash scripts/build-mac.sh
```

The result is installed to `~/Applications/Daymark.app`, with a link at `build/Daymark.app`. Open either path in Finder. The script signs the app outside the repository because iCloud-managed Documents folders add Finder metadata that invalidates app signatures. Rebuilding replaces this development app while preserving all task data. This local build is ad hoc signed, with a minimum macOS version of 13, for the architecture of the Mac that builds it. An Apple Developer identity and notarization are needed for normal public distribution.

When the system iCloud Drive directory exists, the app saves to `~/Library/Mobile Documents/com~apple~CloudDocs/Daymark`. Otherwise it saves to `~/Library/Application Support/Daymark`. The in-app storage status reports the chosen location; iCloud Drive itself controls upload/download timing. **Choose Sync Folder** in the File menu or app settings lets you select a different folder. Existing tasks and attachments are merged/copied into that folder and the old folder is retained.

## Work days and deadlines

The task's **Work on** field opens a calendar where each selected day is independent. Click or tap several dates, including dates in different months; click a selected day again or remove its chip to unschedule only that day. Today and Tomorrow are additive shortcuts. Done closes the picker, and changes save automatically.

Today includes a task whenever today is one of its work days. The sun button and the day planner add or remove Today without replacing the rest of the schedule. Upcoming shows every work day and the separate deadline; if both fall on one day, they share one entry. Completing a task finishes the entire task, not a single work session. Earlier work is suggested for replanning only when no current or future work days remain.

Task records support `doDates`, a sorted array of unique `YYYY-MM-DD` dates. Existing records with only `doDate` are read as a one-day schedule without rewriting timestamps. Edits retain `doDate` as the first selected day (or null) for legacy exports; an explicit empty `doDates` array stays empty. Use the updated app on both devices to edit the complete schedule. The existing whole-task conflict policy applies to schedule changes too.

## iPhone / iPad

The iOS app uses the same editor, storage format, and attachments as Mac. Its native shell adds keyboard-aware layout, Files import, PDF/image previews, sharing, and a background save when leaving the app. Touch editing has an explicit keyboard dismissal control and touch-friendly note tools. A first-launch introduction connects the existing Mac workspace or starts locally.

Install Xcode, finish its first-launch setup, and install XcodeGen (`brew install xcodegen`). Then:

```sh
npm install
npm run build:ios
```

This generates `native/Daymark.xcodeproj` and builds an unsigned simulator app at `build/ios/Build/Products/Debug-iphonesimulator/Daymark.app`. Open the generated project and run the Daymark scheme on an iPhone or iPad simulator. Xcode 26.6 with the iOS 26.5 simulator SDK was used for the verified build.

For a physical iPhone, sign into **Xcode → Settings → Apple Accounts**, choose your signing team for the Daymark target, and run it on your connected phone. The current working bundle identifier is `app.daymark.mobile`; reserve an identifier belonging to your team before distribution. In the app, choose the **same Daymark folder in iCloud Drive** that the Mac app uses. The Files picker retains access using a security-scoped bookmark.

The iPhone app initially uses its local Documents folder. Selecting an iCloud Drive folder through Files enables shared storage without a private CloudKit container or special iCloud entitlements. The folder must be available in the Files app, and iCloud Drive must be enabled on both devices.

### App Store preparation

`npm run archive:ios` compiles an unsigned Release archive for a generic iOS device at `build/Daymark.xcarchive`. An unsigned archive is a build check, not an installable App Store package.

Once a paid Apple Developer team is configured in Xcode, set `DAYMARK_DEVELOPMENT_TEAM` to its ten-character team ID and use `npm run release:ios` to build and export a signed App Store IPA. `npm run release:ios -- --upload` uploads the build to App Store Connect for processing; it does not submit for review or release publicly. The matching app record must exist before upload.

Release settings are configurable without moving the user's workspace:

| Environment variable | Default |
| --- | --- |
| `DAYMARK_DISPLAY_NAME` | `Daymark` (working name) |
| `DAYMARK_VERSION` | `1.0.0` |
| `DAYMARK_BUILD_NUMBER` | `1` (increment for every upload) |
| `DAYMARK_IOS_BUNDLE_IDENTIFIER` | `app.daymark.mobile` |
| `DAYMARK_DEVELOPMENT_TEAM` | None; required for distribution |

The display name is also passed into the bundled interface. Existing workspace folder names, file formats, and storage keys stay stable. See [App Store delivery](docs/APP-STORE.md) for prepared listing copy, privacy/support pages, and the remaining account and release inputs. Physical-device iCloud delivery still needs verification before public release.

## Storage and conflict behavior

`tasks`, `projects`, and `columns` contain one JSON file per record. Attachments are copied into `Attachments` under unique names. Atomic writes use Apple’s file coordination APIs. The app checks for changes every three seconds while active and asks iCloud to download placeholder record files.

Records merge by `updatedAt`. For equal-time conflicts, a deletion tombstone wins, then canonical JSON byte ordering breaks remaining ties. Deletion tombstones are retained. Different task edits merge independently. Concurrent edits to the **same task** use the newer whole record; field-level collaborative editing is not provided. Previous and losing incoming record versions are retained under `Revisions`, deduplicated by content. Both conflict-copy files and unresolved iCloud file versions are included when loading. Saves refuse to overwrite unreadable records, and recheck the current record inside coordinated writes. Revision storage is intentionally not pruned automatically. Keep device clocks accurate.

JSON export includes tasks, notes, projects, column definitions, and attachment references. To back up the attachment binaries and revision history too, copy the entire Daymark folder. Cross-device iCloud delivery and signed iPhone installation require real-device validation.

Run the native persistence checks without Xcode:

```sh
swiftc -swift-version 5 native/Shared/DaymarkStore.swift native/Tests/main.swift -o /tmp/daymark-store-tests
/tmp/daymark-store-tests
```

## Web/native protocol

Web code sends `window.webkit.messageHandlers.daymark.postMessage({ action, requestId, ... })`. Supported actions are `load`, `save`, `chooseFolder`, `attach`, `export`, and `openAttachment`. Responses call `window.daymarkNativeReceive(payload)` with `type: state`, `saved`, `attachment`, `exported`, `cancelled`, or `error`. State responses include `storage: { kind, path, message }`. Storage kinds are `icloud`, `local`, and `folder`.

The shell sets `window.__DAYMARK_NATIVE__ = true` and `window.__DAYMARK_PLATFORM__` to `macos` or `ios` before page scripts run. Mac File → New Task emits the `daymark-new-task` window event. Closing/quitting the Mac app emits `daymark-flush` with a unique `detail.requestId`; the UI must return that request ID on its immediate save. The app waits for that exact save to succeed, and errors offer to keep the app open. The iOS app also emits this event while resigning active, with a background task to finish the write. `daymark://app/` serves bundled assets and `daymark://attachment/` serves local attachments; external web links open in the system browser. The bridge only accepts messages from the app’s main frame.
