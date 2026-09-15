import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTasks,
  agendaEntries,
  createInitialState,
  emptyDoc,
  hasMissedWork,
  isScheduledOn,
  isToday,
  mergeState,
  nextWorkDate,
  schedulePatch,
  scheduleToday,
  toggleWorkDate,
  workDates,
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

    expect(scheduled.doDates).toEqual(["2026-09-10", today]);
    expect(scheduled.doDate).toBe("2026-09-10");
    expect(isToday(scheduled, today)).toBe(true);
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

describe("multiple work dates", () => {
  it("reads legacy dates without migrating or mutating task records", () => {
    const legacy = task("legacy", { doDate: today });
    expect(workDates(legacy)).toEqual([today]);
    expect(isScheduledOn(legacy, today)).toBe(true);
    expect(workDates(task("unscheduled"))).toEqual([]);
    expect(legacy).not.toHaveProperty("doDates");
    expect(legacy.updatedAt).toBe(stamp);
  });

  it("treats an explicit empty array as authoritative over a stale legacy date", () => {
    const cleared = task("cleared", { doDate: today, doDates: [] });
    expect(workDates(cleared)).toEqual([]);
    expect(isToday(cleared, today)).toBe(false);
    expect(nextWorkDate(cleared, today)).toBeNull();
    expect(schedulePatch([])).toEqual({ doDates: [], doDate: null });
  });

  it("canonicalizes date order and duplicates without changing the source array", () => {
    const dates = ["2026-09-21", today, "2026-09-17", today];
    const original = [...dates];
    const expected = [today, "2026-09-17", "2026-09-21"];
    const multi = task("multi", { doDate: "2026-08-01", doDates: dates });
    expect(workDates(multi)).toEqual(expected);
    expect(schedulePatch(dates)).toEqual({ doDates: expected, doDate: today });
    expect(dates).toEqual(original);
    expect(workDates(multi)).not.toBe(dates);
  });

  it("accepts real local calendar dates and rejects rollover dates and timestamps", () => {
    const dates = [
      "2024-02-29",
      "2000-02-29",
      "2026-02-28",
      "2026-03-08",
      "2026-02-29",
      "1900-02-29",
      "2026-04-31",
      "2026-09-00",
      "2026-13-01",
      "0000-01-01",
      "2026-9-14",
      "2026-09-14T00:00:00Z",
      " 2026-09-14",
      "2026-09-14\n",
      "2026-09-14\r",
      "not a date",
    ];
    expect(schedulePatch(dates).doDates).toEqual([
      "2000-02-29",
      "2024-02-29",
      "2026-02-28",
      "2026-03-08",
    ]);
    expect(workDates(task("invalid-legacy", { doDate: "2026-02-29" }))).toEqual(
      [],
    );
  });

  it("uses membership for Today and the next present or future work date", () => {
    const multi = task("multi", {
      doDate: "2026-09-10",
      doDates: ["2026-09-10", today, "2026-09-17", "2026-09-21"],
    });
    expect(isToday(multi, today)).toBe(true);
    expect(nextWorkDate(multi, today)).toBe(today);
    expect(nextWorkDate(multi, "2026-09-15")).toBe("2026-09-17");
    expect(nextWorkDate(multi, "2026-09-22")).toBeNull();
    expect(isToday({ ...multi, completedAt: stamp }, today)).toBe(false);
    expect(isToday({ ...multi, deletedAt: stamp }, today)).toBe(false);
  });

  it("adds and removes only the requested day, preserving the deadline and other days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(later));
    const original = task("paper", {
      doDate: "2026-09-17",
      doDates: ["2026-09-17", "2026-09-21"],
      deadline: "2026-10-14",
    });
    const added = toggleWorkDate(original, today);
    expect(added.doDates).toEqual([today, "2026-09-17", "2026-09-21"]);
    expect(added.doDate).toBe(today);
    expect(added.updatedAt).toBe(later);
    const removed = toggleWorkDate(added, today);
    expect(removed.doDates).toEqual(original.doDates);
    expect(removed.doDate).toBe("2026-09-17");
    expect(removed.deadline).toBe("2026-10-14");
    expect(original.updatedAt).toBe(stamp);
    expect(original.doDates).toEqual(["2026-09-17", "2026-09-21"]);
    expect(toggleWorkDate(original, "2026-02-29")).toBe(original);
  });

  it("removes the last legacy date without allowing it to reappear on read", () => {
    const removed = toggleWorkDate(task("legacy", { doDate: today }), today);
    expect(removed.doDates).toEqual([]);
    expect(removed.doDate).toBeNull();
    expect(workDates(removed)).toEqual([]);
  });

  it("adding Today repeatedly retains earlier and later dates without duplicates", () => {
    const original = task("paper", {
      doDate: "2026-09-10",
      doDates: ["2026-09-10", "2026-09-17"],
      deadline: "2026-10-14",
    });
    const planned = scheduleToday(scheduleToday(original, today), today);
    expect(planned.doDates).toEqual(["2026-09-10", today, "2026-09-17"]);
    expect(planned.doDate).toBe("2026-09-10");
    expect(planned.deadline).toBe(original.deadline);
    expect(scheduleToday(original, "invalid")).toBe(original);
  });

  it("only flags active tasks whose entire work schedule has passed", () => {
    const missed = task("missed", { doDates: ["2026-09-10", "2026-09-13"] });
    expect(hasMissedWork(missed, today)).toBe(true);
    expect(hasMissedWork(task("legacy", { doDate: "2026-09-13" }), today)).toBe(
      true,
    );
    expect(
      hasMissedWork(
        task("ongoing", { doDates: ["2026-09-10", "2026-09-17"] }),
        today,
      ),
    ).toBe(false);
    expect(
      hasMissedWork(task("today", { doDates: ["2026-09-10", today] }), today),
    ).toBe(false);
    expect(
      hasMissedWork(task("deadline-only", { deadline: "2026-09-10" }), today),
    ).toBe(false);
    expect(hasMissedWork({ ...missed, completedAt: stamp }, today)).toBe(false);
    expect(hasMissedWork({ ...missed, deletedAt: stamp }, today)).toBe(false);
  });
});

