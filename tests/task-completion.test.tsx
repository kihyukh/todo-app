// @vitest-environment jsdom
import { act, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import App from "../src/App";
import { COMPLETION_DURATION } from "../src/TaskCompletion";
import {
  playCompletionChime,
  writeCompletionSoundPreference,
} from "../src/completion-sound";
import { addDays, dateKey, emptyDoc } from "../src/model";
import { plainText } from "../src/editor-utils";
import type { AppState, NoteNode, Task } from "../src/model";

let root: Root | undefined;
let seed: AppState;
let latest: AppState;
let setWorkspace: Dispatch<SetStateAction<AppState>>;
let reduceMotion = false;
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
vi.mock("../src/completion-sound", async () => ({
  ...(await vi.importActual<typeof import("../src/completion-sound")>(
    "../src/completion-sound",
  )),
  playCompletionChime: vi.fn(),
}));
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T03:00:00.000Z"));
  reduceMotion = false;
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reduceMotion,
    })),
  );
  writeCompletionSoundPreference(true);
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const timestamp = "2020-01-01T00:00:00.000Z";
const note = (text: string): NoteNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: id,
  notes: emptyDoc(),
  projectId: "",
  columnId: "next",
  doDate: dateKey(),
  deadline: null,
  completedAt: null,
  deletedAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
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
const label = <T extends HTMLElement = HTMLButtonElement>(name: string) =>
  [...document.querySelectorAll<T>("[aria-label]")].find(
    (element) => element.getAttribute("aria-label") === name,
  );
const row = (id: string) =>
  [...document.querySelectorAll<HTMLElement>("main .task-row")].find(
    (element) => element.dataset.taskId === id,
  );
