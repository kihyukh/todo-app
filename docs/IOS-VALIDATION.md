# Native application validation

The chosen display name is **GreenDay**, with a green icon and interface accent. The iPhone/iPad scheme is `Daymark` (`app.daymark.mobile`); the separate Mac App Store scheme is `DaymarkMac` (`app.daymark.desktop`). The latest verification archives use version 1.0.0, build 1, Xcode 26.6, and the platform 26.5 SDKs. Their minimum deployment targets are iOS 16 and macOS 13. They are verification artifacts, not signed store packages.

## Previously completed

- Earlier frontend runs covered editor/storage behavior, mobile setup, keyboard dismissal, link actions, cursor visibility after viewport changes, synced note updates, visible save errors, multi-date calendars, repeated Upcoming entries, heading shortcuts, gutter placement, and selection/Vim preservation through the element menu. These checks also remain in the current automated suite described below.
- Earlier native persistence and migration runs passed using temporary folders, including preservation of date arrays and cleared schedules.
- The simulator app was built for arm64 and x86_64, then installed and launched on iPhone 17 Pro Max and iPad Pro 13-inch (M5) simulators running iOS 26.5.
- A Release archive for an arm64 iOS device was built at `build/Daymark.xcarchive`. It was unsigned and could not be distributed as-is.
- The previously checked archive contained the icon, privacy manifest, bundled editor assets, and license notices. It contained no personal task records, migration exports, attachment workspace, recovery history, or source files. The current archive was audited again, as described below.
- iPhone visual checks confirmed local first-launch setup, the Today list, task details, independent calendar selections, the selected-date summary, and the unchanged deadline. Opening a display equation now keeps its LaTeX visible above the keyboard; Done dismisses the keyboard and restores rendering.
- Browser interaction checks confirmed nonconsecutive dates across September and October, removing one date, the after-deadline hint, and every work day appearing in Upcoming separately from its deadline. Only fictional sample tasks were edited.

- The earlier gutter redesign was checked in the browser and native Mac app: headings showed H2/H3 labels; the + menu created checklists and display equations; Escape restored the note cursor and retained Vim Normal mode. Automated checks covered heading undo, nested-list preservation, cancelled image-picker behavior, preserving selected inline math during insertion, and unchanged typing geometry. iPhone touch checks covered heading creation, list insertion/conversion, and opening the + menu while the software keyboard was visible.

## Previous GreenDay/calendar update

That update added optional Apple Calendar access to configured iCloud/Google accounts; Month, Week, and Day views; event creation/editing/deletion; task-event links; priorities and planning; compact rows; adjustable desktop panes; and further gutter/Vim interaction work. These checks completed for that update:

- **414 frontend tests passed.** After the final change disabling text suggestions in calendar fields, **16 focused calendar UI tests** passed again.
- **36 native persistence checks** and **24 isolated calendar checks** passed. The isolated calendar tests do not construct an EventKit store or access personal calendars. Both native platforms also passed their minimum-target typechecks.
- The final Mac, iPhone/iPad simulator, and unsigned device Release archive builds succeeded. The installed Mac app launched under the GreenDay name with existing tasks and its chosen iCloud workspace preserved. Configured calendar events loaded after permission approval without any personal calendar writes. The final ad hoc Mac rebuild required consent again, and its connection was verified after renewed approval.
- The final archive audit confirmed the GreenDay display name, `app.daymark.mobile`, version 1.0.0/build 1, minimum iOS 16, and the EventKit access description. `Assets.car` and the privacy manifest were present. All **62 bundled web files** matched by hash across `dist`, the Mac app, the simulator app, and the device archive. The app contained no task/project/column data directories, `Attachments`, `Revisions`, migration data, `node_modules`, or `src` directories.
- On the iPhone simulator, **Connect calendars** presented the system permission prompt; approval showed calendar sources and the day agenda. A fictional event was created in the simulator's default local calendar and linked to a task. The event listed its linked task, the task listed its event, the linked-task badge showed one task, and the duplicate work-day row was hidden. Editing the event title preserved the link. The fictional event remains in the simulator; no personal calendar event was written.
- The event form fit within a scrollable viewport above the software keyboard, and Done dismissed the keyboard. The simulator's hardware-keyboard setting was restored after the check.

