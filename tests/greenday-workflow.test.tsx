// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { addDays, dateKey, emptyDoc, workDates } from "../src/model";
import type { AppState, Task } from "../src/model";
import { nativeSend } from "../src/storage";

let root: Root | undefined;
let seed: AppState;
let latest: AppState;
vi.mock("../src/storage", () => ({
  isNative: () => false,
  nativeSend: vi.fn(),
  useWorkspace: () => {
    const [state, setState] = useState(seed);
    latest = state;
    return {
      state,
      setState,
      ready: true,
      error: "",
      setError: vi.fn(),
      storage: { kind: "local" },
      saving: false,
      attachNative: vi.fn(),
    };
  },
}));
vi.mock("../src/TaskEditor", () => ({
  default: () => <div aria-label="Task notes" />,
}));
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
});
const timestamp = "2020-01-01T00:00:00.000Z";
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "",
  columnId: "next",
  doDate: null,
  deadline: null,
  completedAt: null,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  attachments: [],
  ...overrides,
});
async function mount(tasks: Task[], overrides: Partial<AppState> = {}) {
  seed = {
    schemaVersion: 1,
    tasks,
    projects: [],
    tags: [],
    columns: [
      {
        id: "next",
        name: "Not started",
        color: "#24704f",
        updatedAt: timestamp,
      },
      {
        id: "progress",
        name: "In progress",
        color: "#24704f",
        updatedAt: timestamp,
      },
      {
        id: "waiting",
        name: "Waiting",
        color: "#24704f",
        updatedAt: timestamp,
      },
    ],
    ...overrides,
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
}
async function click(element: HTMLElement | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
function label<T extends HTMLElement = HTMLElement>(name: string) {
  return [...document.querySelectorAll<T>("[aria-label]")].find(
    (element) => element.getAttribute("aria-label") === name,
  );
}
function button(text: string, within: ParentNode = document) {
  return [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  );
}
async function view(name: string) {
  await click(
    [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".sidebar button.nav-item",
      ),
    ].find((element) => element.querySelector("span")?.textContent === name),
  );
}
const rowTitles = () =>
  [...document.querySelectorAll("main .task-row .task-title")].map(
    (element) => element.textContent,
  );
const suggestions = () =>
  [...document.querySelectorAll(".planning-panel > .planning-row > span")].map(
    (element) => element.textContent,
  );

describe("Greenday daily work", () => {
  it("keeps work in progress first in Today, then orders by priority and responds to a priority edit", async () => {
    const today = dateKey();
    await mount([
      task("Low", { doDate: today, priority: 1, deadline: addDays(1) }),
      task("Unprioritized", { doDate: today }),
      task("High", { doDate: today, priority: 3, deadline: addDays(20) }),
      task("Started", { doDate: today, priority: 0, columnId: "progress" }),
      task("Medium", { doDate: today, priority: 2 }),
    ]);
    const before = structuredClone(seed);
    expect(rowTitles()).toEqual([
      "Started",
      "High",
      "Medium",
      "Low",
      "Unprioritized",
    ]);
    expect(latest).toEqual(before);
    const low = [
      ...document.querySelectorAll<HTMLElement>("main .task-row"),
    ].find((row) => row.querySelector(".task-title")?.textContent === "Low")!;
    await click(low.querySelector(".task-content"));
    const priority = label<HTMLSelectElement>("Task priority")!;
    await act(async () => {
      priority.value = "3";
      priority.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rowTitles()).toEqual([
      "Started",
      "Low",
      "High",
      "Medium",
      "Unprioritized",
    ]);
    expect(latest.tasks.find((item) => item.id === "Low")).toMatchObject({
      priority: 3,
      deadline: addDays(1),
      doDate: today,
    });
    expect(latest.tasks.filter((item) => item.id !== "Low")).toEqual(
      before.tasks.filter((item) => item.id !== "Low"),
    );
  });

  it("starts working from All tasks, opens the task, and preserves existing work days, deadline, and content", async () => {
    const past = addDays(-2),
      future = addDays(4),
      deadline = addDays(12);
    const planned = task("Paper review", {
      doDate: past,
      doDates: [past, future],
      deadline,
      priority: 2,
      projectId: "research",
      tagIds: ["review"],
      notes: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Keep these research notes." }],
          },
        ],
      },
      attachments: [
        {
          id: "paper",
          name: "paper.pdf",
          mime: "application/pdf",
          size: 10,
          url: "daymark-attachment://paper",
        },
      ],
      calendarLinks: [
        {
          eventId: "meeting",
          externalId: null,
          occurrenceDate: null,
          calendarId: "work",
          title: "Discussion",
          start: `${future}T01:00:00Z`,
          end: `${future}T02:00:00Z`,
          allDay: false,
          calendarTitle: "Work",
          calendarColor: "#24704f",
        },
      ],
    });
    await mount([planned, task("Unrelated")]);
    const before = structuredClone(seed);
    await view("All tasks");
    await click(label("Work on Paper review"));
    const actual = latest.tasks.find((item) => item.id === planned.id)!;
    expect(actual).toEqual({
      ...before.tasks[0],
      doDates: [past, dateKey(), future],
      columnId: "progress",
      updatedAt: actual.updatedAt,
    });
    expect(actual.updatedAt > timestamp).toBe(true);
    expect(latest.tasks[1]).toEqual(before.tasks[1]);
    expect(label<HTMLTextAreaElement>("Task title")?.value).toBe(
      "Paper review",
    );
    expect(document.querySelector(".detail")).not.toBeNull();
    await click(label("Work on Paper review"));
    expect(workDates(latest.tasks[0])).toEqual([past, dateKey(), future]);
    await view("Today");
    expect(rowTitles()).toEqual(["Paper review"]);
    expect(nativeSend).not.toHaveBeenCalled();
  });

  it("can start work without inventing a missing progress column or rewriting legacy dates", async () => {
    const future = addDays(3);
    await mount(
      [
        task("Legacy task", {
          doDate: future,
          deadline: addDays(8),
          columnId: "custom",
        }),
      ],
      {
        columns: [
          {
            id: "custom",
            name: "Reading",
            color: "#24704f",
            updatedAt: timestamp,
          },
        ],
      },
    );
    const before = structuredClone(seed);
    await view("All tasks");
    await click(label("Work on Legacy task"));
    expect(latest.tasks[0]).toMatchObject({
      columnId: "custom",
      doDate: dateKey(),
      doDates: [dateKey(), future],
      deadline: before.tasks[0].deadline,
    });
    expect(latest.columns).toEqual(before.columns);
    expect(label<HTMLTextAreaElement>("Task title")?.value).toBe("Legacy task");
  });

  it("suggests overdue tasks before high-priority future deadlines and leaves tasks untouched until a task is chosen", async () => {
    await mount([
      task("Due soon high priority", { priority: 3, deadline: addDays(2) }),
      task("Overdue low priority", { priority: 1, deadline: addDays(-1) }),
      task("Later high priority", { priority: 3, deadline: addDays(20) }),
      task("Ongoing", { columnId: "progress" }),
      task("Already today", { doDate: dateKey(), deadline: addDays(-3) }),
      task("Completed", { deadline: addDays(-5), completedAt: timestamp }),
      task("Trashed", { deadline: addDays(-6), deletedAt: timestamp }),
    ]);
    const before = structuredClone(seed);
    await click(button("Plan your day"));
    expect(suggestions()).toEqual([
      "Overdue low priority",
      "Due soon high priority",
      "Later high priority",
      "Ongoing",
    ]);
    const filters = label("Suggestions")!;
    await click(button("Due soon", filters));
    expect(suggestions()).toEqual([
      "Overdue low priority",
      "Due soon high priority",
    ]);
    await click(button("In progress", filters));
    expect(suggestions()).toEqual(["Ongoing"]);
    await click(label("Close day planner"));
    expect(latest).toEqual(before);
    expect(nativeSend).not.toHaveBeenCalled();
  });

  it("opens already-planned briefing tasks without rescheduling them or changing their timestamps", async () => {
    await mount([
      task("Due and already planned", {
        doDate: dateKey(),
        doDates: [dateKey(), addDays(3)],
        deadline: addDays(-1),
      }),
      task("Started today", { doDate: dateKey(), columnId: "progress" }),
      task("Started, needs a work day", { columnId: "progress" }),
    ]);
    const before = structuredClone(seed);
    const briefing = label("Planning overview")!;
    const [urgent, ongoing] =
      briefing.querySelectorAll<HTMLButtonElement>("button");
    expect(urgent.textContent).toContain("1 overdue");
    await click(urgent);
    expect(suggestions()).toEqual([]);
    expect(
      document.querySelector(".planning-already > span")?.textContent,
    ).toBe("Already on Today");
    await click(document.querySelector(".planning-already .planning-row"));
    expect(label<HTMLTextAreaElement>("Task title")?.value).toBe(
      "Due and already planned",
    );
    expect(latest).toEqual(before);
    await click(ongoing);
    expect(suggestions()).toEqual(["Started, needs a work day"]);
    await click(document.querySelector(".planning-already .planning-row"));
    expect(label<HTMLTextAreaElement>("Task title")?.value).toBe(
      "Started today",
    );
    expect(latest).toEqual(before);
  });

  it("orders tasks with the same Upcoming date by priority, including overdue dates", async () => {
    await mount([
      task("Future low", { doDate: addDays(2), priority: 1 }),
      task("Overdue low", { deadline: addDays(-1), priority: 1 }),
      task("Future high", { doDate: addDays(2), priority: 3 }),
      task("Overdue high", { deadline: addDays(-1), priority: 3 }),
    ]);
    const before = structuredClone(seed);
    await view("Upcoming");
    expect(rowTitles()).toEqual([
      "Overdue high",
      "Overdue low",
      "Future high",
      "Future low",
    ]);
    expect(latest).toEqual(before);
  });
});

