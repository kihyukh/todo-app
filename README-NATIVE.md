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

## iPhone / iPad

The iOS source is provided in `native/iOS`, using the same UI, storage format, and attachment files as Mac. The Mac app was built with the installed Swift command line tools. Xcode was installed during development, but its first-launch license setup was still pending, so an iOS build could not be verified. Building and signing in Xcode is required before iPhone installation; device sync has not been verified here.

1. Install Xcode and XcodeGen on your Mac.
2. Run `npm run build` in the repository.
3. Run `cd native && xcodegen generate`.
4. Open `native/Daymark.xcodeproj` in Xcode, choose your signing team and a unique bundle identifier, then run the Daymark target on your iPhone.
5. In Daymark settings, choose the **same Daymark folder in iCloud Drive** that the Mac app uses. The Files picker retains access using a security-scoped bookmark.

The iPhone app initially uses its local Documents folder. Selecting an iCloud Drive folder through Files enables shared storage without a private CloudKit container or special iCloud entitlements. The folder must be available in the Files app, and iCloud Drive must be enabled on both devices.

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
