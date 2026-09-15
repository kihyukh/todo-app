// @vitest-environment jsdom
import { act, useState } from "react";
import type { SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
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
import { dateKey, emptyDoc } from "../src/model";
import type { AppState, Task } from "../src/model";
import { readBrowserNoteFile } from "../src/note-file-storage";

let root: Root | undefined;
let seed: AppState;
let latest: AppState;
let nativeMode = false;
const workspaceUpdates = vi.fn();
const fileOpenErrors = vi.fn();
let editorFileLink = {
  href: "daymark://attachment/review.pdf",
  label: "Review paper.pdf",
};

vi.mock("../src/note-file-storage", () => ({
  readBrowserNoteFile: vi.fn(),
}));

vi.mock("../src/storage", () => ({
  isNative: () => nativeMode,
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
  // This intentionally lightweight editor verifies the app retains the mounted
  // editing surface, DOM draft, focus and selection while changing pane layout.
  // ProseMirror behavior itself is exercised in task-editor and browser tests.
  default: ({
    onOpenFile,
  }: {
    onOpenFile?: (href: string, label: string) => void | Promise<void>;
  }) => (
    <div className="task-note-editor">
      <div
        aria-label="Task notes"
        contentEditable
        suppressContentEditableWarning
        tabIndex={0}
      />
      <a
        href={editorFileLink.href}
        onClick={(event) => {
          event.preventDefault();
          void Promise.resolve(
            onOpenFile?.(editorFileLink.href, editorFileLink.label),
          ).catch(fileOpenErrors);
        }}
      >
        {editorFileLink.label}
      </a>
    </div>
  ),
}));

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  nativeMode = false;
  editorFileLink = {
    href: "daymark://attachment/review.pdf",
    label: "Review paper.pdf",
  };
  vi.mocked(readBrowserNoteFile).mockReset();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1280,
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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

async function resize(width: number) {
  await act(async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
    window.dispatchEvent(new Event("resize"));
  });
}
function detail() {
  return document.querySelector<HTMLElement>(".detail");
}
function layout() {
  return document
    .querySelector(".app-shell")
    ?.getAttribute("data-detail-layout");
}
async function escape(target: EventTarget = window, prevented = false) {
  const event = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  if (prevented) event.preventDefault();
  await act(async () => target.dispatchEvent(event));
}