These results establish build and local interaction behavior. They do not establish provider delivery or readiness for signed distribution.

## Previous completion feedback and calendar polish

- **441 frontend tests passed**, including 13 completion integration tests, 8 sound tests, and 22 calendar UI tests. Completion updates the task immediately, retains its row briefly for animation, preserves unpublished note drafts, supports Undo, and transfers keyboard focus only when its focused row actually leaves. Reduced motion, independent task timers, synced changes, and delayed audio unlocks are covered.
- The web build, installed Mac app, iPhone/iPad simulator build, and unsigned device Release archive succeeded. All **62 bundled web files** matched across those outputs; no workspace or development directories were bundled. Native code and bundle identity are unchanged.
- Browser checks confirmed the drawn checkmark, pulse and strike-through in list and board views, Undo, the sound toggle, roomier month cells, and **+N more** opening all entries for that day. No browser errors were reported.
- On the updated iPhone simulator, completing a fictional task showed the animated checkmark, pulse, and completion receipt. The task was reopened afterward. Month and Day views showed the coral linked-task count; opening the existing fictional event displayed its linked task. No personal task or calendar record was modified for these checks.
- The installed Mac app retained its existing workspace. The development signature change requires renewed calendar consent; the system prompt was left for the user. Sound generation and blocked-audio recovery passed automated tests, but native speaker output, volume, silent-mode behavior, and physical-device playback still need listening checks.

## Previous slash-menu update

- **495 frontend tests passed**, including 26 slash state tests and 28 integration tests using the actual task editor. Coverage includes input-only activation, filtering, keyboard selection, nested lists, one-step undo, Vim and IME behavior, image selection/cancellation, synced content, and switching tasks.
- The web build, installed Mac app, iPhone/iPad simulator build, and unsigned device Release archive succeeded. All **62 bundled web files** matched across those outputs, with no workspace or development directories bundled. Native code and bundle identity are unchanged.
- Browser checks confirmed checklist, heading, and equation insertion by slash search, Enter/Tab/mouse selection, continuing at the insertion point, and correct math rendering. The popup stays aligned with the slash while filtering.
- The iPhone simulator check used the actual software keyboard to enter `/`. The popup appeared above the keyboard, tapping Checklist inserted a checkbox while retaining the keyboard, and subsequent typing continued in the checkbox. Done dismissed the keyboard. The fictional test note remains in the simulator.
- The installed Mac app retained its existing workspace and showed the updated note hint. Its previous task view was restored without changing any personal task or calendar records. This development build can require renewed calendar consent; calendar access was not requested during these editor checks.

## Previous Open checkboxes update

- **501 frontend tests passed**, including six new App integration tests for completed/trashed task exclusion, immediate counts, completion/Undo/reopening without note or schedule mutations, nested checkbox paths, incoming synced changes, search by step/title/tag, and filtered versus unfiltered empty states.
- Browser checks used a fictional task to verify that its unchecked steps disappear when the parent is completed, remain unchanged inside its note, and reappear when reopened. Search remains in the checkbox pane and shows matching counts while the navigation count stays unfiltered.
- This update changes the shared interface only. The Mac, simulator, and unsigned device archive builds succeeded. All 62 bundled web files match across these outputs, with no workspace or development directories bundled. The installed Mac app retained its workspace and showed matching active-step counts in its navigation and checkbox pane. Existing physical-device and provider-delivery limits below still apply.

## Previous task details, date picker, and dragging update

