import Foundation

// Pure request/identity checks. No EKEventStore is created and no calendar
// permission is requested, so this suite cannot change personal calendars.
var checks = 0
func check(_ value: Bool, _ message: String) {
    checks += 1
    if !value { fatalError(message) }
}
func rejects(_ message: String, _ action: () throws -> Void) {
    checks += 1
    do { try action(); fatalError(message) } catch { }
}

let stamp = try DaymarkCalendar.optionalDate("2026-09-14T09:30:00+09:00")!
check(DaymarkCalendar.iso(stamp) == "2026-09-14T00:30:00.000Z", "Offsets must represent the same instant")
check(try DaymarkCalendar.optionalDate("2026-09-14T00:30:00.000Z") == stamp, "Fractional timestamps must round trip")
check(try DaymarkCalendar.optionalDate(NSNull()) == nil, "Null occurrence means nonrecurring")
rejects("Date-only values must not silently shift timezones") { _ = try DaymarkCalendar.optionalDate("2026-09-14") }
rejects("Invalid timestamps must fail") { _ = try DaymarkCalendar.optionalDate("not-a-dateT25") }
let interval = try DaymarkCalendar.interval(["start": "2026-09-01T00:00:00Z", "end": "2026-10-01T00:00:00Z"])
check(interval.1.timeIntervalSince(interval.0) == 30 * 24 * 3600, "Visible ranges preserve an exclusive end")
rejects("Reversed ranges must fail") { _ = try DaymarkCalendar.interval(["start": "2026-10-01T00:00:00Z", "end": "2026-09-01T00:00:00Z"]) }
rejects("Unbounded calendar reads must fail") { _ = try DaymarkCalendar.interval(["start": "2026-01-01T00:00:00Z", "end": "2030-01-01T00:00:00Z"]) }

var fields: [String: Any] = ["title": "  Research review  ", "calendarId": "work", "start": "2026-09-14T09:00:00+09:00", "end": "2026-09-14T10:00:00+09:00", "allDay": false, "location": "Office", "notes": "Keep original notes", "url": "https://example.com/paper"]
let draft = try DaymarkCalendar.EventDraft(fields)
check(draft.title == "Research review", "Trim the event title")
check(draft.calendarID == "work" && draft.location == "Office" && draft.notes == "Keep original notes", "Preserve explicit event fields")
check(draft.end.timeIntervalSince(draft.start) == 3600, "Preserve event duration")
fields["end"] = fields["start"]
rejects("Zero-duration events must fail before touching EventKit") { _ = try DaymarkCalendar.EventDraft(fields) }
fields["end"] = "2026-09-14T10:00:00+09:00"
fields["url"] = "javascript:alert(1)"
rejects("Executable event URLs must fail") { _ = try DaymarkCalendar.EventDraft(fields) }
fields["url"] = "daymark://attachment/private.pdf"
rejects("Workspace attachment URLs must not become calendar links") { _ = try DaymarkCalendar.EventDraft(fields) }
fields["url"] = NSNull()
check(try DaymarkCalendar.EventDraft(fields).url == nil, "An explicit empty URL removes only the URL")
fields["url"] = "zoommtg://zoom.us/join?confno=123"
check(try DaymarkCalendar.EventDraft(fields).url?.scheme == "zoommtg", "Editing an existing meeting must preserve its provider URL")
let allDay = try DaymarkCalendar.EventDraft(["title": "Spring day", "calendarId": "home", "start": "2026-03-08T00:00:00-08:00", "end": "2026-03-09T00:00:00-07:00", "allDay": true])
check(allDay.allDay && allDay.end.timeIntervalSince(allDay.start) == 23 * 3600, "All-day exclusive ends must survive daylight-saving transitions")

typealias Identity = DaymarkCalendar.EventIdentity
let occurrence = try DaymarkCalendar.optionalDate("2026-09-14T00:30:00.000Z")!
let linked = Identity(id: "old-device-id", externalID: "server-uid", calendarID: "work", occurrenceDate: occurrence)
let synced = Identity(id: "new-device-id", externalID: "server-uid", calendarID: "work", occurrenceDate: occurrence)
check(linked.matches(synced, requireCalendar: true), "External ID resolves an occurrence when a local ID changes")
check(!linked.matches(Identity(id: "new-device-id", externalID: "server-uid", calendarID: "work", occurrenceDate: occurrence.addingTimeInterval(7 * 24 * 3600)), requireCalendar: true), "Never substitute the next occurrence")
check(!linked.matches(Identity(id: "copy", externalID: "server-uid", calendarID: "personal", occurrenceDate: occurrence), requireCalendar: true), "Duplicate ICS copies in another calendar are not the linked event")
check(!linked.matches(Identity(id: "old-device-id", externalID: "server-uid", calendarID: "work", occurrenceDate: nil), requireCalendar: true), "Never substitute a series master or a nonrecurring event")
check(!linked.matches(Identity(id: "old-device-id", externalID: "different-uid", calendarID: "work", occurrenceDate: occurrence), requireCalendar: true), "Conflicting external identity must fail closed")
let movedRequest = try Identity(["id": "old-device-id", "externalId": "server-uid", "calendarId": "destination", "lookupCalendarId": "work", "occurrenceDate": "2026-09-14T00:30:00.000Z"], calendarField: "lookupCalendarId")
check(movedRequest.calendarID == "work" && movedRequest.matches(synced, requireCalendar: true), "Calendar moves must look up the original calendar before applying the destination")
rejects("Mutations must specify an existing event ID") { _ = try Identity(["externalId": "server-uid"], calendarField: "calendarId") }
print("GreenDay calendar: \(checks) validation, timezone, occurrence, and safe identity checks passed; no EventKit store or personal calendars accessed.")
