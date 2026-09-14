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
  it.each(["saving", "saved", "failed"] as const)(
    "delivers calendar messages without changing a workspace whose save is %s",
    async (phase) => {
      await advance(AUTOSAVE_DELAY_MS);
      const pendingSave = saves()[0];
      if (phase !== "saving") {
        await act(() =>
          window.daymarkNativeReceive?.({
            type: phase === "saved" ? "saved" : "error",
            requestId: pendingSave.requestId,
            ...(phase === "failed"
              ? { message: "Workspace folder is unavailable." }
              : {}),
          }),
        );
      }
      const before = {
        state: workspace.state,
        storage: workspace.storage,
        ready: workspace.ready,
        saving: workspace.saving,
        error: workspace.error,
      };
      expect(before.saving).toBe(phase === "saving");
      expect(before.error).toBe(
        phase === "failed" ? "Workspace folder is unavailable." : "",
      );
      const forwarded: unknown[] = [];
      const receive = (event: Event) =>
        forwarded.push((event as CustomEvent).detail);
      window.addEventListener("daymark-native-message", receive);
      const calendarError = {
        type: "error",
        requestId: "calendar:access-check",
        message: "Calendar access is denied.",
      };
      const calendarChanged = { type: "calendarChanged" };
      try {
        for (const message of [calendarError, calendarChanged]) {
          await act(() => window.daymarkNativeReceive?.(message));
          expect(workspace.state).toBe(before.state);
          expect(workspace.storage).toBe(before.storage);
          expect(workspace.ready).toBe(before.ready);
          expect(workspace.saving).toBe(before.saving);
          expect(workspace.error).toBe(before.error);
        }
        expect(forwarded).toEqual([calendarError, calendarChanged]);
        await advance(AUTOSAVE_DELAY_MS * 2);
        expect(saves()).toEqual([pendingSave]);
      } finally {
        window.removeEventListener("daymark-native-message", receive);
      }
    },
  );

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

  it("propagates tags arriving from the cloud while stale legacy snapshots remain unchanged", async () => {
    await advance(AUTOSAVE_DELAY_MS);
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "saved",
        requestId: saves()[0].requestId,
      }),
    );
    const before = workspace.state;
    const tag = {
      id: "reading",
      name: "Reading",
      group: "action" as const,
      color: "#315fd5",
      updatedAt: "2026-09-14T01:00:00.000Z",
    };
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "state",
        state: { ...structuredClone(before), tags: [tag] },
      }),
    );
    expect(workspace.state).not.toBe(before);
    expect(workspace.state.tags).toEqual([tag]);
    expect(workspace.state.tasks).toEqual(before.tasks);
    expect(workspace.saving).toBe(true);
    await advance(AUTOSAVE_DELAY_MS);
    expect(saves()).toHaveLength(2);
    expect(saves()[1].state?.tags).toEqual([tag]);
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "saved",
        requestId: saves()[1].requestId,
      }),
    );
    const tagged = workspace.state;
    await act(() =>
      window.daymarkNativeReceive?.({
        type: "state",
        state: structuredClone(before),
      }),
    );
    expect(workspace.state).toBe(tagged);
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(saves()).toHaveLength(2);
    expect(workspace.saving).toBe(false);
  });

  it.each([false, true])(
    "does not schedule another write for an unchanged cloud state (explicit empty tags: %s)",
    async (explicitTags) => {
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
          state: explicitTags
            ? { ...structuredClone(before), tags: [] }
            : structuredClone(before),
        }),
      );
      expect(workspace.state).toBe(before);
      await advance(AUTOSAVE_DELAY_MS * 2);
      expect(saves()).toHaveLength(1);
      expect(workspace.saving).toBe(false);
    },
  );
});