describe("Files linked in task notes", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:note-file-preview");
        static revokeObjectURL = vi.fn();
      },
    );
  });

  it("previews an existing native PDF link using its workspace file", async () => {
    nativeMode = true;
    await mount([
      task("Paper review", {
        attachments: [
          {
            id: "review",
            name: "Review paper.pdf",
            mime: "application/pdf",
            size: 128,
            url: editorFileLink.href,
          },
        ],
      }),
    ]);
    await selectTask("Paper review");
    await click(
      detail()!.querySelector<HTMLAnchorElement>(".task-note-editor a"),
    );
    expect(
      label("Review paper.pdf")?.querySelector("object")?.getAttribute("data"),
    ).toBe(editorFileLink.href);
    expect(readBrowserNoteFile).not.toHaveBeenCalled();
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(seed);
  });

  it("previews a stored image without changing attachments and releases its Blob URL on close or unmount", async () => {
    const data = new Blob(["image bytes"], { type: "image/png" });
    vi.mocked(readBrowserNoteFile).mockResolvedValue({
      attachment: {
        id: "review",
        name: "Figure.png",
        mime: "image/png",
        size: data.size,
        url: editorFileLink.href,
      },
      data,
    });
    await mount([task("Paper review")]);
    await selectTask("Paper review");
    const fileLink = detail()!.querySelector<HTMLAnchorElement>(
      ".task-note-editor a",
    )!;

    await click(fileLink);

    expect(readBrowserNoteFile).toHaveBeenCalledWith(editorFileLink.href);
    expect(URL.createObjectURL).toHaveBeenCalledWith(data);
    const preview = label("Figure.png")!;
    expect(preview.getAttribute("role")).toBe("dialog");
    expect(preview.querySelector("img")?.getAttribute("src")).toBe(
      "blob:note-file-preview",
    );
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(seed);
    expect(detail()?.querySelector(".attachments")).toBeNull();

    await click(label("Close preview"));
    expect(label("Figure.png")).toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:note-file-preview",
    );

    await click(fileLink);
    await act(async () => root!.unmount());
    root = undefined;
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(workspaceUpdates).not.toHaveBeenCalled();
  });

  it.each(["csv", "pdf"])(
    "downloads %s with its original filename when it cannot be previewed",
    async (extension) => {
      if (extension === "pdf")
        vi.stubGlobal("navigator", {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          pdfViewerEnabled: false,
        });
      editorFileLink = {
        href: `daymark://attachment/results.${extension}`,
        label: `Experiment results.${extension}`,
      };
      const data = new Blob(["name,value\nalpha,2"], { type: "text/csv" });
      vi.mocked(readBrowserNoteFile).mockResolvedValue({
        attachment: {
          id: "results",
          name: editorFileLink.label,
          mime: extension === "pdf" ? "application/pdf" : "text/csv",
          size: data.size,
          url: editorFileLink.href,
        },
        data,
      });
      const downloads: { url: string; filename: string }[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          downloads.push({ url: this.href, filename: this.download });
        },
      );
      await mount([task("Paper review")]);
      await selectTask("Paper review");
      vi.useFakeTimers();
      await act(async () => {
        detail()!
          .querySelector(".task-note-editor a")!
          .dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
      });

      expect(downloads).toEqual([
        { url: "blob:note-file-preview", filename: editorFileLink.label },
      ]);
      expect(document.querySelector(".preview-modal")).toBeNull();
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1000));
      expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:note-file-preview",
      );
      expect(workspaceUpdates).not.toHaveBeenCalled();
      expect(latest).toEqual(seed);
      expect(detail()?.querySelector(".attachments")).toBeNull();
    },
  );

  it("reports an unavailable file without opening an empty preview or mutating the task", async () => {
    vi.mocked(readBrowserNoteFile).mockResolvedValue(null);
    await mount([task("Paper review")]);
    await selectTask("Paper review");

    await click(
      detail()!.querySelector<HTMLAnchorElement>(".task-note-editor a"),
    );

    expect(fileOpenErrors).toHaveBeenCalledOnce();
    expect(fileOpenErrors.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(fileOpenErrors.mock.calls[0][0].message).toContain(
      "not stored in this browser",
    );
    expect(document.querySelector(".preview-modal")).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(seed);
  });
});