- **540 frontend tests passed**, including 18 date picker tests, three task-detail integration tests, and 27 drag helper/integration tests. The production web, Mac, simulator, and unsigned device archive builds succeeded. All **62 bundled web files** match across the outputs, with no workspace or development directories bundled.
- The installed Mac app passed mouse reordering, sidebar list/tag drops, tag Undo, and saved ordering after quit/reopen. This caught and fixed WebKit's native-drag takeover: a mouse gesture now disables the native draggable source before the drag threshold and restores it on finish/cancel. The two temporary tasks and their temporary list were soft-deleted afterward, with backups retained; no personal task or calendar record was edited.
- The task detail header now contains completion, compact work-day/deadline controls, and a priority flag. List, status, and tags share a small row beneath the title. The note keeps its existing editing behavior and alignment.
- Browser checks confirmed independent noncontiguous work days and a deadline, one Save applying both, cancellation preserving the previous schedule, and tag-menu placement. The iPhone simulator confirmed the touch sheet, visible selected dates, large calendar targets, and cancellation without changing the saved schedule or note. Pointer selection no longer shows a keyboard-style rectangular outline.
- Browser mouse checks confirmed reordering, resetting to priority order, moving to a sidebar list/Inbox, adding a tag while preserving the list, and Undo. Touch scrolling remains intact; touch dragging is not claimed or validated.
- Automated coverage includes atomic schedule saves, task switching, stale incoming changes, keyboard calendar navigation, focus containment, pointer cancellation, click suppression, edge scrolling, authenticated native drag data, per-view order persistence, and Undo preserving unrelated edits.

## Previous contextual-table update

- **577 frontend tests passed**, including 20 table helper/resize/source tests and 17 controls integration tests. Coverage includes scoped row/column selection, edit/undo, hover without note writes, width/header source preservation, multiple tables, incoming document changes, Vim Normal/Insert mode, and menu placement during scrolling or software-keyboard changes.
- Browser checks confirmed the grey handles, contextual menu and selected-column highlight, insertion/deletion, direct border dragging, and retained 120px/313px widths after Markdown apply. All sample data is fictional.

- The installed Mac app confirmed row selection, duplication, Undo, and immediate border dragging; the 125px width was verified in the saved test record. The iPhone simulator confirmed touch handles, an on-screen column menu, insertion, and Undo. Temporary native test tasks were moved to Trash afterward; existing tasks were preserved.
- Production web, Mac, simulator, and unsigned device archive builds passed. All 62 bundled web assets matched exactly across the outputs. No personal workspace or development directories were bundled.

## Previous window and navigation cleanup

- All **577 frontend tests** pass. Production web, Mac, simulator, and unsigned archive builds passed; the Mac change also passed its macOS 13 typecheck. All 62 packaged web assets match across the outputs, with no personal data or development sources bundled.
- The installed Mac app shows full-size content with native window buttons and no visible title strip or sidebar branding. Top-edge task actions and the sidebar drag area were checked with pointer input. The user's current task was restored after reopening, with its saved note preserved.
- The iPhone simulator confirmed a compact search/close row below the safe area and normal drawer opening/dismissal. No task records were edited for these checks.

## Previous top-header window dragging

- Production web, Mac, simulator, and unsigned archive builds passed. All 62 web assets match across the outputs, with no personal records or development directories packaged. MacOS 13 and iOS 16 typechecks passed.

- All **596 frontend tests** pass, including 16 window-drag tests and three App/platform checks. The tests verify that only designated top headers initiate dragging; pane bodies, notes, controls, task rows, calendars, scrollbars, and resize dividers preserve normal gestures. Browser and iPhone do not install the window-drag handler.
- Native diagnostics confirmed real AppKit window movement. The implementation preserves the original mouse-down and matches the web reply to that gesture; a completed quick drag can apply its measured movement without interpreting ordinary clicks as drags. Temporary diagnostics were removed from the final app.

## Previous responsive task detail update

