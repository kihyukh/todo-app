import Foundation
import CryptoKit

/// One file per record lets iCloud Drive reconcile changes to different tasks independently.
/// updatedAt resolves edits to the same record; prior versions remain in Revisions.
final class DaymarkStore {
    static let collections = ["tasks", "projects", "columns", "tags"]
    static let maximumImportedAttachmentBytes = 25 * 1024 * 1024
    private var folderURL: URL
    private var storageKind: String
    private let queue = DispatchQueue(label: "app.daymark.storage", qos: .utility)
    private let queueKey = DispatchSpecificKey<Bool>()
    var folder: URL { serialized { folderURL } }
    var kind: String { serialized { storageKind } }
    private var scopedURL: URL?
    private let manager = FileManager.default
    private let bookmarkKey = "DaymarkStorageBookmark"
    private let preferences: UserDefaults
    private let sandboxedMac: Bool
    private var reconnectRequired = false

    static var isSandboxedMac: Bool {
        #if os(macOS)
        return Bundle.main.object(forInfoDictionaryKey: "DaymarkAppSandbox") as? Bool == true
        #else
        return false
        #endif
    }

    /// Injected preferences/defaults keep storage tests away from a real workspace.
    init(folder explicitFolder: URL? = nil, preferences: UserDefaults = .standard,
         sandboxedMac: Bool = DaymarkStore.isSandboxedMac, defaultFolder: URL? = nil) throws {
        self.preferences = preferences
        self.sandboxedMac = sandboxedMac
        let fallback = { defaultFolder.map { ($0, "local") } ?? Self.defaultLocation(sandboxedMac: sandboxedMac) }
        let initial = explicitFolder.map { ($0, "folder") } ?? fallback()
        folderURL = initial.0
        storageKind = initial.1
        queue.setSpecific(key: queueKey, value: true)
        if explicitFolder == nil, let data = preferences.data(forKey: bookmarkKey) {
            var accessed: URL?
            do {
                var stale = false
                #if os(macOS)
                let options: URL.BookmarkResolutionOptions = [.withSecurityScope, .withoutUI]
                #else
                let options: URL.BookmarkResolutionOptions = [.withoutUI]
                #endif
                let selected = try URL(resolvingBookmarkData: data, options: options, relativeTo: nil, bookmarkDataIsStale: &stale)
                if selected.startAccessingSecurityScopedResource() { accessed = selected }
                // A missing provider folder must not silently become an empty new workspace.
                var directory: ObjCBool = false
                guard manager.fileExists(atPath: selected.path, isDirectory: &directory), directory.boolValue else {
                    throw CocoaError(.fileReadNoSuchFile)
                }
                folderURL = selected
                storageKind = "folder"
                try prepareFolder()
                scopedURL = accessed
                if stale, let renewed = try? Self.bookmark(for: selected) {
                    preferences.set(renewed, forKey: bookmarkKey)
                }
                return
            } catch {
                accessed?.stopAccessingSecurityScopedResource()
                let location = fallback()
                folderURL = location.0
                storageKind = location.1
                // Keep the original bookmark so choosing local storage never erases
                // the route back to a temporarily unavailable existing workspace.
                reconnectRequired = true
            }
        }
        try prepareFolder()
    }

    private static func bookmark(for url: URL) throws -> Data {
        #if os(macOS)
        let options: URL.BookmarkCreationOptions = [.withSecurityScope]
        #else
        let options: URL.BookmarkCreationOptions = [.minimalBookmark]
        #endif
        return try url.bookmarkData(options: options, includingResourceValuesForKeys: nil, relativeTo: nil)
    }

    deinit { scopedURL?.stopAccessingSecurityScopedResource() }

    /// All store access shares one queue, including folder switches and attachment reads.
    /// The UI calls perform so file-provider coordination never blocks keystrokes.
    func perform<Value>(_ operation: @escaping () throws -> Value, completion: @escaping (Result<Value, Error>) -> Void) {
        queue.async {
            let result = Result { try operation() }
            DispatchQueue.main.async { completion(result) }
        }
    }

    private func serialized<Value>(_ operation: () throws -> Value) rethrows -> Value {
        if DispatchQueue.getSpecific(key: queueKey) == true { return try operation() }
        return try queue.sync(execute: operation)
    }

    /// Sandboxed builds never probe the development app's unrestricted iCloud path.
    static func macDefaultLocation(sandboxed: Bool, home: URL, support: URL,
                                   cloudExists: (URL) -> Bool) -> (URL, String) {
        if !sandboxed {
            let cloud = home.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
            if cloudExists(cloud) { return (cloud.appendingPathComponent("Daymark", isDirectory: true), "icloud") }
        }
        return (support.appendingPathComponent("Daymark", isDirectory: true), "local")
    }

