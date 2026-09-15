import { describe, expect, it } from "vitest";
import { emptyDoc, mergeState } from "../src/model";
import type { AppState, Task } from "../src/model";
import {
  TASK_DRAG_MIME,
  acceptsTaskTransfer,
  applyTaskDrop,
  canReorderTasks,
  compareManualTasks,
  planResetTaskOrder,
  planTaskDrop,
  readDraggedTask,
} from "../src/task-drag";
const stamp = "2026-09-01T00:00:00.000Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
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
  ...extra,
});
function workspace(
  tasks: Task[] = [task("a"), task("b"), task("c")],
): AppState {
  return {
    schemaVersion: 1,
    tasks,
    projects: ["research", "teaching"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
    tags: ["reading", "writing", "topic"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
    columns: ["next", "progress"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
  };
}
const order = (state: AppState, scope = "all") =>
  [...state.tasks]
    .sort((a, b) => compareManualTasks(a, b, scope))
    .map((task) => task.id);
describe("task organization", () => {
  it("persists per-view ordering through ID-sorted merge and JSON without changing task content", () => {
    const state = workspace();
    const move = planTaskDrop(state, "c", {
      kind: "reorder",
      id: "a",
      scope: "all",
      edge: "before",
    })!;
    const changed = applyTaskDrop(state, move);
    const restored = mergeState(state, JSON.parse(JSON.stringify(changed)));
    expect(restored.tasks.map((task) => task.id)).toEqual(["a", "b", "c"]);
    expect(order(restored)).toEqual(["c", "a", "b"]);
    expect(order(restored, "project:research")).toEqual(["a", "b", "c"]);
    restored.tasks.forEach(({ manualOrder, updatedAt, ...rest }) => {
      const { updatedAt: oldStamp, ...old } = state.tasks.find(
        (task) => task.id === rest.id,
      )!;
      expect(rest).toEqual(old);
      expect(manualOrder).toBeDefined();
      expect(updatedAt > oldStamp).toBe(true);
    });
  });
  it("keeps list/tag order independent and resets only the selected scope with reversible Undo", () => {
    let state = workspace([
      task("a", { tagIds: ["reading"] }),
      task("b", { tagIds: ["reading"] }),
      task("c", { tagIds: ["reading"] }),
    ]);
    state = applyTaskDrop(
      state,
      planTaskDrop(state, "c", {
        kind: "reorder",
        id: "a",
        scope: "project:research",
        edge: "before",
      })!,
    );
    state = applyTaskDrop(
      state,
      planTaskDrop(state, "b", {
        kind: "reorder",
        id: "a",
        scope: "tag:reading",
        edge: "before",
      })!,
    );
    expect(order(state, "project:research")).toEqual(["c", "a", "b"]);
    expect(order(state, "tag:reading")).toEqual(["b", "a", "c"]);
    const reset = planResetTaskOrder(state, "project:research")!;
    const resetState = applyTaskDrop(state, reset);
    expect(order(resetState, "project:research")).toEqual(["a", "b", "c"]);
    expect(order(resetState, "tag:reading")).toEqual(["b", "a", "c"]);
    expect(
      order(applyTaskDrop(resetState, reset, true), "project:research"),
    ).toEqual(["c", "a", "b"]);
  });
  it("does not reorder no-op, stale, completed, trashed, or out-of-view tasks", () => {
    const state = workspace([
      task("a"),
      task("b", { completedAt: stamp }),
      task("c", { deletedAt: stamp }),
      task("elsewhere", { projectId: "teaching" }),
    ]);
    for (const id of ["missing", "b", "c", "elsewhere", "a"])
      expect(
        planTaskDrop(state, id, {
          kind: "reorder",
          id: "a",
          scope: "project:research",
          edge: "before",
        }),
      ).toBeNull();
    expect(
      planTaskDrop(workspace(), "a", {
        kind: "reorder",
        id: "b",
        scope: "all",
        edge: "before",
      }),
    ).toBeNull();
    expect(
      planTaskDrop(workspace(), "c", {
        kind: "reorder",
        id: "a",
        scope: "today",
        edge: "before",
      }),
    ).toBeNull();
  });
  it("enables manual order only in unfiltered ordinary list views", () => {
    for (const view of ["all", "inbox", "project:research", "tag:reading"]) {
      expect(canReorderTasks(view, "list", "")).toBe(true);
      expect(canReorderTasks(view, "board", "")).toBe(false);
      expect(canReorderTasks(view, "list", "a")).toBe(false);
    }
    for (const view of [
      "today",
      "upcoming",
      "calendar",
      "completed",
      "trash",
      "checkboxes",
    ])
      expect(canReorderTasks(view, "list", "")).toBe(false);
  });
  it("moves only the list field and Undo preserves later note, schedule, priority and tag edits", () => {
    const state = workspace();
    const move = planTaskDrop(state, "a", { kind: "project", id: "teaching" })!;
    const moved = applyTaskDrop(state, move);
    const notes = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Later note" }] },
      ],
    };
    moved.tasks[0] = {
      ...moved.tasks[0],
      notes,
      doDates: ["2026-09-20"],
      deadline: "2026-09-25",
      priority: 3,
      tagIds: ["reading"],
    };
    const undone = applyTaskDrop(moved, move, true);
    expect(undone.tasks[0]).toMatchObject({
      projectId: "research",
      notes,
      doDates: ["2026-09-20"],
      deadline: "2026-09-25",
      priority: 3,
      tagIds: ["reading"],
    });
    const movedAgain = {
      ...moved,
      tasks: moved.tasks.map((task) =>
        task.id === "a" ? { ...task, projectId: "" } : task,
      ),
    };
    expect(applyTaskDrop(movedAgain, move, true)).toBe(movedAgain);
  });
  it("adds tags idempotently and Undo removes only the newly added tag", () => {
    const state = workspace([task("a", { tagIds: ["reading"] })]);
    const change = planTaskDrop(state, "a", { kind: "tag", id: "writing" })!;
    const tagged = applyTaskDrop(state, change);
    expect(tagged.tasks[0]).toMatchObject({
      projectId: "research",
      tagIds: ["reading", "writing"],
    });
    expect(
      planTaskDrop(tagged, "a", { kind: "tag", id: "writing" }),
    ).toBeNull();
    tagged.tasks[0] = {
      ...tagged.tasks[0],
      tagIds: [...tagged.tasks[0].tagIds!, "topic"],
    };
    expect(applyTaskDrop(tagged, change, true).tasks[0].tagIds).toEqual([
      "reading",
      "topic",
    ]);
  });
  it("retains board moves and Inbox while rejecting invalid or deleted destinations", () => {
    const state = workspace();
    expect(
      applyTaskDrop(
        state,
        planTaskDrop(state, "a", { kind: "column", id: "progress" })!,
      ).tasks[0],
    ).toMatchObject({ columnId: "progress", projectId: "research" });
    expect(
      applyTaskDrop(
        state,
        planTaskDrop(state, "a", { kind: "project", id: "" })!,
      ).tasks[0].projectId,
    ).toBe("");
    expect(
      planTaskDrop(state, "a", { kind: "column", id: "missing" }),
    ).toBeNull();
    state.tags![0].deletedAt = stamp;
    expect(planTaskDrop(state, "a", { kind: "tag", id: "reading" })).toBeNull();
  });
  it("rejects a source that completes or moves out of scope before a planned drop applies", () => {
    const state = workspace();
    const move = planTaskDrop(state, "c", {
      kind: "reorder",
      id: "a",
      scope: "project:research",
      edge: "before",
    })!;
    const completed = {
      ...state,
      tasks: state.tasks.map((task) =>
        task.id === "c" ? { ...task, completedAt: stamp } : task,
      ),
    };
    expect(applyTaskDrop(completed, move)).toBe(completed);
    const moved = {
      ...state,
      tasks: state.tasks.map((task) =>
        task.id === "c" ? { ...task, projectId: "teaching" } : task,
      ),
    };
    expect(applyTaskDrop(moved, move)).toBe(moved);
  });
  it("requires both the internal MIME and current session, rejecting arbitrary text/files and stale tokens", () => {
    const state = workspace(),
      session = { id: "a", token: "session-one" };
    const transfer = (types: string[], payload: unknown = session) => ({
      types,
      getData: () => JSON.stringify(payload),
    });
    expect(
      readDraggedTask(transfer([TASK_DRAG_MIME]), session, state)?.id,
    ).toBe("a");
    expect(
      acceptsTaskTransfer(transfer([TASK_DRAG_MIME], ""), session, state),
    ).toBe(true);
    expect(
      readDraggedTask(transfer(["text/plain"]), session, state),
    ).toBeUndefined();
    expect(
      readDraggedTask(transfer([TASK_DRAG_MIME, "Files"]), session, state),
    ).toBeUndefined();
    expect(
      readDraggedTask(transfer([TASK_DRAG_MIME]), null, state),
    ).toBeUndefined();
    expect(
      readDraggedTask(
        transfer([TASK_DRAG_MIME], { ...session, token: "old" }),
        session,
        state,
      ),
    ).toBeUndefined();
    state.tasks[0].completedAt = stamp;
    expect(
      readDraggedTask(transfer([TASK_DRAG_MIME]), session, state),
    ).toBeUndefined();
  });
});
