# Native calendar bridge

GreenDay uses EventKit to access calendars configured in Apple Calendar, including iCloud and Google accounts. Apple Calendar owns account credentials and provider synchronization. There is no separate Google OAuth client or GreenDay calendar server.

Calendar access is requested only by the explicit `calendarConnect` action. The native bridge initializes no event store at startup. `calendarStatus` checks authorization without requesting permission; after authorization it also returns available calendars. Reading events needs full access, so macOS 14/iOS 17 use `requestFullAccessToEvents`; macOS 13/iOS 16 use `requestAccess(to: .event)`. Both generations of usage-description keys are present. No reminder or contact access is requested.

Each request carries its caller's `requestId`; every response and error echoes it. Calendar UI requests use `calendar:` IDs so workspace errors can remain separate.

| Request | Response |
| --- | --- |
| `calendarStatus`, `calendarConnect` | `calendarStatus`, with `status`, `calendars`, `defaultCalendarId` |
| `calendarEvents`, with ISO `start`, exclusive ISO `end`, optional `calendarIds` | `calendarEvents`, with `calendars`, `events`, `start`, `end` |
| `calendarSave`, with an `event` object | `calendarSaved`, with the saved `event` |
| `calendarDelete`, with event identity fields | `calendarDeleted`, with `id`, `occurrenceDate` |
| Any failed request | `error`, with `message` |

Status is `notDetermined`, `authorized`, `denied`, `restricted`, `writeOnly`, or `unavailable`. A calendar contains `id`, `title`, CSS hexadecimal `color`, account `source` title, and `writable`. An event contains `id`, nullable `externalId`, nullable `occurrenceDate`, `calendarId`, `calendarTitle`, `calendarColor`, `writable`, `title`, ISO `start`/`end`, `allDay`, `location`, `notes`, `url`, and `isRecurring`. Missing `calendarIds` means all calendars; an empty array means none. Requests are limited to a visible period of 370 days.

New events require `calendarId`, `title`, `start`, `end`, and `allDay`. Optional `location`, `notes`, and `url` are only changed when supplied. Existing provider meeting URLs are preserved. All-day end dates remain exclusive, including 23-hour or 25-hour days at daylight-saving boundaries.

Updates additionally send `id`, `externalId`, `occurrenceDate`, `lookupStart` (the event's previous start), and `lookupCalendarId` (its previous calendar). Deletion sends the same identity, using `calendarId` for the current calendar. A recurring `occurrenceDate` is the **full ISO original occurrence timestamp** from EventKit, not the edited start or a date-only string. Updates and deletions always use `.thisEvent`; future instances and the recurrence rule are unchanged. Missing or ambiguous events fail rather than silently editing a series master or a duplicate in another calendar. EventKit can still reject a write when a provider or organizer restricts it.

`EKEventStoreChanged` produces a debounced `{type: "calendarChanged"}` notice with no event details. The frontend then refreshes its visible period. Native objects are not retained as an event cache across requests. External IDs can be duplicated after ICS imports and differ for some Exchange accounts, so links include local IDs and occurrence identity rather than relying on a UID alone. All-day occurrence timestamps follow the device's current timezone, as specified by EventKit.

## Verification

All **24 checks** in `native/CalendarTests/main.swift` passed. They test request validation, timezone/DST handling, and event identity without constructing an EventKit store or accessing personal calendars:

```sh
swiftc -swift-version 5 -framework EventKit native/Shared/DaymarkCalendar.swift native/CalendarTests/main.swift -o /tmp/greenday-calendar-tests
/tmp/greenday-calendar-tests
```

Both native platforms passed minimum-target typechecks. The current Mac app, iPhone/iPad simulator builds, and unsigned device Release archive also built successfully.

On Mac, approved calendar authorization allowed configured calendar events to load, including after renewed consent on the final installed build. This was a read-only check: no personal calendar event was created, edited, or removed. On the iPhone simulator, live checks covered the permission prompt and approval, calendar sources, and the day agenda. A fictional event was created in the simulator's default local calendar and linked to a task. Both detail views showed the link, the task badge appeared once, the duplicate work-day row was hidden, and editing the event title preserved the link. That fictional event remains in the simulator. The event form scrolled above the software keyboard, and Done dismissed it.

The final ad hoc Mac rebuild returned to `notDetermined`; after renewed system consent, its calendar connection loaded successfully. Ad hoc code signatures can change their designated requirement between builds, so development updates may request permission again even with the same bundle ID. Stable Apple signing is still required for distribution; permission databases and system security requirements are not modified by the app or build scripts.

Live unlinking, event deletion, recurring writes, permission refusal, and read-only account restrictions have not been verified. Delivery to remote iCloud/Google accounts and refresh after an external provider edit still require separate tests; a successful local EventKit save is not evidence of provider delivery. Physical-device validation also remains outstanding. See [iOS validation](../docs/IOS-VALIDATION.md) for the complete boundary between build checks and distribution readiness.

## Primary references

- [Apple: Accessing the event store](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)
- [Apple: Migrating to the latest Calendar access levels](https://developer.apple.com/documentation/technotes/tn3152-migrating-to-the-latest-calendar-access-levels)
- [Google: Find Google Calendar events on Apple Calendar](https://support.google.com/calendar/answer/99358)
- [Apple: iPhone calendar account settings](https://support.apple.com/guide/iphone/change-calendar-settings-iphc37be2016/ios)

The installed EventKit SDK headers document `occurrenceDate`, external-ID duplication, and invalidation after store changes. GreenDay retains its existing `app.daymark.*` bundle IDs, internal scheme, and workspace paths when renaming the display to GreenDay. The Mac builder's `--no-install` mode keeps its verified bundle under `~/Library/Caches/GreenDay/Builds`, with `build/GreenDay.app` as a symlink, without changing installed apps. A normal installation points that symlink to the installed app, keeps previous app binaries under `~/Library/Caches/GreenDay/PreviousApps`, and retains the old `Daymark.app` location as a compatibility link. Runnable bundles and previous binaries stay outside the iCloud-managed repository; workspace folders are never renamed.
