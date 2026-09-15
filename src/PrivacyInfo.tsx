import { APP_NAME, PUBLIC_PRIVACY_URL, PUBLIC_SUPPORT_URL } from "./brand";
import { openNoteLink } from "./note-links";
import browserNotices from "./third-party-notices.txt?raw";
import nativeNotices from "./third-party-notices.native.txt?raw";
import "./privacy-info.css";

export function PrivacyInfo() {
  const notices =
    import.meta.env.VITE_NATIVE_APP === "1" ? nativeNotices : browserNotices;
  return (
    <div className="privacy-info">
      <p>
        {APP_NAME} does not require an app account and contains no advertising
        or analytics SDK. This information is available offline.
      </p>
      {(PUBLIC_PRIVACY_URL || PUBLIC_SUPPORT_URL) && (
        <nav className="privacy-page-links" aria-label="Privacy and support">
          {[
            [PUBLIC_PRIVACY_URL, "Privacy policy"],
            [PUBLIC_SUPPORT_URL, "Support"],
          ].map(
            ([url, label]) =>
              url && (
                <a
                  key={label}
                  href={url}
                  onClick={(event) => {
                    event.preventDefault();
                    openNoteLink(url);
                  }}
                >
                  {label}
                </a>
              ),
          )}
        </nav>
      )}

      <h4>Your workspace</h4>
      <p>
        Tasks, notes, and attachments stay on your device or in a workspace
        folder you choose. If that folder is in iCloud Drive or another file
        provider, the provider handles storage and syncing under its own privacy
        practices. The developer does not operate a server that receives your
        workspace and cannot access your private iCloud Drive through the app.
      </p>

      <h4>Calendars</h4>
      <p>
        Calendar access is optional. With your permission, {APP_NAME} reads
        calendars connected to Apple Calendar, including iCloud and Google
        accounts. Events you create or edit are saved through Apple Calendar and
        synced by the calendar provider. Linked event names, dates, and
        identifiers are stored with your tasks so those links can follow your
        workspace across devices. Calendar credentials stay with the system.
      </p>

      <h4>Links and images</h4>
      <p>
        Links open in your system browser or the relevant app. A remotely hosted
        image in a note can contact its source website when displayed. That site
        may receive normal web request information, such as your IP address.
        Images copied into your workspace do not need their original website.
      </p>

      <h4>Removing your data</h4>
      <p>
        Trash is recoverable. Earlier record versions and copied attachments may
        remain in the workspace. To remove a folder workspace completely, close
        the app on every device using it, then delete the whole workspace folder
        in Finder or Files, including its attachments and recovery history.
        Remove any exports or other copies you made too.
      </p>
      <p>
        Uninstalling the app does not delete a selected iCloud Drive folder.
        Your file provider and device backups may retain copies under their own
        policies.
      </p>

      <h4>TestFlight</h4>
      <p>
        If you use a TestFlight beta, Apple may share crash information and
        feedback you submit with the developer. This is separate from your task
        workspace.
      </p>
      <details className="license-notices">
        <summary>Open source licenses</summary>
        <pre>{notices}</pre>
      </details>
    </div>
  );
}
