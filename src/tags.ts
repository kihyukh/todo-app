import { now } from "./model";
import type { AppState, TagGroup, TagRecord, Task } from "./model";

export const TAG_GROUPS: ReadonlyArray<{ id: TagGroup; name: string }> = [
  { id: "area", name: "Area" },
  { id: "action", name: "Work type" },
  { id: "topic", name: "Topic" },
];

/** Keep readable spelling while avoiding duplicate pasted hashes and spacing. */
export function normalizeTagName(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/^#+\s*/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Stable across device locales, including Korean and mixed-width Latin text. */
export function tagNameKey(name: string): string {
  return normalizeTagName(name).toLowerCase();
}

export function tagGroup(tag: TagRecord): TagGroup {
  return tag.group === "area" || tag.group === "action" ? tag.group : "topic";
}

export function findTagByName(
  tags: readonly TagRecord[],
  name: string,
  group?: TagGroup,
): TagRecord | undefined {
  const key = tagNameKey(name);
  if (!key) return undefined;
  return tags.find(
    (tag) =>
      !tag.deletedAt &&
      tagNameKey(tag.name) === key &&
      (group === undefined || tagGroup(tag) === group),
  );
}

export function activeTags(state: Pick<AppState, "tags">): TagRecord[] {
  const order = (tag: TagRecord) =>
    TAG_GROUPS.findIndex((group) => group.id === tagGroup(tag));
  return (state.tags ?? [])
    .filter((tag) => !tag.deletedAt)
    .sort(
      (a, b) =>
        order(a) - order(b) ||
        (a.order ?? Number.MAX_SAFE_INTEGER) -
          (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}

function uniqueIds(ids: readonly string[]): string[] {
  return [
    ...new Set(
      ids.filter((id) => typeof id === "string" && id.trim().length > 0),
    ),
  ];
}

export function taskTagIds(task: Pick<Task, "tagIds">): string[] {
  return uniqueIds(Array.isArray(task.tagIds) ? task.tagIds : []);
}

export function taskTags(
  task: Pick<Task, "tagIds">,
  state: Pick<AppState, "tags">,
): TagRecord[] {
  const assigned = new Set(taskTagIds(task));
  return activeTags(state).filter((tag) => assigned.has(tag.id));
}

/** An empty array deliberately records removal; an old absent field means no tags. */
export function setTaskTags(
  task: Task,
  ids: readonly string[],
  stamp = now(),
): Task {
  const tagIds = uniqueIds(ids);
  const oldIds = task.tagIds ?? [];
  if (
    oldIds.length === tagIds.length &&
    oldIds.every((id, index) => id === tagIds[index])
  )
    return task;
  return { ...task, tagIds, updatedAt: stamp };
}

export function assignTag(task: Task, id: string, stamp = now()): Task {
  return setTaskTags(task, [...taskTagIds(task), id], stamp);
}

export function removeTag(task: Task, id: string, stamp = now()): Task {
  return setTaskTags(
    task,
    taskTagIds(task).filter((assigned) => assigned !== id),
    stamp,
  );
}

/** Sidebar counts describe open work, including tasks without a do date. */
export function tasksWithTag(state: AppState, id: string): Task[] {
  if (!(state.tags ?? []).some((tag) => tag.id === id && !tag.deletedAt))
    return [];
  return state.tasks.filter(
    (task) =>
      !task.deletedAt && !task.completedAt && taskTagIds(task).includes(id),
  );
}

export function tagCounts(state: AppState): Map<string, number> {
  const counts = new Map(activeTags(state).map((tag) => [tag.id, 0]));
  for (const task of state.tasks) {
    if (task.deletedAt || task.completedAt) continue;
    for (const id of taskTagIds(task))
      if (counts.has(id)) counts.set(id, counts.get(id)! + 1);
  }
  return counts;
}
