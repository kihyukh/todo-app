# Reviewed task migration

Migration inputs, backups, attachments, and reports belong in a private folder **outside this repository**. No personal task data is shipped with Daymark. Source applications remain unchanged.

The TickTick converter accepts a task-only normalized snapshot, checklist records, a downloaded attachment inventory, and an explicit mapping plan. It preserves task IDs, notes, Markdown checkboxes, checklist order/status, completion and deletion state, exact original metadata, embedded images, file links, and supported rich URL blocks. A single TickTick date becomes a Daymark deadline using the source timezone; date ranges also provide a do date. An explicitly mapped Today list schedules only open tasks for the migration day. The plan defines list/column mapping and grouped tags independently of task content.

Download all source attachments and fully load completed history before creating the final source snapshot. Unsupported task statuses/rich blocks, missing checklist rows, duplicate task IDs, unknown tags, and unavailable attachments stop preparation instead of silently dropping content. Raw snapshots retain source fields that Daymark does not yet expose, including reminder configuration; reminders do not become Daymark notifications.

Build the preparation tool and native import tool:

```sh
node_modules/.bin/esbuild scripts/migration/prepare-ticktick.ts --bundle --platform=node --packages=external --format=esm --outfile=build/prepare-ticktick.mjs
swiftc -swift-version 5 native/Shared/DaymarkStore.swift scripts/migration/main.swift -o /tmp/daymark-migrate-state
```

Use absolute private paths for the snapshot, mapping plan, output, destination workspace, and backups:

```sh
node build/prepare-ticktick.mjs "$SNAPSHOT_FOLDER" "$PLAN_JSON" "$STAGED_FOLDER"
/tmp/daymark-migrate-state --folder "$WORKSPACE_FOLDER" --state "$STAGED_FOLDER/state.json" --attachments "$STAGED_FOLDER/attachments.json"
```

The native command defaults to a read-only dry run. Review task/status/date/tag counts, checklist content, and attachment hashes. Close Daymark before applying:

```sh
/tmp/daymark-migrate-state --folder "$WORKSPACE_FOLDER" --state "$STAGED_FOLDER/state.json" --attachments "$STAGED_FOLDER/attachments.json" --apply --backup "$BACKUP_PARENT"
```

Apply first makes a fresh, timestamped copy of the **entire** destination workspace outside that workspace. It inserts only missing record IDs and never replaces existing tasks or edits, including on a repeated import. Attachments receive native URLs and are resolved throughout notes. Existing records, conflicting IDs, imported counts, and the backup path are reported. The store retains its usual coordinated file writes and revision handling; this is not a multi-file transaction. If a write fails, stop and inspect the reported backup before retrying.

Reopen Daymark and verify native note/image/file rendering, date separation, tag filtering, and saved record/attachment counts. Compare existing records to the backup and imported attachments to the source hashes. The source snapshot, mapping plan, and migration report provide an independent recovery copy.

Synthetic CLI safety checks:

```sh
python3 scripts/migration/test.py /tmp/daymark-migrate-state
```
