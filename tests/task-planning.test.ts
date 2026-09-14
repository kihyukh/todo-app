import { describe, expect, it } from "vitest";
import { emptyDoc, mergeState, schedulePatch } from "../src/model";
import type { Task } from "../src/model";
import {
  compareTaskPriority,
  isDueSoon,
  planningCandidates,
} from "../src/task-planning";
const task = (id: string, patch: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "",
  columnId: "next",
  doDate: null,
  deadline: null,
  completedAt: null,
  deletedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  attachments: [],
  ...patch,
});
describe("daily planning", () => {
  it("orders explicit priorities before deadlines and keeps equal tasks stable", () => {
    const tasks = [
      task("low", { priority: 1, deadline: "2026-09-15" }),
      task("high", { priority: 3 }),
      task("medium", { priority: 2 }),
    ];
    expect(tasks.sort(compareTaskPriority).map((task) => task.id)).toEqual([
      "high",
      "medium",
      "low",
    ]);
  });
  it("recommends unfinished urgent work without changing schedules", () => {
    const tasks = [
      task("overdue", { deadline: "2026-09-10" }),
      task("later", { priority: 3 }),
      task("planned", {
        deadline: "2026-09-15",
        ...schedulePatch(["2026-09-14", "2026-09-18"]),
      }),
      task("done", {
        deadline: "2026-09-14",
        completedAt: "2026-09-14T01:00:00Z",
      }),
    ];
    const before = structuredClone(tasks);
    expect(
      planningCandidates(tasks, "2026-09-14").map((task) => task.id),
    ).toEqual(["overdue", "later"]);
    expect(
      planningCandidates(tasks, "2026-09-14", undefined, "urgent").map(
        (task) => task.id,
      ),
    ).toEqual(["overdue"]);
    expect(tasks).toEqual(before);
    expect(
      isDueSoon(task("week", { deadline: "2026-09-21" }), "2026-09-14"),
    ).toBe(true);
    expect(
      isDueSoon(task("later", { deadline: "2026-09-22" }), "2026-09-14"),
    ).toBe(false);
  });
  it("persists priority and calendar links through existing record merging", () => {
    const link = {
      eventId: "local",
      externalId: "event@example.test",
      occurrenceDate: null,
      calendarId: "c",
      title: "Review",
      start: "2026-09-15T00:00:00Z",
      end: "2026-09-15T01:00:00Z",
      allDay: false,
      calendarTitle: "Work",
      calendarColor: "#24704f",
    };
    const older = task("a"),
      newer = task("a", {
        priority: 3,
        calendarLinks: [link],
        updatedAt: "2026-09-14T00:00:00Z",
      });
    const a = {
      schemaVersion: 1 as const,
      tasks: [older],
      columns: [],
      projects: [],
    };
    const merged = mergeState(a, { ...a, tasks: [newer] });
    expect(merged.tasks[0].priority).toBe(3);
    expect(merged.tasks[0].calendarLinks).toEqual([link]);
    const cleared = {
      ...newer,
      calendarLinks: [],
      updatedAt: "2026-09-14T01:00:00Z",
    };
    expect(
      mergeState(merged, { ...a, tasks: [cleared] }).tasks[0].calendarLinks,
    ).toEqual([]);
  });
});
