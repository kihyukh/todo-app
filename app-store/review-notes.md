# App Review notes

Prepared copy for both platform versions. Review contact fields must be completed privately in App Store Connect. Run the walkthrough on the actual submitted builds before pasting the text below. Screenshots and runtime validation are tracked in [APP-STORE.md](../docs/APP-STORE.md).

---

GreenDay is a task, calendar, and note app. No GreenDay sign-in, demo account, subscription, or backend setup is required. Core editing works offline. The included example tasks are fictional; Settings includes “Move example tasks to Trash.”

Suggested walkthrough:

1. Create “Review a paper.” Open its date control. In Work days, select Today and two nonconsecutive future days. In Deadline, choose a later date. Save applies both tabs. Reopen the picker and Cancel to verify that a draft change is discarded.
2. Open the note. Type / on a new line or use + in the left gutter to insert a Checklist. Open “Open checkboxes” to see the unfinished item and complete it there. Completing the parent task hides its remaining unchecked items from this view without changing the note; reopening the task restores them.
3. Type `$x^2$` for inline math. Type `$$` on a new line and Return for display math. Tap an equation to edit its LaTeX. A hardware keyboard can move into and out of equation source. Optional Vim mode is under Settings → Editor; i enters Insert, Escape returns to Normal, and Shift+J joins source lines.
4. Use Insert image in the note element menu and choose a test image. On Mac, drop a test PDF into the note: a filename link appears at the indicated position. Open the link, then close the system document viewer. Background/relaunch the app and reopen the task to check persistence.
5. Change the task's priority, list, tags, or workflow status. Try List and Board. On Mac, drag pane dividers and resize the window; task details float on the right when there is insufficient space for a third column.

Storage and sync are optional. The Mac App Store app starts with sandbox-local storage. Choose an existing workspace from the first-run prompt or Settings → Storage & sync → Choose workspace folder. The system picker grants access; a bookmark restores it on relaunch. The app does not search unrestricted folders for an earlier installation. To test iCloud sync, select the same folder in the reviewer's own iCloud Drive on both devices. Local save status does not claim that the provider has finished transferring files.

Calendar access is requested only after Connect calendars. The app uses EventKit and the accounts configured in Apple Calendar, including iCloud and Google; there is no separate Google OAuth flow. Use a dedicated test calendar. Create a fictional event, then link a task through Link task or Link event. Unlinking or trashing the task does not delete the calendar event. Recurring edits and deletions target the selected occurrence. Denying access leaves task editing available; read-only calendars cannot be edited.

Linked-event identifiers and cached titles/times are saved with the task. Linking does not copy its full note or attachments to the calendar. Calendar credentials stay with the operating system.

The interface and its code are bundled locally. Mac sandbox access is used for selected workspace files and imported attachments; calendar permission enables the optional calendar view; outgoing network access permits user-inserted remote images. PDFs use system viewers. The app has no advertisements or analytics SDK. Public policy/support links and offline privacy information are in Settings → Privacy, alongside open-source notices.
