// @vitest-environment jsdom
import { act, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { addDays, dateKey } from "../src/model";
import type { AppState, NoteNode, Task } from "../src/model";
import { extractCheckboxes } from "../src/editor-utils";

let root: Root | undefined;
let seed: AppState;
let latest: AppState;
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
vi.mock("../src/completion-sound", async () => ({
  ...(await vi.importActual<typeof import("../src/completion-sound")>(
    "../src/completion-sound",
  )),
  playCompletionChime: vi.fn(),
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
const paragraph = (text: string): NoteNode => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const item = (
  text: string,
  checked = false,
  children: NoteNode[] = [],
): NoteNode => ({
  type: "taskItem",
  attrs: { checked },
  content: [
    paragraph(text),
    ...(children.length ? [{ type: "taskList", content: children }] : []),
  ],
});
const notes = (...items: NoteNode[]): NoteNode => ({
  type: "doc",
  content: [{ type: "taskList", content: items }],
});
const researchNotes = () =>
  notes(
    item("Outline", false, [
      item("Verify lemma"),
      item("Finished detail", true),
    ]),
    item("Read abstract", true),
  );
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  projectId: "",
  columnId: "next",
  notes: researchNotes(),
  doDate: dateKey(),
  doDates: [dateKey(), addDays(3)],
  deadline: addDays(8),
  completedAt: null,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  attachments: [],
  ...overrides,
});
const record = (id: string) =>
  latest.tasks.find((candidate) => candidate.id === id)!;
async function mount(tasks: Task[], tags: AppState["tags"] = []) {
  seed = { schemaVersion: 1, tasks, tags, projects: [], columns: [] };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await click(navigation());
}
function navigation() {
  return [
    ...document.querySelectorAll<HTMLButtonElement>(".sidebar button.nav-item"),
  ].find(
    (button) => button.querySelector("span")?.textContent === "Open checkboxes",
  );
}
const navCount = () =>
  Number(navigation()?.querySelector(".count")?.textContent ?? 0);
const footer = () =>
  document.querySelector(".workspace-footer")?.textContent ?? "";
const groups = () => [
  ...document.querySelectorAll<HTMLElement>(".checkbox-group"),
];
function group(title: string) {
  const found = groups().find(
    (element) =>
      element.querySelector(".parent-task")?.textContent?.trim() === title,
  );
  expect(found, `Checkbox group for ${title}`).toBeDefined();
  return found!;
}
function rowTexts(scope: ParentNode = document) {
  return [...scope.querySelectorAll(".open-check-row")].map(
    (row) => row.querySelector("button:last-child")?.textContent,
  );
}
function label<T extends HTMLElement = HTMLButtonElement>(
  name: string,
  scope: ParentNode = document,
) {
  return [...scope.querySelectorAll<T>("[aria-label]")].find(
    (element) => element.getAttribute("aria-label") === name,
  );
}
async function click(element: HTMLElement | undefined | null) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
async function search(query: string) {
  const input = label<HTMLInputElement>("Search checkboxes")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("open checkboxes across active parent tasks", () => {
  it("includes only unfinished note items from active parents without rewriting any notes", async () => {
    await mount([
      task("Paper"),
      task("Errands", { notes: notes(item("Buy stationery")) }),
      task("Completed parent", {
        completedAt: timestamp,
        notes: notes(item("Hidden completed step")),
      }),
      task("Deleted parent", {
        deletedAt: timestamp,
        notes: notes(item("Hidden deleted step")),
      }),
      task("All steps checked", { notes: notes(item("Already done", true)) }),
    ]);
    expect(
      groups().map((element) =>
        element.querySelector(".parent-task")?.textContent?.trim(),
      ),
    ).toEqual(["Paper", "Errands"]);
    expect(rowTexts()).toEqual(["Outline", "Verify lemma", "Buy stationery"]);
    expect(navCount()).toBe(3);
    expect(footer()).toContain("3 open checkboxes");
    expect(latest).toEqual(seed);
  });

  it("removes a completed parent's group immediately and restores only unfinished items on Undo or Reopen", async () => {
    await mount([
      task("Paper"),
      task("Errands", { notes: notes(item("Buy stationery")) }),
    ]);
    const original = structuredClone(record("Paper"));
    const other = structuredClone(record("Errands"));
    await click(
      group("Paper").querySelector<HTMLButtonElement>(".parent-task"),
    );
    await click(label("Complete task"));
    // No animation timer needs to run before the aggregate or its count changes.
    expect(rowTexts()).toEqual(["Buy stationery"]);
    expect(navCount()).toBe(1);
    expect(record("Paper")).toEqual({
      ...original,
      completedAt: record("Paper").completedAt,
      updatedAt: record("Paper").updatedAt,
    });
    expect(record("Paper").completedAt).toBeTruthy();
    expect(record("Errands")).toEqual(other);
    await click(label("Undo task completion"));
    expect(rowTexts(group("Paper"))).toEqual(["Outline", "Verify lemma"]);
    expect(navCount()).toBe(3);
    expect(record("Paper").notes).toEqual(original.notes);
    await click(label("Complete task"));
    expect(rowTexts()).toEqual(["Buy stationery"]);
    await click(label("Reopen task"));
    expect(rowTexts(group("Paper"))).toEqual(["Outline", "Verify lemma"]);
    expect(navCount()).toBe(3);
    expect(record("Paper")).toMatchObject({
      notes: original.notes,
      doDate: original.doDate,
      doDates: original.doDates,
      deadline: original.deadline,
      completedAt: null,
    });
    expect(record("Errands")).toEqual(other);
  });

  it("checks precisely the nested item and keeps it checked after parent completion and undo", async () => {
    await mount([
      task("Paper"),
      task("Other paper", { notes: notes(item("Verify lemma")) }),
    ]);
    const original = structuredClone(record("Paper"));
    const other = structuredClone(record("Other paper"));
    await click(label("Check Verify lemma", group("Paper")));
    expect(
      extractCheckboxes(record("Paper").notes).map(({ path, checked }) => ({
        path,
        checked,
      })),
    ).toEqual([
      { path: [0, 0], checked: false },
      { path: [0, 0, 1, 0], checked: true },
      { path: [0, 0, 1, 1], checked: true },
      { path: [0, 1], checked: true },
    ]);
    expect(rowTexts(group("Paper"))).toEqual(["Outline"]);
    expect(rowTexts(group("Other paper"))).toEqual(["Verify lemma"]);
    expect(navCount()).toBe(2);
    const checkedNote = structuredClone(record("Paper").notes);
    await click(
      group("Paper").querySelector<HTMLButtonElement>(".parent-task"),
    );
    await click(label("Complete task"));
    expect(navCount()).toBe(1);
    await click(label("Undo task completion"));
    expect(rowTexts(group("Paper"))).toEqual(["Outline"]);
    expect(record("Paper")).toMatchObject({
      notes: checkedNote,
      doDate: original.doDate,
      doDates: original.doDates,
      deadline: original.deadline,
    });
    expect(record("Other paper")).toEqual(other);
  });

  it("responds to synced completion and reopening without reviving checked or deleted items", async () => {
    await mount([
      task("Paper"),
      task("Errands", { notes: notes(item("Buy stationery")) }),
      task("Deleted parent", { deletedAt: timestamp }),
    ]);
    const original = structuredClone(latest);
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((candidate) =>
          candidate.id === "Paper"
            ? {
                ...candidate,
                completedAt: "2026-09-15T01:00:00Z",
                updatedAt: "2026-09-15T01:00:00Z",
              }
            : candidate,
        ),
      })),
    );
    expect(rowTexts()).toEqual(["Buy stationery"]);
    expect(navCount()).toBe(1);
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((candidate) =>
          candidate.id === "Paper"
            ? {
                ...candidate,
                completedAt: null,
                updatedAt: "2026-09-15T02:00:00Z",
              }
            : candidate,
        ),
      })),
    );
    expect(rowTexts()).toEqual(["Outline", "Verify lemma", "Buy stationery"]);
    expect(navCount()).toBe(3);
    expect(record("Paper")).toEqual({
      ...original.tasks[0],
      updatedAt: "2026-09-15T02:00:00Z",
    });
    expect(latest.tasks.slice(1)).toEqual(original.tasks.slice(1));
  });

  it("searches item text or parent title and tags while keeping navigation counts unfiltered", async () => {
    await mount(
      [
        task("Paper review", { tagIds: ["research"] }),
        task("Errands", { notes: notes(item("Buy stationery")) }),
        task("Completed research", {
          completedAt: timestamp,
          tagIds: ["research"],
          notes: notes(item("Verify hidden lemma")),
        }),
      ],
      [
        {
          id: "research",
          name: "Research",
          color: "#23764d",
          updatedAt: timestamp,
        },
      ],
    );
    const original = structuredClone(latest);
    await search("lemma");
    expect(document.querySelector("h1")?.textContent).toBe("Open checkboxes");
    expect(rowTexts()).toEqual(["Verify lemma"]);
    expect(groups()).toHaveLength(1);
    expect(navCount()).toBe(3);
    expect(footer()).toContain("1 of 3");
    await search("PAPER REVIEW");
    expect(rowTexts()).toEqual(["Outline", "Verify lemma"]);
    expect(navCount()).toBe(3);
    expect(footer()).toContain("2 of 3");
    await search("research");
    expect(rowTexts()).toEqual(["Outline", "Verify lemma"]);
    expect(groups()).toHaveLength(1);
    expect(navCount()).toBe(3);
    await search("");
    expect(rowTexts()).toEqual(["Outline", "Verify lemma", "Buy stationery"]);
    expect(footer()).toContain("3 open checkboxes");
    expect(latest).toEqual(original);
  });

  it("distinguishes no search matches from finishing every active checkbox", async () => {
    await mount([
      task("Errands", { notes: notes(item("Buy stationery")) }),
      task("Completed parent", { completedAt: timestamp }),
    ]);
    const completed = structuredClone(record("Completed parent"));
    await search("no matching step");
    expect(rowTexts()).toEqual([]);
    expect(document.querySelector(".task-scroll")?.textContent).toContain(
      "No matching checkboxes",
    );
    expect(document.querySelector(".task-scroll")?.textContent).not.toContain(
      "No open checkboxes",
    );
    expect(navCount()).toBe(1);
    expect(footer()).toContain("0 of 1");
    await search("");
    await click(label("Check Buy stationery"));
    expect(rowTexts()).toEqual([]);
    expect(navCount()).toBe(0);
    expect(footer()).toContain("0 open checkboxes");
    expect(document.querySelector(".task-scroll")?.textContent).toContain(
      "No open checkboxes",
    );
    expect(record("Completed parent")).toEqual(completed);
  });
});
