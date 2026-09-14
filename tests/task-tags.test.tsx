// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppState, TagRecord, Task } from "../src/model";
import { dateKey, emptyDoc } from "../src/model";
import TaskTags, { TagDialog } from "../src/TaskTags";
import App from "../src/App";
import * as storage from "../src/storage";

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
});
const tags: TagRecord[] = [
  {
    id: "research",
    name: "Research",
    group: "area",
    color: "#315fd5",
    updatedAt: "2020-01-01",
  },
  {
    id: "reading",
    name: "Reading",
    group: "action",
    color: "#26826b",
    updatedAt: "2020-01-01",
  },
  {
    id: "ie232",
    name: "IE232",
    group: "topic",
    color: "#8a4caa",
    updatedAt: "2020-01-01",
  },
  {
    id: "old",
    name: "Retired",
    group: "topic",
    color: "#8a4caa",
    updatedAt: "2020-01-01",
    deletedAt: "2020-02-01",
  },
];
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "",
  columnId: "next",
  doDate: dateKey(),
  deadline: null,
  attachments: [],
  createdAt: "2020-01-01T00:00:00.000Z",
  updatedAt: "2020-01-01T00:00:00.000Z",
  completedAt: null,
  deletedAt: null,
  ...overrides,
});
async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(node));
  return container;
}
const label = <T extends HTMLElement = HTMLElement>(name: string) =>
  document.querySelector<T>(`[aria-label="${name}"]`)!;
