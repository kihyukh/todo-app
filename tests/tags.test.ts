import { describe, expect, it } from "vitest";
import { emptyDoc } from "../src/model";
import type { AppState, TagRecord, Task } from "../src/model";
import {
  activeTags,
  assignTag,
  findTagByName,
  normalizeTagName,
  removeTag,
  setTaskTags,
  tagCounts,
  tagGroup,
  tagNameKey,
  taskTagIds,
  taskTags,
  tasksWithTag,
} from "../src/tags";

const stamp = "2026-09-14T01:00:00.000Z";
const later = "2026-09-14T02:00:00.000Z";
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task",
    title: "Synthetic task",
    notes: emptyDoc(),
    projectId: "inbox",
    columnId: "next",
    doDate: null,
    deadline: null,
    completedAt: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    attachments: [],
    ...overrides,
  };
}
function tag(id: string, overrides: Partial<TagRecord> = {}): TagRecord {
  return { id, name: id, color: "#315fd5", updatedAt: stamp, ...overrides };
}
function state(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 1,
    tasks: [],
    projects: [],
    columns: [],
    ...overrides,
  };
}

describe("tag names and groups", () => {
  it("normalizes pasted hashes, mixed-width text, and whitespace without changing readable case", () => {
    expect(normalizeTagName("  ＃＃ Ｒｅａｄｉｎｇ \n Group \t ")).toBe(
      "Reading Group",
    );
    expect(normalizeTagName("  연구  방법론  ")).toBe("연구 방법론");
    expect(tagNameKey("#READING")).toBe(tagNameKey("reading"));
    expect(tagNameKey("#  ")).toBe("");
  });

  it("finds equivalent live names so create flows can deduplicate without renaming records", () => {
    const records = [
      tag("deleted", { name: "Reading", deletedAt: later }),
      tag("reading", { name: "READING", group: "action" }),
    ];
    expect(findTagByName(records, "#reading")?.id).toBe("reading");
    expect(findTagByName(records, "reading", "action")?.id).toBe("reading");
    expect(findTagByName(records, "reading", "area")).toBeUndefined();
    expect(findTagByName(records, " ")).toBeUndefined();
    expect(records[1].name).toBe("READING");
  });

  it("puts ungrouped older tags in Topic without mutating them", () => {
    const legacy = tag("legacy");
    expect(tagGroup(legacy)).toBe("topic");
    expect(findTagByName([legacy], "legacy", "topic")).toBe(legacy);
    expect(legacy.group).toBeUndefined();
  });

  it("sorts live tags by group then explicit order and label", () => {
    const records = [
      tag("topic"),
      tag("writing", { group: "action", order: 2 }),
      tag("reading", { group: "action", order: 1 }),
      tag("work", { group: "area" }),
      tag("deleted", { deletedAt: later }),
    ];
    const original = [...records];
    expect(activeTags({ tags: records }).map((value) => value.id)).toEqual([
      "work",
      "reading",
      "writing",
      "topic",
    ]);
    expect(records).toEqual(original);
    expect(activeTags({})).toEqual([]);
  });
});

describe("task tag assignment", () => {
  it("assigns multiple tags independently of lists and dates, without mutating the task", () => {
    const original = task({ projectId: "project", deadline: "2026-10-01" });
    const assigned = assignTag(
      assignTag(original, "reading", later),
      "research",
      later,
    );
    expect(assigned.tagIds).toEqual(["reading", "research"]);
    expect(assigned.updatedAt).toBe(later);
    expect(assigned.projectId).toBe("project");
    expect(assigned.deadline).toBe("2026-10-01");
    expect(original.tagIds).toBeUndefined();
    expect(assignTag(assigned, "reading", "unused")).toBe(assigned);
  });

  it("stores last-tag removal explicitly and keeps other assignments", () => {
    const original = task({ tagIds: ["reading", "research"] });
    const removed = removeTag(original, "reading", later);
    expect(removed.tagIds).toEqual(["research"]);
    expect(removeTag(removed, "research", later).tagIds).toEqual([]);
    expect(removed.updatedAt).toBe(later);
    expect(original.tagIds).toEqual(["reading", "research"]);
    expect(removeTag(removed, "absent", "unused")).toBe(removed);
  });

  it("handles old tasks, duplicate imported IDs, and blank IDs predictably", () => {
    const legacy = task();
    expect(taskTagIds(legacy)).toEqual([]);
    expect(assignTag(legacy, " ", later)).toBe(legacy);
    expect(removeTag(legacy, "missing", later)).toBe(legacy);
    expect(taskTagIds({ tagIds: ["one", "one", "", " ", "two"] })).toEqual([
      "one",
      "two",
    ]);
    const replaced = setTaskTags(legacy, ["one", "one", "", "two"], later);
    expect(replaced.tagIds).toEqual(["one", "two"]);
  });

  it("shows only live assigned tags while preserving unknown/offline references in the task", () => {
    const original = task({ tagIds: ["removed", "missing", "reading"] });
    const workspace = state({
      tags: [tag("reading"), tag("removed", { deletedAt: later })],
    });
    expect(taskTags(original, workspace).map((value) => value.id)).toEqual([
      "reading",
    ]);
    expect(original.tagIds).toEqual(["removed", "missing", "reading"]);
    expect(taskTags(original, state())).toEqual([]);
  });
});

describe("tag work views", () => {
  it("counts each open task once per tag and excludes completed, deleted, unknown, or deleted tags", () => {
    const workspace = state({
      tags: [
        tag("reading"),
        tag("research"),
        tag("empty"),
        tag("removed", { deletedAt: later }),
      ],
      tasks: [
        task({
          id: "one",
          tagIds: ["reading", "reading", "research", "removed", "missing"],
        }),
        task({ id: "two", tagIds: ["reading"] }),
        task({ id: "done", tagIds: ["reading"], completedAt: later }),
        task({ id: "trash", tagIds: ["reading"], deletedAt: later }),
        task({ id: "legacy" }),
      ],
    });
    expect([...tagCounts(workspace)]).toEqual([
      ["empty", 0],
      ["reading", 2],
      ["research", 1],
    ]);
    expect(tasksWithTag(workspace, "reading").map((value) => value.id)).toEqual(
      ["one", "two"],
    );
    expect(tasksWithTag(workspace, "removed")).toEqual([]);
    expect(tasksWithTag(workspace, "missing")).toEqual([]);
    expect(tagCounts(state()).size).toBe(0);
  });
});