- The installed TickTick Mac app was inspected by opening tasks, switching between them through the exposed list, dismissing its floating detail, and resizing into a third column.
- All **611 frontend tests** pass, including 11 pane-layout tests and six responsive task-detail integration tests. The checks cover layout thresholds and saved preferences, retained editor DOM/focus/caret/draft/scroll, unsaved date drafts, dismissal, task switching, and phone Back navigation.
- Browser checks confirmed a floating right pane at 860px, docking at the default 984px boundary (224px navigation, 360px list, 400px detail), and a wider three-column view. An edit to a fictional sample note retained its caret and Undo history through both transitions; Undo restored the original note. The date chooser stayed open while resizing. At 390px, details stayed full screen and Back returned to the list.
- The installed Mac app confirmed the floating pane, three-column docking when zoomed wider, and the same selected task remaining open in a floating pane after restoring its original size. No personal task records were changed.
- Production web, Mac, iPhone simulator, and unsigned device archive builds passed. All 62 web assets match across these outputs, with no personal records or development directories packaged. This update changes the shared interface; physical-device and provider-delivery limits below still apply.
- The floating-pane entrance now slides from the right over 220ms, and the desktop close button is on the left of the header. Browser checks observed an animated transform on opening, no animation when switching/reselecting tasks or resizing, and the unchanged phone Back button with the desktop close button hidden. Task-opening controls explicitly bypass background dismissal so capture/bubble event timing cannot briefly close and remount the pane. All 611 existing tests still pass.
- The close button is now shown only in the floating layout. Browser checks confirmed that it leaves no header gap in three-column view, reappears when narrowing, and stays hidden beside the phone's Back button. All 35 existing task-detail, pane-layout, and mobile App tests passed for this CSS-only follow-up.

## Previous tag dialog update

- All **34 existing tag and mobile App tests** passed, and the production web build succeeded. The dialog now has padded fields, clearer color selection, a live preview, and a scrollable body with a separate footer.
- Browser checks covered name autofocus, duplicate-name feedback, disabled invalid submission, group/color selection, live preview, forward/reverse Tab containment, and Escape restoring the trigger. At 390px and 320px widths, the dialog stays within the screen; at 320×568 its body scrolls while the action footer remains visible.
- This revision was validated in the browser preview only. The installed Mac app, simulator app, and device archive were deliberately not rebuilt or replaced, preserving the working Mac app's calendar permission continuity. Their bundled assets remain at the previous revision.

## Previous file drop and link update

- External file drops insert ordinary filename links at the indicated note position, without adding a bottom attachment-list entry. Browser checks used fictional PDF/image fixtures to verify mid-line insertion, a new paragraph below the note, persistence after reload, image preview on normal click, and Undo/Redo. A temporary browser drag source was used; Finder-to-installed-app dragging was not exercised.
- The in-app browser did not render its advertised embedded PDF viewer reliably, so browser document links now download with their original names. The PDF download was verified in Downloads with bytes matching the fixture exactly. Image previews rendered correctly. Native PDF/image preview routing is covered by App integration tests, and other file types use the existing native external-open action.
- All **157 focused frontend tests** passed, covering import persistence, size/read failures, native request isolation, caret geometry, import ordering and cancellation, link activation, and image-paste/slash-menu regressions. The production web build, all 90 native store checks, and macOS/iOS Swift typechecks passed in temporary verification environments.
- No installed Mac or simulator app was replaced, and no real task, attachment, or calendar records were changed. The production web build is newer than the installed apps. Real-device file dragging, native preview interaction, and cross-device file delivery still need verification on the next signed build.

## Initial unsigned Mac and iOS store archive preparation — 15 September 2026

Both Release archive commands succeeded. A read-only audit checked the resulting artifacts:

