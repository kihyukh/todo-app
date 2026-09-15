import { describe, expect, it } from "vitest";
import { deleteList, repairDeletedLists, undoDeleteList } from "../src/lists";
import { emptyDoc, mergeState } from "../src/model";
import type { AppState, NamedRecord, Task } from "../src/model";

const stamp = "2026-09-14T00:00:00.000Z";
const deletedAt = "2026-09-15T00:00:00.000Z";
const later = "2026-09-16T00:00:00.000Z";
const future = "2030-01-01T00:00:00.000Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "research",
  columnId: "progress",
  doDate: "2026-09-17",
  doDates: ["2026-09-17", "2026-09-21"],
  deadline: "2026-10-01",
  completedAt: null,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
  attachments: [
    {
      id: "pdf",
      name: "Paper.pdf",
      mime: "application/pdf",
      size: 12,
      url: "daymark://attachment/paper.pdf",
    },
  ],
  tagIds: ["review"],
  priority: 3,
  manualOrder: { "project:research": 10 },
  ...extra,
});
const list = (extra: Partial<NamedRecord> = {}): NamedRecord => ({
  id: "research",
  name: "Research",
  color: "#24704f",
  order: 20,
  updatedAt: stamp,
  ...extra,
});
const workspace = (extra: Partial<AppState> = {}): AppState => ({
  schemaVersion: 1,
  tasks: [task("paper")],
  projects: [list()],
  columns: [],
  tags: [],
  ...extra,
});

describe("list deletion", () => {
  it("moves active, completed, and trashed members to Inbox while preserving every other task field", () => {
    const state = workspace({
      tasks: [
        task("active"),
        task("done", { completedAt: stamp }),
        task("trash", { deletedAt: stamp }),
        task("other", { projectId: "teaching" }),
      ],
    });
    const result = deleteList(state, "research", deletedAt)!;

    expect(result.receipt).toEqual({
      id: "research",
      name: "Research",
      deletedAt,
      taskIds: ["active", "done", "trash"],
    });
    expect(result.state.projects[0]).toEqual({
      ...state.projects[0],
      deletedAt,
      updatedAt: deletedAt,
    });
    for (const original of state.tasks.slice(0, 3)) {
      expect(
        result.state.tasks.find((item) => item.id === original.id),
      ).toEqual({ ...original, projectId: "", updatedAt: deletedAt });
      expect(original.projectId).toBe("research");
    }
    expect(result.state.tasks[3]).toBe(state.tasks[3]);
    expect(result.state.columns).toBe(state.columns);
    expect(result.state.tags).toBe(state.tags);
    expect(state.projects[0].deletedAt).toBeUndefined();
  });

  it("deletes empty lists but cannot delete Inbox, a missing list, or an already deleted list", () => {
    const state = workspace({ tasks: [] });
    const result = deleteList(state, "research", deletedAt)!;
    expect(result.receipt.taskIds).toEqual([]);
    expect(result.state.projects[0].deletedAt).toBe(deletedAt);
    expect(deleteList(state, "", deletedAt)).toBeNull();
    expect(deleteList(state, "missing", deletedAt)).toBeNull();
    expect(deleteList(result.state, "research", later)).toBeNull();
  });

  it("advances list and member timestamps even when the device clock is behind existing records", () => {
    const state = workspace({
      projects: [list({ updatedAt: future })],
      tasks: [task("paper", { updatedAt: "2031-01-01T00:00:00.000Z" })],
    });
    const result = deleteList(state, "research", deletedAt)!;
    expect(result.receipt.deletedAt).toBe("2030-01-01T00:00:00.001Z");
    expect(result.state.tasks[0].updatedAt).toBe("2031-01-01T00:00:00.001Z");
    expect(mergeState(state, result.state).tasks[0].projectId).toBe("");
    expect(mergeState(state, result.state).projects[0].deletedAt).toBe(
      result.receipt.deletedAt,
    );
  });
});

