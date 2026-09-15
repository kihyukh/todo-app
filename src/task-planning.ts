import { addDays, isScheduledOn } from "./model";
import type { Task } from "./model";

export const priorityLabels = ["No priority", "Low", "Medium", "High"] as const;
export function taskPriority(task: Task): number {
  return Number.isInteger(task.priority) &&
    task.priority! >= 0 &&
    task.priority! <= 3
    ? task.priority!
    : 0;
}
export function compareTaskPriority(a: Task, b: Task): number {
  return (
    taskPriority(b) - taskPriority(a) ||
    (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}
export function isDueSoon(task: Task, today: string): boolean {
  return (
    !task.deletedAt &&
    !task.completedAt &&
    !!task.deadline &&
    task.deadline <= addDays(7, new Date(`${today}T12:00:00`))
  );
}
export function planningCandidates(
  tasks: Task[],
  today: string,
  progressId?: string,
  filter: "all" | "urgent" | "progress" = "all",
): Task[] {
  return tasks
    .filter(
      (task) =>
        !task.deletedAt &&
        !task.completedAt &&
        !isScheduledOn(task, today) &&
        (filter === "urgent"
          ? isDueSoon(task, today)
          : filter === "progress"
            ? !!progressId && task.columnId === progressId
            : true),
    )
    .sort(
      (a, b) =>
        Number(!!b.deadline && b.deadline < today) -
          Number(!!a.deadline && a.deadline < today) ||
        Number(isDueSoon(b, today)) - Number(isDueSoon(a, today)) ||
        compareTaskPriority(a, b),
    );
}