| Archive                                                       | Application                          | Architectures    | SDK / minimum OS  |
| ------------------------------------------------------------- | ------------------------------------ | ---------------- | ----------------- |
| `~/Library/Caches/GreenDay/AppStore/macOS/GreenDay.xcarchive` | `Products/Applications/GreenDay.app` | arm64 and x86_64 | macOS 26.5 / 13.0 |
| `~/Library/Caches/GreenDay/AppStore/iOS/GreenDay.xcarchive`   | `Products/Applications/Daymark.app`  | arm64            | iOS 26.5 / 16.0   |

- Both application plists contain the GreenDay display name, expected bundle identifiers, version **1.0.0**, build **1**, calendar access descriptions, and the nonexempt-encryption declaration set to false. The iOS device family remains iPhone and iPad. The Mac category is Productivity and its `DaymarkAppSandbox` storage marker is true.
- The web resources in both archives match `build/release-web` byte for byte: **62 files, 2,572,051 bytes**. The native bundle validator passed on the reference and both archived copies. Native builds omit browser-only PDF.js assets and use native document opening. The bundle inventory contains no workspace directories, attachment stores, revision stores, migration folders, source maps, source files, `node_modules`, or symlinks.
- The Mac archive includes a structurally valid `Daymark.icns` with the expected icon-size chunks; the iOS archive includes `Assets.car`, generated icon PNGs, and 1024×1024 AppIcon catalog entries for iPhone and iPad. Both archives include their application dSYM bundles.
- Both privacy manifests declare no tracking and no developer-collected data. They declare app-local UserDefaults use (`CA92.1`); the Mac manifest additionally declares elapsed in-app event timing (`35F9.1`) for native window dragging. These declarations describe the reviewed code; they do not replace the publisher's App Store privacy answers.
- The Mac target enables App Sandbox and requests only outgoing network access, calendars, user-selected read/write files, and app-scoped bookmarks. Its separate store plist uses the sandbox-aware workspace path. The existing direct-development Mac build and its plist remain separate.
- **Signing limitation:** the Mac executable has only the linker's ad hoc signature, with no team, sealed bundle resources, or embedded sandbox entitlements. The iOS application is unsigned. Neither archive contains a provisioning profile. The store marker and unsigned build settings alone do not establish runtime sandbox enforcement. The separately entitled runtime check below covers selected-folder behavior; final distribution signing and validation are still required. The Mac copyright field intentionally remains `Copyright owner not configured` in this verification archive.
- Release scripts now require the actual Developer team, bundle/version/build inputs, and nonplaceholder public HTTPS privacy/support URLs; the Mac script also requires the publisher's copyright notice. Missing-team checks stopped signed archive, export, and upload commands before any build or network upload. Release builds use freshly built native web resources and validate their contents before packaging.

The final archives were rebuilt after a help-text-only change, then their resource equality was rechecked. The artifact audit itself was read-only and did not change signing accounts, export a distribution package, or upload a build. The following runtime checks used the preceding build with identical application behavior and isolated test data:

- A copy of the Mac archive was placed in a unique cache QA directory, assigned bundle identifier `app.daymark.releaseqa`, and ad hoc signed with the actual `GreenDay.entitlements`. Launch showed the workspace chooser. Through the system folder picker, the app connected a fictional external cache workspace containing six sample tasks.
- Creating **Sandbox release check** saved its task JSON in that selected external folder. The QA app's sandbox container and persisted workspace bookmark were confirmed. After quitting and relaunching, the app restored the **Shared folder** connection and all seven tasks, including the new task, without a reconnect prompt. This checks sandboxed folder access and bookmark restoration on the local Mac; it does not prove iCloud provider delivery or App Store distribution signing.
- The user's installed development app, existing workspace, and calendar data/permissions were not modified by the QA copy. Only the isolated fictional workspace was written.
- The Release iPhone simulator app was installed and launched; visual inspection showed its existing test tasks. Further touch interaction checks could not proceed because the UI automation surface returned `noWindowsAvailable`. The iPad Release simulator install succeeded, but a new iPad launch/touch check is not claimed for this turn.

