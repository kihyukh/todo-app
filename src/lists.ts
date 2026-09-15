import type { AppState } from "./model";

export type ListDeletionReceipt = {
  id: string;
  name: string;
  deletedAt: string;
  taskIds: string[];
};

function milliseconds(stamp: string | number): number {
  const value = typeof stamp === "number" ? stamp : Date.parse(stamp);
  return Number.isFinite(value) ? value : 0;
}

function nextTimestamp(stamp: string | number, ...previous: string[]): string {
  return new Date(
    Math.max(
      milliseconds(stamp),
      ...previous.map((value) => milliseconds(value) + 1),
    ),
  ).toISOString();
}

/** Keep the list tombstone so an offline device cannot resurrect it on save. */
export function deleteList(
  state: AppState,
  id: string,
  stamp: string | number = Date.now(),
): { state: AppState; receipt: ListDeletionReceipt } | null {
  const list = state.projects.find((project) => project.id === id);
  if (!id || !list || list.deletedAt) return null;
  const deletedAt = nextTimestamp(stamp, list.updatedAt);
  const taskIds = state.tasks
    .filter((task) => task.projectId === id)
    .map((task) => task.id);
  return {
    receipt: { id, name: list.name, deletedAt, taskIds },
    state: {
      ...state,
      projects: state.projects.map((project) =>
        project.id === id
          ? { ...project, deletedAt, updatedAt: deletedAt }
          : project,
      ),
      tasks: state.tasks.map((task) =>
        task.projectId === id
          ? {
              ...task,
              projectId: "",
              updatedAt: nextTimestamp(deletedAt, task.updatedAt),
            }
          : task,
      ),
    },
  };
}

/** Restore membership without rolling back edits or deliberate moves made since deletion. */
export function undoDeleteList(
  state: AppState,
  receipt: ListDeletionReceipt,
  stamp: string | number = Date.now(),
): AppState {
  const list = state.projects.find((project) => project.id === receipt.id);
  if (!list?.deletedAt || list.deletedAt !== receipt.deletedAt) return state;
  const restoredAt = nextTimestamp(stamp, list.updatedAt, list.deletedAt);
  const taskIds = new Set(receipt.taskIds);
  return {
    ...state,
    projects: state.projects.map((project) =>
      project.id === receipt.id
        ? { ...project, deletedAt: null, updatedAt: restoredAt }
        : project,
    ),
    tasks: state.tasks.map((task) =>
      taskIds.has(task.id) && !task.projectId
        ? {
            ...task,
            projectId: receipt.id,
            updatedAt: nextTimestamp(restoredAt, task.updatedAt),
          }
        : task,
    ),
  };
}

/**
 * A newer edit from an offline device may still point at a deleted list.
 * Repair only known tombstones: an unknown list may be awaiting cloud download.
 * The deterministic timestamp beats both records without producing sync churn.
 */
export function repairDeletedLists(state: AppState): AppState {
  const deleted = new Map(
    state.projects
      .filter((project) => project.deletedAt)
      .map((project) => [project.id, project]),
  );
  if (!deleted.size) return state;
  let changed = false;
  const tasks = state.tasks.map((task) => {
    const list = deleted.get(task.projectId);
    if (!task.projectId || !list) return task;
    changed = true;
    return {
      ...task,
      projectId: "",
      updatedAt: nextTimestamp(
        0,
        task.updatedAt,
        list.updatedAt,
        list.deletedAt!,
      ),
    };
  });
  return changed ? { ...state, tasks } : state;
}
