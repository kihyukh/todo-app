import Foundation
import EventKit
import CoreGraphics

/// EventKit owns account credentials and synchronization. This bridge never reads
/// calendar data before consent and never writes except for an explicit web action.
final class DaymarkCalendar {
    typealias Reply = (Result<[String: Any], Error>) -> Void
    private let queue = DispatchQueue(label: "app.daymark.calendar", qos: .userInitiated)
    private lazy var eventStore = EKEventStore()
    private var observer: NSObjectProtocol?
    private var changedWork: DispatchWorkItem?
    var onChange: (() -> Void)?

    init() {
        observer = NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: nil, queue: nil) { [weak self] _ in
            guard let self else { return }
            self.queue.async {
                guard Self.authorization == "authorized" else { return }
                self.changedWork?.cancel()
                let work = DispatchWorkItem { [weak self] in DispatchQueue.main.async { self?.onChange?() } }
                self.changedWork = work
                self.queue.asyncAfter(deadline: .now() + 0.25, execute: work)
            }
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        changedWork?.cancel()
    }

    static var authorization: String {
        let status = EKEventStore.authorizationStatus(for: .event)
        switch status {
        case .notDetermined: return "notDetermined"
        case .denied: return "denied"
        case .restricted: return "restricted"
        default:
            if #available(macOS 14.0, iOS 17.0, *) {
                if status == .fullAccess { return "authorized" }
                if status == .writeOnly { return "writeOnly" }
            } else if status == .authorized { return "authorized" }
            return "unavailable"
        }
    }

    func handle(_ action: String, body: [String: Any], completion: @escaping Reply) {
        let reply: Reply = { result in DispatchQueue.main.async { completion(result) } }
        queue.async { [self] in
            do {
                if action == "calendarConnect" {
                    connect(reply)
                    return
                }
                if action == "calendarStatus" {
                    reply(.success(statusPayload()))
                    return
                }
                guard Self.authorization == "authorized" else {
                    throw CalendarError("Connect Calendar and allow full calendar access in your device’s privacy settings.")
                }
                switch action {
                case "calendarEvents": reply(.success(try events(body)))
                case "calendarSave": reply(.success(try save(body)))
                case "calendarDelete": reply(.success(try delete(body)))
                default: throw CalendarError("Unknown calendar action.")
                }
            } catch { reply(.failure(error)) }
        }
    }

    private func connect(_ reply: @escaping Reply) {
        guard ["notDetermined", "writeOnly"].contains(Self.authorization) else {
            reply(.success(statusPayload()))
            return
        }
        let received: (Bool, Error?) -> Void = { [weak self] _, error in
            guard let self else { return }
            self.queue.async {
                if let error { reply(.failure(error)) }
                else { reply(.success(self.statusPayload())) }
            }
        }
        if #available(macOS 14.0, iOS 17.0, *) {
            eventStore.requestFullAccessToEvents(completion: received)
        } else {
            eventStore.requestAccess(to: .event, completion: received)
        }
    }

    private func statusPayload() -> [String: Any] {
        let status = Self.authorization
        return ["type": "calendarStatus", "status": status,
                "calendars": status == "authorized" ? calendarPayloads() : [],
                "defaultCalendarId": status == "authorized" ? (eventStore.defaultCalendarForNewEvents?.calendarIdentifier as Any? ?? NSNull()) : NSNull()]
    }

    private func calendarPayloads() -> [[String: Any]] {
        eventStore.calendars(for: .event).sorted {
            let left = "\($0.source.title) \($0.title)", right = "\($1.source.title) \($1.title)"
            return left.localizedStandardCompare(right) == .orderedAscending
        }.map {
            ["id": $0.calendarIdentifier, "title": $0.title,
             "color": Self.color($0.cgColor), "source": $0.source.title,
             "writable": $0.allowsContentModifications]
        }
    }

    private func events(_ body: [String: Any]) throws -> [String: Any] {
        let (start, end) = try Self.interval(body)
        let all = eventStore.calendars(for: .event)
        let calendars: [EKCalendar]
        if let requested = body["calendarIds"] {
            guard let ids = requested as? [String] else { throw CalendarError("Choose valid calendars to display.") }
            let allowed = Set(ids)
            calendars = all.filter { allowed.contains($0.calendarIdentifier) }
        } else { calendars = all }
        let records = calendars.isEmpty ? [] : eventStore.events(matching: eventStore.predicateForEvents(withStart: start, end: end, calendars: calendars))
        return ["type": "calendarEvents", "start": Self.iso(start), "end": Self.iso(end),
                "calendars": calendarPayloads(),
                "events": records.sorted { $0.startDate < $1.startDate }.map(Self.eventPayload)]
    }

    private func save(_ body: [String: Any]) throws -> [String: Any] {
        guard let fields = body["event"] as? [String: Any] else { throw CalendarError("The event details are missing.") }
        let draft = try EventDraft(fields)
        let existing = fields["id"] as? String
        let event = try existing.map { _ in try findEvent(fields, calendarField: "lookupCalendarId") } ?? EKEvent(eventStore: eventStore)
        if existing != nil && !event.calendar.allowsContentModifications { throw CalendarError("This calendar is read-only. Choose a writable calendar for a new event.") }
        guard let calendar = eventStore.calendar(withIdentifier: draft.calendarID), calendar.allowedEntityTypes.contains(.event), calendar.allowsContentModifications else {
            throw CalendarError("The selected calendar is unavailable or read-only. Choose another calendar.")
        }
        event.calendar = calendar
        event.title = draft.title
        event.startDate = draft.start
        event.endDate = draft.end
        event.isAllDay = draft.allDay
        if draft.allDay { event.timeZone = nil }
        else if existing == nil { event.timeZone = .current }
        if fields.keys.contains("location") { event.location = draft.location }
        if fields.keys.contains("notes") { event.notes = draft.notes }
        if fields.keys.contains("url") { event.url = draft.url }
        do {
            // Editing an occurrence never changes its future siblings or recurrence rule.
            try eventStore.save(event, span: .thisEvent, commit: true)
            return ["type": "calendarSaved", "event": Self.eventPayload(event)]
        } catch {
            eventStore.reset()
            throw error
        }
    }

    private func delete(_ body: [String: Any]) throws -> [String: Any] {
        let event = try findEvent(body, calendarField: "calendarId")
        guard event.calendar.allowsContentModifications else { throw CalendarError("This calendar is read-only.") }
        let id = event.eventIdentifier ?? ""
        let occurrence = Self.occurrence(event).map(Self.iso) as Any? ?? NSNull()
        do {
            try eventStore.remove(event, span: .thisEvent, commit: true)
            return ["type": "calendarDeleted", "id": id, "occurrenceDate": occurrence]
        } catch {
            eventStore.reset()
            throw error
        }
    }

    private func findEvent(_ fields: [String: Any], calendarField: String) throws -> EKEvent {
        let identity = try EventIdentity(fields, calendarField: calendarField)
        let direct = eventStore.event(withIdentifier: identity.id)
        if let direct, identity.matches(Self.identity(direct), requireCalendar: false) { return direct }
        // Never use the series master as a substitute for a requested occurrence.
        var candidates: [EKEvent] = []
        if let externalID = identity.externalID {
            candidates += eventStore.calendarItems(withExternalIdentifier: externalID).compactMap { $0 as? EKEvent }
        }
        let searchDates = [identity.occurrenceDate, try Self.optionalDate(fields["lookupStart"])].compactMap { $0 }
        let calendars = identity.calendarID.flatMap { eventStore.calendar(withIdentifier: $0) }.map { [$0] }
        for date in searchDates {
            candidates += eventStore.events(matching: eventStore.predicateForEvents(withStart: date.addingTimeInterval(-36 * 3600), end: date.addingTimeInterval(36 * 3600), calendars: calendars))
        }
        let matches = candidates.filter { identity.matches(Self.identity($0), requireCalendar: true) }
        let unique = Dictionary(grouping: matches) {
            "\($0.calendar.calendarIdentifier)|\($0.eventIdentifier ?? "")|\(Self.occurrence($0).map(Self.iso) ?? "")"
        }.values.compactMap { $0.first }
        guard unique.count == 1, let event = unique.first else {
            throw CalendarError(unique.count > 1 ? "More than one calendar event matches this link. Open the intended event in Calendar and try again." : "This event or occurrence changed or was removed. Refresh the calendar and choose it again.")
        }
        return event
    }

    private static func identity(_ event: EKEvent) -> EventIdentity {
        EventIdentity(id: event.eventIdentifier ?? "", externalID: event.calendarItemExternalIdentifier,
                      calendarID: event.calendar.calendarIdentifier, occurrenceDate: occurrence(event))
    }

    private static func occurrence(_ event: EKEvent) -> Date? {
        (event.hasRecurrenceRules || event.isDetached) ? event.occurrenceDate : nil
    }

    private static func eventPayload(_ event: EKEvent) -> [String: Any] {
        let occurrence = occurrence(event)
        return ["id": event.eventIdentifier ?? "", "externalId": event.calendarItemExternalIdentifier as Any? ?? NSNull(),
                "occurrenceDate": occurrence.map(iso) as Any? ?? NSNull(),
                "calendarId": event.calendar.calendarIdentifier, "calendarTitle": event.calendar.title,
                "calendarColor": color(event.calendar.cgColor), "writable": event.calendar.allowsContentModifications,
                "title": event.title ?? "", "start": iso(event.startDate), "end": iso(event.endDate),
                "allDay": event.isAllDay, "location": event.location ?? "", "notes": event.notes ?? "",
                "url": event.url?.absoluteString ?? "", "isRecurring": occurrence != nil]
    }

    private static func color(_ value: CGColor?) -> String {
        guard let value, let rgb = value.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil), let parts = rgb.components, parts.count >= 3 else { return "#26734D" }
        return String(format: "#%02X%02X%02X", Int(round(parts[0] * 255)), Int(round(parts[1] * 255)), Int(round(parts[2] * 255)))
    }

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func optionalDate(_ value: Any?) throws -> Date? {
        if value == nil || value is NSNull { return nil }
        guard let value = value as? String, value.contains("T") else { throw CalendarError("Use a complete date and time for the calendar event.") }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: value) else { throw CalendarError("The calendar date or time is invalid.") }
        return date
    }

    static func interval(_ fields: [String: Any]) throws -> (Date, Date) {
        guard let start = try optionalDate(fields["start"]), let end = try optionalDate(fields["end"]), end > start else { throw CalendarError("The calendar’s end must be after its start.") }
        guard end.timeIntervalSince(start) <= 370 * 24 * 3600 else { throw CalendarError("Choose a calendar period of one year or less.") }
        return (start, end)
    }

    struct EventDraft {
        let title: String
        let start: Date
        let end: Date
        let allDay: Bool
        let calendarID: String
        let location: String?
        let notes: String?
        let url: URL?
        init(_ fields: [String: Any]) throws {
            guard let rawTitle = fields["title"] as? String, !rawTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw CalendarError("Give the event a title.") }
            guard let calendarID = fields["calendarId"] as? String, !calendarID.isEmpty else { throw CalendarError("Choose a calendar for the event.") }
            guard let start = try DaymarkCalendar.optionalDate(fields["start"]), let end = try DaymarkCalendar.optionalDate(fields["end"]), end > start else { throw CalendarError("The event’s end must be after its start.") }
            guard let allDay = fields["allDay"] as? Bool else { throw CalendarError("Choose whether this is an all-day event.") }
            let location = fields["location"] as? String, notes = fields["notes"] as? String
            let rawURL = (fields["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !rawURL.isEmpty {
                guard let url = URL(string: rawURL), let scheme = url.scheme?.lowercased(), !["javascript", "vbscript", "data", "file"].contains(scheme), scheme != "daymark" || url.host == "task" else { throw CalendarError("Use a web, meeting, or task link for the event URL.") }
                self.url = url
            } else { self.url = nil }
            self.title = rawTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            self.start = start; self.end = end; self.allDay = allDay; self.calendarID = calendarID
            self.location = location; self.notes = notes
        }
    }

    struct EventIdentity {
        let id: String
        let externalID: String?
        let calendarID: String?
        let occurrenceDate: Date?
        init(id: String, externalID: String?, calendarID: String?, occurrenceDate: Date?) {
            self.id = id; self.externalID = externalID; self.calendarID = calendarID; self.occurrenceDate = occurrenceDate
        }
        init(_ fields: [String: Any], calendarField: String) throws {
            guard let id = fields["id"] as? String, !id.isEmpty else { throw CalendarError("Choose the calendar event to change.") }
            self.id = id
            self.externalID = fields["externalId"] as? String
            self.calendarID = fields[calendarField] as? String
            self.occurrenceDate = try DaymarkCalendar.optionalDate(fields["occurrenceDate"])
        }
        func matches(_ other: EventIdentity, requireCalendar: Bool) -> Bool {
            guard id == other.id || (externalID != nil && externalID == other.externalID) else { return false }
            if let externalID, let otherExternal = other.externalID, externalID != otherExternal { return false }
            if requireCalendar, let calendarID, calendarID != other.calendarID { return false }
            switch (occurrenceDate, other.occurrenceDate) {
            case (nil, nil): return true
            case (.some(let left), .some(let right)): return abs(left.timeIntervalSince(right)) < 1
            default: return false
            }
        }
    }
}

struct CalendarError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}
