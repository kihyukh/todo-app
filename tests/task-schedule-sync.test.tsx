// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import { emptyDoc, type AppState, type Task } from "../src/model";
import { AUTOSAVE_DELAY_MS } from "../src/storage";
import { finishIOSWorkspaceSetup } from "../src/platform";

// Exercise the real App, date field, note editor and native useWorkspace bridge.
// Only the native host is replaced; no simulator or real workspace is accessed.
let root: Root | undefined;
let messages: { action: string; requestId?: string; state?: AppState }[];
const initialTime = "2026-09-15T12:46:56.000Z";
const task = (id: string, title: string): Task => ({
  id,
  title,
  notes: emptyDoc(),
  projectId: "",
  columnId: "next",
  doDate: "2026-09-15",
  doDates: ["2026-09-15"],
  deadline: null,
  completedAt: null,
  deletedAt: null,
  createdAt: initialTime,
  updatedAt: initialTime,
  attachments: [],
});
const initial: AppState = {
  schemaVersion: 1,
  tasks: [task("review", "Review example paper")],
  projects: [],
  columns: [
    { id: "next", name: "To do", color: "#23764d", updatedAt: initialTime },
  ],
  tags: [],
};
const dialog = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Task dates"]',
  );
const button = (text: string) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>("button")].find(
    (element) => element.textContent?.trim() === text,
  )!;
const day = (date: string) =>
  dialog()!.querySelector<HTMLButtonElement>(`[data-schedule-day="${date}"]`)!;
const saves = () => messages.filter((message) => message.action === "save");
async function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  await act(async () => element.click());
}
async function pointer(element: HTMLElement, type: string) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type.endsWith("up") || type === "click" ? 0 : 1,
  });
  if (type.startsWith("pointer"))
    Object.defineProperties(event, {
      pointerType: { value: "touch" },
      pointerId: { value: 1 },
      isPrimary: { value: true },
    });
  await act(async () => element.dispatchEvent(event));
}
async function receive(state: AppState) {
  await act(async () =>
    window.daymarkNativeReceive?.({
      type: "state",
      state: structuredClone(state),
      storage: { kind: "folder", path: "/fictional/qa-workspace" },
    }),
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-15T13:00:00.000Z"));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("innerWidth", 390);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
  window.__DAYMARK_PLATFORM__ = "ios";
  finishIOSWorkspaceSetup();
  messages = [];
  window.webkit = {
    messageHandlers: {
      daymark: {
        postMessage(message) {
          const value = message as (typeof messages)[number];
          messages.push(value);
          if (value.action === "calendarStatus")
            window.dispatchEvent(
              new CustomEvent("daymark-native-message", {
                detail: {
                  type: "calendarStatus",
                  requestId: value.requestId,
                  status: "notDetermined",
                  calendars: [],
                },
              }),
            );
        },
      },
    },
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<App />));
  await receive(initial);
  await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS));
  const firstSave = saves()[0];
  await act(async () =>
    window.daymarkNativeReceive?.({
      type: "saved",
      requestId: firstSave.requestId,
    }),
  );
  messages = [];
  await click(
    document.querySelector<HTMLElement>(
      '[data-task-id="review"] .task-content',
    )!,
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete window.webkit;
  delete window.daymarkNativeReceive;
  delete window.__DAYMARK_PLATFORM__;
  localStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("date drafts during native workspace updates", () => {
  it.each(["while drafting", "between Save press and click"])(
    "retains the phone draft through unrelated task and note updates %s, then saves once",
    async (arrival) => {
      const editorDOM = document.querySelector('[aria-label="Task notes"]');
      await click(
        document.querySelector<HTMLElement>(".task-schedule-trigger.is-work")!,
      );
      const originalPanel = dialog();
      await click(day("2026-09-17"));
      await click(day("2026-09-22"));
      await click(button("Deadline"));
      await click(day("2026-09-30"));
      const save = button("Save");
      expect(
        originalPanel?.querySelector(".task-schedule-summary")?.textContent,
      ).toContain("3 work days");
      expect(saves()).toHaveLength(0);
      if (arrival === "between Save press and click") {
        await pointer(save, "pointerdown");
        await pointer(save, "mousedown");
      }
      const created: AppState = {
        ...structuredClone(initial),
        tasks: [
          ...structuredClone(initial.tasks),
          task("unrelated", "New task from another device"),
        ],
      };
      await receive(created);
      const remote: AppState = {
        ...created,
        tasks: created.tasks.map((value) =>
          value.id === "unrelated"
            ? {
                ...value,
                updatedAt: "2026-09-15T12:59:00.000Z",
                notes: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "An unrelated note edit from another device.",
                        },
                      ],
                    },
                  ],
                },
              }
            : value,
        ),
      };
      await receive(remote);
      expect(dialog()).toBe(originalPanel);
      expect(save.isConnected).toBe(true);
      expect(document.querySelector('[aria-label="Task notes"]')).toBe(
        editorDOM,
      );
      expect(
        dialog()?.querySelector(".task-schedule-summary")?.textContent,
      ).toContain("3 work days");
      expect(day("2026-09-30").getAttribute("aria-pressed")).toBe("true");
      expect(
        dialog()?.querySelectorAll(".task-schedule-chips button"),
      ).toHaveLength(3);
      if (arrival === "while drafting") {
        await pointer(save, "pointerdown");
        await pointer(save, "mousedown");
      }
      await pointer(save, "pointerup");
      await pointer(save, "mouseup");
      const committedAt = new Date().toISOString();
      await pointer(save, "click");
      expect(dialog()).toBeNull();
      expect(
        document.querySelector(
          ".task-schedule-trigger.is-work .task-schedule-trigger-count",
        )?.textContent,
      ).toBe("+2");
      expect(
        document.querySelector(".task-schedule-trigger.is-deadline")
          ?.textContent,
      ).toContain("Sep 30");
      await act(async () => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS));
      expect(saves()).toHaveLength(1);
      const saved = saves()[0].state!;
      expect(saved.tasks.find((value) => value.id === "review")).toEqual({
        ...initial.tasks[0],
        doDates: ["2026-09-15", "2026-09-17", "2026-09-22"],
        deadline: "2026-09-30",
        updatedAt: committedAt,
      });
      expect(saved.tasks.find((value) => value.id === "unrelated")).toEqual(
        remote.tasks[1],
      );
      expect(
        messages.some((message) => message.action === "openAttachment"),
      ).toBe(false);
      // An old cloud echo after Save must not remove the newly committed dates.
      await receive(remote);
      await click(
        document.querySelector<HTMLElement>(".task-schedule-trigger.is-work")!,
      );
      expect(day("2026-09-17").getAttribute("aria-pressed")).toBe("true");
      expect(day("2026-09-22").getAttribute("aria-pressed")).toBe("true");
      expect(day("2026-09-30").classList.contains("has-deadline")).toBe(true);
    },
  );
});
