import Foundation

// Compile alongside native/Shared/DaymarkStore.swift. This tool never discovers a
// user's workspace: both staged input and destination must be explicit paths.
struct MigrationError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}
func fail(_ message: String) throws -> Never { throw MigrationError(message: message) }
let manager = FileManager.default
let collections = DaymarkStore.collections
let placeholderPrefix = "migration-attachment://"
var recoveryBackupURL: URL?
var workspaceMayHaveChanged = false

func absoluteURL(_ path: String, option: String) throws -> URL {
    guard path.hasPrefix("/") else { try fail("\(option) must be an absolute path") }
    return URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath()
}
func inside(_ child: URL, _ parent: URL) -> Bool {
    child.path == parent.path || child.path.hasPrefix(parent.path + "/")
}
func object(at url: URL) throws -> Any {
    try JSONSerialization.jsonObject(with: Data(contentsOf: url))
}
func output(_ object: Any) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
    FileHandle.standardOutput.write(data + Data("\n".utf8))
}
func timestamp(_ record: [String: Any]) -> String {
    record["updatedAt"] as? String ?? record["createdAt"] as? String ?? ""
}
func prefers(_ candidate: [String: Any], _ old: [String: Any]) throws -> Bool {
    if timestamp(candidate) != timestamp(old) { return timestamp(candidate) > timestamp(old) }
    let deleted = (candidate["deletedAt"] as? String)?.isEmpty == false
    let oldDeleted = (old["deletedAt"] as? String)?.isEmpty == false
    if deleted != oldDeleted { return deleted }
    return try DaymarkStore.json(old).lexicographicallyPrecedes(DaymarkStore.json(candidate))
}

/// Read without initializing DaymarkStore, because dry-run must not create folders.
func readWorkspace(_ folder: URL) throws -> [String: Any] {
    var result: [String: Any] = ["schemaVersion": 1]
    for collection in collections {
        let directory = folder.appendingPathComponent(collection, isDirectory: true)
        var records: [String: [String: Any]] = [:]
        if manager.fileExists(atPath: directory.path) {
            let files = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            for file in files {
                if file.lastPathComponent.hasSuffix(".json.icloud") { try fail("Download \(file.lastPathComponent) from iCloud before migration") }
                guard file.pathExtension == "json" else { continue }
                for version in [file] + (NSFileVersion.unresolvedConflictVersionsOfItem(at: file) ?? []).map(\.url) {
                    guard let record = try object(at: version) as? [String: Any],
                          let id = record["id"] as? String, DaymarkStore.safeFilename(id) else {
                        try fail("Cannot safely read existing record \(version.lastPathComponent)")
                    }
                    if let old = records[id], try !prefers(record, old) { continue }
                    records[id] = record
                }
            }
        }
        result[collection] = records.values.sorted { ($0["id"] as! String) < ($1["id"] as! String) }
    }
    return result
}