describe("agenda occurrences", () => {
  it("repeats a task for nonconsecutive work days and combines a coincident deadline", () => {
    const paper = task("paper", {
      doDate: "2026-09-10",
      doDates: ["2026-09-21", "2026-09-10", today, "2026-09-17", today],
      deadline: "2026-09-21",
    });
    const entries = agendaEntries([paper], today);
    expect(
      entries.map(({ date, work, deadline }) => ({ date, work, deadline })),
    ).toEqual([
      { date: today, work: true, deadline: false },
      { date: "2026-09-17", work: true, deadline: false },
      { date: "2026-09-21", work: true, deadline: true },
    ]);
    expect(entries.every((entry) => entry.task === paper)).toBe(true);
  });

  it("shows independent deadlines and sorts dates before stable task order", () => {
    const tasks = [
      task("z", { doDates: ["2026-09-17"], deadline: "2026-09-15" }),
      task("b", { doDate: "2026-09-17" }),
      task("a", { deadline: "2026-09-17" }),
      task("older", {
        doDates: ["2026-09-17"],
        createdAt: "2026-09-13T02:00:00.000Z",
      }),
      task("past", { doDate: "2026-09-12", deadline: "2026-09-13" }),
      task("invalid", { deadline: "2026-09-31" }),
      task("empty", { doDate: today, doDates: [] }),
    ];
    expect(
      agendaEntries(tasks, today).map(({ task, date, work, deadline }) => [
        task.id,
        date,
        work,
        deadline,
      ]),
    ).toEqual([
      ["z", "2026-09-15", false, true],
      ["older", "2026-09-17", true, false],
      ["a", "2026-09-17", false, true],
      ["b", "2026-09-17", true, false],
      ["z", "2026-09-17", true, false],
    ]);
  });
});

describe("workspace synchronization", () => {
  it("round-trips complete work-date arrays with last-write-wins additions and removals", () => {
    const stale = workspace({
      tasks: [
        task("paper", {
          ...schedulePatch([today, "2026-09-17", "2026-09-21"]),
          deadline: "2026-10-14",
        }),
      ],
    });
    const changed = workspace({
      tasks: [
        task("paper", {
          ...schedulePatch(["2026-09-17", "2026-09-24"]),
          deadline: "2026-10-14",
          updatedAt: later,
        }),
      ],
    });
    const imported = JSON.parse(JSON.stringify(changed)) as AppState;
    for (const merged of [
      mergeState(stale, imported),
      mergeState(imported, stale),
    ]) {
      expect(merged.tasks[0].doDates).toEqual(["2026-09-17", "2026-09-24"]);
      expect(merged.tasks[0].doDate).toBe("2026-09-17");
      expect(merged.tasks[0].deadline).toBe("2026-10-14");
      expect(workDates(merged.tasks[0])).not.toContain(today);
    }
  });

  it("retains an explicitly cleared schedule against older legacy data", () => {
    const stale = workspace({ tasks: [task("paper", { doDate: today })] });
    const cleared = workspace({
      tasks: [
        task("paper", {
          ...schedulePatch([]),
          updatedAt: later,
        }),
      ],
    });
    const result = mergeState(cleared, stale);
    expect(result).toEqual(mergeState(stale, cleared));
    expect(workDates(result.tasks[0])).toEqual([]);
    expect(result.tasks[0].doDate).toBeNull();
    expect(result.tasks[0].doDates).toEqual([]);
  });

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