describe("Responsive task detail", () => {
  it("opens a floating pane while retaining the task list and switches tasks directly", async () => {
    await resize(860);
    await mount([task("First task"), task("Second task")]);
    const workspace = document.querySelector(".workspace");
    const rows = [...document.querySelectorAll(".task-row")];
    await selectTask("First task");

    expect(layout()).toBe("floating");
    expect(detail()).not.toBeNull();
    expect(document.querySelector(".workspace")).toBe(workspace);
    expect([...document.querySelectorAll(".task-row")]).toEqual(rows);
    expect(label("Close task")).toBeTruthy();
    expect(label("Resize task detail pane")).toBeUndefined();

    await selectTask("Second task");
    expect(layout()).toBe("floating");
    expect(document.querySelectorAll(".detail")).toHaveLength(1);
    expect(document.querySelector(".workspace")).toBe(workspace);
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(seed);
  });

  it("docks and floats the same mounted editor without losing its draft, caret, focus or scroll", async () => {
    await resize(860);
    await mount([task("Paper review")]);
    await selectTask("Paper review");
    const pane = detail()!;
    const editor = label("Task notes")!;
    const scroll = pane.querySelector<HTMLElement>(".detail-scroll")!;
    const workspace = document.querySelector(".workspace");
    const selection = window.getSelection()!;
    await act(async () => {
      editor.textContent = "Unpublished editor draft";
      editor.focus();
      const range = document.createRange();
      range.setStart(editor.firstChild!, 12);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      scroll.scrollTop = 185;
    });
    const text = editor.firstChild;

    for (const [width, mode] of [
      [984, "docked"],
      [1400, "docked"],
      [983, "floating"],
      [860, "floating"],
    ] as const) {
      await resize(width);
      expect(layout()).toBe(mode);
      expect(detail()).toBe(pane);
      expect(label("Task notes")).toBe(editor);
      expect(document.querySelector(".workspace")).toBe(workspace);
      expect(document.activeElement).toBe(editor);
      expect(editor.textContent).toBe("Unpublished editor draft");
      expect(selection.anchorNode).toBe(text);
      expect(selection.anchorOffset).toBe(12);
      expect(selection.focusNode).toBe(text);
      expect(selection.focusOffset).toBe(12);
      expect(scroll.scrollTop).toBe(185);
      expect(label<HTMLTextAreaElement>("Task title")?.value).toBe(
        "Paper review",
      );
    }
    expect(workspaceUpdates).not.toHaveBeenCalled();
    expect(latest).toEqual(seed);
  });

  it("preserves title selection and an unsaved date draft while docking", async () => {
    await resize(860);
    await mount([task("Paper review")]);
    await selectTask("Paper review");
    const title = label<HTMLTextAreaElement>("Task title")!;
    await act(async () => {
      title.focus();
      title.setSelectionRange(2, 7);
    });
    await resize(1200);
    expect(document.activeElement).toBe(title);
    expect(label("Task title")).toBe(title);
    expect(title.selectionStart).toBe(2);
    expect(title.selectionEnd).toBe(7);

    await resize(860);
    await openSchedule();
    await chooseDay(20);
    const dates = dialog();
    await resize(1200);
    expect(dialog()).toBe(dates);
    expect(workspaceUpdates).not.toHaveBeenCalled();
    await click(button("Save"));
    expect(latest.tasks[0].doDates).toEqual([day(10), day(20)]);
    expect(workspaceUpdates).toHaveBeenCalledTimes(1);
  });

  it("dismisses floating details from the workspace, navigation or close button, but retains docked details", async () => {
    await resize(860);
    await mount([task("Paper review")]);
    await selectTask("Paper review");
    await click(document.querySelector<HTMLElement>(".workspace-header"));
    expect(detail()).toBeNull();

    await selectTask("Paper review");
    await click(document.querySelector<HTMLElement>(".sidebar-collections"));
    expect(detail()).toBeNull();

    await selectTask("Paper review");
    await click(label("Close task"));
    expect(detail()).toBeNull();

    await selectTask("Paper review");
    await resize(1200);
    const pane = detail();
    await click(document.querySelector<HTMLElement>(".workspace-header"));
    expect(detail()).toBe(pane);
    expect(workspaceUpdates).not.toHaveBeenCalled();
  });

  it("reserves Escape for text entry and nested menus before dismissing floating details", async () => {
    await resize(860);
    await mount([task("Paper review")]);
    await selectTask("Paper review");
    const pane = detail();
    const title = label<HTMLTextAreaElement>("Task title")!;
    await act(async () => title.focus());
    await escape(title);
    expect(detail()).toBe(pane);

    const editor = label("Task notes")!;
    await act(async () => editor.focus());
    await escape(editor);
    expect(detail()).toBe(pane);
    await act(async () => editor.blur());

    await escape(window, true);
    expect(detail()).toBe(pane);
    await click(label("Task actions"));
    expect(button("Duplicate task", document)).toBeTruthy();
    await escape();
    expect(button("Duplicate task", document)).toBeUndefined();
    expect(detail()).toBe(pane);

    await openSchedule();
    await escape(document);
    expect(dialog()).toBeNull();
    expect(detail()).toBe(pane);
    await escape();
    expect(detail()).toBeNull();
    expect(workspaceUpdates).not.toHaveBeenCalled();
  });

  it("keeps the phone detail full screen with Back navigation and floats above the phone breakpoint", async () => {
    await resize(600);
    await mount([task("Paper review")]);
    await selectTask("Paper review");
    expect(layout()).toBe("fullscreen");
    expect(label("Back to tasks")).toBeTruthy();
    await click(label("Back to tasks"));
    expect(detail()).toBeNull();

    await resize(601);
    await selectTask("Paper review");
    expect(layout()).toBe("floating");
    const pane = detail();
    await resize(600);
    expect(layout()).toBe("fullscreen");
    expect(detail()).toBe(pane);
    expect(workspaceUpdates).not.toHaveBeenCalled();
  });
});

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