describe("undo list deletion", () => {
  it("restores the original list and members without changing completion or trash status", () => {
    const initial = workspace({
      tasks: [
        task("active"),
        task("done", { completedAt: stamp }),
        task("trash", { deletedAt: stamp }),
      ],
    });
    const result = deleteList(initial, "research", deletedAt)!;
    const restored = undoDeleteList(result.state, result.receipt, later);
    expect(restored.projects[0]).toEqual({
      ...initial.projects[0],
      deletedAt: null,
      updatedAt: later,
    });
    expect(restored.tasks).toEqual(
      initial.tasks.map((item) => ({ ...item, updatedAt: later })),
    );
    expect(mergeState(restored, result.state)).toEqual(
      mergeState(result.state, restored),
    );
    expect(mergeState(restored, result.state).projects[0].deletedAt).toBeNull();
  });

  it("preserves subsequent task edits, deliberate moves, new Inbox tasks, and current list fields", () => {
    const initial = workspace({ tasks: [task("edited"), task("moved")] });
    const result = deleteList(initial, "research", deletedAt)!;
    const notes = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "New notes" }] },
      ],
    };
    const current = {
      ...result.state,
      projects: result.state.projects.map((project) => ({
        ...project,
        name: "Research papers",
        color: "#627087",
        updatedAt: later,
      })),
      tasks: [
        {
          ...result.state.tasks[0],
          projectId: null,
          notes,
          deadline: "2026-12-01",
          updatedAt: later,
        },
        { ...result.state.tasks[1], projectId: "teaching", updatedAt: later },
        task("new", { projectId: "", updatedAt: later }),
      ],
    };
    const restored = undoDeleteList(current, result.receipt, later);
    expect(restored.tasks[0]).toEqual({
      ...current.tasks[0],
      projectId: "research",
      updatedAt: "2026-09-16T00:00:00.001Z",
    });
    expect(restored.tasks[1]).toBe(current.tasks[1]);
    expect(restored.tasks[2]).toBe(current.tasks[2]);
    expect(restored.projects[0]).toEqual({
      ...current.projects[0],
      deletedAt: null,
      updatedAt: "2026-09-16T00:00:00.001Z",
    });
  });

  it("does not undo another deletion or repeat an already used receipt", () => {
    const result = deleteList(workspace(), "research", deletedAt)!;
    const restored = undoDeleteList(result.state, result.receipt, later);
    expect(undoDeleteList(restored, result.receipt, future)).toBe(restored);
    const deletedAgain = deleteList(restored, "research", later)!;
    expect(deletedAgain.receipt.deletedAt).not.toBe(result.receipt.deletedAt);
    expect(undoDeleteList(deletedAgain.state, result.receipt, future)).toBe(
      deletedAgain.state,
    );
    const missing = { ...result.state, projects: [] };
    expect(undoDeleteList(missing, result.receipt, future)).toBe(missing);
  });

  it("never rolls timestamps back when undo happens within a millisecond or against future-dated edits", () => {
    const result = deleteList(workspace(), "research", future)!;
    const restored = undoDeleteList(result.state, result.receipt, deletedAt);
    expect(restored.projects[0].updatedAt).toBe("2030-01-01T00:00:00.001Z");
    expect(restored.tasks[0].updatedAt).toBe("2030-01-01T00:00:00.001Z");
  });
});

