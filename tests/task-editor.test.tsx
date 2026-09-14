// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import type { NoteNode } from "../src/model";
import TaskEditor from "../src/TaskEditor";
import { vimPluginKey } from "../src/vim-editor";

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
async function mount(
  options: { initialNote?: NoteNode; vimEnabled?: boolean } = {},
) {
  let renderCount = 0;
  const published: Array<{ id: string; doc: NoteNode }> = [];
  let select!: (id: string) => void;
  function Harness() {
    renderCount++;
    const [id, setId] = useState("a");
    const [notes, setNotes] = useState({
      a: options.initialNote ?? note("Alpha"),
      b: note("Beta"),
    });
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
        vimEnabled={options.vimEnabled ?? false}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  return {
    container,
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

  it("keeps link clicks in the note and opens only deliberate modifier-clicks", async () => {
    const harness = await mount();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    try {
      await act(async () => {
        harness.editor().commands.setContent({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Reference paper",
                  marks: [
                    {
                      type: "link",
                      attrs: { href: "https://example.com/paper" },
                    },
                  ],
                },
              ],
            },
          ],
        });
      });
      const before = harness.editor().getJSON();
      const link = harness.editor().view.dom.querySelector("a")!;
      const ordinary = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(ordinary);
      expect(ordinary.defaultPrevented).toBe(true);
      expect(open).not.toHaveBeenCalled();
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );
      expect(open).toHaveBeenCalledExactlyOnceWith(
        "https://example.com/paper",
        "_blank",
        "noopener,noreferrer",
      );
      expect(harness.editor().getJSON()).toEqual(before);
    } finally {
      open.mockRestore();
    }
  });
});

describe("rendered math after applying Markdown source", () => {
  async function applyMathSource(vimEnabled = false) {
    const harness = await mount({
      initialNote: { type: "doc", content: [{ type: "paragraph" }] },
      vimEnabled,
    });
    await act(async () => {
      harness.container
        .querySelector<HTMLButtonElement>(
          '[aria-label="Edit Markdown source"]',
        )!
        .click();
    });
    const source = harness.container.querySelector<HTMLTextAreaElement>(
      '[aria-label="Markdown source"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(source, "Above.\n\n$$\na+b=c\n$$\n\nBelow.");
      source.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(
        harness.container.querySelectorAll<HTMLButtonElement>("button"),
      )
        .find((button) => button.textContent === "Apply Markdown")!
        .click();
    });
    const editor = harness.editor();
    expect(editor.getJSON().content).toEqual([
      note("Above.").content![0],
      { type: "blockMath", attrs: { latex: "a+b=c" } },
      note("Below.").content![0],
    ]);
    return { ...harness, editor };
  }

  it("opens the display equation on click after the rich editor remounts", async () => {
    const { editor } = await applyMathSource();
    const math =
      editor.view.dom.querySelector<HTMLElement>(".math-note-block")!;
    await act(async () => {
      math.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      math.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    const source = math.querySelector<HTMLTextAreaElement>(".math-note-input")!;
    expect(math.classList.contains("is-editing")).toBe(true);
    expect(document.activeElement).toBe(source);
    expect(source.value).toBe("a+b=c");
    expect(editor.state.selection.$from.nodeAfter?.type.name).toBe("blockMath");
  });

  it("enters the display source with Vim j from the paragraph above after Markdown is applied", async () => {
    const { editor, container } = await applyMathSource(true);
    await act(async () => {
      editor.commands.setTextSelection(1);
      editor.view.focus();
      expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "j",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    const source =
      editor.view.dom.querySelector<HTMLTextAreaElement>(".math-note-input")!;
    expect(document.activeElement).toBe(source);
    expect(source.value).toBe("a+b=c");
    expect(source.selectionStart).toBe(0);
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
    expect(
      container.querySelector('[aria-label="Vim mode status"]')?.textContent,
    ).toBe("Vim · normal");
    expect(editor.state.selection.$from.nodeAfter?.type.name).toBe("blockMath");
    await act(async () => {
      source.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "A",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("insert");
    expect(
      container.querySelector('[aria-label="Vim mode status"]')?.textContent,
    ).toBe("Vim · insert");
    expect(document.activeElement).toBe(source);
    await act(async () => {
      source.value = "a+b=d";
      source.setSelectionRange(source.value.length, source.value.length);
      source.dispatchEvent(new Event("input", { bubbles: true }));
      source.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
    expect(
      container.querySelector('[aria-label="Vim mode status"]')?.textContent,
    ).toBe("Vim · normal");
    expect(document.activeElement).toBe(source);
    expect(source.closest(".math-note")!.classList.contains("is-editing")).toBe(
      true,
    );
    expect(source.selectionStart).toBe(4);
    await act(async () => {
      source.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(editor.getJSON().content?.[1].attrs?.latex).toBe("a+b=d");
    expect(editor.state.selection.$from.parent.textContent).toBe("Below.");
    expect(editor.view.dom.dataset.vimMode).toBe("normal");
    expect(source.closest(".math-note")!.classList.contains("is-editing")).toBe(
      false,
    );
    await act(async () => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(document.activeElement).toBe(source);
    expect(source.value).toBe("a+b=d");
    expect(source.selectionStart).toBe(source.value.length - 1);
  });
});