async function click(element: HTMLElement) {
  expect(element).not.toBeNull();
  await act(async () => element.click());
}
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose(element: HTMLSelectElement, value: string) {
  await act(async () => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function submit(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
}
const buttonText = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
const tagOption = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')].find(
    (button) => button.textContent === text,
  )!;
async function mountApp(overrides: Partial<AppState> = {}) {
  seed = {
    schemaVersion: 1,
    tags,
    tasks: [
      task("example-review", {
        title: "Paper notes",
        tagIds: ["research", "reading"],
        projectId: "one",
      }),
      task("second", {
        title: "Course notes",
        tagIds: ["reading", "ie232"],
        projectId: "two",
      }),
      task("third", { title: "Schedule meeting" }),
    ],
    projects: [
      { id: "one", name: "Lab", color: "#315fd5", updatedAt: "2020-01-01" },
      { id: "two", name: "Course", color: "#26826b", updatedAt: "2020-01-01" },
    ],
    columns: [
      { id: "next", name: "Next", color: "#315fd5", updatedAt: "2020-01-01" },
    ],
    ...overrides,
  };
  return mount(<App />);
}

describe("task tag picker", () => {
  it("shows groups, toggles tags and removes chips without exposing deleted tags", async () => {
    let current: string[] = [];
    function Harness() {
      const [ids, setIds] = useState(["research"]);
      current = ids;
      return (
        <TaskTags
          tags={tags}
          tagIds={ids}
          onChange={setIds}
          onCreate={vi.fn()}
        />
      );
    }
    await mount(<Harness />);
    await click(label("Add tag"));
    expect(document.activeElement).toBe(label("Find or create tag"));
    expect(document.querySelector(".tag-popover")!.textContent).toContain(
      "Work type",
    );
    expect(document.querySelector(".tag-popover")!.textContent).not.toContain(
      "Retired",
    );
    await click(tagOption("Reading"));
    expect(current).toEqual(["research", "reading"]);
    expect(tagOption("Reading").getAttribute("aria-checked")).toBe("true");
    await click(label("Remove tag Research"));
    expect(current).toEqual(["reading"]);
    expect(tagOption("Research").getAttribute("aria-checked")).toBe("false");
    await click(tagOption("Reading"));
    expect(current).toEqual([]);
  });

  it("creates normalized Korean tags in the chosen group and finds case-insensitive existing tags", async () => {
    const create = vi.fn(),
      change = vi.fn();
    await mount(
      <TaskTags tags={tags} tagIds={[]} onChange={change} onCreate={create} />,
    );
    await click(label("Add tag"));
    await input(label("Find or create tag"), "  #논문   검토  ");
    await choose(label("New tag group"), "action");
    await submit(document.querySelector(".tag-popover form")!);
    expect(create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "논문 검토", group: "action" }),
    );
    await input(label("Find or create tag"), " ＲＥＡＤＩＮＧ ");
    expect(label("New tag group")).toBeNull();
    expect(tagOption("Reading")).not.toBeUndefined();
    await submit(document.querySelector(".tag-popover form")!);
    expect(change).toHaveBeenCalledWith(["reading"]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape and returns focus, without submitting an IME composition", async () => {
    await mount(
      <TaskTags
        tags={tags}
        tagIds={[]}
        onChange={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    await click(label("Add tag"));
    const search = label("Find or create tag");
    const composing = new KeyboardEvent("keydown", {
      key: "Enter",
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      search.dispatchEvent(composing);
    });
    expect(composing.defaultPrevented).toBe(true);
    await act(async () => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.querySelector(".tag-popover")).toBeNull();
    expect(document.activeElement).toBe(label("Add tag"));
  });
});

describe("tag management", () => {
  it("blocks duplicate names and saves name, group, and color together", async () => {
    const save = vi.fn();
    await mount(
      <TagDialog tag={tags[0]} tags={tags} onSave={save} onClose={vi.fn()} />,
    );
    await input(label("Tag name"), " reading ");
    expect(buttonText("Save").disabled).toBe(true);
    expect(document.querySelector('[role="alert"]')!.textContent).toContain(
      "already exists",
    );
    await input(label("Tag name"), " #연구  프로젝트 ");
    await choose(label("Tag group"), "topic");
    await click(label("Tag color #ad721f"));
    await submit(document.querySelector(".tag-dialog")!);
    expect(save).toHaveBeenCalledExactlyOnceWith({
      name: "연구 프로젝트",
      group: "topic",
      color: "#ad721f",
    });
  });
});

describe("tags across the workspace", () => {
  it("filters across lists, shows task chips, and gives a new task the current tag", async () => {
    await mountApp();
    await click(buttonText("Reading2", label("Work type tags")));
    expect(document.querySelector("h1")!.textContent).toBe("Reading");
    expect(
      [...document.querySelectorAll(".task-row .task-title")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Paper notes", "Course notes"]);
    expect(
      document.querySelector(".task-row .tag-chips")!.textContent,
    ).toContain("Research");
    await input(label("New task title"), "Read the next paper");
    await submit(document.querySelector(".quick-add")!);
    const created = latest.tasks.find(
      (task) => task.title === "Read the next paper",
    )!;
    expect(created.tagIds).toEqual(["reading"]);
    expect(created.projectId).toBe("");
    expect(created.doDate).toBeNull();
    expect(document.querySelector("h1")!.textContent).toBe("Reading");
  });

  it("searches tag names and assigns a new tag while preserving notes, dates, and attachments", async () => {
    await mountApp();
    const before = structuredClone(latest.tasks[0]);
    await input(label("Search tasks"), "IE232");
    expect(
      [...document.querySelectorAll(".task-row .task-title")].map(
        (node) => node.textContent,
      ),
    ).toEqual(["Course notes"]);
    await click(label("Add tag"));
    await input(label("Find or create tag"), " #Reading   group ");
    await submit(document.querySelector(".tag-popover form")!);
    const added = latest.tags!.find((tag) => tag.name === "Reading group")!;
    expect(added.group).toBe("topic");
    expect(latest.tasks[0].tagIds).toContain(added.id);
    expect(latest.tasks[0].notes).toEqual(before.notes);
    expect(latest.tasks[0].deadline).toEqual(before.deadline);
    expect(latest.tasks[0].doDate).toEqual(before.doDate);
    expect(latest.tasks[0].attachments).toEqual(before.attachments);
  });

  it("edits and deletes a tag across tasks without changing the tasks themselves", async () => {
    await mountApp();
    await click(buttonText("Reading2", label("Work type tags")));
    await click(label("Edit tag"));
    await input(label("Tag name"), "Read");
    await choose(label("Tag group"), "topic");
    await click(label("Tag color #bf514a"));
    await submit(document.querySelector(".tag-dialog")!);
    expect(document.querySelector("h1")!.textContent).toBe("Read");
    expect(latest.tags!.find((tag) => tag.id === "reading")).toMatchObject({
      name: "Read",
      group: "topic",
      color: "#bf514a",
    });
    const before = latest.tasks.map((task) => ({
      title: task.title,
      notes: task.notes,
      projectId: task.projectId,
    }));
    await click(label("Edit tag"));
    await click(buttonText("Delete tag"));
    expect(
      latest.tags!.find((tag) => tag.id === "reading")!.deletedAt,
    ).toBeTruthy();
    expect(
      latest.tasks.every((task) => !task.tagIds?.includes("reading")),
    ).toBe(true);
    expect(
      latest.tasks.map((task) => ({
        title: task.title,
        notes: task.notes,
        projectId: task.projectId,
      })),
    ).toEqual(before);
    expect(document.querySelector("h1")!.textContent).toBe("All tasks");
  });
});

describe("searching task history", () => {
  const visibleTitles = () =>
    [...document.querySelectorAll(".task-row .task-title")].map(
      (node) => node.textContent,
    );

  it("keeps Completed selected for title and tag searches, excluding active and trashed tasks", async () => {
    await mountApp({
      tasks: [
        task("completed-paper", {
          title: "Paper review finished",
          tagIds: ["reading"],
          completedAt: "2026-09-01T00:00:00.000Z",
        }),
        task("completed-course", {
          title: "Course preparation finished",
          tagIds: ["ie232"],
          completedAt: "2026-09-02T00:00:00.000Z",
        }),
        task("active-paper", {
          title: "Paper review active",
          tagIds: ["reading"],
        }),
        task("trashed-paper", {
          title: "Paper review trashed",
          tagIds: ["reading"],
          completedAt: "2026-09-01T00:00:00.000Z",
          deletedAt: "2026-09-02T00:00:00.000Z",
        }),
      ],
    });
    await click(buttonText("Completed"));
    expect(label<HTMLInputElement>("Search tasks").placeholder).toBe(
      "Search completed tasks",
    );
    await input(label("Search tasks"), "Paper review");
    expect(document.querySelector("h1")!.textContent).toBe("Completed");
    expect(visibleTitles()).toEqual(["Paper review finished"]);
    await input(label("Search tasks"), "IE232");
    expect(document.querySelector("h1")!.textContent).toBe("Completed");
    expect(visibleTitles()).toEqual(["Course preparation finished"]);
    await input(label("Search tasks"), "reading");
    expect(visibleTitles()).toEqual(["Paper review finished"]);
    await input(label("Search tasks"), "");
    expect(document.querySelector("h1")!.textContent).toBe("Completed");
    expect(visibleTitles()).toEqual([
      "Paper review finished",
      "Course preparation finished",
    ]);
  });

  it("keeps Trash selected for title and tag searches across deleted open and completed tasks", async () => {
    await mountApp({
      tasks: [
        task("trashed-open", {
          title: "Archived paper draft",
          tagIds: ["reading"],
          deletedAt: "2026-09-01T00:00:00.000Z",
        }),
        task("trashed-done", {
          title: "Archived course work",
          tagIds: ["ie232"],
          completedAt: "2026-08-01T00:00:00.000Z",
          deletedAt: "2026-09-01T00:00:00.000Z",
        }),
        task("open", {
          title: "Archived paper still active",
          tagIds: ["reading"],
        }),
        task("done", {
          title: "Archived course completed",
          tagIds: ["ie232"],
          completedAt: "2026-08-01T00:00:00.000Z",
        }),
      ],
    });
    await click(buttonText("Trash"));
    expect(label<HTMLInputElement>("Search tasks").placeholder).toBe(
      "Search Trash",
    );
    await input(label("Search tasks"), "paper");
    expect(document.querySelector("h1")!.textContent).toBe("Trash");
    expect(visibleTitles()).toEqual(["Archived paper draft"]);
    await input(label("Search tasks"), "IE232");
    expect(document.querySelector("h1")!.textContent).toBe("Trash");
    expect(visibleTitles()).toEqual(["Archived course work"]);
    await input(label("Search tasks"), "");
    expect(document.querySelector("h1")!.textContent).toBe("Trash");
    expect(visibleTitles()).toEqual([
      "Archived paper draft",
      "Archived course work",
    ]);
  });
});

describe("imported file attachments", () => {
  it("labels a HWP attachment as a file and opens its native fallback without a PDF preview", async () => {
    const native = vi.spyOn(storage, "isNative").mockReturnValue(true);
    const send = vi.mocked(storage.nativeSend);
    send.mockClear();
    const attachment = {
      id: "handout",
      name: "강의 자료.hwp",
      mime: "application/x-hwp",
      size: 2048,
      url: "daymark://attachment/handout.hwp",
    };
    try {
      await mountApp({
        tasks: [
          task("example-review", {
            title: "Course handout",
            attachments: [attachment],
          }),
        ],
      });
      const card = document.querySelector(".attachment")!;
      expect(card.querySelector("small")!.textContent).toBe("File · 2 KB");
      expect(card.querySelector("img")).toBeNull();
      await click(card.querySelector("button")!);
      const preview = label("강의 자료.hwp");
      expect(preview.querySelector("object")).toBeNull();
      expect(preview.textContent).toContain(
        "Open this file in its default app.",
      );
      await click(buttonText("Open file", preview));
      expect(send).toHaveBeenCalledExactlyOnceWith({
        action: "openAttachment",
        attachment,
      });
      expect(latest.tasks[0].attachments).toEqual([attachment]);
    } finally {
      native.mockRestore();
      send.mockClear();
    }
  });
});
