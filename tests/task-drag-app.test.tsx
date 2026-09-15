// @vitest-environment jsdom
import { act, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { dateKey, emptyDoc, mergeState } from "../src/model";
import type { AppState, Task } from "../src/model";
import { TASK_DRAG_MIME } from "../src/task-drag";
let root: Root | undefined, seed: AppState, latest: AppState;
let setWorkspace: Dispatch<SetStateAction<AppState>>;
let pointerTarget: Element | null = null;
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
  document.elementFromPoint = () => pointerTarget;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
  pointerTarget = null;
});
const stamp = "2026-09-01T00:00:00.000Z";
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "research",
  columnId: "next",
  doDate: dateKey(),
  deadline: null,
  completedAt: null,
  deletedAt: null,
  createdAt: stamp,
  updatedAt: stamp,
  attachments: [],
  ...extra,
});
async function mount(tasks = [task("a"), task("b"), task("c")]) {
  seed = {
    schemaVersion: 1,
    tasks,
    projects: ["research", "teaching"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
    tags: ["reading", "writing", "topic"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
    columns: ["next", "progress"].map((id) => ({
      id,
      name: id,
      color: "#24704f",
      updatedAt: stamp,
    })),
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
}
const row = (id: string) =>
  [...document.querySelectorAll<HTMLElement>("main .task-row")].find(
    (element) => element.dataset.taskId === id,
  )!;
const titles = () =>
  [...document.querySelectorAll("main .task-title")].map(
    (element) => element.textContent,
  );
const label = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("[aria-label]")].find(
    (element) => element.getAttribute("aria-label") === name,
  )!;
const nav = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".sidebar .nav-item")].find(
    (element) => element.querySelector("span")?.textContent === name,
  )!;
