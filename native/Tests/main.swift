import Foundation

let fm = FileManager.default
let directory = fm.temporaryDirectory.appendingPathComponent("DaymarkStoreTests-" + UUID().uuidString)
defer { try? fm.removeItem(at: directory) }
let store = try DaymarkStore(folder: directory)

func task(_ title: String, _ updatedAt: String, deleted: String? = nil) -> [String: Any] {
    ["id": "test-task", "title": title, "updatedAt": updatedAt, "deletedAt": deleted as Any? ?? NSNull(), "attachments": []]
}
func state(_ value: [String: Any]) -> [String: Any] { ["schemaVersion": 1, "tasks": [value], "projects": [], "columns": []] }
func current() throws -> [String: Any] { (try store.load()!["tasks"] as! [[String: Any]])[0] }
var checks = 0
func check(_ value: @autoclosure () throws -> Bool, _ message: String) rethrows {
    if try !value() { fatalError(message) }
    checks += 1
}

try check(store.load() == nil, "Fresh store should be empty")
try store.save(state(task("First", "2026-09-14T01:00:00.000Z")))
try store.save(state(task("Newer", "2026-09-14T02:00:00.000Z")))
try store.save(state(task("Older offline edit", "2026-09-14T01:30:00.000Z")))
try check(current()["title"] as? String == "Newer", "An older incoming task must not overwrite a newer task")
let revisions = try fm.contentsOfDirectory(atPath: directory.appendingPathComponent("Revisions/tasks/test-task").path)
check(revisions.count == 2, "Both previous and losing offline edits should be archived")
try store.save(state(task("Older offline edit", "2026-09-14T01:30:00.000Z")))
try check(fm.contentsOfDirectory(atPath: directory.appendingPathComponent("Revisions/tasks/test-task").path).count == 2, "Duplicate losing autosaves must not duplicate revisions")

try store.save(state(task("Deleted", "2026-09-14T02:00:00.000Z", deleted: "2026-09-14T02:00:00.000Z")))
try store.save(state(task("ZZZZ live collision", "2026-09-14T02:00:00.000Z")))
try check(current()["deletedAt"] is String, "Tombstone must win equal-time collision")
try store.save(["schemaVersion": 1, "tasks": [], "projects": [], "columns": []])
try check(current()["deletedAt"] is String, "Omitted records must not remove tombstones")

let conflict = task("Remote conflict copy", "2026-09-14T04:00:00.000Z")
try DaymarkStore.json(conflict).write(to: directory.appendingPathComponent("tasks/test-task 2.json"))
try check(current()["title"] as? String == "Remote conflict copy", "Conflict-copy records must participate in merge")

let malformed = directory.appendingPathComponent("tasks/unavailable.json")
try Data("not valid JSON".utf8).write(to: malformed)
var rejected = false
do { try store.save(state(task("Unsafe write", "2026-09-14T05:00:00.000Z"))) } catch { rejected = true }
check(rejected, "An unreadable existing record must block writes")
try fm.removeItem(at: malformed)

