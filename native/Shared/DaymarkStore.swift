import Foundation
import CryptoKit

/// One file per record lets iCloud Drive reconcile changes to different tasks independently.
/// updatedAt resolves edits to the same record; prior versions remain in Revisions.
final class DaymarkStore {
    static let collections = ["tasks", "projects", "columns"]
    private(set) var folder: URL
    private(set) var kind: String
    private var scopedURL: URL?
    private let manager = FileManager.default
    private let bookmarkKey = "DaymarkStorageBookmark"

    init(folder explicitFolder: URL? = nil) throws {
        if let explicitFolder {
            folder = explicitFolder
            kind = "folder"
        } else if let data = UserDefaults.standard.data(forKey: bookmarkKey) {
            var stale = false
            #if os(macOS)
            let options: URL.BookmarkResolutionOptions = [.withSecurityScope]
            #else
            let options: URL.BookmarkResolutionOptions = []
            #endif
            if let selected = try? URL(resolvingBookmarkData: data, options: options, relativeTo: nil, bookmarkDataIsStale: &stale) {
                _ = selected.startAccessingSecurityScopedResource()
                scopedURL = selected
                folder = selected
                kind = "folder"
            } else {
                let fallback = Self.defaultLocation()
                folder = fallback.0
                kind = fallback.1
            }
        } else {
            let fallback = Self.defaultLocation()
            folder = fallback.0
            kind = fallback.1
        }
        try prepareFolder()
    }

    deinit { scopedURL?.stopAccessingSecurityScopedResource() }

    private static func defaultLocation() -> (URL, String) {
        #if os(macOS)
        let cloud = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Mobile Documents/com~apple~CloudDocs", isDirectory: true)
        if FileManager.default.fileExists(atPath: cloud.path) {
            return (cloud.appendingPathComponent("Daymark", isDirectory: true), "icloud")
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return (support.appendingPathComponent("Daymark", isDirectory: true), "local")
        #else
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return (documents.appendingPathComponent("Daymark", isDirectory: true), "local")
        #endif
    }

    var storageInfo: [String: Any] {
        let message: String
        switch kind {
        case "icloud": message = "Saved in iCloud Drive. iCloud transfers changes between your devices."
        case "folder": message = "Saved in your selected folder. Select this same Daymark folder on your other devices."
        default: message = "Saved on this device. Choose a folder in iCloud Drive to sync between devices."
        }
        return ["kind": kind, "path": folder.path, "message": message]
    }

    private func prepareFolder() throws {
        for name in Self.collections + ["Attachments", "Revisions"] {
            try manager.createDirectory(at: folder.appendingPathComponent(name, isDirectory: true), withIntermediateDirectories: true)
        }
    }

    /// Merge current records into the chosen folder before switching storage.
    func chooseFolder(_ url: URL) throws {
        let current = try load()
        let oldFolder = folder
        let oldKind = kind
        let access = url.startAccessingSecurityScopedResource()
        let oldScope = scopedURL
        folder = url
        kind = "folder"
        do {
            try prepareFolder()
            if let current { _ = try save(current) }
            let oldAttachments = oldFolder.appendingPathComponent("Attachments")
            for source in (try? manager.contentsOfDirectory(at: oldAttachments, includingPropertiesForKeys: nil)) ?? [] {
                let target = folder.appendingPathComponent("Attachments").appendingPathComponent(source.lastPathComponent)
                if !manager.fileExists(atPath: target.path) { try coordinatedWrite(try Data(contentsOf: source), to: target) }
            }
            #if os(macOS)
            let bookmarkOptions: URL.BookmarkCreationOptions = [.withSecurityScope]
            #else
            let bookmarkOptions: URL.BookmarkCreationOptions = [.minimalBookmark]
            #endif
            let bookmark = try url.bookmarkData(options: bookmarkOptions, includingResourceValuesForKeys: nil, relativeTo: nil)
            UserDefaults.standard.set(bookmark, forKey: bookmarkKey)
            oldScope?.stopAccessingSecurityScopedResource()
            scopedURL = access ? url : nil
        } catch {
            folder = oldFolder
            kind = oldKind
            if access { url.stopAccessingSecurityScopedResource() }
            throw error
        }
    }

    func load() throws -> [String: Any]? {
        var result: [String: Any] = ["schemaVersion": 1]
        var count = 0
        for collection in Self.collections {
            let records = try readRecords(collection)
            result[collection] = records.values.sorted { ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "") }
            count += records.count
        }
        return count == 0 ? nil : result
    }

    @discardableResult
    func save(_ state: [String: Any]) throws -> [String: Any]? {
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

    private func coordinatedWrite(_ data: Data, to url: URL) throws {
        var coordinationError: NSError?
        var writeError: Error?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { coordinatedURL in
            do { try data.write(to: coordinatedURL, options: .atomic) } catch { writeError = error }
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
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let data = try coordinatedRead(source)
        let id = UUID().uuidString.lowercased()
        let ext = source.pathExtension.lowercased().filter { $0.isLetter || $0.isNumber }
        let filename = ext.isEmpty ? id : id + "." + ext
        try coordinatedWrite(data, to: folder.appendingPathComponent("Attachments").appendingPathComponent(filename))
        return ["id": id, "name": source.lastPathComponent, "mime": Self.mimeType(ext), "size": data.count, "url": "daymark://attachment/" + filename]
    }

    func attachmentURL(_ url: URL) -> URL? {
        guard url.scheme == "daymark", url.host == "attachment" else { return nil }
        let filename = url.lastPathComponent
        guard Self.safeFilename(filename), url.path == "/" + filename else { return nil }
        return folder.appendingPathComponent("Attachments").appendingPathComponent(filename)
    }

    func attachmentData(_ url: URL) throws -> Data {
        guard let file = attachmentURL(url) else { throw CocoaError(.fileReadInvalidFileName) }
        return try coordinatedRead(file)
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