describe("deleted list synchronization", () => {
  it("keeps list tombstones and Inbox membership when a stale device saves", () => {
    const original = workspace();
    const result = deleteList(original, "research", deletedAt)!;
    const merged = mergeState(result.state, original);
    expect(merged).toEqual(mergeState(original, result.state));
    expect(merged.projects[0].deletedAt).toBe(deletedAt);
    expect(merged.tasks[0]).toEqual(result.state.tasks[0]);
  });

  it("retains newer offline task content while repairing its reference to the deleted list", () => {
    const original = workspace();
    const result = deleteList(original, "research", deletedAt)!;
    const remoteTask = task("paper", {
      title: "Offline revision",
      deadline: "2026-11-01",
      updatedAt: later,
    });
    const remote = workspace({ tasks: [remoteTask] });
    const merged = mergeState(result.state, remote);
    expect(merged).toEqual(mergeState(remote, result.state));
    expect(merged.tasks[0]).toEqual({
      ...remoteTask,
      projectId: "",
      updatedAt: "2026-09-16T00:00:00.001Z",
    });
    expect(mergeState(merged, remote)).toEqual(merged);
  });

  it("rehomes tasks created remotely in a deleted list even when they were absent from the deletion receipt", () => {
    const original = workspace();
    const result = deleteList(original, "research", deletedAt)!;
    const remote = workspace({
      tasks: [
        ...original.tasks,
        task("new-offline", { updatedAt: later }),
        task("completed-offline", { completedAt: later, updatedAt: later }),
        task("trash-offline", { deletedAt: later, updatedAt: later }),
      ],
    });
    const merged = mergeState(result.state, remote);
    expect(merged.tasks.every((item) => item.projectId === "")).toBe(true);
    expect(
      merged.tasks.find((item) => item.id === "completed-offline")?.completedAt,
    ).toBe(later);
    expect(
      merged.tasks.find((item) => item.id === "trash-offline")?.deletedAt,
    ).toBe(later);
    const restored = undoDeleteList(merged, result.receipt, future);
    expect(restored.tasks.find((item) => item.id === "paper")?.projectId).toBe(
      "research",
    );
    expect(
      restored.tasks
        .filter((item) => item.id !== "paper")
        .every((item) => item.projectId === ""),
    ).toBe(true);
  });

  it("retains unknown list references because cloud records may arrive separately", () => {
    const initial = workspace({
      projects: [list({ deletedAt, updatedAt: deletedAt })],
      tasks: [
        task("unknown", { projectId: "pending-download" }),
        task("inbox", { projectId: "" }),
      ],
    });
    expect(repairDeletedLists(initial)).toBe(initial);
    expect(
      mergeState(initial, workspace({ tasks: [], projects: [] })).tasks.find(
        (item) => item.id === "unknown",
      )?.projectId,
    ).toBe("pending-download");
    const active = workspace();
    expect(repairDeletedLists(active)).toBe(active);
  });

  it("can repair an initial snapshot directly and is deterministic and idempotent", () => {
    const initial = workspace({
      projects: [list({ deletedAt, updatedAt: deletedAt })],
    });
    const repaired = repairDeletedLists(initial);
    expect(repaired.tasks[0]).toEqual({
      ...initial.tasks[0],
      projectId: "",
      updatedAt: "2026-09-15T00:00:00.001Z",
    });
    expect(repairDeletedLists(repaired)).toBe(repaired);
    expect(repairDeletedLists(JSON.parse(JSON.stringify(initial)))).toEqual(
      repaired,
    );
    expect(initial.tasks[0].projectId).toBe("research");
    expect(repaired.projects).toBe(initial.projects);
  });

  it("makes repaired membership newer than every relevant future record timestamp", () => {
    const initial = workspace({
      projects: [
        list({ deletedAt: future, updatedAt: "2031-01-01T00:00:00.000Z" }),
      ],
      tasks: [
        task("old"),
        task("newer", { updatedAt: "2032-01-01T00:00:00.000Z" }),
      ],
    });
    const repaired = repairDeletedLists(initial);
    expect(repaired.tasks[0].updatedAt).toBe("2031-01-01T00:00:00.001Z");
    expect(repaired.tasks[1].updatedAt).toBe("2032-01-01T00:00:00.001Z");
    expect(mergeState(initial, repaired)).toEqual(
      mergeState(repaired, initial),
    );
    expect(
      mergeState(initial, repaired).tasks.every(
        (item) => item.projectId === "",
      ),
    ).toBe(true);
  });
});