// Tags are optional in old workspaces but first-class per-record data once saved.
let tagDirectory = directory.appendingPathComponent("TagRoundTrip", isDirectory: true)
let tagStore = try DaymarkStore(folder: tagDirectory)
var legacyTask = task("Legacy without tags", "2026-09-14T01:00:00.000Z")
try tagStore.save(state(legacyTask))
let legacyState = try tagStore.load()!
check((legacyState["tags"] as? [[String: Any]])?.isEmpty == true, "Legacy workspace should load with an empty tag collection")
check((legacyState["tasks"] as? [[String: Any]])?.first?["tagIds"] == nil, "Legacy task should remain unchanged without a tagIds field")
legacyTask["tagIds"] = ["tag-reading", "tag-topic"]
legacyTask["updatedAt"] = "2026-09-14T02:00:00.000Z"
let readingTag: [String: Any] = ["id": "tag-reading", "name": "Reading", "color": "#315fd5", "group": "action", "updatedAt": "2026-09-14T02:00:00.000Z"]
let topicTag: [String: Any] = ["id": "tag-topic", "name": "Synthetic topic", "color": "#547ce8", "group": "topic", "updatedAt": "2026-09-14T02:00:00.000Z"]
var taggedState = state(legacyTask)
taggedState["tags"] = [readingTag, topicTag]
try tagStore.save(taggedState)
let restoredTags = try DaymarkStore(folder: tagDirectory).load()!
check((restoredTags["tags"] as? [[String: Any]])?.count == 2, "Tag records must round-trip through a new store")
check((restoredTags["tasks"] as? [[String: Any]])?.first?["tagIds"] as? [String] == ["tag-reading", "tag-topic"], "Task tag assignments must round-trip")
check((restoredTags["tags"] as? [[String: Any]])?.first?["group"] as? String == "action", "Tag groups must round-trip")
check(fm.fileExists(atPath: tagDirectory.appendingPathComponent("tags/tag-reading.json").path), "Tags must be persisted as independent iCloud records")
let exportedTags = try JSONSerialization.jsonObject(with: DaymarkStore.json(restoredTags)) as! [String: Any]
check((exportedTags["tags"] as? [[String: Any]])?.count == 2, "Workspace JSON export must include tags")
try tagStore.save(state(legacyTask))
try check((tagStore.load()!["tags"] as? [[String: Any]])?.count == 2, "Saving from an older client that omits tags must not erase tag records")
var deletedTag = readingTag
deletedTag["deletedAt"] = "2026-09-14T03:00:00.000Z"
deletedTag["updatedAt"] = "2026-09-14T03:00:00.000Z"
var removedTask = legacyTask
removedTask["tagIds"] = [String]()
removedTask["updatedAt"] = "2026-09-14T03:00:00.000Z"
var removedTagsState = state(removedTask)
removedTagsState["tags"] = [deletedTag]
try tagStore.save(removedTagsState)
try tagStore.save(taggedState)
let removedTagsResult = try tagStore.load()!
check((removedTagsResult["tags"] as? [[String: Any]])?.first?["deletedAt"] as? String == "2026-09-14T03:00:00.000Z", "An offline copy must not resurrect a deleted tag")
check(((removedTagsResult["tasks"] as? [[String: Any]])?.first?["tagIds"] as? [String])?.isEmpty == true, "An offline task must not restore removed tag assignments")
try check(fm.contentsOfDirectory(atPath: tagDirectory.appendingPathComponent("Revisions/tags/tag-reading").path).count >= 1, "Tag changes must preserve revision records")

// Independent work days stay ordinary JSON data across saves, exports, and
// file-provider updates. An empty array is an intentional cleared schedule.
let dateDirectory = directory.appendingPathComponent("WorkDateRoundTrip", isDirectory: true)
let dateStore = try DaymarkStore(folder: dateDirectory)
var datedTask = task("Legacy schedule", "2026-09-14T01:00:00.000Z")
datedTask["doDate"] = "2026-09-14"
datedTask["deadline"] = "2026-09-30"
try dateStore.save(state(datedTask))
let legacyDates = (try dateStore.load()!["tasks"] as! [[String: Any]])[0]
check(legacyDates["doDates"] == nil && legacyDates["doDate"] as? String == "2026-09-14", "A legacy single-date record must load without inventing an array")
let plannedDays = ["2026-09-14", "2026-09-17", "2026-09-25"]
datedTask["doDates"] = plannedDays
datedTask["updatedAt"] = "2026-09-14T02:00:00.000Z"
try dateStore.save(state(datedTask))
let dateFile = dateDirectory.appendingPathComponent("tasks/test-task.json")
let onDiskDates = try JSONSerialization.jsonObject(with: Data(contentsOf: dateFile)) as! [String: Any]
check(onDiskDates["doDates"] as? [String] == plannedDays, "Every independent work day must be saved to the task file without filling gaps")
let secondDateStore = try DaymarkStore(folder: dateDirectory)
let restoredDates = try secondDateStore.load()!
let exportedDates = try JSONSerialization.jsonObject(with: DaymarkStore.json(restoredDates)) as! [String: Any]
let exportedDatedTask = (exportedDates["tasks"] as! [[String: Any]])[0]
check(exportedDatedTask["doDates"] as? [String] == plannedDays, "All work dates must survive a new store and JSON export")
check(exportedDatedTask["doDate"] as? String == "2026-09-14" && exportedDatedTask["deadline"] as? String == "2026-09-30", "Multiple work days must not rewrite the legacy alias or deadline")
var remoteDatedTask = datedTask
let remoteDays = ["2026-09-14", "2026-09-18", "2026-09-25"]
remoteDatedTask["doDates"] = remoteDays
remoteDatedTask["updatedAt"] = "2026-09-14T04:00:00.000Z"
try secondDateStore.save(state(remoteDatedTask))
var offlineDatedTask = datedTask
let offlineDays = ["2026-09-14", "2026-09-17", "2026-09-26"]
offlineDatedTask["doDates"] = offlineDays
offlineDatedTask["updatedAt"] = "2026-09-14T03:00:00.000Z"
try dateStore.save(state(offlineDatedTask))
let reconciledDates = (try dateStore.load()!["tasks"] as! [[String: Any]])[0]
check(reconciledDates["doDates"] as? [String] == remoteDays, "A newer file-provider record must retain its complete date array when an older offline edit arrives")
let dateRevisionFiles = try fm.contentsOfDirectory(at: dateDirectory.appendingPathComponent("Revisions/tasks/test-task"), includingPropertiesForKeys: nil)
let dateRevisions = try dateRevisionFiles.map { try JSONSerialization.jsonObject(with: Data(contentsOf: $0)) as! [String: Any] }
check(dateRevisions.contains { $0["doDates"] as? [String] == offlineDays }, "A losing offline date selection must remain recoverable in revisions")
remoteDatedTask["doDates"] = [String]()
remoteDatedTask["doDate"] = NSNull()
remoteDatedTask["updatedAt"] = "2026-09-14T05:00:00.000Z"
try secondDateStore.save(state(remoteDatedTask))
try dateStore.save(state(datedTask))
let clearedDates = (try dateStore.load()!["tasks"] as! [[String: Any]])[0]
check(clearedDates["doDates"] as? [String] == [] && clearedDates["doDate"] is NSNull, "Clearing every work date must survive reload and an older client snapshot")
check(clearedDates["deadline"] as? String == "2026-09-30", "Clearing work dates must preserve the absolute deadline")

