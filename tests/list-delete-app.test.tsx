// @vitest-environment jsdom
import { act, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import {
  dateKey,
  emptyDoc,
  mergeState,
  type AppState,
  type Task,
} from "../src/model";
import { deleteList } from "../src/lists";

let root: Root | undefined, seed: AppState, latest: AppState;
let setWorkspace: Dispatch<SetStateAction<AppState>>;
vi.mock("../src/storage", () => ({
  isNative: () => false,
  nativeSend: vi.fn(),
  useWorkspace: () => {
    const [state, setState] = useState(seed);
    latest = state;
    setWorkspace = setState;
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
const stamp = "2026-09-01T00:00:00.000Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "research",
  columnId: "next",
  doDate: dateKey(),
  deadline: "2026-10-01",
  completedAt: null,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
  attachments: [],
  tagIds: ["reading"],
  ...extra,
});
async function mount(
  tasks = [
    task("paper"),
    task("draft"),
    task("finished", { completedAt: stamp }),
    task("discarded", { deletedAt: stamp }),
  ],
) {
  seed = {
    schemaVersion: 1,
    tasks,
    projects: ["research", "teaching"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
    columns: [{ id: "next", name: "Next", color: "#24704f", updatedAt: stamp }],
    tags: [
      { id: "reading", name: "Reading", color: "#24704f", updatedAt: stamp },
    ],
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
}
const label = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("[aria-label]")].find(
    (element) => element.getAttribute("aria-label") === name,
  )!;
const nav = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".sidebar .nav-item")].find(
    (element) => element.querySelector("span")?.textContent === name,
  )!;
const button = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent === text,
  )!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;
async function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
}
async function key(key: string, extra: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  await act(async () => document.activeElement!.dispatchEvent(event));
  return event;
}
async function openDelete() {
  await click(nav("research"));
  await click(label("List options"));
  await click(button("Delete list…"));
}

describe("list deletion in the workspace", () => {
  it("explains active/completed/trashed tasks, cancels safely, and restores focus", async () => {
    await mount();
    await openDelete();
    expect(dialog().textContent).toContain("Delete “research”?");
    expect(dialog().textContent).toContain("2 tasks will move to Inbox.");
    expect(dialog().textContent).toContain(
      "1 completed task stays in Completed.",
    );
    expect(dialog().textContent).toContain("1 task stays in Trash.");
    expect(dialog().textContent).toContain(
      "notes, files, dates, and tags will be kept",
    );
    expect(document.activeElement).toBe(button("Cancel", dialog()));
    expect((await key("k", { metaKey: true })).defaultPrevented).toBe(true);
    expect((await key("n", { ctrlKey: true })).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(button("Cancel", dialog()));
    await key("Escape");
    expect(dialog()).toBeFalsy();
    expect(latest).toBe(seed);
    expect(document.activeElement).toBe(label("List options"));
    await click(label("List options"));
    await click(button("Delete list…"));
    await click(button("Cancel", dialog()));
    expect(latest).toBe(seed);
  });

  it("deletes the list, preserves tasks and statuses, and Undo preserves subsequent edits and moves", async () => {
    await mount();
    await openDelete();
    await click(button("Delete list", dialog()));
    expect(nav("research")).toBeFalsy();
    expect(document.querySelector(".workspace h1")?.textContent).toBe("Inbox");
    for (const original of seed.tasks) {
      expect(latest.tasks.find((item) => item.id === original.id)).toEqual({
        ...original,
        projectId: "",
        updatedAt: expect.any(String),
      });
    }
    expect(document.querySelectorAll(".workspace .task-row")).toHaveLength(2);
    await act(async () =>
      setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((item) =>
          item.id === "paper"
            ? { ...item, title: "Edited in Inbox", deadline: "2026-12-12" }
            : item.id === "draft"
              ? { ...item, projectId: "teaching" }
              : item,
        ),
      })),
    );
    await click(label("Undo list deletion"));
    expect(nav("research")).toBeTruthy();
    expect(document.querySelector(".workspace h1")?.textContent).toBe(
      "research",
    );
    expect(latest.tasks.find((item) => item.id === "paper")).toMatchObject({
      projectId: "research",
      title: "Edited in Inbox",
      deadline: "2026-12-12",
    });
    expect(latest.tasks.find((item) => item.id === "draft")?.projectId).toBe(
      "teaching",
    );
    expect(
      latest.tasks.find((item) => item.id === "finished")?.completedAt,
    ).toBe(stamp);
    expect(
      latest.tasks.find((item) => item.id === "discarded")?.deletedAt,
    ).toBe(stamp);
    expect(label("Undo list deletion")).toBeFalsy();
    await act(
      async () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(document.activeElement).toBe(label("List options"));
  });

  it("includes queued membership and timestamp changes in the deletion receipt", async () => {
    await mount();
    await openDelete();
    await act(async () => {
      setWorkspace((current) => ({
        ...current,
        projects: current.projects.map((list) =>
          list.id === "research"
            ? { ...list, updatedAt: "2030-01-01T00:00:00.000Z" }
            : list,
        ),
        tasks: [...current.tasks, task("arrived from sync")],
      }));
      button("Delete list", dialog()).click();
    });
    expect(latest.tasks.every((item) => !item.projectId)).toBe(true);
    await click(label("Undo list deletion"));
    expect(latest.projects[0].deletedAt).toBeNull();
    expect(
      latest.tasks.find((item) => item.id === "arrived from sync")?.projectId,
    ).toBe("research");
  });

  it("offers empty-list deletion from the sidebar without leaving the current view", async () => {
    await mount();
    await act(async () =>
      nav("teaching").dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 120,
          clientY: 160,
        }),
      ),
    );
    expect(document.activeElement).toBe(button("Edit list"));
    await key("ArrowDown");
    expect(document.activeElement).toBe(button("Delete list…"));
    await click(button("Delete list…"));
    expect(dialog().textContent).toContain("This list is empty.");
    await click(button("Delete list", dialog()));
    expect(nav("teaching")).toBeFalsy();
    expect(document.querySelector(".workspace h1")?.textContent).toBe("Today");
    await act(
      async () => new Promise((resolve) => requestAnimationFrame(resolve)),
    );
    expect(document.activeElement).toBe(label("Undo list deletion"));
    await click(label("Dismiss list deletion message"));
    expect(label("Undo list deletion")).toBeFalsy();
  });

  it("offers delete from Edit list, and keeps confirmation keyboard focus inside", async () => {
    await mount();
    await click(nav("research"));
    await click(label("List options"));
    await click(button("Edit list"));
    await click(button("Delete list…", dialog()));
    button("Delete list", dialog()).focus();
    await key("Tab");
    expect(document.activeElement).toBe(label("Close delete list"));
    await key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(button("Delete list", dialog()));
    await key("Escape");
    expect(document.activeElement).toBe(nav("research"));
  });

  it("handles a synced deletion while its confirmation is open and protects Inbox", async () => {
    await mount();
    await openDelete();
    const remote = deleteList(latest, "research")!.state;
    await act(async () =>
      setWorkspace((current) => mergeState(current, remote)),
    );
    expect(dialog()).toBeFalsy();
    expect(document.querySelector(".workspace h1")?.textContent).toBe("Inbox");
    expect(label("List options")).toBeFalsy();
    await act(async () =>
      nav("Inbox").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
      ),
    );
    expect(document.querySelector('[role="menu"]')).toBeFalsy();
    expect(latest.tasks.every((item) => !item.projectId)).toBe(true);
  });
});
