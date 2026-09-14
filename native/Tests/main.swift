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

let image = directory.appendingPathComponent("sample.png")
let bytes = Data([137, 80, 78, 71, 13, 10, 26, 10])
try bytes.write(to: image)
let attachment = try store.addAttachment(image)
let url = URL(string: attachment["url"] as! String)!
try check(store.attachmentData(url) == bytes, "Attachment bytes must round-trip")
check(attachment["mime"] as? String == "image/png", "Attachment MIME should match")
check(store.attachmentURL(URL(string: "daymark://attachment/subdirectory/file.pdf")!) == nil, "Attachment path traversal must be rejected")

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
print("Daymark native store: \(checks) persistence, tag, conflict, attachment, and background IO checks passed.")
