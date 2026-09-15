"""Synthetic-only migration smoke checks. Pass the separately compiled CLI path."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

binary = str(Path(sys.argv[1]).resolve())
checks = 0

def check(condition, message):
    global checks
    assert condition, message
    checks += 1

def invoke(*args, ok=True):
    result = subprocess.run([binary, *map(str, args)], capture_output=True, text=True)
    check((result.returncode == 0) == ok, result.stderr or result.stdout)
    return json.loads(result.stdout if ok else result.stderr)

def write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")

stamp = "2026-09-14T01:00:00.000Z"

def task(id, **values):
    return {"id": id, "title": "Synthetic imported task", "createdAt": stamp,
            "updatedAt": stamp, "doDate": None, "deadline": None,
            "completedAt": None, "deletedAt": None, "projectId": "",
            "columnId": "next", "attachments": [],
            "notes": {"type": "doc", "content": [{"type": "paragraph"}]}, **values}

with tempfile.TemporaryDirectory(prefix="daymark-migration-checks-") as temporary:
    base = Path(temporary)
    folder = base / "workspace"
    staged_file = base / "staged.json"
    manifest_file = base / "manifest.json"
    backup_parent = base / "backups"
    source = base / "source.pdf"
    source.write_bytes(b"%PDF-1.4\nSynthetic attachment only\n%%EOF")
    placeholder = "migration-attachment://attachment-one"
    staged = {"schemaVersion": 1, "projects": [], "columns": [],
              "tags": [{"id": "tag-reading", "name": "Reading", "color": "#315fd5", "group": "action", "updatedAt": stamp}],
              "tasks": [task("import-stable-id", tagIds=["tag-reading"],
                             doDates=["2026-09-14", "2026-09-17", "2026-09-25"],
                             doDate="2026-09-14", deadline="2026-09-30",
                             attachments=[{"id": "stable-attachment-id", "name": "Synthetic paper.pdf", "mime": "application/pdf", "size": 0, "url": placeholder}],
                             notes={"type": "doc", "content": [{"type": "image", "attrs": {"src": placeholder}}]})]}
    write(staged_file, staged)
    write(manifest_file, [{"id": "attachment-one", "path": str(source)}])
    common = ("--folder", folder, "--state", staged_file, "--attachments", manifest_file)
    preview = invoke(*common)
    check(preview["mode"] == "dry-run" and preview["records"]["tasks"]["add"] == 1, "Dry-run must report intended records")
    check(not folder.exists() and not backup_parent.exists(), "Dry-run must create no files")
    missing_approval = invoke(*common, "--apply", ok=False)
    check(not missing_approval["workspaceMayHaveChanged"] and not folder.exists(), "Apply without backup must leave workspace absent")
    first = invoke(*common, "--apply", "--backup", backup_parent)
    backup = Path(first["backupPath"])
    check(backup.is_dir() and backup.parent == backup_parent, "Apply must create external timestamped backup")
    saved = invoke("--folder", folder, "--export")
    imported = saved["tasks"][0]
    attachment = imported["attachments"][0]
    check(imported["id"] == "import-stable-id", "Migration must preserve supplied deterministic record IDs")
    check(imported["doDates"] == ["2026-09-14", "2026-09-17", "2026-09-25"], "Independent noncontiguous work dates must survive import and export without filling gaps")
    check(imported["doDate"] == "2026-09-14" and imported["deadline"] == "2026-09-30", "Migration must preserve the legacy date alias and independent deadline")
    check(attachment["id"] == "stable-attachment-id" and attachment["name"] == "Synthetic paper.pdf", "Attachment IDs and display names must remain stable")
    check(attachment["size"] == source.stat().st_size and attachment["mime"] == "application/pdf", "Attachment metadata must describe stored bytes")
    check(imported["notes"]["content"][0]["attrs"]["src"] == attachment["url"], "Notes and metadata must share the resolved local URL")
    saved_file = folder / "Attachments" / attachment["url"].split("/")[-1]
    check(saved_file.read_bytes() == source.read_bytes(), "Attachment contents must round-trip")
    check(saved["tags"] == staged["tags"], "Tags must be saved by native storage")
    second = invoke(*common, "--apply", "--backup", backup_parent)
    check(second["records"]["tasks"]["add"] == 0 and second["attachmentsAdded"] == 0, "Repeat apply must add neither duplicate task nor attachment")
    check(len(list((folder / "Attachments").iterdir())) == 1, "Repeated import must not duplicate attachment bytes")
    second_backup = Path(second["backupPath"])
    check((second_backup / "Attachments" / saved_file.name).read_bytes() == source.read_bytes(), "Full backup must include attachment bytes")
    check(json.loads((second_backup / "tasks" / "import-stable-id.json").read_text()) == imported, "Full backup must preserve original task data")
    imported["title"] = "Synthetic user edit"
    imported["updatedAt"] = "2026-09-15T01:00:00.000Z"
    write(folder / "tasks" / "import-stable-id.json", imported)
    staged["tasks"][0]["updatedAt"] = "2030-01-01T00:00:00.000Z"
    staged["tasks"].append(task("second-stable-id", doDate="2024-02-29"))
    write(staged_file, staged)
    before = invoke(*common)
    check(before["records"]["tasks"]["skippedExistingIds"] == ["import-stable-id"], "Existing differing task IDs must be explicitly reported")
    third = invoke(*common, "--apply", "--backup", backup_parent)
    after = invoke("--folder", folder, "--export")
    check(len(after["tasks"]) == 2, "New migration records must coexist with existing tasks")
    legacy = next(t for t in after["tasks"] if t["id"] == "second-stable-id")
    check("doDates" not in legacy and legacy["doDate"] == "2024-02-29", "Old backups without an array must retain valid legacy leap-day schedules")
    check(next(t for t in after["tasks"] if t["id"] == imported["id"]) == imported, "Even a newer staged record must not overwrite user edits")
    check(third["attachmentsAdded"] == 0, "Skipped existing records must not import unused attachments")
    unsafe = invoke(*common, "--apply", "--backup", folder / "bad-backup", ok=False)
    check(not unsafe["workspaceMayHaveChanged"] and not (folder / "bad-backup").exists(), "Backup inside workspace must be rejected before changes")
    duplicate = copy.deepcopy(staged)
    duplicate["tasks"].append(duplicate["tasks"][0])
    write(staged_file, duplicate)
    invoke(*common, ok=False)
    check(invoke("--folder", folder, "--export") == after, "Invalid staged IDs must not change any records")
    write(staged_file, {**staged, "tasks": [task("missing-source", attachments=staged["tasks"][0]["attachments"])]})
    invoke("--folder", folder, "--state", staged_file, ok=False)
    check(invoke("--folder", folder, "--export") == after, "Unresolved attachments must be rejected before writes")

    # Reject malformed schedules before backup or writes, even with --apply.
    # Calendar validation must not normalize impossible dates into another month.
    invalid_schedules = [
        None, "2026-09-14", {"date": "2026-09-14"}, [None], [20260914],
        ["2026-09-14", "2026-09-14"], ["2026-09-17", "2026-09-14"],
        ["2026-02-29"], ["2024-02-30"], ["1900-02-29"], ["2026-04-31"],
        ["2026-13-01"], ["2026-00-01"], ["2026-09-00"], ["0000-01-01"],
        ["2026-9-14"], ["2026-09-14T00:00:00Z"], ["2026-09-14\n"],
    ]
    backups_before = set(backup_parent.iterdir())
    for dates in invalid_schedules:
        write(staged_file, {**staged, "tasks": [task("invalid-schedule", doDates=dates)]})
        error = invoke(*common, "--apply", "--backup", backup_parent, ok=False)
        check("doDates" in error["error"] and not error["workspaceMayHaveChanged"], "Invalid date arrays must be diagnosed before changes")
    for field in ("doDate", "deadline"):
        write(staged_file, {**staged, "tasks": [task("invalid-single-date", **{field: "2026-02-30"})]})
        error = invoke(*common, "--apply", "--backup", backup_parent, ok=False)
        check(field in error["error"] and not error["workspaceMayHaveChanged"], "Impossible legacy and deadline dates must also be rejected")
    check(set(backup_parent.iterdir()) == backups_before, "Invalid date inputs must not create needless backup directories")
    check(invoke("--folder", folder, "--export") == after, "Rejected schedules must leave all tasks and attachments unchanged")

    valid_schedules = [
        task("cleared-schedule", doDates=[], doDate=None),
        task("leap-schedule", doDates=["2000-02-29", "2024-02-29", "2026-03-31"], doDate="2000-02-29"),
        task("stale-legacy-alias", doDates=[], doDate="2026-09-14"),
    ]
    write(staged_file, {**staged, "tasks": valid_schedules})
    date_import = invoke(*common, "--apply", "--backup", backup_parent)
    with_dates = invoke("--folder", folder, "--export")
    for original in valid_schedules:
        check(next(t for t in with_dates["tasks"] if t["id"] == original["id"]) == original,
              "Valid date arrays, including explicit empty arrays, must round-trip without rewriting supplied records")
    date_backup = Path(date_import["backupPath"])
    check(invoke("--folder", date_backup, "--export") == after,
          "The pre-import backup must retain the exact prior workspace for recovery")
    fresh = base / "export-only"
    exported = invoke("--folder", fresh, "--export")
    check(not fresh.exists() and exported["tasks"] == [], "Exporting a missing workspace must not create it")
print(f"Daymark migration: {checks} synthetic date-validation, backup, attachment, idempotence, and edit-preservation checks passed.")