const record = (id: string) => latest.tasks.find((item) => item.id === id)!;
async function click(element: HTMLElement | null | undefined) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
async function focus(element: HTMLElement) {
  await act(async () => element.focus());
}
async function advance(milliseconds: number) {
  await act(async () => vi.advanceTimersByTimeAsync(milliseconds));
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

describe("task completion feedback", () => {
  it("saves completion immediately, preserves task data, and moves keyboard focus only when the held row exits", async () => {
    await mount([
      task("Paper", {
        notes: note("Review the proof."),
        doDates: [addDays(-2), dateKey(), addDays(3)],
        doDate: addDays(-2),
        deadline: addDays(10),
        priority: 3,
        tagIds: ["research"],
        attachments: [
          {
            id: "pdf",
            name: "paper.pdf",
            mime: "application/pdf",
            size: 20,
            url: "daymark://attachment/paper.pdf",
          },
        ],
      }),
      task("Read next"),
    ]);
    const before = structuredClone(record("Paper"));
    const checkbox = label("Complete Paper")!;
    await focus(checkbox);
    await click(checkbox);
    expect(record("Paper")).toEqual({
      ...before,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(playCompletionChime).toHaveBeenCalledOnce();
    expect(row("Paper")?.classList.contains("is-completing")).toBe(true);
    expect(
      row("Paper")?.querySelector(".completion-mark.is-drawing"),
    ).not.toBeNull();
    expect(label("Undo task completion")).toBeTruthy();
    expect(document.activeElement).toBe(checkbox);
    await advance(COMPLETION_DURATION - 1);
    expect(row("Paper")).toBeTruthy();
    expect(document.activeElement).toBe(checkbox);
    await advance(1);
    expect(row("Paper")).toBeUndefined();
    expect(document.activeElement).toBe(label("Complete Read next"));
  });

  it.each([100, COMPLETION_DURATION + 100])(
    "undoes at %dms without overwriting notes or schedules that changed after completion",
    async (delay) => {
      await mount([
        task("Paper", {
          notes: note("Original"),
          doDates: [dateKey(), addDays(2)],
          deadline: addDays(6),
        }),
      ]);
      await click(label("Complete Paper"));
      await advance(delay);
      await act(async () =>
        setWorkspace((state) => ({
          ...state,
          tasks: state.tasks.map((item) => ({
            ...item,
            notes: note("Arrived from another device"),
            doDates: [dateKey(), addDays(2), addDays(4)],
          })),
        })),
      );
      const beforeUndo = structuredClone(record("Paper"));
      await click(label("Undo task completion"));
      expect(record("Paper")).toEqual({
        ...beforeUndo,
        completedAt: null,
        updatedAt: record("Paper").updatedAt,
      });
      expect(row("Paper")).toBeTruthy();
      expect(row("Paper")?.classList.contains("is-completing")).toBe(false);
      expect(label("Undo task completion")).toBeUndefined();
      expect(playCompletionChime).toHaveBeenCalledOnce();
      await advance(COMPLETION_DURATION + 5000);
      expect(row("Paper")).toBeTruthy();
      expect(record("Paper").completedAt).toBeNull();
    },
  );

  it("keeps independent animation timers when two tasks are completed rapidly", async () => {
    await mount([task("First"), task("Second"), task("Third")]);
    await click(label("Complete First"));
    await advance(200);
    await click(label("Complete Second"));
    expect(record("First").completedAt).toBeTruthy();
    expect(record("Second").completedAt).toBeTruthy();
    expect(document.querySelector(".completion-toast")?.textContent).toContain(
      "Completed Second",
    );
    await advance(COMPLETION_DURATION - 200);
    expect(row("First")).toBeUndefined();
    expect(row("Second")).toBeTruthy();
    await click(label("Undo task completion"));
    await advance(200);
    expect(record("First").completedAt).toBeTruthy();
    expect(record("Second").completedAt).toBeNull();
    expect(row("Second")).toBeTruthy();
    expect(row("Third")).toBeTruthy();
    expect(playCompletionChime).toHaveBeenCalledTimes(2);
  });

  it("cancels a reopened task's old timer before starting another completion", async () => {
    await mount([task("Paper")]);
    await click(label("Complete Paper"));
    await advance(100);
    await click(label("Reopen Paper"));
    expect(record("Paper").completedAt).toBeNull();
    expect(playCompletionChime).toHaveBeenCalledOnce();
    await advance(100);
    await click(label("Complete Paper"));
    await advance(COMPLETION_DURATION - 200);
    expect(row("Paper")?.classList.contains("is-completing")).toBe(true);
    await advance(200);
    expect(row("Paper")).toBeUndefined();
    expect(playCompletionChime).toHaveBeenCalledTimes(2);
  });

  it("does not chime for completed tasks loaded from storage, a reopen, or an incoming completion", async () => {
    await mount([
      task("Already done", { completedAt: timestamp }),
      task("Remote task"),
    ]);
    expect(playCompletionChime).not.toHaveBeenCalled();
    await view("Completed");
    await click(label("Reopen Already done"));
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((item) =>
          item.id === "Remote task"
            ? { ...item, completedAt: new Date().toISOString() }
            : item,
        ),
      })),
    );
    expect(record("Already done").completedAt).toBeNull();
    expect(row("Remote task")).toBeTruthy();
    expect(row("Remote task")?.classList.contains("is-completing")).toBe(false);
    expect(document.querySelector(".completion-toast")).toBeNull();
    expect(playCompletionChime).not.toHaveBeenCalled();
  });

  it("does not steal focus after a synced reopen cancels the need for an exit", async () => {
    await mount([task("Paper"), task("Read next")]);
    const checkbox = label("Complete Paper")!;
    await focus(checkbox);
    await click(checkbox);
    await act(async () =>
      setWorkspace((state) => ({
        ...state,
        tasks: state.tasks.map((item) =>
          item.id === "Paper" ? { ...item, completedAt: null } : item,
        ),
      })),
    );
    await advance(COMPLETION_DURATION);
    expect(row("Paper")).toBeTruthy();
    expect(document.activeElement).toBe(label("Complete Paper"));
    expect(playCompletionChime).toHaveBeenCalledOnce();
  });

  it("keeps focus in Completed when the same row will remain after its animation", async () => {
    await mount([
      task("Paper"),
      task("Previously done", { completedAt: timestamp }),
    ]);
    await click(label("Complete Paper"));
    await view("Completed");
    await focus(label("Reopen Paper")!);
    await advance(COMPLETION_DURATION);
    expect(row("Paper")).toBeTruthy();
    expect(document.activeElement).toBe(label("Reopen Paper"));
  });

  it("does not interrupt typing in another field when the row disappears", async () => {
    await mount([task("Paper"), task("Read next")]);
    await click(label("Complete Paper"));
    const input = label<HTMLInputElement>("New task title")!;
    await focus(input);
    await advance(COMPLETION_DURATION);
    expect(row("Paper")).toBeUndefined();
    expect(document.activeElement).toBe(input);
  });

  it("uses the shorter completion hold for reduced motion and offers Undo for five seconds", async () => {
    reduceMotion = true;
    await mount([task("Paper")]);
    await click(label("Complete Paper"));
    await advance(119);
    expect(row("Paper")).toBeTruthy();
    await advance(1);
    expect(row("Paper")).toBeUndefined();
    expect(label("Undo task completion")).toBeTruthy();
    await advance(4879);
    expect(label("Undo task completion")).toBeTruthy();
    await advance(1);
    expect(label("Undo task completion")).toBeUndefined();
  });

  it("retains a missed-work row long enough to animate and pass keyboard focus onward", async () => {
    await mount([task("Missed work", { doDate: addDays(-1) }), task("Today")]);
    await click(document.querySelector(".earlier-toggle"));
    const checkbox = label("Complete Missed work")!;
    await focus(checkbox);
    await click(checkbox);
    expect(record("Missed work").completedAt).toBeTruthy();
    expect(row("Missed work")?.classList.contains("is-completing")).toBe(true);
    await advance(COMPLETION_DURATION);
    expect(row("Missed work")).toBeUndefined();
    expect(document.activeElement).toBe(label("Complete Today"));
  });

  it("preserves an unpublished note draft when completing and immediately switching tasks", async () => {
    await mount([
      task("Paper", { notes: note("Original") }),
      task("Read next", { notes: note("Other note") }),
    ]);
    await click(row("Paper")?.querySelector(".task-content"));
    const editor = (
      document.querySelector(".tiptap") as HTMLElement & { editor: Editor }
    ).editor;
    await act(async () => {
      editor.commands.setTextSelection(9);
      editor.commands.insertContent(" with a final note");
    });
    expect(plainText(record("Paper").notes)).toBe("Original");
    await click(label("Complete task"));
    expect(record("Paper").completedAt).toBeTruthy();
    await click(row("Read next")?.querySelector(".task-content"));
    expect(plainText(record("Paper").notes)).toBe("Original with a final note");
    expect(plainText(record("Read next").notes)).toBe("Other note");
    await advance(COMPLETION_DURATION);
    expect(record("Paper").completedAt).toBeTruthy();
    expect(label<HTMLTextAreaElement>("Task title")?.value).toBe("Read next");
  });

  it("remembers the muted Settings preference after remounting without changing task data", async () => {
    await mount([task("Paper")]);
    const before = structuredClone(latest);
    await click(label("Settings"));
    const toggle = label<HTMLInputElement>("Completion sound")!;
    expect(toggle.checked).toBe(true);
    await click(toggle);
    expect(localStorage.getItem("daymark.completion-sound.v1")).toBe("false");
    expect(latest).toEqual(before);
    await act(async () => root!.unmount());
    root = undefined;
    document.body.replaceChildren();
    await mount(before.tasks);
    await click(label("Settings"));
    expect(label<HTMLInputElement>("Completion sound")?.checked).toBe(false);
    expect(playCompletionChime).not.toHaveBeenCalled();
  });
});