let image = directory.appendingPathComponent("sample.png")
let bytes = Data([137, 80, 78, 71, 13, 10, 26, 10])
try bytes.write(to: image)
let attachment = try store.addAttachment(image)
let url = URL(string: attachment["url"] as! String)!
try check(store.attachmentData(url) == bytes, "Attachment bytes must round-trip")
check(attachment["mime"] as? String == "image/png", "Attachment MIME should match")
check(store.attachmentURL(URL(string: "daymark://attachment/subdirectory/file.pdf")!) == nil, "Attachment path traversal must be rejected")

// Dropped files are copied from bytes and remain available without a task's
// attachment-list entry. Their original names must never become storage paths.
let droppedBytes = Data("%PDF-1.7\nDropped note document".utf8)
let droppedName = "논문 검토.PDF"
let dropped = try store.importAttachment(name: droppedName, mime: "application/pdf", base64: droppedBytes.base64EncodedString())
let droppedURL = URL(string: dropped["url"] as! String)!
check(dropped["name"] as? String == droppedName, "Dropped files must retain their original display names")
check(dropped["mime"] as? String == "application/pdf" && dropped["size"] as? Int == droppedBytes.count, "Dropped file metadata must describe the copied bytes")
check(UUID(uuidString: dropped["id"] as! String) != nil && droppedURL.pathExtension == "pdf", "Dropped files must use UUID names and sanitized lowercase extensions")
try check(DaymarkStore(folder: directory).attachmentData(droppedURL) == droppedBytes, "Dropped bytes must survive reopening a workspace without an attachment-list entry")
try check((current()["attachments"] as? [[String: Any]])?.isEmpty == true, "Importing bytes must not add a task attachment-list entry")

for originalName in ["../outside.pdf", "/tmp/outside.pdf", "..\\outside.p$d-f", "report." + String(repeating: "z", count: 500)] {
    let imported = try store.importAttachment(name: originalName, mime: "", base64: droppedBytes.base64EncodedString())
    let importedURL = URL(string: imported["url"] as! String)!
    let storedURL = store.attachmentURL(importedURL)!
    check(storedURL.deletingLastPathComponent().standardizedFileURL == directory.appendingPathComponent("Attachments").standardizedFileURL, "A path-like original filename must stay contained in Attachments")
    check(imported["name"] as? String == originalName, "The original name must remain display metadata")
    check(storedURL.lastPathComponent.count <= 69, "A long extension must not exceed the generated filename limit")
    try check(store.attachmentData(importedURL) == droppedBytes, "Path-like display names must not change imported content")
}
check(!fm.fileExists(atPath: directory.appendingPathComponent("outside.pdf").path), "Importing a traversal-style filename must not write outside Attachments")
let unknown = try store.importAttachment(name: "handout.hwp", mime: "", base64: droppedBytes.base64EncodedString())
check(unknown["mime"] as? String == "application/octet-stream", "Unknown file types must use a generic MIME fallback")
let inferredPDF = try store.importAttachment(name: "paper.PDF", mime: "", base64: droppedBytes.base64EncodedString())
check(inferredPDF["mime"] as? String == "application/pdf", "An empty MIME type must be inferred from a known extension")
let emptyFile = try store.importAttachment(name: "empty.txt", mime: "text/plain", base64: "")
let emptyURL = URL(string: emptyFile["url"] as! String)!
try check(emptyFile["size"] as? Int == 0 && store.attachmentData(emptyURL).isEmpty, "Empty base64 must represent a valid zero-byte file")

