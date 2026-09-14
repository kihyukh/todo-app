# Daymark

A desktop-first personal task app: a quiet three-pane workspace, deliberate daily planning, and rich research notes. Built for macOS, with a shared iPhone/iPad app source.

## Try the Mac app

The development build is installed at **`~/Applications/Daymark.app`**. Open it in Finder or Spotlight. `build/Daymark.app` links to the same app.

On this Mac, tasks are stored in **iCloud Drive → Daymark**. The footer reports the storage location; it does not claim that Apple has finished uploading every change. The app works without a web server or internet connection once built. Six clearly labelled example tasks help demonstrate the features; Settings can move them to Trash.

## What works

- **Do date and deadline are independent.** Today includes only tasks deliberately scheduled for today. Older work stays in a separate, collapsed section. Plan your day and the sun button change the do date without touching the deadline.
- **Rich notes.** Markdown input shortcuts, headings, bold/italic, links, code blocks, quotes, tables, nested checklists, images, and editable inline/display LaTeX. Type `$x^2$` for inline math, or type `$$` on a new line and press Enter for a display equation. Move the cursor into an equation with the arrow keys to reveal its LaTeX, then move out to render it again. Entry from the left/above starts at the beginning; entry from the right/below starts at the end. Up/Down traverse wrapped source lines before leaving. Clicking also opens source; ⌘ Enter returns to rendered math, and Tab / Shift-Tab continues after/before it. Escape also renders math when Vim mode is off; in Vim mode it returns to Normal inside the equation. Range selections keep equations rendered. Markdown source mode has explicit Apply and Cancel actions.
- **Predictable note navigation.** Enter continues bullets and checkboxes; an empty item exits the list. Tab / Shift-Tab indents/outdents the current item, and ⌘ Shift Enter toggles its checkbox without moving the cursor. ⌘ Enter continues below a quote, table, code block, or selected image. Click link text to edit it; ⌘/Ctrl-click opens the resource. A short footer hint follows the current block.
- **Responsive typing.** Notes update immediately while task-list updates and saves are batched. Native iCloud file coordination runs on a background queue. Switching tasks or quitting flushes the latest edit. Predictive text, autocomplete, and automatic corrections are disabled inside Daymark.
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

The responsive interface has been checked at a 390 × 844 viewport. The iOS app source, native Files picker, attachment preview, and background-save bridge are included. **An iPhone app has not yet been built or installed, and cross-device iCloud delivery has not been verified.** Xcode first-launch setup/licensing and a signing team/device are required. Follow [the iPhone build instructions](README-NATIVE.md#iphone--ipad).

On iPhone, choose the Mac app’s **same Daymark folder in iCloud Drive** using Settings. This uses Apple’s document-provider access rather than CloudKit.

## Validation

- 250 automated frontend tests cover date independence, task visibility, merge convergence, deletion preservation, concurrent browser saves, rich Markdown/math round trips, nested checkbox updates, directional math navigation, list/quote/table cursor behavior, image paste/drop placement, resizing/cropping/deletion, link clicks, Vim commands and modes inside equation source, typing batches, immediate task switches, and shutdown flushes, grouped tag editing/filtering, native attachment links, and TickTick conversion.
- 28 native checks cover conflict handling, unreadable-file protection, revision history, attachments, tag persistence, and ordered background saves without blocking the main queue.
- 36 synthetic migration CLI checks cover read-only preparation, required full backups, attachment resolution, idempotence, and preservation of existing edits.
- Manually checked native app launch, task creation, images/PDF previews, iCloud folder saving, quit/reopen persistence, and confirmed-save shutdown.
- Manually checked Today rescheduling, live checkbox aggregation, typed inline/display math, equation editing, and desktop/mobile layouts.
- Manually checked cursor entry and exit in both directions, wrapped LaTeX navigation, native WebKit focus, Vim Normal/Insert traversal, list indentation, checkbox continuation, and quote exit.
- Manually checked native clipboard-image paste, the image file chooser, mouse resize/crop, image deletion and undo, Vim image traversal, two-step Backspace selection/deletion, and image edits surviving Markdown source and app reopening.

```sh
swiftc -swift-version 5 native/Shared/DaymarkStore.swift native/Tests/main.swift -o /tmp/daymark-store-tests
/tmp/daymark-store-tests
```

## Design and limits

[Design notes and product references](docs/DESIGN.md) explain the choices and which products were directly inspected.

Concurrent edits to the **same task** resolve as whole records; the newer record wins and previous/losing versions are retained under `Revisions`. This is a personal app, not a collaborative text editor. Revisions do not have a restore UI yet. JSON export includes attachment references; copy the whole workspace folder to back up the attachment files too. A guarded [TickTick migration tool](docs/MIGRATION.md) supports a reviewed one-time transfer; there is no recurring TickTick sync or general import UI. Push notifications remain outside this version.