async function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
}
class Transfer {
  data = new Map<string, string>();
  effectAllowed = "all";
  dropEffect = "none";
  get types() {
    return [...this.data.keys()];
  }
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
  getData(type: string) {
    return this.data.get(type) ?? "";
  }
  clearData() {
    this.data.clear();
  }
}
async function send(
  element: HTMLElement,
  type: string,
  transfer: Transfer,
  y = 101,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: y,
  });
  Object.defineProperty(event, "dataTransfer", { value: transfer });
  await act(async () => element.dispatchEvent(event));
  return event;
}
async function drag(source: HTMLElement, target: HTMLElement, after = false) {
  const transfer = new Transfer();
  target.getBoundingClientRect = () => new DOMRect(0, 100, 300, 60);
  await send(source, "dragstart", transfer);
  await send(target, "dragover", transfer, after ? 159 : 101);
  await send(target, "drop", transfer, after ? 159 : 101);
  await send(source, "dragend", transfer);
  return transfer;
}
async function pointerEvent(
  element: EventTarget,
  type: string,
  x: number,
  y: number,
  pointerType = "mouse",
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: pointerType },
    isPrimary: { value: true },
  });
  await act(async () => element.dispatchEvent(event));
  return event;
}
async function startPointerDrag(
  source: HTMLElement,
  target: HTMLElement,
  after = false,
) {
  target.getBoundingClientRect = () => new DOMRect(0, 100, 300, 60);
  pointerTarget = target;
  await pointerEvent(
    source.querySelector(".task-content") ?? source,
    "pointerdown",
    100,
    300,
  );
  await pointerEvent(document, "pointermove", 100, after ? 159 : 101);
}
describe("mouse pointer task dragging", () => {
  it("supports a mouse-only gesture with missing buttons metadata and restores native dragging", async () => {
    await mount();
    await click(nav("All tasks"));
    const source = row("c");
    const content = source.querySelector<HTMLElement>(".task-content")!;
    const target = row("a");
    target.getBoundingClientRect = () => new DOMRect(0, 100, 300, 60);
    pointerTarget = target;
    const mouse = async (element: EventTarget, type: string, y: number) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 0,
        clientX: 100,
        clientY: y,
      });
      await act(async () => element.dispatchEvent(event));
      return event;
    };
    expect(source.draggable).toBe(true);
    await mouse(content, "mousedown", 300);
    expect(source.draggable).toBe(false);
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    expect(
      (await send(source, "dragstart", new Transfer())).defaultPrevented,
    ).toBe(true);
    await mouse(document, "mousemove", 101);
    expect(document.querySelector(".task-drag-ghost")).not.toBeNull();
    await mouse(document, "mouseup", 101);
    expect(titles()).toEqual(["c", "a", "b"]);
    expect(source.draggable).toBe(true);
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    await click(content);
    expect(document.querySelector("aside.detail")).toBeNull();
  });
  it("uses one mouse stream after pointerdown and cancels on leaving the window", async () => {
    await mount();
    await click(nav("All tasks"));
    const source = row("c");
    const content = source.querySelector<HTMLElement>(".task-content")!;
    pointerTarget = row("a");
    row("a").getBoundingClientRect = () => new DOMRect(0, 100, 300, 60);
    await pointerEvent(content, "pointerdown", 100, 300);
    await act(async () =>
      content.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 300,
        }),
      ),
    );
    await pointerEvent(document, "pointermove", 100, 101);
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new MouseEvent("mousemove", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 101,
        }),
      ),
    );
    expect(document.querySelector(".task-drag-ghost")).not.toBeNull();
    await pointerEvent(document, "pointerup", 100, 101);
    expect(latest).toBe(seed);
    expect(document.querySelector(".task-drag-ghost")).not.toBeNull();
    await act(async () =>
      document.dispatchEvent(
        new MouseEvent("mouseleave", {
          relatedTarget: row("a"),
        }),
      ),
    );
    expect(document.querySelector(".task-drag-ghost")).not.toBeNull();
    await act(async () => document.dispatchEvent(new MouseEvent("mouseleave")));
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    expect(source.draggable).toBe(true);
    await act(async () =>
      document.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 100,
          clientY: 101,
        }),
      ),
    );
    await click(content);
    expect(document.querySelector("aside.detail")).toBeNull();
    expect(latest).toBe(seed);
  });
  it("scrolls horizontally at board edges while keeping sidebar scrolling vertical", async () => {
    await mount();
    await click(nav("All tasks"));
    await click(label("Board view"));
    const callbacks: FrameRequestCallback[] = [];
    const frames = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callbacks.push(callback);
        return callbacks.length;
      });
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => {});
    try {
      const area = document.querySelector<HTMLElement>(".task-scroll")!;
      area.getBoundingClientRect = () => new DOMRect(0, 0, 300, 400);
      Object.defineProperties(area, {
        scrollWidth: { configurable: true, value: 1000 },
        clientWidth: { configurable: true, value: 300 },
      });
      const column = document.querySelector<HTMLElement>(".board-column")!;
      await startPointerDrag(row("a"), column);
      await pointerEvent(document, "pointermove", 295, 200);
      await act(async () => callbacks.shift()!(0));
      expect(area.scrollLeft).toBeGreaterThan(0);
      await pointerEvent(document, "pointercancel", 295, 200);
      callbacks.length = 0;
      const sidebar = document.querySelector<HTMLElement>(
        ".sidebar-collections",
      )!;
      sidebar.getBoundingClientRect = () => new DOMRect(0, 0, 200, 400);
      Object.defineProperties(sidebar, {
        scrollWidth: { configurable: true, value: 400 },
        clientWidth: { configurable: true, value: 200 },
      });
      await startPointerDrag(row("a"), nav("writing"));
      await pointerEvent(document, "pointermove", 195, 200);
      await act(async () => callbacks.shift()!(0));
      expect(sidebar.scrollLeft).toBe(0);
      await pointerEvent(document, "pointercancel", 195, 200);
      expect(latest).toBe(seed);
    } finally {
      frames.mockRestore();
      cancel.mockRestore();
    }
  });
  it("reorders from the task content, prevents native takeover, and suppresses the release click", async () => {
    await mount();
    await click(nav("All tasks"));
    const source = row("c");
    await startPointerDrag(source, row("a"));
    expect(row("a").dataset.dropEdge).toBe("before");
    expect(document.querySelector(".task-drag-ghost")?.textContent).toContain(
      "Place before",
    );
    const transfer = new Transfer();
    expect((await send(source, "dragstart", transfer)).defaultPrevented).toBe(
      true,
    );
    expect(transfer.types).toEqual([]);
    await pointerEvent(document, "pointerup", 100, 101);
    expect(titles()).toEqual(["c", "a", "b"]);
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    expect(
      document.documentElement.classList.contains("is-task-pointer-dragging"),
    ).toBe(false);
    await click(source.querySelector<HTMLElement>(".task-content")!);
    expect(document.querySelector("aside.detail")).toBeNull();
    expect(latest.tasks.every((task) => !task.completedAt)).toBe(true);
    await pointerEvent(
      source.querySelector(".task-content")!,
      "pointerdown",
      100,
      101,
    );
    await pointerEvent(document, "pointerup", 100, 101);
    await click(source.querySelector<HTMLElement>(".task-content")!);
    expect(document.querySelector("aside.detail")).not.toBeNull();
  });
  it("preserves ordinary clicks below the threshold and leaves touch and pen scrolling alone", async () => {
    await mount();
    await click(nav("All tasks"));
    pointerTarget = row("a");
    for (const pointerType of ["touch", "pen"]) {
      await pointerEvent(row("c"), "pointerdown", 100, 300, pointerType);
      const move = await pointerEvent(
        document,
        "pointermove",
        100,
        101,
        pointerType,
      );
      await pointerEvent(document, "pointerup", 100, 101, pointerType);
      expect(move.defaultPrevented).toBe(false);
    }
    await pointerEvent(
      row("a").querySelector(".task-content")!,
      "pointerdown",
      100,
      101,
    );
    await pointerEvent(document, "pointermove", 102, 102);
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    await pointerEvent(document, "pointerup", 102, 102);
    await click(row("a").querySelector<HTMLElement>(".task-content")!);
    expect(document.querySelector("aside.detail")).not.toBeNull();
    expect(latest).toBe(seed);
  });
  it.each(["pointercancel", "Escape", "blur"])(
    "cleans up a drag on %s without changing tasks",
    async (reason) => {
      await mount();
      await click(nav("All tasks"));
      await startPointerDrag(row("c"), row("a"));
      if (reason === "pointercancel")
        await pointerEvent(document, "pointercancel", 100, 101);
      else if (reason === "Escape")
        await act(async () =>
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: "Escape",
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
      else await act(async () => window.dispatchEvent(new Event("blur")));
      expect(document.querySelector(".task-drag-ghost")).toBeNull();
      expect(document.querySelector('[data-task-dragging="true"]')).toBeNull();
      await pointerEvent(document, "pointerup", 100, 101);
      expect(latest).toBe(seed);
    },
  );
  it("cancels when sync completes the source, when the view changes, and on unmount", async () => {
    await mount();
    await click(nav("All tasks"));
    await startPointerDrag(row("c"), row("a"));
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === "c" ? { ...task, completedAt: stamp } : task,
        ),
      })),
    );
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    const completed = latest;
    await pointerEvent(document, "pointerup", 100, 101);
    expect(latest).toBe(completed);
    await click(row("a").querySelector<HTMLElement>(".task-content")!);
    expect(document.querySelector("aside.detail")).toBeNull();
    await startPointerDrag(row("b"), row("a"));
    await click(nav("Today"));
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    await pointerEvent(document, "pointerup", 100, 101);
    expect(latest).toBe(completed);
    await click(row("a").querySelector<HTMLElement>(".task-content")!);
    expect(document.querySelector("aside.detail")).toBeNull();
    await click(nav("All tasks"));
    await startPointerDrag(row("b"), row("a"));
    await act(async () => root!.unmount());
    root = undefined;
    expect(document.querySelector(".task-drag-ghost")).toBeNull();
    expect(
      document.documentElement.classList.contains("is-task-pointer-dragging"),
    ).toBe(false);
  });
  it("moves to sidebar lists, adds tags, and keeps board-column pointer drops working", async () => {
    await mount();
    await click(nav("All tasks"));
    await startPointerDrag(row("a"), nav("teaching"));
    expect(nav("teaching").dataset.taskDrop).toBe("true");
    await pointerEvent(document, "pointerup", 100, 101);
    expect(latest.tasks[0].projectId).toBe("teaching");
    await startPointerDrag(row("a"), nav("writing"));
    await pointerEvent(document, "pointerup", 100, 101);
    expect(latest.tasks[0]).toMatchObject({
      projectId: "teaching",
      tagIds: ["writing"],
    });
    await pointerEvent(label("Board view"), "pointerdown", 50, 50);
    await click(label("Board view"));
    const progress = [
      ...document.querySelectorAll<HTMLElement>(".board-column"),
    ].find(
      (element) =>
        element.querySelector(".column-name")?.textContent === "progress",
    )!;
    await startPointerDrag(row("a"), progress);
    await pointerEvent(document, "pointerup", 100, 101);
    expect(latest.tasks[0]).toMatchObject({
      columnId: "progress",
      projectId: "teaching",
      tagIds: ["writing"],
    });
  });
});
describe("desktop task dragging", () => {
  it("reorders before/after, persists after an ID-sorted reload, and resets only manual order with Undo", async () => {
    await mount();
    await click(nav("All tasks"));
    const transfer = await drag(row("c"), row("a"));
    expect(transfer.types).toEqual([TASK_DRAG_MIME, "text/plain"]);
    expect(transfer.getData("text/plain")).toBe("c");
    expect(titles()).toEqual(["c", "a", "b"]);
    expect(document.body.textContent).toContain("Reordered c");
    const persisted = JSON.parse(JSON.stringify(latest));
    await act(async () => setWorkspace(mergeState(seed, persisted)));
    expect(titles()).toEqual(["c", "a", "b"]);
    await drag(row("c"), row("b"), true);
    expect(titles()).toEqual(["a", "b", "c"]);
    await click(label("Undo task move"));
    expect(titles()).toEqual(["c", "a", "b"]);
    await click(label("Reset to priority order"));
    expect(titles()).toEqual(["a", "b", "c"]);
    expect(label("Reset to priority order")).toBeUndefined();
    await click(label("Undo task move"));
    expect(titles()).toEqual(["c", "a", "b"]);
  });
  it("supports repeated Alt+Up/Down from the focused handle", async () => {
    await mount();
    await click(nav("All tasks"));
    const handle = label("Reorder c");
    await act(async () => {
      handle.focus();
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(titles()).toEqual(["a", "c", "b"]);
    expect(document.activeElement).toBe(handle);
    await act(async () =>
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowUp",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(titles()).toEqual(["c", "a", "b"]);
  });
  it("keeps Today, Upcoming, search and board out of manual reordering", async () => {
    await mount([task("a", { priority: 3 }), task("b"), task("c")]);
    expect(label("Reorder a")).toBeUndefined();
    await drag(row("c"), row("a"));
    expect(latest).toBe(seed);
    await click(nav("Upcoming"));
    expect(label("Reorder a")).toBeUndefined();
    await click(nav("All tasks"));
    const search = label("Search tasks") as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "a");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(label("Reorder a")).toBeUndefined();
    await click(nav("All tasks"));
    await click(label("Board view"));
    expect(label("Reorder a")).toBeUndefined();
    expect(latest).toBe(seed);
  });
  it("moves into sidebar lists and Inbox, with Undo preserving edits made after the drop", async () => {
    await mount();
    await click(nav("All tasks"));
    await drag(row("a"), nav("teaching"));
    expect(latest.tasks[0].projectId).toBe("teaching");
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === "a"
            ? {
                ...task,
                title: "Updated a",
                deadline: "2026-09-29",
                priority: 3,
              }
            : task,
        ),
      })),
    );
    await click(label("Undo task move"));
    expect(latest.tasks[0]).toMatchObject({
      projectId: "research",
      title: "Updated a",
      deadline: "2026-09-29",
      priority: 3,
    });
    await drag(row("a"), nav("Inbox"));
    expect(latest.tasks[0].projectId).toBe("");
    await click(nav("Inbox"));
    expect(titles()).toEqual(["Updated a"]);
  });
  it("adds a sidebar tag without changing the list or replacing tags and Undo preserves other added tags", async () => {
    await mount([task("a", { tagIds: ["reading"] })]);
    await click(nav("All tasks"));
    await drag(row("a"), nav("writing"));
    expect(latest.tasks[0]).toMatchObject({
      projectId: "research",
      tagIds: ["reading", "writing"],
    });
    const unchanged = latest;
    await drag(row("a"), nav("writing"));
    expect(latest).toBe(unchanged);
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: [
          { ...state.tasks[0], tagIds: [...state.tasks[0].tagIds!, "topic"] },
        ],
      })),
    );
    await click(label("Undo task move"));
    expect(latest.tasks[0].tagIds).toEqual(["reading", "topic"]);
  });
  it("preserves board column moves and allows a board card to move into a sidebar list", async () => {
    await mount();
    await click(nav("All tasks"));
    await click(label("Board view"));
    const progress = [
      ...document.querySelectorAll<HTMLElement>(".board-column"),
    ].find(
      (element) =>
        element.querySelector(".column-name")?.textContent === "progress",
    )!;
    await drag(row("a"), progress);
    expect(latest.tasks[0]).toMatchObject({
      columnId: "progress",
      projectId: "research",
    });
    await drag(row("a"), nav("teaching"));
    expect(latest.tasks[0]).toMatchObject({
      columnId: "progress",
      projectId: "teaching",
    });
    const plain = new Transfer();
    plain.setData("text/plain", "b");
    const before = latest;
    await send(progress, "dragover", plain);
    await send(progress, "drop", plain);
    expect(latest).toBe(before);
  });
  it("rejects external text/files, expired sessions, and a source completed during a drag", async () => {
    await mount();
    await click(nav("All tasks"));
    for (const type of ["text/plain", "Files", TASK_DRAG_MIME]) {
      const external = new Transfer();
      external.setData(
        type,
        type === TASK_DRAG_MIME
          ? JSON.stringify({ id: "a", token: "fake" })
          : "a",
      );
      await send(nav("teaching"), "drop", external);
    }
    expect(latest).toBe(seed);
    const stale = new Transfer();
    await send(row("a"), "dragstart", stale);
    await send(row("a"), "dragend", stale);
    await send(nav("teaching"), "drop", stale);
    expect(latest).toBe(seed);
    const active = new Transfer();
    await send(row("a"), "dragstart", active);
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === "a" ? { ...task, completedAt: stamp } : task,
        ),
      })),
    );
    const completed = latest;
    await send(nav("teaching"), "drop", active);
    expect(latest).toBe(completed);
    await click(nav("Completed"));
    expect(row("a").draggable).toBe(false);
  });
  it("blocks starting a task drag from completion controls", async () => {
    await mount();
    await click(nav("All tasks"));
    await act(async () =>
      row("a")
        .querySelector(".task-check")!
        .dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })),
    );
    const transfer = new Transfer();
    const event = await send(row("a"), "dragstart", transfer);
    expect(event.defaultPrevented).toBe(true);
    expect(transfer.types).toEqual([]);
    expect(latest).toBe(seed);
  });
});