No physical iPhone, real calendar/provider synchronization, or cross-device iCloud delivery was tested in this initial preparation. The subsequent signing checks below supersede the signing limitation for the exported iOS package, but do not replace mobile runtime checks.

## Signed iOS App Store export — 15 September 2026

After the user renewed Developer Program membership, the authenticated App Store Connect page no longer displayed the expired-membership banner, and an automatic-signing release export succeeded. The signed archive is `~/Library/Caches/GreenDay/AppStore/iOS-Signed/GreenDay.xcarchive`; the App Store IPA is `~/Library/Caches/GreenDay/AppStore/iOS-Signed/Export/Daymark.ipa`.

A read-only audit of the exported IPA, using a disposable extracted copy for signature verification, confirmed:

- App identity **`com.kihyukh.greenday`**, display name **GreenDay**, version **1.0.0**, build **1**; arm64 architecture, minimum iOS **16.0**, SDK **26.5**, and iPhone/iPad device families. The nonexempt-encryption flag is false.
- Strict `codesign` verification passed. Certificate authorities are **Apple Distribution: Kihyuk Hong (3D637V9C9W)**, **Apple Worldwide Developer Relations Certification Authority**, and **Apple Root CA**. The embedded signed app identifier and provisioning-profile app identifier both equal `3D637V9C9W.com.kihyukh.greenday`.
- Both signed entitlements and the embedded provisioning profile set `get-task-allow=false` and `beta-reports-active=true`. The profile has no provisioned-device list and does not provision all devices; it expires on **15 September 2027**. No private device identifiers or credential material were written into release documentation.
- The native privacy manifest exactly matches the iOS source manifest: no tracking or collected-data categories, with app-local UserDefaults reason `CA92.1`.
- The **62 web files, 2,572,298 bytes**, exactly match the signed archive. Their JavaScript includes `https://kihyukh.github.io/todo-app/support.html` and `https://kihyukh.github.io/todo-app/privacy.html`. The native production-resource validator passed; no workspace directories, source maps, symlinks, or browser PDF assets are packaged. Asset catalog and generated iPhone/iPad icon resources are present.
- IPA SHA-256: `bb0b47425512735f80bd688c14e735a6aba6c265843bec81c8ef0cacd7dbe2c8`.

The support/privacy site was published through GitHub Pages from branch `codex/app-store-site`, site commit `1ccc663`; both required pages returned HTTP 200 and matched the local source byte for byte. They identify Kihyuk Hong and the user-approved public support address `hominot@gmail.com`.

At this initial signing stage, no final release screenshots were captured: the available native UI automation returned `noWindowsAvailable`, and the Simulator Save Screen action was disabled. A subsequent native capture recovery and release-matching simulator build are recorded below. The capture plan remains in [screenshots.md](../app-store/screenshots.md). No physical iPhone or cross-device iCloud/provider delivery was tested in this signing pass. The subsequent upload is recorded below.

## Signed Mac App Store export — 15 September 2026

The universal Mac archive and export also succeeded. The archive is `~/Library/Caches/GreenDay/AppStore/macOS-Signed/GreenDay.xcarchive`; the store package is `~/Library/Caches/GreenDay/AppStore/macOS-Signed/Export/GreenDay.pkg`. A read-only installer-signature inspection and disposable expanded-copy audit confirmed:

