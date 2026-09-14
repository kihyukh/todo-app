import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTasks,
  createInitialState,
  emptyDoc,
  isToday,
  mergeState,
  scheduleToday,
} from "../src/model";
import type { AppState, NamedRecord, Task } from "../src/model";

const today = "2026-09-14";
const stamp = "2026-09-14T02:00:00.000Z";
const later = "2026-09-14T03:00:00.000Z";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    notes: emptyDoc(),
    projectId: "research",
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

function record(id: string, overrides: Partial<NamedRecord> = {}): NamedRecord {
  return { id, name: id, color: "#547ce8", updatedAt: stamp, ...overrides };
}

function workspace(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 1,
    tasks: [],
    projects: [],
    columns: [],
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe("daily planning", () => {
  it("schedules work for today while preserving the final deadline and original task", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(later));
    const original = task("paper", {
      doDate: "2026-09-10",
      deadline: "2026-10-14",
    });

    const scheduled = scheduleToday(original, today);

    expect(scheduled.doDate).toBe(today);
    expect(scheduled.deadline).toBe("2026-10-14");
    expect(scheduled.completedAt).toBeNull();
    expect(scheduled.updatedAt).toBe(later);
    expect(original.doDate).toBe("2026-09-10");
    expect(original.updatedAt).toBe(stamp);
  });

  it("includes only unfinished tasks deliberately scheduled for the current day", () => {
    const tasks = [
      task("chosen", { doDate: today, deadline: "2026-10-14" }),
      task("earlier", { doDate: "2026-09-13" }),
      task("tomorrow", { doDate: "2026-09-15" }),
      task("deadline-only", { deadline: today }),
      task("unscheduled"),
      task("done", { doDate: today, completedAt: stamp }),
      task("deleted", { doDate: today, deletedAt: stamp }),
    ];

    expect(
      tasks.filter((value) => isToday(value, today)).map((value) => value.id),
    ).toEqual(["chosen"]);
  });

  it("keeps unscheduled and future work active while excluding completed and deleted tasks", () => {
    const state = workspace({
      tasks: [
        task("unscheduled"),
        task("future", { doDate: "2026-10-01" }),
        task("done", { completedAt: stamp }),
        task("deleted", { deletedAt: stamp }),
      ],
    });

    expect(activeTasks(state).map((value) => value.id)).toEqual([
      "unscheduled",
      "future",
    ]);
  });
});

describe("workspace synchronization", () => {
  it("merges newer changes without losing other tasks, projects, or board columns", () => {
    const local = workspace({
      tasks: [task("paper"), task("local-only")],
      projects: [record("research"), record("personal")],
      columns: [record("next"), record("waiting")],
    });
    const remote = workspace({
      tasks: [
        task("paper", { title: "Revised title", updatedAt: later }),
        task("remote-only"),
      ],
      projects: [
        record("research", { name: "Research papers", updatedAt: later }),
      ],
      columns: [
        record("next", { name: "Ready", updatedAt: later }),
        record("review"),
      ],
    });
    const merged = mergeState(local, remote);

    expect(merged.tasks.map((value) => value.id).sort()).toEqual([
      "local-only",
      "paper",
      "remote-only",
    ]);
    expect(merged.tasks.find((value) => value.id === "paper")?.title).toBe(
      "Revised title",
    );
    expect(merged.projects.map((value) => value.id).sort()).toEqual([
      "personal",
      "research",
    ]);
    expect(merged.projects.find((value) => value.id === "research")?.name).toBe(
      "Research papers",
    );
    expect(merged.columns.map((value) => value.id).sort()).toEqual([
      "next",
      "review",
      "waiting",
    ]);
    expect(merged.columns.find((value) => value.id === "next")?.name).toBe(
      "Ready",
    );
    expect(local.tasks[0].title).toBe("Task paper");
  });

  it("preserves newer deletion tombstones when an offline device returns stale records", () => {
    const removed = workspace({
      tasks: [task("paper", { deletedAt: later, updatedAt: later })],
      projects: [record("research", { deletedAt: later, updatedAt: later })],
      columns: [record("next", { deletedAt: later, updatedAt: later })],
    });
    const stale = workspace({
      tasks: [task("paper")],
      projects: [record("research")],
      columns: [record("next")],
    });

    for (const result of [
      mergeState(removed, stale),
      mergeState(stale, removed),
    ]) {
      expect(result.tasks[0].deletedAt).toBe(later);
      expect(result.projects[0].deletedAt).toBe(later);
      expect(result.columns[0].deletedAt).toBe(later);
      expect(activeTasks(result)).toEqual([]);
    }
  });

  it("converges to identical state regardless of device merge order", () => {
    const left = workspace({
      tasks: [task("z"), task("shared")],
      projects: [record("work")],
    });
    const right = workspace({
      tasks: [task("a"), task("shared", { title: "Newer", updatedAt: later })],
      columns: [record("next")],
    });

    expect(mergeState(left, right)).toEqual(mergeState(right, left));
  });

  it("resolves an equal-timestamp edit and deletion identically, retaining the tombstone", () => {
    const edited = workspace({
      tasks: [task("paper", { title: "Edited on Mac" })],
    });
    const deleted = workspace({ tasks: [task("paper", { deletedAt: stamp })] });

    const result = mergeState(edited, deleted);
    expect(result).toEqual(mergeState(deleted, edited));
    expect(result.tasks[0].deletedAt).toBe(stamp);
  });

  it("resolves simultaneous edits deterministically and remains stable across repeated merges", () => {
    const left = workspace({
      tasks: [task("paper", { title: "Mac version" })],
    });
    const right = workspace({
      tasks: [task("paper", { title: "Phone version" })],
    });
    const result = mergeState(left, right);

    expect(result).toEqual(mergeState(right, left));
    expect(mergeState(result, left)).toEqual(result);
    expect(mergeState(result, right)).toEqual(result);
    expect(mergeState(result, result)).toEqual(result);
  });
});