func validTimestamp(_ value: Any?) -> Bool {
    guard let value = value as? String else { return false }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if formatter.date(from: value) != nil { return true }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value) != nil
}
func validDay(_ value: Any?) -> Bool {
    guard let value = value as? String, value.utf8.count == 10,
          value.range(of: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", options: .regularExpression) != nil else { return false }
    let parts = value.split(separator: "-").compactMap { Int($0) }
    guard parts.count == 3, parts[0] >= 1, (1...12).contains(parts[1]) else { return false }
    let year = parts[0]
    let leapYear = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
    let days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    return (1...days[parts[1] - 1]).contains(parts[2])
}
func validateState(_ object: Any) throws -> [String: Any] {
    guard let state = object as? [String: Any], state["schemaVersion"] as? Int == 1 else {
        try fail("Staged state must be a schemaVersion 1 workspace")
    }
    var result = state
    for collection in collections {
        let values: [[String: Any]]
        if collection == "tags", state[collection] == nil { values = [] }
        else if let records = state[collection] as? [[String: Any]] { values = records }
        else { try fail("Staged \(collection) must be an array of records") }
        var ids = Set<String>()
        for record in values {
            guard let id = record["id"] as? String, DaymarkStore.safeFilename(id), ids.insert(id).inserted else {
                try fail("Staged \(collection) contains an unsafe, missing, or duplicate id")
            }
            guard validTimestamp(record["updatedAt"]) else { try fail("\(collection)/\(id) needs a valid updatedAt") }
            if let deleted = record["deletedAt"], !(deleted is NSNull), !validTimestamp(deleted) {
                try fail("\(collection)/\(id) has an invalid deletedAt")
            }
            if collection == "tasks" {
                guard record["title"] is String, record["projectId"] is String, record["columnId"] is String,
                      validTimestamp(record["createdAt"]), let note = record["notes"] as? [String: Any], note["type"] as? String == "doc",
                      let attachments = record["attachments"] as? [[String: Any]] else {
                    try fail("Task \(id) must include title, notes, list, column, createdAt, and attachments")
                }
                if let value = record["tagIds"] {
                    guard let tagIds = value as? [String], tagIds.allSatisfy(DaymarkStore.safeFilename) else {
                        try fail("Task \(id) tagIds must be an array of valid ids")
                    }
                }
                for field in ["doDate", "deadline"] {
                    guard let value = record[field] else { try fail("Task \(id) needs \(field)") }
                    if value is NSNull { continue }
                    guard validDay(value) else { try fail("Task \(id) has invalid \(field)") }
                }
                // Old backups omit this field. When present, its independent
                // dates are authoritative; doDate is only a legacy alias.
                if let value = record["doDates"] {
                    guard let dates = value as? [String], dates.allSatisfy({ validDay($0) }),
                          dates == dates.sorted(), Set(dates).count == dates.count else {
                        try fail("Task \(id) doDates must be an array of sorted, unique valid dates")
                    }
                }
                if let completed = record["completedAt"], !(completed is NSNull), !validTimestamp(completed) {
                    try fail("Task \(id) has invalid completedAt")
                }
                for attachment in attachments {
                    guard attachment["id"] is String, attachment["name"] is String, attachment["mime"] is String,
                          let size = attachment["size"] as? NSNumber, size.int64Value >= 0,
                          attachment["url"] is String else { try fail("Task \(id) has malformed attachment metadata") }
                }
            } else {
                guard let name = record["name"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      record["color"] is String else { try fail("\(collection)/\(id) needs name and color") }
                if collection == "tags", let value = record["group"] {
                    guard let group = value as? String, ["area", "action", "topic"].contains(group) else { try fail("Tag \(id) has an unknown group") }
                }
            }
        }
        result[collection] = values
    }
    return result
}

func placeholders(in value: Any) -> Set<String> {
    if let string = value as? String, string.hasPrefix(placeholderPrefix) { return [String(string.dropFirst(placeholderPrefix.count))] }
    if let values = value as? [Any] { return values.reduce(into: Set<String>()) { $0.formUnion(placeholders(in: $1)) } }
    if let object = value as? [String: Any] { return object.values.reduce(into: Set<String>()) { $0.formUnion(placeholders(in: $1)) } }
    return []
}
func replacePlaceholders(_ value: Any, attachments: [String: [String: Any]]) -> Any {
    if let string = value as? String, string.hasPrefix(placeholderPrefix), let attachment = attachments[String(string.dropFirst(placeholderPrefix.count))] {
        return attachment["url"]!
    }
    if let values = value as? [Any] { return values.map { replacePlaceholders($0, attachments: attachments) } }
    if let object = value as? [String: Any] {
        var result = object.mapValues { replacePlaceholders($0, attachments: attachments) }
        if let url = object["url"] as? String, url.hasPrefix(placeholderPrefix), object["id"] != nil, object["mime"] != nil,
           let actual = attachments[String(url.dropFirst(placeholderPrefix.count))] {
            // Keep the imported attachment's stable id/name, but record the bytes
            // and local URL actually stored by Daymark (the source path can be temporary).
            result["mime"] = actual["mime"]
            result["size"] = actual["size"]
        }
        return result
    }
    return value
}

func readManifest(_ url: URL?) throws -> [String: URL] {
    guard let url else { return [:] }
    guard let values = try object(at: url) as? [[String: String]] else { try fail("Attachment manifest must be [{id,path}]") }
    var result: [String: URL] = [:]
    for value in values {
        guard let id = value["id"], !id.isEmpty, id.range(of: "^[A-Za-z0-9_.-]+$", options: .regularExpression) != nil,
              let path = value["path"], result[id] == nil else { try fail("Attachment manifest has a missing, invalid, or duplicate id/path") }
        result[id] = try absoluteURL(path, option: "Attachment path")
    }
    return result
}

func backup(_ folder: URL, in parent: URL) throws -> URL {
    guard !inside(parent, folder) else { try fail("Backup directory must be outside the workspace") }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
    let name = "Daymark-before-migration-" + formatter.string(from: Date())
    var destination = parent.appendingPathComponent(name, isDirectory: true)
    if manager.fileExists(atPath: destination.path) { destination = parent.appendingPathComponent(name + "-" + UUID().uuidString.prefix(8), isDirectory: true) }
    try manager.createDirectory(at: parent, withIntermediateDirectories: true)
    if manager.fileExists(atPath: folder.path) { try manager.copyItem(at: folder, to: destination) }
    else { try manager.createDirectory(at: destination, withIntermediateDirectories: true) }
    return destination
}

func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments.contains("--help") {
        try output(["usage": "migration --folder /workspace --state /staged.json [--attachments /manifest.json] [--apply --backup /backup-directory] | --folder /workspace --export", "default": "Dry-run validation; record IDs come from staged state and are never regenerated. Existing IDs are never overwritten. --backup creates a fresh timestamped child outside the workspace."])
        return
    }
    var options: [String: String] = [:]
    var apply = false
    var exporting = false
    var index = 0
    while index < arguments.count {
        let key = arguments[index]
        if key == "--apply" { apply = true; index += 1; continue }
        if key == "--export" { exporting = true; index += 1; continue }
        guard ["--folder", "--state", "--attachments", "--backup"].contains(key), options[key] == nil,
              index + 1 < arguments.count, !arguments[index + 1].hasPrefix("--") else { try fail("Unknown, repeated, or missing argument: \(key)") }
        options[key] = arguments[index + 1]
        index += 2
    }
    guard let path = options["--folder"] else { try fail("--folder is required") }
    let folder = try absoluteURL(path, option: "--folder")
    var isDirectory: ObjCBool = false
    if manager.fileExists(atPath: folder.path, isDirectory: &isDirectory), !isDirectory.boolValue { try fail("--folder must name a directory") }
    guard folder.path != "/" else { try fail("The filesystem root cannot be a workspace") }
    let existing = try readWorkspace(folder)
    if exporting {
        guard !apply, options["--state"] == nil, options["--attachments"] == nil else { try fail("--export cannot be combined with migration inputs or --apply") }
        try output(existing)
        return
    }
    guard let inputPath = options["--state"] else { try fail("--state is required") }
    let staged = try validateState(object(at: absoluteURL(inputPath, option: "--state")))
    let manifest = try readManifest(options["--attachments"].map { try absoluteURL($0, option: "--attachments") })
    var additions: [String: Any] = ["schemaVersion": 1]
    var counts: [String: Any] = [:]
    for collection in collections {
        let current = Dictionary(uniqueKeysWithValues: (existing[collection] as! [[String: Any]]).map { ($0["id"] as! String, $0) })
        var new: [[String: Any]] = []
        var unchanged: [String] = []
        var skipped: [String] = []
        for record in staged[collection] as! [[String: Any]] {
            let id = record["id"] as! String
            if let old = current[id] {
                if try DaymarkStore.json(record) == DaymarkStore.json(old) { unchanged.append(id) }
                else { skipped.append(id) }
            } else { new.append(record) }
        }
        additions[collection] = new
        counts[collection] = ["add": new.count, "unchanged": unchanged.count, "unchangedIds": unchanged.sorted(), "skippedExisting": skipped.count, "skippedExistingIds": skipped.sorted()]
    }
    let needed = placeholders(in: additions).sorted()
    for id in needed {
        guard let source = manifest[id] else { try fail("No attachment source for \(placeholderPrefix)\(id)") }
        let values = try source.resourceValues(forKeys: [.isRegularFileKey, .isReadableKey])
        guard values.isRegularFile == true, values.isReadable == true else { try fail("Attachment source is not a readable file: \(source.path)") }
    }
    var summary: [String: Any] = ["mode": apply ? "apply" : "dry-run", "folder": folder.path, "records": counts, "attachmentsToAdd": needed.count, "preservesExistingRecords": true]
    if apply {
        guard let backupPath = options["--backup"] else { try fail("--apply requires --backup outside the workspace") }
        let backupURL = try backup(folder, in: absoluteURL(backupPath, option: "--backup"))
        summary["backupPath"] = backupURL.path
        recoveryBackupURL = backupURL
        workspaceMayHaveChanged = true
        let store = try DaymarkStore(folder: folder)
        // Recheck after backup. A new record appearing during preparation is never overwritten.
        let current = try store.load()
        for collection in collections {
            let ids = Set((current?[collection] as? [[String: Any]] ?? []).compactMap { $0["id"] as? String })
            if (additions[collection] as! [[String: Any]]).contains(where: { ids.contains($0["id"] as! String) }) {
                try fail("Workspace changed during preparation; retry the dry-run with the app closed. Backup: \(backupURL.path)")
            }
        }
        var imported: [String: [String: Any]] = [:]
        for id in needed { imported[id] = try store.addAttachment(manifest[id]!) }
        let resolved = replacePlaceholders(additions, attachments: imported) as! [String: Any]
        guard placeholders(in: resolved).isEmpty else { try fail("Unresolved attachment placeholders remain") }
        _ = try store.save(resolved)
        summary["attachmentsAdded"] = imported.count
    }
    try output(summary)
}

do { try run() }
catch {
    var failure: [String: Any] = ["error": error.localizedDescription, "workspaceMayHaveChanged": workspaceMayHaveChanged]
    if let recoveryBackupURL { failure["backupPath"] = recoveryBackupURL.path }
    if let data = try? JSONSerialization.data(withJSONObject: failure, options: [.sortedKeys, .withoutEscapingSlashes]) {
        FileHandle.standardError.write(data + Data("\n".utf8))
    }
    exit(1)
}