    private static func defaultLocation(sandboxedMac: Bool) -> (URL, String) {
        #if os(macOS)
        return macDefaultLocation(sandboxed: sandboxedMac,
                                  home: FileManager.default.homeDirectoryForCurrentUser,
                                  support: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!) {
            FileManager.default.fileExists(atPath: $0.path)
        }
        #else
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return (documents.appendingPathComponent("Daymark", isDirectory: true), "local")
        #endif
    }

    var storageInfo: [String: Any] {
        serialized {
            let message: String
            switch kind {
            case "icloud": message = "Saved in iCloud Drive. iCloud transfers changes between your devices."
            case "folder": message = "Saved in your selected folder. Select this same Daymark folder on your other devices."
            default: message = "Saved on this device. Choose a folder in iCloud Drive to sync between devices."
            }
            var info: [String: Any] = ["kind": kind, "path": folder.path, "message": message]
            if sandboxedMac {
                info["sandboxed"] = true
                info["needsFolderSelection"] = kind == "local"
            }
            if reconnectRequired {
                info["reconnectRequired"] = true
                info["message"] = "Your previous workspace could not be opened. Its files have not been moved or deleted. Choose that folder again to reconnect; new changes are saved separately on this device."
            }
            return info
        }
    }

    private func prepareFolder() throws {
        for name in Self.collections + ["Attachments", "Revisions"] {
            try manager.createDirectory(at: folder.appendingPathComponent(name, isDirectory: true), withIntermediateDirectories: true)
        }
    }

    /// Copy into the selected workspace without deleting or renaming the old one.
    func chooseFolder(_ url: URL) throws {
        try serialized {
            let current = try load(strict: true)
            let oldFolder = folder
            let oldKind = kind
            let access = url.startAccessingSecurityScopedResource()
            let oldScope = scopedURL
            folderURL = url
            storageKind = "folder"
            do {
                // Obtain the persistent grant and verify both workspaces before
                // merging records. A failed selection keeps the old grant intact.
                let bookmark = try Self.bookmark(for: url)
                try prepareFolder()
                _ = try load(strict: true)
                let oldAttachments = oldFolder.appendingPathComponent("Attachments")
                let sources = try manager.contentsOfDirectory(at: oldAttachments, includingPropertiesForKeys: nil)
                var copies: [(URL, URL)] = []
                if oldFolder.standardizedFileURL != url.standardizedFileURL {
                    for source in sources {
                        let data = try coordinatedRead(source)
                        let target = folder.appendingPathComponent("Attachments").appendingPathComponent(source.lastPathComponent)
                        if manager.fileExists(atPath: target.path) {
                            guard try coordinatedRead(target) == data else {
                                throw Self.attachmentNameConflict
                            }
                        } else { copies.append((source, target)) }
                    }
                }
                // Keep memory bounded to one file, including workspaces with many PDFs.
                for (source, target) in copies {
                    try coordinatedWrite(try coordinatedRead(source), to: target, replacingExisting: false)
                }
                if let current { _ = try save(current) }
                preferences.set(bookmark, forKey: bookmarkKey)
                oldScope?.stopAccessingSecurityScopedResource()
                scopedURL = access ? url : nil
                reconnectRequired = false
            } catch {
                folderURL = oldFolder
                storageKind = oldKind
                if access { url.stopAccessingSecurityScopedResource() }
                throw error
            }
        }
    }

    func load(strict: Bool = false) throws -> [String: Any]? {
        try serialized {
            var result: [String: Any] = ["schemaVersion": 1]
            var count = 0
            for collection in Self.collections {
                let records = try readRecords(collection, strict: strict)
                result[collection] = records.values.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
                count += records.count
            }
            return count == 0 ? nil : result
        }
    }

    @discardableResult
    func save(_ state: [String: Any]) throws -> [String: Any]? {
        try serialized {
            for collection in Self.collections {
                let incoming = state[collection] as? [[String: Any]] ?? []
                // Never overwrite an existing record whose current contents are unavailable.
                // iCloud placeholders and malformed files must be resolved before this save.
                var current = try readRecords(collection, strict: true)
                for record in incoming {
                    guard let id = record["id"] as? String, Self.safeFilename(id) else { continue }
                    let data = try Self.json(record)
                    if let existing = current[id] {
                        let oldData = try Self.json(existing)
                        if oldData == data { continue }
                        if !Self.prefers(record, over: existing) {
                            try archive(data, collection: collection, id: id)
                            continue
                        }
                        try archive(oldData, collection: collection, id: id)
                    }
                    let destination = folder.appendingPathComponent(collection).appendingPathComponent(id + ".json")
                    try coordinatedRecordWrite(data, record: record, collection: collection, id: id, to: destination)
                    current[id] = record
                }
            }
            return try load()
        }
    }

