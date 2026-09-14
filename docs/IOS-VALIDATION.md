# iPhone and iPad validation

The chosen display name is **GreenDay**, with a green icon and interface accent. Internal project/scheme names and `app.daymark.mobile` remain unchanged. The final archive audit confirmed version 1.0.0, build 1, and minimum deployment target iOS 16. The validation environment uses Xcode 26.6 and the iOS 26.5 SDK.

## Previously completed

- Earlier frontend runs covered editor/storage behavior, mobile setup, keyboard dismissal, link actions, cursor visibility after viewport changes, synced note updates, visible save errors, multi-date calendars, repeated Upcoming entries, heading shortcuts, gutter placement, and selection/Vim preservation through the element menu. These checks also remain in the current automated suite described below.
- Earlier native persistence and migration runs passed using temporary folders, including preservation of date arrays and cleared schedules.
- The simulator app was built for arm64 and x86_64, then installed and launched on iPhone 17 Pro Max and iPad Pro 13-inch (M5) simulators running iOS 26.5.
- A Release archive for an arm64 iOS device was built at `build/Daymark.xcarchive`. It was unsigned and could not be distributed as-is.
- The previously checked archive contained the icon, privacy manifest, bundled editor assets, and license notices. It contained no personal task records, migration exports, attachment workspace, recovery history, or source files. The current archive was audited again, as described below.
- iPhone visual checks confirmed local first-launch setup, the Today list, task details, independent calendar selections, the selected-date summary, and the unchanged deadline. Opening a display equation now keeps its LaTeX visible above the keyboard; Done dismisses the keyboard and restores rendering.
- Browser interaction checks confirmed nonconsecutive dates across September and October, removing one date, the after-deadline hint, and every work day appearing in Upcoming separately from its deadline. Only fictional sample tasks were edited.

- The earlier gutter redesign was checked in the browser and native Mac app: headings showed H2/H3 labels; the + menu created checklists and display equations; Escape restored the note cursor and retained Vim Normal mode. Automated checks covered heading undo, nested-list preservation, cancelled image-picker behavior, preserving selected inline math during insertion, and unchanged typing geometry. iPhone touch checks covered heading creation, list insertion/conversion, and opening the + menu while the software keyboard was visible.

## Current GreenDay/calendar update

The current scope includes optional Apple Calendar access to configured iCloud/Google accounts; Month, Week, and Day views; event creation/editing/deletion; task-event links; priorities and planning; compact rows; adjustable desktop panes; and further gutter/Vim interaction work. These checks completed for the current update:

- **414 frontend tests passed.** After the final change disabling text suggestions in calendar fields, **16 focused calendar UI tests** passed again.
- **36 native persistence checks** and **24 isolated calendar checks** passed. The isolated calendar tests do not construct an EventKit store or access personal calendars. Both native platforms also passed their minimum-target typechecks.
- The final Mac, iPhone/iPad simulator, and unsigned device Release archive builds succeeded. The installed Mac app launched under the GreenDay name with existing tasks and its chosen iCloud workspace preserved. Configured calendar events loaded after permission approval without any personal calendar writes. The final ad hoc Mac rebuild required consent again, and its connection was verified after renewed approval.
- The final archive audit confirmed the GreenDay display name, `app.daymark.mobile`, version 1.0.0/build 1, minimum iOS 16, and the EventKit access description. `Assets.car` and the privacy manifest were present. All **62 bundled web files** matched by hash across `dist`, the Mac app, the simulator app, and the device archive. The app contained no task/project/column data directories, `Attachments`, `Revisions`, migration data, `node_modules`, or `src` directories.
- On the iPhone simulator, **Connect calendars** presented the system permission prompt; approval showed calendar sources and the day agenda. A fictional event was created in the simulator's default local calendar and linked to a task. The event listed its linked task, the task listed its event, the linked-task badge showed one task, and the duplicate work-day row was hidden. Editing the event title preserved the link. The fictional event remains in the simulator; no personal calendar event was written.
- The event form fit within a scrollable viewport above the software keyboard, and Done dismissed the keyboard. The simulator's hardware-keyboard setting was restored after the check.

These results establish build and local interaction behavior. They do not establish provider delivery or readiness for signed distribution.

## Still needed before distribution

- Complete native calendar interaction checks for unlinking, event deletion, recurring occurrence edits/deletion, permission refusal, read-only calendars, and error recovery. Test external event changes and iCloud/Google delivery separately using a dedicated test calendar. Event creation and title editing were tested only in a simulator local calendar.
- Finish touch review of Month/Week/Day layouts, overlapping/all-day events, and task work days/deadlines. Recheck note menu placement, selected-text formatting, and Vim interactions on the final mobile build.
- Finish the remaining native interaction checks: touch link Open/Edit, deadline/tag sheets, image/PDF import and preview, folder selection, and error recovery. Capture App Store screenshots from the final build using fictional data.
- Sign into Xcode with an Apple Developer Program team; reserve the final bundle identifier and create the App Store Connect record. No signing identity or authenticated App Store Connect session was available during this build.
- Test on a physical iPhone: foreground/background persistence, local offline edits, Files permissions after relaunch, attachments, and cross-device iCloud delivery with the Mac using a separate test workspace. Simulator compilation does not verify these device/provider behaviors.
- Finish publisher/contact details, privacy/support URLs, listing, and distribution settings described in [App Store delivery](APP-STORE.md). GreenDay is the chosen display name; the publisher/contact placeholders are still unresolved.

No build has been uploaded to TestFlight or submitted to App Review.