describe("first-run examples on a second device", () => {
  it("cannot overwrite an edited list or restore a deleted example", () => {
    const first = createInitialState();
    first.projects[0] = {
      ...first.projects[0],
      name: "My renamed research list",
      updatedAt: "2026-09-14T01:00:00.000Z",
    };
    first.tasks[0] = {
      ...first.tasks[0],
      deletedAt: "2026-09-14T01:00:00.000Z",
      updatedAt: "2026-09-14T01:00:00.000Z",
    };
    const merged = mergeState(createInitialState(), first);
    expect(
      merged.projects.find((p) => p.id === first.projects[0].id)?.name,
    ).toBe("My renamed research list");
    expect(
      merged.tasks.find((t) => t.id === first.tasks[0].id)?.deletedAt,
    ).toBeTruthy();
  });
});

describe("tag synchronization", () => {
  it("opens and merges legacy workspaces without tags or task tagIds", () => {
    const legacy = workspace({ tasks: [task("legacy")] });
    const merged = mergeState(legacy, workspace());
    expect(merged.tags).toEqual([]);
    expect(merged.tasks).toEqual(legacy.tasks);
    expect(merged.tasks[0].tagIds).toBeUndefined();
    expect(legacy).not.toHaveProperty("tags");
  });

  it("retains tags when an older workspace omits the collection", () => {
    const tagged = workspace({
      tasks: [task("paper", { tagIds: ["reading"] })],
      tags: [{ ...record("reading"), name: "Reading", group: "action" }],
    });
    const legacy = workspace({ tasks: [task("other")] });
    const result = mergeState(tagged, legacy);
    expect(result).toEqual(mergeState(legacy, tagged));
    expect(result.tags).toEqual(tagged.tags);
    expect(result.tasks.find((value) => value.id === "paper")?.tagIds).toEqual([
      "reading",
    ]);
  });

  it("merges tag renames and groups without overwriting tasks or other tags", () => {
    const local = workspace({
      tasks: [task("paper", { tagIds: ["reading"] })],
      tags: [{ ...record("reading"), group: "topic" }, record("local")],
    });
    const remote = workspace({
      tags: [
        {
          ...record("reading", { name: "Read", updatedAt: later }),
          group: "action",
        },
        record("remote"),
      ],
    });
    const result = mergeState(local, remote);
    expect(result.tags?.map((tag) => tag.id)).toEqual([
      "local",
      "reading",
      "remote",
    ]);
    expect(result.tags?.find((tag) => tag.id === "reading")).toMatchObject({
      name: "Read",
      group: "action",
    });
    expect(result.tasks).toEqual(local.tasks);
    expect(result).toEqual(mergeState(remote, local));
  });

  it("does not resurrect deleted tags or removed task assignments from offline data", () => {
    const stale = workspace({
      tasks: [task("paper", { tagIds: ["reading"] })],
      tags: [{ ...record("reading"), group: "action" }],
    });
    const removed = workspace({
      tasks: [task("paper", { tagIds: [], updatedAt: later })],
      tags: [
        {
          ...record("reading", { deletedAt: later, updatedAt: later }),
          group: "action",
        },
      ],
    });
    for (const result of [
      mergeState(stale, removed),
      mergeState(removed, stale),
    ]) {
      expect(result.tasks[0].tagIds).toEqual([]);
      expect(result.tags?.[0].deletedAt).toBe(later);
    }
  });

  it("keeps a tag tombstone on equal timestamps and converges simultaneous tag edits", () => {
    const left = workspace({ tags: [record("tag", { name: "Read" })] });
    const right = workspace({ tags: [record("tag", { name: "Writing" })] });
    const merged = mergeState(left, right);
    expect(merged).toEqual(mergeState(right, left));
    expect(mergeState(merged, left)).toEqual(merged);
    const deleted = workspace({ tags: [record("tag", { deletedAt: stamp })] });
    expect(mergeState(left, deleted).tags?.[0].deletedAt).toBe(stamp);
    expect(mergeState(deleted, right).tags?.[0].deletedAt).toBe(stamp);
  });
});
