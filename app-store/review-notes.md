# Review notes draft

Replace `__APP_NAME__` before pasting into App Store Connect. Supply the real review contact in its separate fields. The following copy applies only after the corresponding release-build checks pass.

---

__APP_NAME__ is a personal task and note app. No sign-in, demo account, subscription, or backend setup is required. Core task editing works offline. The included examples are fictional and can be moved to Trash from Settings.

Suggested walkthrough:

1. Create “Review a paper.” Set its deadline to a future date, then open Work on and select Today plus two nonconsecutive future days. The calendar stays open while selecting; Done closes it. Today shows the task without changing its deadline. Upcoming shows each selected work day and the deadline; removing Today leaves the other dates intact.
2. Open the task and write a short note. Add a checkbox with the note toolbar. Open the “Open checkboxes” view and check that item; its original note updates.
3. Enter `$x^2$` for inline math. Enter `$$` on a new line and press Return for display math. Tap an equation to edit its LaTeX. With a hardware keyboard, arrow keys enter and leave equation source. Optional Vim mode is in Settings → Editor.
4. Use “Insert image” or “Attach an image or PDF” and choose a test file using the system picker. Close and reopen the task. Background and reopen the app to check persistence.

iCloud Drive is optional. In Settings → Storage & sync → Choose workspace folder, choose a folder in the reviewer’s own iCloud Drive. For a two-device test, select that same folder on both devices using the same Apple Account. No developer-owned account or shared test credentials are involved. iCloud Drive handles transfers; its completion timing can differ from the app’s local save status.

The app is a locally bundled interface inside a native shell. It does not download its application code from a website. It saves task records, attachment files, and recovery revisions in the local or user-selected workspace. It has no advertising or analytics SDK. Links entered by the user open in the system browser; remotely hosted images inserted into a note may contact their source host.

The privacy policy and support contact are available through the URLs supplied with this submission and the app’s privacy/support entry. The publisher’s personal workspace and migration backups are not included in this build.
