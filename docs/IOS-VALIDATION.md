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

## Current Mac and iOS store archive preparation — 15 September 2026

Both Release archive commands succeeded. A read-only audit checked the resulting artifacts:

| Archive | Application | Architectures | SDK / minimum OS |
| --- | --- | --- | --- |
| `~/Library/Caches/GreenDay/AppStore/macOS/GreenDay.xcarchive` | `Products/Applications/GreenDay.app` | arm64 and x86_64 | macOS 26.5 / 13.0 |
| `~/Library/Caches/GreenDay/AppStore/iOS/GreenDay.xcarchive` | `Products/Applications/Daymark.app` | arm64 | iOS 26.5 / 16.0 |

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

No physical iPhone, real calendar/provider synchronization, or cross-device iCloud delivery was tested in this preparation. Store-signature checks and the deeper mobile interaction checks below remain outstanding.

## Still needed before distribution

- Complete native calendar interaction checks for unlinking, event deletion, recurring occurrence edits/deletion, permission refusal, read-only calendars, and error recovery. Test external event changes and iCloud/Google delivery separately using a dedicated test calendar. Event creation and title editing were tested only in a simulator local calendar.
- Finish touch review of Month/Week/Day layouts, overlapping/all-day events, and task work days/deadlines. Recheck note menu placement, selected-text formatting, and Vim interactions on the final mobile build.
- Finish the remaining native interaction checks: touch link Open/Edit, deadline/tag sheets, image/PDF import and preview, folder selection, and error recovery. Capture App Store screenshots from the final build using fictional data.
- Renew the expired Apple Developer Program membership, configure the signing team in Xcode, reserve the final bundle identifier, and create the App Store Connect record. App Store Connect and the Developer account are signed in, but both currently report expired membership; no local signing identity is available. The user was asked to renew. No payment, renewal, or agreement acceptance was attempted, and no build was uploaded.
- Test on a physical iPhone: foreground/background persistence, local offline edits, Files permissions after relaunch, attachments, and cross-device iCloud delivery with the Mac using a separate test workspace. Simulator compilation does not verify these device/provider behaviors.
- Finish publisher/contact details, privacy/support URLs, listing, and distribution settings described in [App Store delivery](APP-STORE.md). GreenDay is the chosen display name; the publisher/contact placeholders are still unresolved.

No build has been uploaded to TestFlight or submitted to App Review.
