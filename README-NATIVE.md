# GreenDay for Mac and iPhone

GreenDay’s native shell runs the bundled web interface offline in WKWebView. It adds native attachment pickers, Finder/Files folder selection, JSON export, standard Mac editing shortcuts, file-based storage in iCloud Drive, and optional EventKit calendar access. It does not use CloudKit or require a hosted server. The display name and theme are GreenDay/green; internal `Daymark` paths, bridge names, and bundle identifiers remain stable so existing workspaces keep working.

## Mac

```sh
npm install
npm run build
bash scripts/build-mac.sh
```

The result is installed to `~/Applications/GreenDay.app`, with a symlink at `build/GreenDay.app`. Open the installed path in Finder. Runnable bundles are compiled and signed outside the repository, under `~/Library/Caches/GreenDay/Builds`, because iCloud-managed Documents folders can add Finder metadata that invalidates app signatures. Use `bash scripts/build-mac.sh --no-install` to retain the verified cache bundle without changing installed apps; the build symlink then points to that cache product. Only the symlink lives in the repository.

Rebuilding preserves task data. Installation stages and verifies the replacement before moving the existing app, and keeps previous binaries under `~/Library/Caches/GreenDay/PreviousApps`. An older `~/Applications/Daymark.app` becomes a compatibility link only after the GreenDay installation succeeds; unrelated apps are never replaced. The cached app binaries are not workspace backups. This local build is ad hoc signed, with a minimum macOS version of 13, for the architecture of the Mac that builds it. Direct distribution outside the Mac App Store needs Developer ID signing and notarization; the separate App Store workflow below uses a sandboxed Xcode target.

Ad hoc rebuilds can change the app's signing identity and require calendar consent again; this occurred during the final development update. Approve the system prompt after choosing **Connect calendars**. Distribution still needs stable Apple signing; the development build does not weaken or bypass macOS permission checks.

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

For a physical iPhone, sign into **Xcode → Settings → Apple Accounts**, choose your signing team for the Daymark target, and run it on your connected phone. The development bundle identifier remains `app.daymark.mobile`; the registered release identifier is `com.kihyukh.greenday` for both platforms. In the app, choose the **same Daymark folder in iCloud Drive** that the Mac app uses. The Files picker retains access using a security-scoped bookmark.

The iPhone app initially uses its local Documents folder. Selecting an iCloud Drive folder through Files enables shared storage without a private CloudKit container or special iCloud entitlements. The folder must be available in the Files app, and iCloud Drive must be enabled on both devices.

iPhone and iPad simulator builds and the unsigned device archive passed for the current GreenDay/calendar update. Live iPhone checks covered calendar permission, a fictional local event, task-event linking, and keyboard layout; the final archive contents were audited. The internal Xcode project, scheme, simulator bundle filename, and archive filename still use Daymark; the installed display name and icon are GreenDay. See [iOS validation](docs/IOS-VALIDATION.md) for remaining physical-device and provider checks.

## App Store preparation for Mac and iPhone

The store workflows build the native interface with `VITE_NATIVE_APP=1`. PDFs use the system document viewer, so browser-only PDF.js resources are excluded. The resource validator rejects workspace files, source maps, symlinks, and unexpected assets before packaging. The local Mac development/install commands above remain separate.

Build verification does not require a Developer account:

| Command               | Target                                       | Default archive                                               |
| --------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `npm run archive:ios` | Generic arm64 iOS device, iOS 16 minimum     | `build/Daymark.xcarchive`                                     |
| `npm run archive:mac` | Universal arm64/x86_64 Mac, macOS 13 minimum | `~/Library/Caches/GreenDay/AppStore/macOS/GreenDay.xcarchive` |

These are unsigned verification archives, not App Store packages. The Mac linker may embed an ad hoc executable signature; this does not seal the bundle or activate the release sandbox entitlements. The archive audit and separate sandbox runtime check are recorded in [native validation](docs/IOS-VALIDATION.md).

The Mac App Store target uses `DaymarkMac`, `native/macOS/Store-Info.plist`, and `native/macOS/GreenDay.entitlements`. It starts in its sandbox container and offers a system picker to connect an existing workspace. Select the same Daymark folder in iCloud Drive on both platforms. Successful folder selection stores an app-scoped bookmark; a failed restore keeps the old bookmark and offers reconnection while new edits remain separate locally. This build does not probe the development app's unrestricted iCloud path or silently move its data. Its entitlements cover outgoing networking, calendars, user-selected read/write files, and app-scoped bookmarks; it does not request an unrestricted filesystem exception or private CloudKit container.

