// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { addDays, dateKey, dateLabel, emptyDoc, workDates } from "../src/model";
import type { AppState, Task } from "../src/model";

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
});
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
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  attachments: [],
  ...overrides,
});
async function mount(tasks: Task[]) {
  seed = { schemaVersion: 1, tasks, projects: [], columns: [], tags: [] };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
}
async function click(element: HTMLElement | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
function label(name: string) {
  return [...document.querySelectorAll<HTMLElement>("[aria-label]")].find(
    (element) => element.getAttribute("aria-label") === name,
  );
}
function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>("button")].find(
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
function rows() {
  return [...document.querySelectorAll<HTMLElement>("main .task-row")];
}

describe("planning a task over several work days", () => {
  it("shows Today when it is one of several dates, and the Today toggle preserves every other date", async () => {
    const today = dateKey(),
      past = addDays(-2),
      future = addDays(5),
      deadline = addDays(20);
    await mount([
      task("Paper review", {
        doDate: past,
        doDates: [past, today, future],
        deadline,
      }),
    ]);
    expect(rows()).toHaveLength(1);
    expect(document.querySelector(".earlier")).toBeNull();
    await click(label("Remove from Today: Paper review"));
    expect(rows()).toHaveLength(0);
    expect(workDates(latest.tasks[0])).toEqual([past, future]);
    expect(latest.tasks[0].deadline).toBe(deadline);
    await view("All tasks");
    await click(label("Do today: Paper review"));
    expect(workDates(latest.tasks[0])).toEqual([past, today, future]);
    expect(latest.tasks[0].deadline).toBe(deadline);
    expect(latest.tasks[0].notes).toEqual(emptyDoc());
  });

  it("adds Today from the day planner without replacing an existing future schedule", async () => {
    const future = [addDays(2), addDays(9)],
      deadline = addDays(20);
    await mount([
      task("Write draft", { doDate: future[0], doDates: future, deadline }),
    ]);
    await click(button("Plan your day"));
    await click(document.querySelector(".planning-row"));
    expect(workDates(latest.tasks[0])).toEqual([dateKey(), ...future]);
    expect(latest.tasks[0].deadline).toBe(deadline);
    expect(rows()).toHaveLength(1);
  });

  it("shows each work day in Upcoming and combines a matching deadline into one occurrence", async () => {
    const first = addDays(2),
      second = addDays(9),
      last = addDays(20);
    await mount([
      task("Read and revise", {
        doDate: first,
        doDates: [first, second],
        deadline: second,
      }),
      task("Deadline only", { deadline: last }),
    ]);
    await view("Upcoming");
    const sections = [
      ...document.querySelectorAll<HTMLElement>(".task-scroll > section"),
    ];
    expect(sections).toHaveLength(3);
    expect(
      sections.map(
        (section) => section.querySelector(".section-title")?.textContent,
      ),
    ).toEqual([
      `${dateLabel(first)}1`,
      `${dateLabel(second)}1`,
      `${dateLabel(last)}1`,
    ]);
    expect(sections[0].querySelector(".row-do-date")?.textContent).toBe(
      "Work day",
    );
    expect(sections[1].querySelector(".row-do-date")?.textContent).toBe(
      "Work · Due",
    );
    expect(sections[2].querySelector(".row-do-date")?.textContent).toBe(
      "Deadline",
    );
    expect(
      rows().filter((row) => row.textContent?.includes("Read and revise")),
    ).toHaveLength(2);
    await click(label("Complete Read and revise"));
    expect(rows()).toHaveLength(1);
    expect(workDates(latest.tasks[0])).toEqual([first, second]);
    await view("Completed");
    expect(rows()).toHaveLength(1);
  });

  it("keeps ongoing multi-day work out of the missed-work list and preserves legacy single dates", async () => {
    await mount([
      task("Still scheduled", {
        doDate: addDays(-2),
        doDates: [addDays(-2), addDays(4)],
      }),
      task("Needs replanning", { doDate: addDays(-1) }),
      task("Legacy today", { doDate: dateKey() }),
      task("Explicitly cleared", { doDate: dateKey(), doDates: [] }),
    ]);
    expect(
      rows().map((row) => row.querySelector(".task-title")?.textContent),
    ).toEqual(["Legacy today"]);
    await click(document.querySelector(".earlier-toggle"));
    expect(
      rows().map((row) => row.querySelector(".task-title")?.textContent),
    ).toEqual(["Legacy today", "Needs replanning"]);
    expect(latest.tasks).toEqual(seed.tasks);
  });
});
