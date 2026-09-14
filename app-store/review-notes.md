# Review notes draft

GreenDay is the chosen app name. Supply the real review contact in App Store Connect's separate fields. The following copy applies only after the corresponding release-build checks pass; the current calendar update is still being validated.

---

GreenDay is a personal task, calendar, and note app with a green interface. No GreenDay sign-in, demo account, subscription, or backend setup is required. Core task editing works offline. The included examples are fictional and can be moved to Trash from Settings.

Suggested walkthrough:

1. Create “Review a paper.” Set its deadline to a future date, then open Work on and select Today plus two nonconsecutive future days. The calendar stays open while selecting; Done closes it. Today shows the task without changing its deadline. Upcoming shows each selected work day and the deadline; removing Today leaves the other dates intact.
2. Open the task and write a short note. Tap **+** beside the current note line, then Checklist. Type `## ` to create a heading; its H2 label appears in the gutter and opens the element menu. Open the “Open checkboxes” view and check that item; its original note updates.
3. Enter `$x^2$` for inline math. Enter `$$` on a new line and press Return for display math. Tap an equation to edit its LaTeX. With a hardware keyboard, arrow keys enter and leave equation source. Optional Vim mode is in Settings → Editor.
4. In the note’s **+** menu, use “Insert image” or “Attach an image or PDF” and choose a test file using the system picker. Close and reopen the task. Background and reopen the app to check persistence.
5. Set the task's priority and workflow status. Review it in List and Board views, then use Plan your day to add Today without replacing its other work days. On Mac, pane dividers can be dragged or adjusted with arrow keys; double-click restores their default widths.
6. Optional calendar walkthrough: open **Settings → Calendars → Connect calendars** and grant event access. Choose a calendar belonging to the reviewer, preferably a separate test calendar. Open **Calendar** and switch between Month, Week, and Day. Create a fictional event; link the sample task from its **Link task** action or from **Link event** in task details. Unlinking removes the task association without deleting the event. Use the test event to check edit/delete; recurring operations target the selected occurrence.

iCloud Drive is optional. In Settings → Storage & sync → Choose workspace folder, choose a folder in the reviewer’s own iCloud Drive. For a two-device test, select that same folder on both devices using the same Apple Account. No developer-owned account or shared test credentials are involved. iCloud Drive handles transfers; its completion timing can differ from the app’s local save status.

Calendar access is also optional, and its permission request appears only after **Connect calendars**. The app uses EventKit with the accounts already configured in Apple Calendar, including iCloud and Google. It has no separate Google OAuth screen; add or enable that account in the device's calendar settings first. Apple Calendar and the account provider manage authentication and synchronization. Denying calendar access leaves task and note editing available. Read-only calendars can be displayed, but do not offer writes.

Task-event links save event identifiers and cached title/time/calendar metadata with the task. A work-session event can use the task title after the reviewer confirms its event form. Linking does not copy the full task note or attachments to a calendar. Calendar events remain at their provider when a task is unlinked, trashed, or its workspace is removed.

The app is a locally bundled interface inside a native shell. It does not download its application code from a website. It saves task records, attachment files, and recovery revisions in the local or user-selected workspace. It has no advertising or analytics SDK. Links entered by the user open in the system browser; remotely hosted images inserted into a note may contact their source host.

The app's Privacy section includes offline privacy information and open-source notices. Final published privacy/support URLs and the real support contact must be supplied with the submission; draft publisher/contact placeholders must not be submitted. The release archive must be checked to exclude the publisher’s personal workspace and migration backups.