describe("existing workspaces and optional calendars", () => {
  it("opens Calendar with a full workspace, closing the previous task without changing it", async () => {
    await mount([task("Scheduled task", { doDate: dateKey() })]);
    const before = structuredClone(seed);
    await click(document.querySelector(".task-content"));
    expect(document.querySelector(".detail")).not.toBeNull();
    await view("Calendar");
    expect(document.querySelector(".detail")).toBeNull();
    expect(document.querySelector(".app-shell.has-detail")).toBeNull();
    expect(label("Calendar")).toBeTruthy();
    expect(
      document.querySelector(".calendar-workspace")?.textContent,
    ).toContain("Scheduled task");
    expect(label("New task title")).toBeUndefined();
    expect(label("Layout")).toBeUndefined();
    expect(latest).toEqual(before);
    expect(nativeSend).not.toHaveBeenCalled();
  });

  it("keeps legacy tags without a group usable without migrating task or tag records during navigation", async () => {
    await mount(
      [
        task("Tagged legacy task", { tagIds: ["research"] }),
        task("No tag field"),
        task("Deleted tag reference", { tagIds: ["deleted"] }),
      ],
      {
        tags: [
          {
            id: "research",
            name: "Research",
            color: "#24704f",
            updatedAt: timestamp,
          },
          {
            id: "deleted",
            name: "Old tag",
            color: "#24704f",
            updatedAt: timestamp,
            deletedAt: timestamp,
          },
        ],
      },
    );
    const before = structuredClone(seed);
    expect(
      document.querySelector('[aria-label="Topic tags"]')?.textContent,
    ).toContain("Research");
    expect(document.querySelector(".sidebar-tags")?.textContent).not.toContain(
      "Old tag",
    );
    await view("Research");
    expect(rowTitles()).toEqual(["Tagged legacy task"]);
    await view("All tasks");
    expect(rowTitles()).toHaveLength(3);
    expect(latest).toEqual(before);
  });

  it("keeps local storage and export available in browser Settings while explaining native-only calendar access", async () => {
    await mount([task("Local task")], { tags: undefined });
    const before = structuredClone(seed);
    await click(label("Settings"));
    const settings = document.querySelector(".settings-modal")!;
    expect(settings.textContent).toContain(
      "Open the Mac or iPhone app to connect calendars",
    );
    expect(button("Connect calendars", settings)).toBeUndefined();
    expect(button("Choose workspace folder", settings)).toBeUndefined();
    expect(button("Export task data", settings)).toBeTruthy();
    expect(settings.querySelector('[aria-label="Vim mode"]')).not.toBeNull();
    expect(latest).toEqual(before);
    expect(nativeSend).not.toHaveBeenCalled();
  });
});
