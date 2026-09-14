// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import type { NoteNode } from "../src/model";
import TaskEditor from "../src/TaskEditor";

let root: Root | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  document.body.replaceChildren();
});

const note = (text: string): NoteNode => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function mount() {
  let renderCount = 0;
  const published: Array<{ id: string; doc: NoteNode }> = [];
  let select!: (id: string) => void;
  function Harness() {
    renderCount++;
    const [id, setId] = useState("a");
    const [notes, setNotes] = useState({ a: note("Alpha"), b: note("Beta") });
    select = setId;
    return (
      <TaskEditor
        key={id}
        taskId={id}
        content={notes[id as "a" | "b"]}
        onChange={(doc) => {
          published.push({ id, doc });
          setNotes((old) => ({ ...old, [id]: doc }));
        }}
        onPendingChange={() => {}}
        onAttach={() => {}}
        vimEnabled={false}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  return {
    published,
    select,
    renders: () => renderCount,
    editor: () =>
      (container.querySelector(".tiptap") as HTMLElement & { editor: Editor })
        .editor,
  };
}

describe("task editor publication", () => {
  it("types immediately without rerendering the app for every keystroke", async () => {
    const harness = await mount();
    vi.useFakeTimers();
    const before = harness.renders();
    await act(async () => {
      harness.editor().commands.setTextSelection(6);
      for (let i = 0; i < 100; i++)
        harness.editor().commands.insertContent("x");
    });
    expect(harness.editor().getText()).toBe("Alpha" + "x".repeat(100));
    expect(harness.published).toHaveLength(0);
    expect(harness.renders()).toBe(before);
    await act(async () => vi.advanceTimersByTime(350));
    expect(harness.published).toHaveLength(1);
    expect(harness.renders()).toBe(before + 1);
  });

  it("flushes a pending note to its original task when switching immediately", async () => {
    const harness = await mount();
    await act(async () => {
      harness.editor().commands.setTextSelection(6);
      harness.editor().commands.insertContent(" final edit");
      harness.select("b");
    });
    expect(harness.published).toHaveLength(1);
    expect(harness.published[0].id).toBe("a");
    expect(JSON.stringify(harness.published[0].doc)).toContain(
      "Alpha final edit",
    );
    expect(harness.editor().getText()).toBe("Beta");
  });

  it("publishes the final keystroke before the native shutdown handler runs", async () => {
    const harness = await mount();
    let snapshotAtSave = "";
    const save = () => {
      snapshotAtSave = JSON.stringify(harness.published.at(-1)?.doc);
    };
    window.addEventListener("daymark-flush", save);
    try {
      await act(async () => {
        harness.editor().commands.setTextSelection(6);
        harness.editor().commands.insertContent(" just typed");
        window.dispatchEvent(new CustomEvent("daymark-flush"));
      });
      expect(snapshotAtSave).toContain("Alpha just typed");
    } finally {
      window.removeEventListener("daymark-flush", save);
    }
  });

  it("disables predictive text and correction on the rich note", async () => {
    const harness = await mount();
    const dom = harness.editor().view.dom;
    expect(dom.getAttribute("autocorrect")).toBe("off");
    expect(dom.getAttribute("autocomplete")).toBe("off");
    expect(dom.getAttribute("spellcheck")).toBe("false");
    expect(dom.getAttribute("writingsuggestions")).toBe("false");
  });
});