func checkImportRejected(_ message: String, name: String = "invalid.pdf", mime: String = "application/pdf", base64: String) throws {
    let attachmentFolder = directory.appendingPathComponent("Attachments")
    let before = try fm.contentsOfDirectory(atPath: attachmentFolder.path).count
    var rejected = false
    do { _ = try store.importAttachment(name: name, mime: mime, base64: base64) } catch { rejected = true }
    check(rejected, message)
    try check(fm.contentsOfDirectory(atPath: attachmentFolder.path).count == before, "A rejected import must not write an attachment")
}
for malformedBase64 in ["not base64!", "data:application/pdf;base64,JVBERg==", "JVBERg=", "JVBE\nRg==", "===="] {
    try checkImportRejected("Malformed or wrapped base64 must be rejected", base64: malformedBase64)
}
for invalidName in ["", " \n", "bad\u{0}.pdf", String(repeating: "x", count: 1025)] {
    try checkImportRejected("Invalid display names must be rejected", name: invalidName, base64: "YQ==")
}
for invalidMime in ["pdf", "text/plain\n", "text/plain; charset=utf-8"] {
    try checkImportRejected("Invalid file MIME types must be rejected", mime: invalidMime, base64: "YQ==")
}
do {
    let maximumBytes = Data(repeating: 97, count: DaymarkStore.maximumImportedAttachmentBytes)
    let maximumFile = try store.importAttachment(name: "maximum.bin", mime: "", base64: maximumBytes.base64EncodedString())
    let maximumURL = URL(string: maximumFile["url"] as! String)!
    try check(store.attachmentData(maximumURL) == maximumBytes, "The 25 MB boundary must import successfully")
    let tooManyBytes = Data(repeating: 97, count: DaymarkStore.maximumImportedAttachmentBytes + 1)
    try checkImportRejected("Decoded content beyond 25 MB must be rejected even when its encoded length fits", base64: tooManyBytes.base64EncodedString())
}
let maximumEncodedBytes = ((DaymarkStore.maximumImportedAttachmentBytes + 2) / 3) * 4
try checkImportRejected("Oversized encoded input must be rejected before decoding", base64: String(repeating: "A", count: maximumEncodedBytes + 4))

// Model a file provider waiting for iCloud while the UI continues to handle input.
let workerStarted = DispatchSemaphore(value: 0)
let releaseWorker = DispatchSemaphore(value: 0)
var completionOrder: [Int] = []
var uiResponded = false
var operationsOnWorker = true
var completionsOnMain = true
var lastState: [String: Any]?
store.perform({
    operationsOnWorker = !Thread.isMainThread
    workerStarted.signal()
    guard releaseWorker.wait(timeout: .now() + 3) == .success else { throw CocoaError(.fileWriteUnknown) }
    return try store.save(state(task("First queued edit", "2026-09-14T06:00:00.000Z")))
}) { result in
    if case .failure(let error) = result { fatalError(error.localizedDescription) }
    completionsOnMain = completionsOnMain && Thread.isMainThread
    completionOrder.append(1)
}
check(workerStarted.wait(timeout: .now() + 3) == .success, "Asynchronous storage must start without the main run loop")
store.perform({ try store.save(state(task("Latest queued edit", "2026-09-14T07:00:00.000Z"))) }) { result in
    if case .failure(let error) = result { fatalError(error.localizedDescription) }
    completionsOnMain = completionsOnMain && Thread.isMainThread
    completionOrder.append(2)
}
store.perform({ try store.load() }) { result in
    do { lastState = try result.get() } catch { fatalError(error.localizedDescription) }
    completionsOnMain = completionsOnMain && Thread.isMainThread
    completionOrder.append(3)
}
DispatchQueue.main.async {
    uiResponded = true
    releaseWorker.signal()
}
let deadline = Date().addingTimeInterval(5)
while completionOrder.count < 3 && Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.01))
}
check(uiResponded, "The main queue must stay responsive while file coordination waits")
check(operationsOnWorker, "Persistence IO must execute outside the UI thread")
check(completionsOnMain, "Storage callbacks must return to the UI thread")
check(completionOrder == [1, 2, 3], "Queued saves and reads must finish in order")
check((lastState?["tasks"] as? [[String: Any]])?.first?["title"] as? String == "Latest queued edit", "A read after queued saves must contain the latest edit")
print("Daymark native store: \(checks) persistence, work-date, tag, conflict, attachment, and background IO checks passed.")
