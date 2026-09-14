// @vitest-environment jsdom
import { act, useState } from "react";
import type { SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { dateKey, emptyDoc } from "../src/model";
import type { AppState, Task } from "../src/model";

let root: Root | undefined;
let seed: AppState;
let latest: AppState;
const workspaceUpdates = vi.fn();

vi.mock("../src/storage", () => ({
  isNative: () => false,
  nativeSend: vi.fn(),
  useWorkspace: () => {
    const [state, setState] = useState(seed);
    latest = state;
    return {
      state,
      setState: (update: SetStateAction<AppState>) => {
        workspaceUpdates();
        setState(update);
      },
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
const day = (value: number) =>
  `${dateKey().slice(0, 7)}-${String(value).padStart(2, "0")}`;
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "research",
  columnId: "next",
  doDate: day(10),
  deadline: day(26),
  completedAt: null,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  attachments: [],
  tagIds: ["review"],
  priority: 2,
  ...overrides,
});

async function mount(tasks: Task[]) {
  seed = {
    schemaVersion: 1,
    tasks,
    projects: [
      {
        id: "research",
        name: "Research",
        color: "#24704f",
        updatedAt: timestamp,
      },
    ],
    tags: [
      {
        id: "review",
        name: "Review",
        color: "#24704f",
        group: "action",
        updatedAt: timestamp,
      },
    ],
    columns: [
      {
        id: "next",
        name: "Not started",
        color: "#24704f",
        updatedAt: timestamp,
      },
    ],
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await click(
    [
      ...document.querySelectorAll<HTMLButtonElement>(".sidebar .nav-item"),
    ].find(
      (element) => element.querySelector("span")?.textContent === "All tasks",
    ),
  );
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
function dialog() {
  return document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Task dates"]',
  );
}
function button(text: string, within: ParentNode | null = dialog()) {
  return [
    ...(within?.querySelectorAll<HTMLButtonElement>("button") ?? []),
  ].find((element) => element.textContent?.trim() === text);
}
async function selectTask(title: string) {
  const row = [
    ...document.querySelectorAll<HTMLElement>("main .task-row"),
  ].find(
    (element) => element.querySelector(".task-title")?.textContent === title,
  );
  await click(row?.querySelector<HTMLElement>(".task-content"));
  expect(label<HTMLTextAreaElement>("Task title")?.value).toBe(title);
}
async function openSchedule() {
  await click(
    document.querySelector<HTMLButtonElement>(
      ".detail-top .task-schedule-trigger.is-work",
    ),
  );
  expect(dialog()).not.toBeNull();
}
async function chooseDay(value: number) {
  await click(
    dialog()?.querySelector<HTMLButtonElement>(
      `[data-schedule-day="${day(value)}"]`,
    ),
  );
}

describe("Task detail schedule drafts", () => {
  it("saves work days and a separate deadline in one update without changing task content or metadata", async () => {
    await mount([
      task("Paper review", {
        notes: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Retain the review notes." }],
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
      }),
      task("Unrelated", { projectId: "", tagIds: [], deadline: null }),
    ]);
    const before = structuredClone(seed);
    await selectTask("Paper review");
    await openSchedule();
    // Deliberately choose dates out of order: persistence must stay canonical.
    await chooseDay(20);
    await chooseDay(12);
    await click(button("Deadline"));
    await chooseDay(25);
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(before);

    await click(button("Save"));

    expect(dialog()).toBeNull();
    expect(workspaceUpdates).toHaveBeenCalledTimes(1);
    const saved = latest.tasks[0];
    expect(saved).toEqual({
      ...before.tasks[0],
      doDates: [day(10), day(12), day(20)],
      doDate: day(10),
      deadline: day(25),
      updatedAt: saved.updatedAt,
    });
    expect(saved.updatedAt > timestamp).toBe(true);
    expect(latest.tasks[1]).toEqual(before.tasks[1]);
    expect(latest.projects).toEqual(before.projects);
    expect(latest.tags).toEqual(before.tags);
    expect(latest.columns).toEqual(before.columns);
  });

  it("cancels edits to both fields without publishing or retaining the discarded draft", async () => {
    await mount([task("Paper review", { doDates: [day(10), day(12)] })]);
    const before = structuredClone(seed);
    await selectTask("Paper review");
    await openSchedule();
    await chooseDay(10);
    await chooseDay(20);
    await click(button("Deadline"));
    await chooseDay(25);
    await click(button("Cancel"));

    expect(dialog()).toBeNull();
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(before);
    await openSchedule();
    await chooseDay(14);
    await click(button("Save"));
    expect(workspaceUpdates).toHaveBeenCalledTimes(1);
    expect(latest.tasks[0]).toMatchObject({
      doDates: [day(10), day(12), day(14)],
      doDate: day(10),
      deadline: before.tasks[0].deadline,
    });
  });

  it("discards an open draft when switching tasks and saves only the new task's own schedule", async () => {
    await mount([
      task("First task", { doDates: [day(10)] }),
      task("Second task", {
        doDate: day(12),
        doDates: [day(12)],
        deadline: null,
        tagIds: [],
      }),
    ]);
    const before = structuredClone(seed);
    await selectTask("First task");
    await openSchedule();
    await chooseDay(20);
    await click(button("Deadline"));
    await chooseDay(25);
    const oldSave = button("Save")!;

    await selectTask("Second task");

    expect(dialog()).toBeNull();
    expect(oldSave.isConnected).toBe(false);
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(before);
    await openSchedule();
    await chooseDay(14);
    await click(button("Save"));
    expect(workspaceUpdates).toHaveBeenCalledTimes(1);
    expect(latest.tasks[0]).toEqual(before.tasks[0]);
    expect(latest.tasks[1]).toEqual({
      ...before.tasks[1],
      doDates: [day(12), day(14)],
      updatedAt: latest.tasks[1].updatedAt,
    });
  });
});