    private func readRecords(_ collection: String, strict: Bool = false) throws -> [String: [String: Any]] {
        let directory = folder.appendingPathComponent(collection)
        let entries = try manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isUbiquitousItemKey], options: [])
        let files = Set(entries.compactMap { url -> URL? in
            if url.pathExtension == "json" { return url }
            // Older iCloud Drive file providers expose hidden placeholder filenames.
            let name = url.lastPathComponent
            if name.hasPrefix("."), name.hasSuffix(".json.icloud") {
                return directory.appendingPathComponent(String(name.dropFirst().dropLast(7)))
            }
            return nil
        })
        var records: [String: [String: Any]] = [:]
        for url in files {
            // Ask iCloud to fetch placeholders; the next poll reads them once available.
            if (try? url.resourceValues(forKeys: [.isUbiquitousItemKey]).isUbiquitousItem) == true {
                try? manager.startDownloadingUbiquitousItem(at: url)
            }
            let versionURLs = [url] + (NSFileVersion.unresolvedConflictVersionsOfItem(at: url) ?? []).map(\.url)
            for versionURL in versionURLs {
                do {
                    let data = try coordinatedRead(versionURL)
                    guard let record = try JSONSerialization.jsonObject(with: data) as? [String: Any], let id = record["id"] as? String, Self.safeFilename(id) else { throw CocoaError(.fileReadCorruptFile) }
                    if let existing = records[id] {
                        if strict {
                            try archive(try Self.json(existing), collection: collection, id: id)
                            try archive(data, collection: collection, id: id)
                        }
                        if !Self.prefers(record, over: existing) { continue }
                    }
                    records[id] = record
                } catch {
                    if strict {
                        throw NSError(domain: "DaymarkStorage", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not safely read \(url.lastPathComponent). Wait for iCloud Drive to finish downloading, or check this file in your Daymark folder. Your changes have not overwritten it."])
                    }
                }
            }
        }
        return records
    }

    private static func prefers(_ candidate: [String: Any], over existing: [String: Any]) -> Bool {
        let newDate = timestamp(candidate)
        let oldDate = timestamp(existing)
        if newDate != oldDate { return newDate > oldDate }
        let newDeleted = (candidate["deletedAt"] as? String)?.isEmpty == false
        let oldDeleted = (existing["deletedAt"] as? String)?.isEmpty == false
        if newDeleted != oldDeleted { return newDeleted }
        guard let new = try? json(candidate), let old = try? json(existing) else { return false }
        return old.lexicographicallyPrecedes(new)
    }

    private static func timestamp(_ record: [String: Any]) -> String {
        record["updatedAt"] as? String ?? record["createdAt"] as? String ?? ""
    }

    static func json(_ object: Any) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func safeFilename(_ value: String) -> Bool {
        !value.isEmpty && value != "." && value != ".." && !value.contains("/") && !value.contains("\\") && !value.contains("\0")
    }

    private func archive(_ data: Data, collection: String, id: String) throws {
        let directory = folder.appendingPathComponent("Revisions").appendingPathComponent(collection).appendingPathComponent(id)
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        // Content-addressing avoids repeatedly archiving the same stale autosave.
        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        let destination = directory.appendingPathComponent(digest + ".json")
        if !manager.fileExists(atPath: destination.path) { try coordinatedWrite(data, to: destination) }
    }

    private func coordinatedRead(_ url: URL) throws -> Data {
        var coordinationError: NSError?
        var result: Result<Data, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinationError) { coordinatedURL in
            result = Result { try Data(contentsOf: coordinatedURL) }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw CocoaError(.fileReadUnknown) }
        return try result.get()
    }

    private static var attachmentNameConflict: Error {
        NSError(domain: "DaymarkStorage", code: 6, userInfo: [NSLocalizedDescriptionKey: "These workspaces contain different attachments with the same filename. No existing files were replaced. Choose another folder or export both workspaces before combining them."])
    }

    private func coordinatedWrite(_ data: Data, to url: URL, replacingExisting: Bool = true) throws {
        var coordinationError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinatedURL in
            do {
                if !replacingExisting && manager.fileExists(atPath: coordinatedURL.path) {
                    // A provider may have delivered this attachment after validation.
                    guard try Data(contentsOf: coordinatedURL) == data else { throw Self.attachmentNameConflict }
                    return
                }
                try data.write(to: coordinatedURL, options: .atomic)
            } catch { writeError = error }
        }
        if let coordinationError { throw coordinationError }
        if let writeError { throw writeError }
    }

    private func coordinatedRecordWrite(_ data: Data, record: [String: Any], collection: String, id: String, to url: URL) throws {
        var coordinationError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinatedURL in
            do {
                // Recheck within the write coordination in case another device changed
                // this record since the directory snapshot was read.
                if manager.fileExists(atPath: coordinatedURL.path) {
                    let currentData = try Data(contentsOf: coordinatedURL)
                    guard let currentRecord = try JSONSerialization.jsonObject(with: currentData) as? [String: Any] else { throw CocoaError(.fileReadCorruptFile) }
                    if try Self.json(currentRecord) == data { return }
                    if !Self.prefers(record, over: currentRecord) {
                        try archive(data, collection: collection, id: id)
                        return
                    }
                    try archive(currentData, collection: collection, id: id)
                }
                try data.write(to: coordinatedURL, options: .atomic)
            } catch { writeError = error }
        }
        if let coordinationError { throw coordinationError }
        if let writeError { throw writeError }
    }

    func addAttachment(_ source: URL) throws -> [String: Any] {
        try serialized {
            let access = source.startAccessingSecurityScopedResource()
            defer { if access { source.stopAccessingSecurityScopedResource() } }
            let data = try coordinatedRead(source)
            let ext = source.pathExtension.lowercased().filter { $0.isLetter || $0.isNumber }
            return try writeAttachment(data, name: source.lastPathComponent, mime: Self.mimeType(ext), extension: ext)
        }
    }

    /// A dropped WebKit File supplies bytes, never a trusted filesystem path.
    /// Decode on the storage queue and bound both the encoded and decoded sizes.
    func importAttachment(name: String, mime: String, base64: String) throws -> [String: Any] {
        try serialized {
            guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  name.utf8.count <= 1024,
                  name.rangeOfCharacter(from: .controlCharacters) == nil,
                  mime.utf8.count <= 255,
                  mime.rangeOfCharacter(from: .controlCharacters) == nil,
                  mime.isEmpty || mime.range(of: "^[A-Za-z0-9!#$&^_.+'-]+/[A-Za-z0-9!#$&^_.+'-]+$", options: .regularExpression) != nil else {
                throw NSError(domain: "DaymarkStorage", code: 3, userInfo: [NSLocalizedDescriptionKey: "This file has an invalid name or file type."])
            }
            let maximumEncodedBytes = ((Self.maximumImportedAttachmentBytes + 2) / 3) * 4
            guard base64.utf8.count <= maximumEncodedBytes else {
                throw NSError(domain: "DaymarkStorage", code: 4, userInfo: [NSLocalizedDescriptionKey: "Each file can be up to 25 MB."])
            }
            guard let data = Data(base64Encoded: base64), data.base64EncodedString() == base64 else {
                throw NSError(domain: "DaymarkStorage", code: 5, userInfo: [NSLocalizedDescriptionKey: "This file could not be read. Please try adding it again."])
            }
            guard data.count <= Self.maximumImportedAttachmentBytes else {
                throw NSError(domain: "DaymarkStorage", code: 4, userInfo: [NSLocalizedDescriptionKey: "Each file can be up to 25 MB."])
            }
            // The original name is display metadata only; even path-like names
            // cannot choose the destination. Limit the extension's disk length.
            let ext = String((name as NSString).pathExtension.lowercased().filter { $0.isLetter || $0.isNumber }.prefix(32))
            return try writeAttachment(data, name: name, mime: mime.isEmpty ? Self.mimeType(ext) : mime.lowercased(), extension: ext)
        }
    }

    private func writeAttachment(_ data: Data, name: String, mime: String, extension ext: String) throws -> [String: Any] {
        let id = UUID().uuidString.lowercased()
        let filename = ext.isEmpty ? id : id + "." + ext
        try coordinatedWrite(data, to: folder.appendingPathComponent("Attachments").appendingPathComponent(filename))
        return ["id": id, "name": name, "mime": mime, "size": data.count, "url": "daymark://attachment/" + filename]
    }

    func attachmentURL(_ url: URL) -> URL? {
        serialized {
            guard url.scheme == "daymark", url.host == "attachment" else { return nil }
            let filename = url.lastPathComponent
            guard Self.safeFilename(filename), url.path == "/" + filename else { return nil }
            return folder.appendingPathComponent("Attachments").appendingPathComponent(filename)
        }
    }

    func attachmentData(_ url: URL) throws -> Data {
        try serialized {
            guard let file = attachmentURL(url) else { throw CocoaError(.fileReadInvalidFileName) }
            return try coordinatedRead(file)
        }
    }

    static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html"
        case "js", "mjs": return "text/javascript"
        case "css": return "text/css"
        case "json", "map": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "heic", "heif": return "image/heic"
        case "pdf": return "application/pdf"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "ico": return "image/x-icon"
        case "txt": return "text/plain"
        default: return "application/octet-stream"
        }
    }
}