- Package signing certificate **3rd Party Mac Developer Installer: Kihyuk Hong (3D637V9C9W)**, chaining through **Apple Worldwide Developer Relations Certification Authority** to **Apple Root CA**. The enclosed application passed strict code-signature verification with **Apple Distribution: Kihyuk Hong (3D637V9C9W)** and the same Apple authority chain.
- App identity **`com.kihyukh.greenday`**, display name **GreenDay**, version **1.0.0**, build **1**, copyright **2026 Kihyuk Hong**; **arm64 and x86_64**, minimum macOS **13.0**, SDK **26.5**, and the nonexempt-encryption flag false.
- The signature enables hardened runtime. Actual signed entitlements include App Sandbox, outgoing network access, calendar access, user-selected read/write files, and app-scoped bookmarks, matching `native/macOS/GreenDay.entitlements`. No debug entitlement is enabled. Both signed and provisioning-profile app identifiers are `3D637V9C9W.com.kihyukh.greenday`; the profile has no provisioned-device list or all-device grant and expires on **15 September 2027**. The storage marker `DaymarkAppSandbox` is true.
- The privacy manifest exactly matches the Mac source manifest: no tracking or collected-data categories, app-local UserDefaults reason `CA92.1`, and elapsed-event-time reason `35F9.1`.
- The **62 web files, 2,572,298 bytes**, exactly match the Mac signed archive and the iOS package's web content. Both public support/privacy URLs and `Daymark.icns` are present. The native production-resource validator passed; no workspace directories, source maps, symlinks, or browser PDF assets are packaged.
- Package SHA-256: `a92045351f5b0a298d18520334cada4965627b93d847d1904b5e12143a94a514`.

These audits did not install either distribution package, open the user's workspace, alter its calendar permissions, or upload a build. Signing keys remain in Keychain. Portal verification confirmed the explicit identifier `com.kihyukh.greenday` under the publisher's team. App Store record **6812229239** was created for both platforms with SKU **greenday-2026** and English (U.S.). The available listing name is **GreenDay: Tasks & Notes**; the app itself remains named GreenDay. Both platforms are in Prepare for Submission.

## App Store Connect uploads — 15 September 2026

The iOS **1.0.0 (1)** upload from the audited existing archive succeeded at **16:03:23 KST**, with command exit status **0**. `build/ios-upload.log` records “Uploaded package is processing,” “Upload succeeded,” and `EXPORT SUCCEEDED`. The upload used `xcodebuild -exportArchive` with `destination=upload`, automatic signing, and version/build management disabled; the application was not rebuilt. Its upload output directory is `~/Library/Caches/GreenDay/AppStore/iOS-Signed/Upload`.

The Mac **1.0.0 (1)** upload from its audited archive succeeded at **16:07:29 KST**, with command exit status **0**. `build/macos-upload.log` records “Uploaded package is processing,” “Upload succeeded,” and `EXPORT SUCCEEDED`. It used the same export options and output directory `~/Library/Caches/GreenDay/AppStore/macOS-Signed/Upload`. No retry or rebuild was performed. Neither platform has been submitted for App Review or publicly released. A subsequent App Store Connect check confirmed upload status **Complete** and build status **Ready to Submit** for both platforms. Both platform versions now have selected build **1.0.0 (1)**, complete review contacts, and review notes saved. The user-saved iOS contact, build, and notes were verified after reload. The same authorized private contact and notes were then saved for Mac with its selected build; Save is disabled and no validation errors remain. The private phone number is intentionally not stored in repository files.

App Store Connect verification confirmed saved iOS and Mac listing versions **1.0.0**, description, promotional text, keywords, support/marketing URLs, copyright, and no sign-in requirement. Pricing is saved at **US$0.00**, with zero prices verified for all **174 other territories**. Availability is saved for **all 175 countries/regions**, including future territories; the table identifies them as available when the app releases. These settings do not make the app live before approval/release. A Mac screenshot and the user's EU trader declaration remain pending; review contact information is now saved for both platforms. App Store Connect Business confirms **Free Apps Agreement: Active**. The privacy-policy URL and **Data Not Collected** response are saved as a draft; publication awaits the user's certification confirmation. The EU trader form remains unanswered.

## Final Release simulator package for screenshots

