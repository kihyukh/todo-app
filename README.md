# Daymark

A desktop-first personal task app: a quiet three-pane workspace, deliberate daily planning, and rich research notes. Built for macOS, with a shared iPhone/iPad app source.

## Try the Mac app

The development build is installed at **`~/Applications/Daymark.app`**. Open it in Finder or Spotlight. `build/Daymark.app` links to the same app.

On this Mac, tasks are stored in **iCloud Drive → Daymark**. The footer reports the storage location; it does not claim that Apple has finished uploading every change. The app works without a web server or internet connection once built. Six clearly labelled example tasks help demonstrate the features; Settings can move them to Trash.

## What works

- **Do date and deadline are independent.** Today includes only tasks deliberately scheduled for today. Older work stays in a separate, collapsed section. Plan your day and the sun button change the do date without touching the deadline.
- **Rich notes.** Markdown input shortcuts, headings, bold/italic, links, code blocks, quotes, tables, nested checklists, images, and editable inline/display LaTeX. Type `$x^2$` or `$$x^2$$`, or use the equation button. Click a rendered equation to edit its source. Markdown source mode has explicit Apply and Cancel actions.
- **Images and PDFs.** Paste/drop images into notes or attach image/PDF files. Attachments preview inside the Mac app and can open in the default viewer.
- **Open checkboxes.** Every unchecked note item appears with a link to its parent. Checking it updates the original note. Completed parent tasks remain included until their steps are checked; trashed tasks are excluded.
- **Lists and boards.** Add/rename lists. Switch list/board layouts. Add, rename, recolor, reorder, or remove board columns. Drag a card between columns or change its status in the detail pane. Removing a column moves its tasks into a remaining column.
- **Daily essentials.** Search across titles and notes, quick entry, task completion/reopening, duplicate, recoverable Trash, and task-data export.
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

- 19 automated frontend tests cover date independence, task visibility, merge convergence, deletion preservation, concurrent browser saves, rich Markdown/math round trips, and nested checkbox updates.
- 11 native persistence checks cover conflict handling, unreadable-file protection, revision history, and attachments.
- Manually checked native app launch, task creation, images/PDF previews, iCloud folder saving, quit/reopen persistence, and confirmed-save shutdown.
- Manually checked Today rescheduling, live checkbox aggregation, typed inline/display math, equation editing, and desktop/mobile layouts.

```sh
swiftc -swift-version 5 native/Shared/DaymarkStore.swift native/Tests/main.swift -o /tmp/daymark-store-tests
/tmp/daymark-store-tests
```

## Design and limits

[Design notes and product references](docs/DESIGN.md) explain the choices and which products were directly inspected.

Concurrent edits to the **same task** resolve as whole records; the newer record wins and previous/losing versions are retained under `Revisions`. This is a personal app, not a collaborative text editor. Revisions do not have a restore UI yet. JSON export includes attachment references; copy the whole workspace folder to back up the attachment files too. Import from existing task apps and push notifications are outside this first version.