Developer membership was renewed on 15 September 2026, and both iOS and Mac App Store distribution exports passed their signing audits. The active team is `3D637V9C9W`, with shared release identifier `com.kihyukh.greenday` and App Store record `6812229239` (**GreenDay: Tasks & Notes**; the app's displayed name remains GreenDay). Both **1.0.0 (1)** uploads succeeded and finished processing; App Store Connect shows **Complete** and **Ready to Submit** for both. Both listings and free global availability are saved, and the Free Apps Agreement is Active. Both platform versions have their **1.0.0 (1)** builds, complete private review contacts, and review notes saved and verified. The phone number was provided privately and is intentionally omitted from repository files. The privacy response is a saved draft awaiting publication confirmation, and the EU trader declaration remains unanswered. One iPhone screenshot and three iPad screenshots are uploaded and verified; a Mac screenshot still needs manual capture. Neither platform has been submitted for review or publicly released. For subsequent builds, configure the active team in **Xcode → Settings → Apple Accounts** and supply these explicit values. Release commands intentionally do not silently reuse the verification bundle/version defaults:

| Environment variable            | Required value                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `DAYMARK_DEVELOPMENT_TEAM`      | Your ten-character Apple Developer team ID, both platforms                          |
| `DAYMARK_IOS_BUNDLE_IDENTIFIER` | The registered iOS identifier, iOS release                                          |
| `DAYMARK_MAC_BUNDLE_IDENTIFIER` | The registered macOS identifier, Mac release                                        |
| `DAYMARK_VERSION`               | Intended numeric version, such as `1.0.0`, both platforms                           |
| `DAYMARK_BUILD_NUMBER`          | An unused positive build number; increment for every upload                         |
| `DAYMARK_COPYRIGHT`             | The publisher's actual copyright notice, Mac release                                |
| `VITE_PUBLIC_PRIVACY_URL`       | The published public HTTPS privacy-policy page, both platforms                      |
| `VITE_PUBLIC_SUPPORT_URL`       | The published public HTTPS support page with actual contact details, both platforms |

`DAYMARK_PUBLIC_PRIVACY_URL` and `DAYMARK_PUBLIC_SUPPORT_URL` are accepted aliases for the two URL variables. `DAYMARK_DISPLAY_NAME` remains optional and defaults to GreenDay; it is also passed into the bundled interface. The URL check rejects local, malformed, and placeholder URLs; verify that the actual published pages load before uploading. Do not place passwords, private signing keys, or API credentials in this repository.

With those values set in the shell, export locally or explicitly upload:

```sh
npm run release:ios
npm run release:mac

# Upload only after the matching App Store Connect records are configured:
npm run release:ios -- --upload
npm run release:mac -- --upload
```

The default release action creates a signed archive and exports a local store package (an IPA for iOS, a Mac App Store package for macOS). `--upload` sends the build to App Store Connect for processing and TestFlight; it does not submit for review or release publicly. The registered identifiers and corresponding App Store Connect app/platform records must match. Both release commands rebuild the repository UI and reject a custom `DAYMARK_WEB_DIST` pointing elsewhere.

Default iOS release outputs are `build/Daymark.xcarchive` and `build/app-store`; override them with `DAYMARK_IOS_ARCHIVE_PATH` and `DAYMARK_IOS_EXPORT_PATH`. Mac outputs stay outside the iCloud-managed repository under `~/Library/Caches/GreenDay/AppStore/macOS`: `GreenDay.xcarchive`, `DerivedData`, and `Export`. Override those with `DAYMARK_MAC_ARCHIVE_PATH`, `DAYMARK_MAC_DERIVED_DATA`, and `DAYMARK_MAC_EXPORT_PATH`. `bash scripts/build-mac-store.sh --signed` creates only a signed Mac archive when the team, copyright, and public URL inputs are configured; it does not export or upload.

The development workflow and workspace names/file formats remain stable. See [App Store delivery](docs/APP-STORE.md) for listing copy, privacy/support pages, publisher/contact inputs, and review steps. A final distribution-signed device test, physical-iPhone iCloud delivery, and provider-specific calendar checks remain necessary before public release.

The final Release simulator app for screenshot capture is `~/Library/Caches/GreenDay/AppStore/Simulator-Final/Build/Products/Release-iphonesimulator/Daymark.app`. It retains QA identifier `app.daymark.mobile` and contains **all 62 web files byte-identical** to the signed iOS release, including the public privacy/support URLs and GreenDay **1.0.0 (1)** display/version. It was installed in place on the isolated iPhone 17 Pro Max and iPad Pro 13-inch simulators. Its native executable targets the simulator SDK, not the device SDK.

## Calendars and task links

Open **Settings → Calendars → Connect calendars** in the native app. GreenDay requests full event access only after this action; no permission prompt appears at startup. Full access is needed to read events. Read-only calendars remain visible, but writable calendars are required for creating, editing, or deleting events. Calendar failures appear separately from workspace-save errors.

Accounts configured in Apple Calendar supply the data, including iCloud and Google. Add or enable the account in Apple Calendar or the device's calendar account settings, then refresh access in GreenDay. Account credentials and synchronization stay with the operating system and provider; there is no separate Google sign-in or GreenDay calendar server. The bridge observes EventKit changes and refreshes the displayed period. Provider transfers can take longer than a local save.

The Calendar view offers Month, Week, and Day layouts with task work days and deadlines alongside events. **Link event** in task details connects an existing event; **Schedule work session** creates an event you review before saving. Event details also offer **Link task**. Links store identifiers, the original recurring occurrence, calendar labels/colors, and cached event title/times with the task. Linking or unlinking does not change the task schedule or delete the event. Updates and deletions apply to the selected occurrence, not future events in a recurring series.

Calendar operations do not copy the full task note or attachment workspace into the event. A task's title can prefill a work-session event. Uninstalling GreenDay or deleting its workspace does not delete events already saved to a calendar provider. Revoke calendar access in the device's privacy settings if desired.

See [the native calendar contract](native/CALENDAR.md) for request fields, permission compatibility, recurring identity, and the pure validation suite. Real permission/provider synchronization and event writes require a separate test calendar on a device; a passing build does not verify them.

## Workspace layout and workflow

The desktop uses compact rows and a green accent. Drag or keyboard-adjust the navigation/detail dividers; double-click or Home resets them. Width preferences remain local to the device. Priority (High/Medium/Low/None), custom board status, and task completion are separate. The day planner helps review upcoming deadlines and in-progress work without replacing other selected work dates.

The note editor uses a left gutter instead of a fixed formatting bar. **+**, heading labels, the footer's **…**, and **⌘/** open the shared element menu. Text selections and Vim mode are retained; choosing another heading cancels an unfinished Vim command before moving its caret. Touch layouts retain usable controls and keyboard dismissal.

## Storage and conflict behavior

`tasks`, `projects`, `columns`, and `tags` contain one JSON file per record. Task records also hold priority and calendar-link metadata. Attachments are copied into `Attachments` under unique names. Atomic writes use Apple’s file coordination APIs. The app checks for changes every three seconds while active and asks iCloud to download placeholder record files.

Records merge by `updatedAt`. For equal-time conflicts, a deletion tombstone wins, then canonical JSON byte ordering breaks remaining ties. Deletion tombstones are retained. Different task edits merge independently. Concurrent edits to the **same task** use the newer whole record; field-level collaborative editing is not provided. Previous and losing incoming record versions are retained under `Revisions`, deduplicated by content. Both conflict-copy files and unresolved iCloud file versions are included when loading. Saves refuse to overwrite unreadable records, and recheck the current record inside coordinated writes. Revision storage is intentionally not pruned automatically. Keep device clocks accurate.

JSON export includes tasks, notes, projects, tags, column definitions, calendar links, and attachment references. To back up attachment binaries and revision history too, copy the entire Daymark folder. A workspace export is not a backup of the connected calendar accounts. Cross-device iCloud delivery and signed iPhone installation require real-device validation.

Run the native persistence checks without Xcode:

```sh
swiftc -swift-version 5 native/Shared/DaymarkStore.swift native/Tests/main.swift -o /tmp/daymark-store-tests
/tmp/daymark-store-tests
```

## Web/native protocol

Web code sends `window.webkit.messageHandlers.daymark.postMessage({ action, requestId, ... })`. Workspace actions are `load`, `save`, `chooseFolder`, `attach`, `export`, and `openAttachment`. `openExternal` sends validated HTTP(S)/mailto links to the system browser or mail app; note clicks use this action directly rather than opening a web-view popup. PDF attachments use `openAttachment` for the system PDF viewer on Mac and Quick Look on iOS. Their responses call `window.daymarkNativeReceive(payload)` with `type: state`, `saved`, `attachment`, `exported`, `cancelled`, or `error`. State responses include `storage: { kind, path, message }`. Storage kinds are `icloud`, `local`, and `folder`.

Calendar actions are `calendarStatus`, `calendarConnect`, `calendarEvents`, `calendarSave`, and `calendarDelete`; responses use `calendarStatus`, `calendarEvents`, `calendarSaved`, `calendarDeleted`, or `error`, echoing `requestId`. An unsolicited `calendarChanged` notice asks the frontend to refresh. Calendar request IDs use the `calendar:` prefix; the frontend broadcasts native messages internally without treating calendar errors as failed task saves.

The shell sets `window.__DAYMARK_NATIVE__ = true` and `window.__DAYMARK_PLATFORM__` to `macos` or `ios` before page scripts run. Mac File → New Task emits the `daymark-new-task` window event. Closing/quitting the Mac app emits `daymark-flush` with a unique `detail.requestId`; the UI must return that request ID on its immediate save. The app waits for that exact save to succeed, and errors offer to keep the app open. The iOS app also emits this event while resigning active, with a background task to finish the write. `daymark://app/` serves bundled assets and `daymark://attachment/` serves local attachments; external web links open in the system browser. The bridge only accepts messages from the app’s main frame.