Native Simulator screenshot capture was recovered. One final iPhone screenshot and three final iPad screenshots have been captured, reviewed, and uploaded. A fresh Release simulator package was built from the current source with `VITE_NATIVE_APP=1`, GreenDay version **1.0.0**, build **1**, and the same published privacy/support URLs as the uploaded release. Output: `~/Library/Caches/GreenDay/AppStore/Simulator-Final/Build/Products/Release-iphonesimulator/Daymark.app`. The isolated QA identifier remains **app.daymark.mobile**.

The package's **62 web files, 2,572,298 bytes**, are byte-identical to the signed iOS archive, and the native resource validator passed. Display/version, iPhone/iPad device families, calendar descriptions, minimum OS, encryption flag, and native privacy manifest match the release. The expected differences are the simulator SDK/native executable, QA bundle identifier, and signing. No store archive or export was rebuilt or changed.

After coordination with the screenshot operator, the package was installed in place on both the iPhone 17 Pro Max and iPad Pro 13-inch simulators without uninstalling or clearing data. Installed web resources match the release on both. Simulator installation relocated data-container UUIDs: all **12 iPad Documents files** retained identical hashes; the iPhone still contains its **37 fictional task/revision files**, but its first overly strict container-path check did not retain the prior hash snapshot, so an exact iPhone before/after-content comparison is not claimed. Both apps were relaunched through the Simulator UI and the expected fictional content was confirmed. No real user app or workspace was modified.

## Still needed before distribution

- Complete native calendar interaction checks for unlinking, event deletion, recurring occurrence edits/deletion, permission refusal, read-only calendars, and error recovery. Test external event changes and iCloud/Google delivery separately using a dedicated test calendar. Event creation and title editing were tested only in a simulator local calendar.
- Finish touch review of Month/Week/Day layouts, overlapping/all-day events, and task work days/deadlines. Recheck note menu placement, selected-text formatting, and Vim interactions on the final mobile build.
- Finish the remaining native interaction checks: touch link Open/Edit, deadline/tag sheets, image/PDF import and preview, folder selection, and error recovery. Capture App Store screenshots from the final build using fictional data.
- Both selected builds **1.0.0 (1)**, complete private review contacts, and review notes are saved for App Store record **6812229239**. No further contact or build-selection action is currently required; finish the remaining screenshot, privacy, account, and runtime checks before submission.
- Test on a physical iPhone: foreground/background persistence, local offline edits, Files permissions after relaunch, attachments, and cross-device iCloud delivery with the Mac using a separate test workspace. Simulator compilation does not verify these device/provider behaviors.
- Finish the Mac screenshot, privacy-publication confirmation, and account declarations described in [App Store delivery](APP-STORE.md). Both platform listings, publisher/copyright, public support URLs, free prices, and availability in all 175 countries/regions are saved and verified. The user's EU trader declaration remains pending; future in-app purchases are not configured.

Both packages have completed App Store Connect processing and show Ready to Submit; neither app has been submitted to App Review.

## Native screenshot capture and App Store upload

Four opaque JPEG assets are retained under `app-store/screenshots/ios` with SHA-256 hashes in `manifest.json`. They are native simulator captures with unchanged pixel dimensions and only fictional data. App Store Connect verified **1 of 10** screenshots in the **iPhone 6.9-inch** slot (1320 × 2868) and **3 of 10** in the **iPad 13-inch** slot (2064 × 2752). The iPad set shows tasks with rendered math, three nonconsecutive work days with a separate deadline, and open checkboxes.

The final iPad UI successfully opened the work-day picker, selected and saved work days, and opened Open checkboxes. Native CUA taps on iPhone header controls remained unreliable; this is an unresolved automation limitation and does not establish physical-touch correctness. Check those controls on an iPhone before submission.

Mac native screenshot capture remains incomplete after bounded attempts with Simulator-independent system capture and Preview. Use the isolated fictional GreenDay Release QA app for manual capture, verify an Apple-accepted pixel size, and exclude the user’s working app and private workspace. No browser screenshot was substituted for a native capture.
