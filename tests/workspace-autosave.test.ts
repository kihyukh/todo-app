// @vitest-environment jsdom
import { createElement, act } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDoc, type AppState } from "../src/model";
import { AUTOSAVE_DELAY_MS, useWorkspace } from "../src/storage";

const initial: AppState = {
  schemaVersion: 1,
  tasks: [
    {
      id: "paper",
      title: "Paper",
      notes: emptyDoc(),
      projectId: null,
      columnId: "next",
      doDate: null,
      deadline: null,
      completedAt: null,
      deletedAt: null,
      createdAt: "2026-09-14T00:00:00.000Z",
      updatedAt: "2026-09-14T00:00:00.000Z",
      attachments: [],
    },
  ],
  projects: [],
  columns: [],
};

let workspace: ReturnType<typeof useWorkspace>;
let root: Root;
let container: HTMLDivElement;
let messages: Array<{ action: string; requestId?: string; state?: AppState }>;

function Harness() {
  workspace = useWorkspace();
  return null;
}
function edit(title: string) {
  workspace.setState((old) => ({
    ...old,
    tasks: old.tasks.map((task) => ({ ...task, title, updatedAt: title })),
  }));
}
const saves = () => messages.filter((message) => message.action === "save");
const advance = async (milliseconds: number) => {
  await act(() => vi.advanceTimersByTimeAsync(milliseconds));
};

beforeEach(async () => {
  vi.useFakeTimers();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  messages = [];
  window.webkit = {
    messageHandlers: {
      daymark: { postMessage: (message) => messages.push(message as any) },
    },
  };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(() => root.render(createElement(Harness)));
  await act(() =>
    window.daymarkNativeReceive?.({
      type: "state",
      state: structuredClone(initial),
    }),
  );
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  delete window.webkit;
  delete window.daymarkNativeReceive;
  vi.useRealTimers();
});

describe("autosave scheduling", () => {
  it("coalesces a burst of edits and does not send a native write per keystroke", async () => {
    await act(() => edit("2026-09-14T01:00:00.000Z"));
    await advance(AUTOSAVE_DELAY_MS - 1);
    expect(saves()).toHaveLength(0);
    await act(() => edit("2026-09-14T02:00:00.000Z"));
    await advance(AUTOSAVE_DELAY_MS - 1);
    expect(saves()).toHaveLength(0);
    await advance(1);
    expect(saves()).toHaveLength(1);
    expect(saves()[0].state?.tasks[0].title).toBe("2026-09-14T02:00:00.000Z");
  });

  it("keeps newer edits marked as saving when an older write finishes", async () => {
    await advance(AUTOSAVE_DELAY_MS);
    const previous = saves()[0];
    await act(() => edit("2026-09-14T02:00:00.000Z"));
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "saved",
        requestId: previous.requestId,
      }),
    );
    expect(workspace.saving).toBe(true);
    await advance(AUTOSAVE_DELAY_MS);
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "saved",
        requestId: saves()[1].requestId,
      }),
    );
    expect(workspace.saving).toBe(false);
  });

  it("flushes the editor's freshly committed draft with the exact native shutdown ID", async () => {
    const flushEditor = () => flushSync(() => edit("2026-09-14T03:00:00.000Z"));
    window.addEventListener("daymark-flush", flushEditor, true);
    try {
      await act(() =>
        window.dispatchEvent(
          new CustomEvent("daymark-flush", {
            detail: { requestId: "native-flush-exact" },
          }),
        ),
      );
      expect(saves()).toHaveLength(1);
      expect(saves()[0].requestId).toBe("native-flush-exact");
      expect(saves()[0].state?.tasks[0].title).toBe("2026-09-14T03:00:00.000Z");
    } finally {
      window.removeEventListener("daymark-flush", flushEditor, true);
    }
  });

  it("does not schedule another write for an unchanged cloud state", async () => {
    await advance(AUTOSAVE_DELAY_MS);
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "saved",
        requestId: saves()[0].requestId,
      }),
    );
    const before = workspace.state;
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "state",
        state: structuredClone(before),
      }),
    );
    expect(workspace.state).toBe(before);
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(saves()).toHaveLength(1);
    expect(workspace.saving).toBe(false);
  });
});
