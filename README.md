# GreenDay

A desktop-first personal task app with a clear green theme, compact task lists, adjustable panes, deliberate daily planning, calendar events, and rich research notes. Built for macOS and iPhone/iPad.

## Try the Mac app

The Mac builder installs the app at **`~/Applications/GreenDay.app`**, with a shortcut at **`build/GreenDay.app`**. Open the installed app in Finder or Spotlight. Verification builds stay outside the iCloud-managed repository under `~/Library/Caches/GreenDay/Builds`, with the same build shortcut pointing to the verified bundle. When replacing the older Daymark build, the installer retains the previous binary and keeps the old app path as a compatibility link.

Existing workspace folders remain named **Daymark**, including **iCloud Drive → Daymark**; the display rename does not move your data. The footer reports the storage location; it does not claim that Apple has finished uploading every change. Task editing works without a web server or internet connection once built. New workspaces include clearly labelled fictional examples that Settings can move to Trash.

## What works

- **Work days and deadlines are independent.** Select several individual days in **Work on**, including nonconsecutive days across months. Today and Tomorrow toggle only their own dates. Today includes tasks deliberately scheduled for that day; Upcoming shows each work day and the separate deadline. The deadline remains unchanged, with a subtle hint for work planned after it.
- **Calendar beside your tasks.** Month, Week, and Day views show calendar events alongside work days and deadlines. In the native app, **Settings → Calendars → Connect calendars** requests optional access to Apple Calendar. This includes iCloud, Google, and other accounts already configured in Apple Calendar. Choose which calendars to show; create, edit, or delete events in writable calendars. Recurring edits target the selected occurrence. Account authentication and provider syncing remain with Apple Calendar.
- **Linked events and work sessions.** Use **Link event** in a task or **Link task** in an event to connect them. Schedule a work session from a task when you want an actual timed event. Linking does not move a task's work days or deadline; unlinking does not delete the calendar event. A link retains its last saved title and dates when its calendar is unavailable.
- **Compact, adjustable workspace.** Drag the desktop pane dividers to give the task list or note more room; arrow keys also resize them, and double-click resets a divider. Widths are remembered on each device. Task details combine schedule, workflow status, priority, tags, linked events, and notes in one place.
- **Priority and daily planning.** Set High, Medium, Low, or No priority. Planning highlights approaching deadlines and in-progress work, while the task's workflow status stays separate from its priority and completion.
- **A quiet note editor.** A reserved left gutter replaces the formatting bar. Use **+** beside the current line for headings, lists, checkboxes, quotes, code, equations, images, files, tables, and dividers. Heading labels show H1/H2/H3 and open the same menu to change the level. Type `# `, `## `, or `### ` to create a heading; Enter continues in ordinary text and immediate Backspace restores the marker. Text formatting and Markdown source are in the menu, also available through **⌘/Ctrl /** or the footer’s **…** button.
- **Rich notes.** Markdown input shortcuts, headings, bold/italic, links, code blocks, quotes, tables, nested checklists, images, and editable inline/display LaTeX. Type `$x^2$` for inline math, or type `$$` on a new line and press Enter for a display equation. Move the cursor into an equation with the arrow keys to reveal its LaTeX, then move out to render it again. Entry from the left/above starts at the beginning; entry from the right/below starts at the end. Up/Down traverse wrapped source lines before leaving. Clicking also opens source; ⌘ Enter returns to rendered math, and Tab / Shift-Tab continues after/before it. Escape also renders math when Vim mode is off; in Vim mode it returns to Normal inside the equation. Range selections keep equations rendered. Markdown source mode has explicit Apply and Cancel actions.
- **Predictable note navigation.** Enter continues bullets and checkboxes; an empty item exits the list. Tab / Shift-Tab indents/outdents the current item, and ⌘ Shift Enter toggles its checkbox without moving the cursor. ⌘ Enter continues below a quote, table, code block, or selected image. Click link text to edit it; ⌘/Ctrl-click opens the resource. A short footer hint follows the current block.
- **Responsive typing.** Notes update immediately while task-list updates and saves are batched. Native iCloud file coordination runs on a background queue. Switching tasks or quitting flushes the latest edit. Predictive text, autocomplete, and automatic corrections are disabled inside GreenDay. Gutter measurements are batched and do not serialize the note on each keystroke.
- **Optional Vim mode.** Turn on **Settings → Editor → Vim mode** for Normal, Insert, and Visual editing in rich notes. Use `i` / `Esc`, `h j k l`, `w b e`, `0 $`, `gg G`, `dd`, `cw`, `yy p`, and `u` / `Ctrl-R`. Moving into LaTeX keeps the current mode: Normal commands navigate and edit the source, `i` starts typing, and Escape returns to Normal inside the equation. Moving past its boundary renders it again and keeps the current mode in the note. Visual selections and operators in the surrounding note treat each equation as one unit. The setting is remembered on each device. The Markdown source panel remains an ordinary text input.
- **Editable images.** Paste an image at the cursor, drop image files where you want them, or use Insert image. Click an image to reveal Small/Medium/Full sizing, a proportional resize handle, Crop, and Delete. Cropping supports Apply, Cancel, and Reset while preserving the original image. Size and crop survive saving and Markdown source editing. Arrow keys visit images as single blocks; Backspace beside an image selects it before deleting it on the next press. Enter continues below, and Vim keeps its mode with navigation, delete, and yank/paste commands. All image edits support undo.
- **Images and PDFs as attachments.** Attach image/PDF files to preview inside the Mac app or open in the default viewer.
- **Open checkboxes.** Every unchecked note item appears with a link to its parent. Checking it updates the original note. Completed parent tasks remain included until their steps are checked; trashed tasks are excluded.
- **Lists and boards.** Add/rename lists. Switch list/board layouts. Add, rename, recolor, reorder, or remove board columns. Drag a card between columns or change its status in the detail pane. Removing a column moves its tasks into a remaining column.
- **Grouped tags.** Organize tasks by Area, Work type, and Topic. Filter across lists from the sidebar, search tag names, and assign several tags to a task. Create, rename, recolor, regroup, or delete tags; assignments sync with your tasks. A task created in a tag view inherits that tag.
- **Daily essentials.** Search across titles, notes, and tags, quick entry, task completion/reopening, duplicate, recoverable Trash, and task-data export.
- **Local persistence and iCloud Drive storage.** Separate coordinated files per task, deletion tombstones, deterministic conflict resolution, and retained previous versions. See [native storage details](README-NATIVE.md).

There are no habits, timers, gamification, collaboration feeds, or analytics integrations.

## Build and develop

Requires Node.js 22+ and Apple’s Swift command line tools for the Mac build.

```sh
npm ci
npm run dev       # Browser development preview, with its own local workspace
npm test
npm run build:mac # Bundles the interface, builds and signs the local Mac app
```

The Mac build is ad hoc signed for the current Mac architecture. Public distribution would require Developer ID signing and notarization. Rebuilding preserves your task data.

Browser preview data is held in IndexedDB and merged across tabs. It is separate from the native app’s iCloud Drive workspace.

## iPhone status

The current GreenDay app builds for iPhone and iPad simulators, and its unsigned device Release archive has passed a bundle-content audit. Simulator checks covered calendar permission, event creation and editing, task-event links, and forms above the software keyboard. Signed physical-device installation, cross-device iCloud delivery, and calendar-provider behavior still require device validation. See [iOS validation](docs/IOS-VALIDATION.md) for completed checks and remaining limits, and follow [the iPhone build instructions](README-NATIVE.md#iphone--ipad).

On iPhone, choose the Mac app’s **same Daymark folder in iCloud Drive** using Settings. This uses Apple’s document-provider access rather than CloudKit.

## Validation

The current GreenDay/calendar update passed these checks:

- **414 frontend tests**, covering scheduling, calendar layout/linking, planning and priorities, pane resizing, storage conflicts, Markdown/math, images, note navigation, Vim, touch interactions, tags, native links, and TickTick conversion. After the final calendar text-suggestion change, all **16 focused calendar UI tests** also passed.
- **36 native persistence checks**, covering conflict handling, unreadable-file protection, revision history, attachments, tags, work dates, and background saves. **24 isolated calendar checks** passed for dates, event identity, and recurrence safeguards without constructing an EventKit store.
- The renamed Mac app built, installed, and launched with existing tasks and the chosen iCloud workspace preserved. An earlier build of this update loaded configured calendar events after access was approved, using the same native calendar implementation. The final ad hoc rebuild requests consent again. No personal calendar events were created, edited, or deleted.
- iPhone/iPad simulator builds and an unsigned device Release archive passed. The final archive contains the GreenDay identity, icon assets, privacy manifest, and expected web assets; bundled web assets match the Mac and simulator builds. The audit found no personal workspace or development directories in the app.
- iPhone live checks covered permission approval, calendar sources, the day agenda, and creating and editing a fictional event in the simulator's default local calendar. A linked task appeared in both the event and task details; its badge appeared once, its duplicate work-day row was suppressed, and editing the event title retained the link. The fictional event remains in the simulator. Forms scroll above the software keyboard, and Done dismisses it.

Live event unlinking/deletion, recurring writes, read-only account restrictions, and delivery to iCloud or Google remain unverified. Physical-device and distribution checks are listed in [iOS validation](docs/IOS-VALIDATION.md).

Earlier manual checks also covered task creation and quit/reopen persistence, images/PDF previews, work-day planning, checkbox aggregation, math cursor navigation, Vim modes, list/quote interactions, image paste/resize/crop/delete/undo, and Markdown round trips. Synthetic migration checks covered read-only preparation, full backups, attachment resolution, idempotence, and preservation of existing edits.

```sh
swiftc -swift-version 5 native/Shared/DaymarkStore.swift native/Tests/main.swift -o /tmp/daymark-store-tests
/tmp/daymark-store-tests

swiftc -swift-version 5 -framework EventKit native/Shared/DaymarkCalendar.swift native/CalendarTests/main.swift -o /tmp/greenday-calendar-tests
/tmp/greenday-calendar-tests
```

## Design and limits

[Design notes and product references](docs/DESIGN.md) explain the choices and which products were directly inspected.

Concurrent edits to the **same task** resolve as whole records; the newer record wins and previous/losing versions are retained under `Revisions`. This is a personal app, not a collaborative text editor. Revisions do not have a restore UI yet. JSON export includes attachment references; copy the whole workspace folder to back up the attachment files too. A guarded [TickTick migration tool](docs/MIGRATION.md) supports a reviewed one-time transfer; there is no recurring TickTick sync or general import UI. Push notifications remain outside this version.

Calendar access requires the native app and explicit permission. Browser previews still show task work days and deadlines, but do not connect to system accounts. GreenDay does not provide separate Google OAuth or promise immediate provider delivery. Calendar-event writes and workspace-file saves are separate operations; saving a task does not create an event automatically. See the [calendar bridge contract and limits](native/CALENDAR.md).
