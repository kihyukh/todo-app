import type { AppState, Task } from "./model";
import { compareTaskPriority } from "./task-planning";

export const TASK_DRAG_MIME = "application/x-greenday-task";
export type TaskDragSession = { id: string; token: string };
export type TaskDropDestination =
  | { kind: "project"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "column"; id: string }
  | { kind: "reorder"; id: string; scope: string; edge: "before" | "after" };
type Transfer = Pick<DataTransfer, "types" | "getData">;
export const isActiveTask = (task: Task | undefined): task is Task =>
  !!task && !task.deletedAt && !task.completedAt;
export function isManualTaskView(view: string): boolean {
  return view === "all" || view === "inbox" || /^(project|tag):.+/.test(view);
}
export function canReorderTasks(
  view: string,
  mode: string,
  query: string,
): boolean {
  return mode === "list" && !query && isManualTaskView(view);
}
export function taskInManualView(task: Task, view: string): boolean {
  if (!isActiveTask(task)) return false;
  if (view === "all") return true;
  if (view === "inbox") return !task.projectId;
  if (view.startsWith("project:")) return task.projectId === view.slice(8);
  if (view.startsWith("tag:"))
    return (task.tagIds ?? []).includes(view.slice(4));
  return false;
}
function rank(task: Task, scope: string): number | undefined {
  const value = task.manualOrder?.[scope];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
export function compareManualTasks(a: Task, b: Task, scope: string): number {
  const first = rank(a, scope),
    second = rank(b, scope);
  if (first !== undefined || second !== undefined) {
    if (first === undefined) return 1;
    if (second === undefined) return -1;
    if (first !== second) return first - second;
  }
  return compareTaskPriority(a, b);
}
/** Protected dragover data is unreadable, so require our live local session too. */
export function acceptsTaskTransfer(
  transfer: Transfer,
  session: TaskDragSession | null,
  state: AppState,
): boolean {
  return (
    !!session &&
    Array.from(transfer.types).includes(TASK_DRAG_MIME) &&
    !Array.from(transfer.types).includes("Files") &&
    isActiveTask(state.tasks.find((task) => task.id === session.id))
  );
}
export function readDraggedTask(
  transfer: Transfer,
  session: TaskDragSession | null,
  state: AppState,
): Task | undefined {
  if (!acceptsTaskTransfer(transfer, session, state)) return;
  try {
    const data = JSON.parse(transfer.getData(TASK_DRAG_MIME));
    if (data.id !== session!.id || data.token !== session!.token) return;
    return state.tasks.find((task) => task.id === data.id);
  } catch {
    return;
  }
}

type FieldChange =
  | {
      id: string;
      field: "projectId" | "columnId";
      before: string;
      after: string;
    }
  | { id: string; field: "tag"; key: string; before: boolean; after: boolean }
  | {
      id: string;
      field: "order";
      key: string;
      before: number | undefined;
      after: number | undefined;
    };
export type TaskDropChange = {
  taskId: string;
  destination: TaskDropDestination | { kind: "resetOrder"; scope: string };
  changes: FieldChange[];
  message: string;
};
function validDestination(
  state: AppState,
  destination: TaskDropChange["destination"],
): boolean {
  if (destination.kind === "project")
    return (
      !destination.id ||
      state.projects.some((p) => p.id === destination.id && !p.deletedAt)
    );
  if (destination.kind === "tag")
    return (state.tags ?? []).some(
      (tag) => tag.id === destination.id && !tag.deletedAt,
    );
  if (destination.kind === "column")
    return state.columns.some(
      (column) => column.id === destination.id && !column.deletedAt,
    );
  if (!isManualTaskView(destination.scope)) return false;
  if (destination.scope.startsWith("project:"))
    return state.projects.some(
      (p) => p.id === destination.scope.slice(8) && !p.deletedAt,
    );
  if (destination.scope.startsWith("tag:"))
    return (state.tags ?? []).some(
      (tag) => tag.id === destination.scope.slice(4) && !tag.deletedAt,
    );
  return true;
}
export function planResetTaskOrder(
  state: AppState,
  scope: string,
): TaskDropChange | null {
  const tasks = state.tasks.filter(
    (task) => taskInManualView(task, scope) && rank(task, scope) !== undefined,
  );
  if (!tasks.length || !validDestination(state, { kind: "resetOrder", scope }))
    return null;
  return {
    taskId: tasks[0].id,
    destination: { kind: "resetOrder", scope },
    changes: tasks.map((task) => ({
      id: task.id,
      field: "order",
      key: scope,
      before: rank(task, scope),
      after: undefined,
    })),
    message: "Restored priority order",
  };
}
export function planTaskDrop(
  state: AppState,
  taskId: string,
  destination: TaskDropDestination,
): TaskDropChange | null {
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!isActiveTask(task) || !validDestination(state, destination)) return null;
  if (destination.kind === "reorder") {
    const { scope, edge, id } = destination;
    const ordered = state.tasks
      .filter((item) => taskInManualView(item, scope))
      .sort((a, b) => compareManualTasks(a, b, scope));
    const from = ordered.findIndex((item) => item.id === taskId);
    if (from < 0 || taskId === id || !ordered.some((item) => item.id === id))
      return null;
    const moved = ordered.filter((item) => item.id !== taskId);
    const target =
      moved.findIndex((item) => item.id === id) + (edge === "after" ? 1 : 0);
    moved.splice(target, 0, task);
    if (ordered.every((item, index) => item.id === moved[index].id))
      return null;
    return {
      taskId,
      destination,
      changes: moved.flatMap((item, index): FieldChange[] =>
        rank(item, scope) === index
          ? []
          : [
              {
                id: item.id,
                field: "order",
                key: scope,
                before: rank(item, scope),
                after: index,
              },
            ],
      ),
      message: `Reordered ${task.title}`,
    };
  }
  if (destination.kind === "tag") {
    if ((task.tagIds ?? []).includes(destination.id)) return null;
    const tag = state.tags!.find((item) => item.id === destination.id)!;
    return {
      taskId,
      destination,
      changes: [
        { id: task.id, field: "tag", key: tag.id, before: false, after: true },
      ],
      message: `Added ${tag.name} to ${task.title}`,
    };
  }
  const field = destination.kind === "project" ? "projectId" : "columnId";
  if (task[field] === destination.id) return null;
  const name =
    destination.kind === "project"
      ? (state.projects.find((item) => item.id === destination.id)?.name ??
        "Inbox")
      : state.columns.find((item) => item.id === destination.id)!.name;
  return {
    taskId,
    destination,
    changes: [
      { id: task.id, field, before: task[field], after: destination.id },
    ],
    message: `Moved ${task.title} to ${name}`,
  };
}
/** Apply only the named fields to current records; unrelated newer edits survive. */
export function applyTaskDrop(
  state: AppState,
  change: TaskDropChange,
  undo = false,
  timestamp = Date.now(),
): AppState {
  if (!undo && !validDestination(state, change.destination)) return state;
  if (
    !undo &&
    !isActiveTask(state.tasks.find((task) => task.id === change.taskId))
  )
    return state;
  if (!undo && change.destination.kind === "reorder") {
    const { id, scope } = change.destination;
    if (
      ![id, change.taskId].every((taskId) =>
        state.tasks.some(
          (task) => task.id === taskId && taskInManualView(task, scope),
        ),
      )
    )
      return state;
  }
  let changed = false;
  const tasks = state.tasks.map((original) => {
    if (!isActiveTask(original)) return original;
    let task = original;
    for (const field of change.changes.filter((item) => item.id === task.id)) {
      const expected = undo ? field.after : field.before;
      const value = undo ? field.before : field.after;
      if (field.field === "order") {
        if (rank(task, field.key) !== expected) continue;
        if (!undo && !taskInManualView(task, field.key)) continue;
        const manualOrder = { ...task.manualOrder };
        if (value === undefined) delete manualOrder[field.key];
        else manualOrder[field.key] = value as number;
        task = { ...task, manualOrder };
        if (!Object.keys(manualOrder).length) delete task.manualOrder;
      } else if (field.field === "tag") {
        if ((task.tagIds ?? []).includes(field.key) !== expected) continue;
        task = {
          ...task,
          tagIds: value
            ? [...(task.tagIds ?? []), field.key]
            : (task.tagIds ?? []).filter((id) => id !== field.key),
        };
      } else {
        if (task[field.field] !== expected) continue;
        if (
          undo &&
          field.field === "projectId" &&
          value &&
          !state.projects.some(
            (project) => project.id === value && !project.deletedAt,
          )
        )
          continue;
        if (
          undo &&
          field.field === "columnId" &&
          !state.columns.some(
            (column) => column.id === value && !column.deletedAt,
          )
        )
          continue;
        task = { ...task, [field.field]: value };
      }
    }
    if (task === original) return original;
    changed = true;
    return {
      ...task,
      updatedAt: new Date(
        Math.max(timestamp, (Date.parse(task.updatedAt) || 0) + 1),
      ).toISOString(),
    };
  });
  return changed ? { ...state, tasks } : state;
}
