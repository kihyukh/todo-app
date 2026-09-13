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
func check(_ value: @autoclosure () throws -> Bool, _ message: String) rethrows {
    if try !value() { fatalError(message) }
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

let image = directory.appendingPathComponent("sample.png")
let bytes = Data([137, 80, 78, 71, 13, 10, 26, 10])
try bytes.write(to: image)
let attachment = try store.addAttachment(image)
let url = URL(string: attachment["url"] as! String)!
try check(store.attachmentData(url) == bytes, "Attachment bytes must round-trip")
check(attachment["mime"] as? String == "image/png", "Attachment MIME should match")
check(store.attachmentURL(URL(string: "daymark://attachment/subdirectory/file.pdf")!) == nil, "Attachment path traversal must be rejected")
print("Daymark native store: 11 persistence, conflict, tombstone, and attachment checks passed.")
