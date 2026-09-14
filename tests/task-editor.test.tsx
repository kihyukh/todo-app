// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import type { NoteNode } from "../src/model";
import TaskEditor from "../src/TaskEditor";
import { vimPluginKey } from "../src/vim-editor";
import { NodeSelection } from "@tiptap/pm/state";

let root: Root | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});

describe("images in the task note", () => {
  function transfer(files: File[], text = "", html = "") {
    return {
      files,
      types: files.length ? ["Files"] : ["text/plain"],
      getData: (type: string) =>
        type === "text/html" ? html : type === "text/plain" ? text : "",
    };
  }

  it("returns focus from the image picker and selects the new image", async () => {
    const { editor: getEditor, container } = await mount();
    const editor = getEditor();
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      editor.commands.setTextSelection(6);
      editor.view.dom.blur();
      Object.defineProperty(fileInput, "files", {
        value: [new File(["bitmap"], "Chosen.png", { type: "image/png" })],
      });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() =>
        expect(editor.state.selection).toBeInstanceOf(NodeSelection),
      );
    });
    expect(editor.view.hasFocus()).toBe(true);
    expect((editor.state.selection as NodeSelection).node.attrs.alt).toBe(
      "Chosen.png",
    );
  });

  it("pastes clipboard images at the cursor and exposes selection controls", async () => {
    const { editor: getEditor, container } = await mount();
    const editor = getEditor();
    await act(async () => {
      editor.view.focus();
      editor.commands.setTextSelection(3);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: transfer([
          new File(["bitmap"], "Pasted screenshot.png", { type: "image/png" }),
        ]),
      });
      editor.view.dom.dispatchEvent(paste);
      await vi.waitFor(() =>
        expect(
          editor.getJSON().content?.some((node) => node.type === "image"),
        ).toBe(true),
      );
    });
    expect(editor.getText()).toContain("Al");
    expect(editor.getText()).toContain("pha");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(container.querySelector(".note-image")).not.toBeNull();
    expect(
      container.querySelector('[aria-label="Delete image"]'),
    ).not.toBeNull();
    await act(async () => editor.commands.undo());
    expect(editor.getText()).toBe("Alpha");
    expect(container.querySelector(".note-image")).toBeNull();
  });

  it("uses the file drop location instead of the current text cursor", async () => {
    const { editor: getEditor } = await mount();
    const editor = getEditor();
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 3, inside: 0 });
    await act(async () => {
      editor.view.focus();
      editor.commands.setTextSelection(6);
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperties(drop, {
        dataTransfer: {
          value: transfer([
            new File(["bitmap"], "Dropped.png", { type: "image/png" }),
          ]),
        },
        clientX: { value: 10 },
        clientY: { value: 20 },
      });
      editor.view.dom.dispatchEvent(drop);
      await vi.waitFor(() =>
        expect(
          editor.getJSON().content?.some((node) => node.type === "image"),
        ).toBe(true),
      );
    });
    const blocks = editor.getJSON().content!;
    expect(blocks.map((node) => node.type)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
    expect(blocks[0].content?.[0].text).toBe("Al");
    expect(blocks[2].content?.[0].text).toBe("pha");
  });

  it("pastes text beside a selected image without deleting the image", async () => {
    const { editor: getEditor } = await mount({
      initialNote: {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: { src: "data:image/png;base64,YQ==", alt: "Keep me" },
          },
          { type: "paragraph", content: [{ type: "text", text: "Below" }] },
        ],
      },
    });
    const editor = getEditor();
    await act(async () => {
      editor.view.focus();
      editor.commands.setNodeSelection(0);
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: transfer([], "Caption. "),
      });
      editor.view.dom.dispatchEvent(paste);
    });
    expect(editor.getJSON().content?.[0].type).toBe("image");
    expect(editor.getText()).toContain("Caption. Below");
  });
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
  let replace!: (doc: NoteNode) => void;
  function Harness() {
    renderCount++;
    const [id, setId] = useState("a");
    const [notes, setNotes] = useState({
      a: options.initialNote ?? note("Alpha"),
      b: note("Beta"),
    });
    select = setId;
    replace = (doc) => setNotes((old) => ({ ...old, [id]: doc }));
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
    replace,
    renders: () => renderCount,
    editor: () =>
      (container.querySelector(".tiptap") as HTMLElement & { editor: Editor })
        .editor,
  };
}

async function openNoteOptions(container: HTMLElement) {
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('[aria-label="Note options"]')!
      .click();
  });
  const menu = document.body.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Note elements"]',
  );
  expect(menu).not.toBeNull();
  return menu!;
}

async function chooseNoteOption(container: HTMLElement, label: string) {
  const menu = await openNoteOptions(container);
  await act(async () => {
    menu.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click();
  });
}

function pressKey(target: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("contextual note elements", () => {
  it("replaces the fixed toolbar with options and makes a heading in one undoable action", async () => {
    const { container, editor: getEditor } = await mount();
    const editor = getEditor();
    expect(
      container.querySelector(
        '.note-toolbar, [role="toolbar"][aria-label="Note formatting"]',
      ),
    ).toBeNull();
    expect(
      container.querySelector('[aria-label="Note options"]'),
    ).not.toBeNull();
    await chooseNoteOption(container, "Heading 2");
    expect(
      document.body.querySelector('[aria-label="Note elements"]'),
    ).toBeNull();
    expect(editor.getJSON().content).toEqual([
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Alpha" }],
      },
      { type: "paragraph" },
    ]);
    await act(async () => {
      editor.commands.undo();
    });
    expect(editor.getJSON()).toEqual(note("Alpha"));
  });

  it("does not offer heading or code conversion that would lift a checkbox out of its list", async () => {
    const initialNote: NoteNode = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: true },
              content: [note("Keep this checked").content![0]],
            },
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [note("Keep this next step").content![0]],
            },
          ],
        },
      ],
    };
    const { container, editor: getEditor } = await mount({ initialNote });
    const editor = getEditor();
    await act(async () => {
      editor.commands.setTextSelection(3);
    });
    const before = editor.getJSON();
    const menu = await openNoteOptions(container);
    for (const label of ["Heading 1", "Heading 2", "Heading 3", "Code block"]) {
      const button = menu.querySelector<HTMLButtonElement>(
        `[aria-label="${label}"]`,
      )!;
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
    }
    expect(editor.getJSON()).toEqual(before);
    await act(async () =>
      menu
        .querySelector<HTMLButtonElement>('[aria-label="Plain text"]')!
        .click(),
    );
    expect(editor.getJSON()).toEqual(before);
  });

  it("applies bold to the saved text selection without expanding or replacing it", async () => {
    const { container, editor: getEditor } = await mount({
      initialNote: note("Alpha Beta"),
    });
    const editor = getEditor();
    await act(async () => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    await chooseNoteOption(container, "Bold (⌘B)");
    expect(editor.getJSON().content?.[0].content).toEqual([
      { type: "text", text: "Alpha", marks: [{ type: "bold" }] },
      { type: "text", text: " Beta" },
    ]);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
    await act(async () => {
      editor.commands.undo();
    });
    expect(editor.getJSON()).toEqual(note("Alpha Beta"));
  });

  it("keeps a heading inside its quote when reselected or changed to plain text", async () => {
    const { container, editor: getEditor } = await mount({
      initialNote: {
        type: "doc",
        content: [
          {
            type: "blockquote",
            content: [
              {
                type: "heading",
                attrs: { level: 2 },
                content: [{ type: "text", text: "Quoted heading" }],
              },
            ],
          },
        ],
      },
    });
    const editor = getEditor();
    await act(async () => {
      editor.commands.setTextSelection(2);
    });
    const before = editor.getJSON();
    await chooseNoteOption(container, "Heading 2");
    expect(editor.getJSON()).toEqual(before);
    await chooseNoteOption(container, "Plain text");
    expect(editor.getJSON().content?.[0]).toEqual({
      type: "blockquote",
      content: [note("Quoted heading").content![0]],
    });
    await act(async () => {
      editor.commands.undo();
    });
    expect(editor.getJSON()).toEqual(before);
  });

  it("keeps stored formatting when another mark is chosen on an empty line", async () => {
    const { container, editor: getEditor } = await mount({
      initialNote: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const editor = getEditor();
    await chooseNoteOption(container, "Bold (⌘B)");
    await chooseNoteOption(container, "Italic (⌘I)");
    await act(async () => {
      editor.commands.insertContent("Both marks");
    });
    expect(editor.getJSON().content?.[0].content?.[0]).toEqual({
      type: "text",
      text: "Both marks",
      marks: [{ type: "bold" }, { type: "italic" }],
    });
  });

  it.each(["normal", "insert"])(
    "closes with Escape and returns focus without changing Vim %s mode",
    async (mode) => {
      const { container, editor: getEditor } = await mount({
        vimEnabled: true,
      });
      const editor = getEditor();
      await act(async () => {
        editor.view.focus();
        if (mode === "insert") pressKey(editor.view.dom, "i");
      });
      const before = editor.getJSON();
      const selection = editor.state.selection;
      const menu = await openNoteOptions(container);
      await act(async () => {
        const first = document.activeElement as HTMLElement;
        expect(menu.contains(first)).toBe(true);
        expect(pressKey(first, "ArrowDown").defaultPrevented).toBe(true);
        expect(document.activeElement).not.toBe(first);
        expect(
          pressKey(document.activeElement as HTMLElement, "Escape")
            .defaultPrevented,
        ).toBe(true);
      });
      expect(
        document.body.querySelector('[aria-label="Note elements"]'),
      ).toBeNull();
      expect(editor.view.hasFocus()).toBe(true);
      expect(vimPluginKey.getState(editor.state)?.mode).toBe(mode);
      expect(editor.state.selection.eq(selection)).toBe(true);
      expect(editor.getJSON()).toEqual(before);
    },
  );

  it("cancels a pending Vim operator on formatting while retaining the copied register", async () => {
    const { container, editor: getEditor } = await mount({ vimEnabled: true });
    const editor = getEditor();
    await act(async () => {
      editor.view.focus();
      for (const key of ["y", "y", "2", "d"]) pressKey(editor.view.dom, key);
    });
    const before = vimPluginKey.getState(editor.state)!;
    expect(before.register).not.toBeNull();
    expect(before.operator).toBe("d");
    await chooseNoteOption(container, "Heading 2");
    const after = vimPluginKey.getState(editor.state)!;
    expect(after.mode).toBe("normal");
    expect(after.register).toBe(before.register);
    expect(after.operator).toBeNull();
    expect(after.count).toBe("");
    expect(after.pending).toBe("");
    expect(after.operatorCount).toBe(1);
    expect(editor.state.doc.textContent).toBe("Alpha");
  });

  it("inserts display math directly into the note and preserves Vim mode while entering its source", async () => {
    const { container, editor: getEditor } = await mount({
      initialNote: { type: "doc", content: [{ type: "paragraph" }] },
      vimEnabled: true,
    });
    const editor = getEditor();
    await chooseNoteOption(container, "Display equation");
    expect(
      document.body.querySelector('[aria-label="Note elements"]'),
    ).toBeNull();
    const input = editor.view.dom.querySelector<HTMLTextAreaElement>(
      ".math-note-block .math-note-input",
    )!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
    await act(async () => {
      pressKey(input, "i");
      input.value = "x^2 + y^2";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      pressKey(input, "Escape");
      pressKey(input, "ArrowDown");
    });
    expect(editor.getJSON().content?.[0]).toEqual({
      type: "blockMath",
      attrs: { latex: "x^2 + y^2" },
    });
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.view.hasFocus()).toBe(true);
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
  });

  it("closes a portal menu when the task changes and leaves the next task intact", async () => {
    const harness = await mount();
    await openNoteOptions(harness.container);
    await act(async () => harness.select("b"));
    expect(
      document.body.querySelector('[aria-label="Note elements"]'),
    ).toBeNull();
    expect(harness.editor().getJSON()).toEqual(note("Beta"));
    expect(harness.published).toEqual([]);
  });

  it("keeps the iPhone menu open through outer scrolling but closes on an outside tap or Escape", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    try {
      const { container, editor: getEditor } = await mount();
      const anchor = container.querySelector<HTMLButtonElement>(
        '[aria-label="Note options"]',
      )!;
      let anchorTop = 220;
      anchor.getBoundingClientRect = () => new DOMRect(20, anchorTop, 30, 30);
      const menu = await openNoteOptions(container);
      const initialTop = parseFloat(menu.style.top);
      await act(async () => {
        // Focusing the menu changes the software keyboard and can scroll its
        // surrounding detail panel without any deliberate dismissal gesture.
        anchorTop = 100;
        document.dispatchEvent(new Event("scroll"));
      });
      expect(document.body.querySelector('[aria-label="Note elements"]')).toBe(
        menu,
      );
      expect(parseFloat(menu.style.top)).toBeLessThan(initialTop);
      await act(async () => {
        document.body.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        );
      });
      expect(
        document.body.querySelector('[aria-label="Note elements"]'),
      ).toBeNull();
      const reopened = await openNoteOptions(container);
      await act(async () => {
        pressKey(
          reopened.querySelector<HTMLButtonElement>("button")!,
          "Escape",
        );
      });
      expect(
        document.body.querySelector('[aria-label="Note elements"]'),
      ).toBeNull();
      expect(getEditor().view.hasFocus()).toBe(true);
    } finally {
      delete window.__DAYMARK_PLATFORM__;
    }
  });

  it.each(["Display equation", "Insert image"])(
    "keeps selected inline LaTeX when choosing %s beside it",
    async (action) => {
      const { container, editor: getEditor } = await mount({
        initialNote: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Before " },
                { type: "inlineMath", attrs: { latex: "\\alpha^2" } },
                { type: "text", text: " after" },
              ],
            },
          ],
        },
      });
      const editor = getEditor();
      let inlinePosition = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "inlineMath") inlinePosition = pos;
      });
      await act(async () => {
        editor.commands.setNodeSelection(inlinePosition);
      });
      const before = editor.getJSON();
      const fileInput =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const picker = vi.spyOn(fileInput, "click").mockImplementation(() => {});
      try {
        await chooseNoteOption(container, action);
        if (action === "Insert image") {
          expect(picker).toHaveBeenCalledOnce();
          expect(editor.getJSON()).toEqual(before);
          await act(async () => {
            Object.defineProperty(fileInput, "files", {
              value: [
                new File(["synthetic bitmap"], "Alongside.png", {
                  type: "image/png",
                }),
              ],
            });
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            await vi.waitFor(() =>
              expect(
                editor.view.dom.querySelector(".note-image"),
              ).not.toBeNull(),
            );
          });
        }
        const atoms: Array<{ type: string; latex?: string; alt?: string }> = [];
        editor.state.doc.descendants((node) => {
          if (["inlineMath", "blockMath", "image"].includes(node.type.name))
            atoms.push({
              type: node.type.name,
              latex: node.attrs.latex,
              alt: node.attrs.alt,
            });
        });
        expect(atoms[0]).toEqual({
          type: "inlineMath",
          latex: "\\alpha^2",
          alt: undefined,
        });
        expect(atoms.map((node) => node.type)).toEqual([
          "inlineMath",
          action === "Display equation" ? "blockMath" : "image",
        ]);
        expect(editor.state.doc.textContent).toContain("Before ");
        expect(editor.state.doc.textContent).toContain(" after");
        if (action === "Display equation") {
          const input = editor.view.dom.querySelector<HTMLTextAreaElement>(
            ".math-note-block .math-note-input",
          )!;
          expect(document.activeElement).toBe(input);
          expect(input.value).toBe("");
        } else {
          expect(atoms[1].alt).toBe("Alongside.png");
          await act(async () => {
            editor.commands.undo();
          });
          expect(editor.getJSON()).toEqual(before);
        }
      } finally {
        picker.mockRestore();
      }
    },
  );

  it.each(["image", "blockMath"])(
    "does not edit a selected %s merely to open and cancel the image picker",
    async (type) => {
      const { container, editor: getEditor } = await mount({
        initialNote: {
          type: "doc",
          content: [
            {
              type,
              attrs:
                type === "image"
                  ? { src: "data:image/png;base64,YQ==", alt: "Keep image" }
                  : { latex: "x^2" },
            },
            note("Keep caption").content![0],
          ],
        },
      });
      const editor = getEditor();
      await act(async () => {
        editor.commands.setNodeSelection(0);
      });
      const before = editor.getJSON();
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const picker = vi.spyOn(input, "click").mockImplementation(() => {});
      try {
        await chooseNoteOption(container, "Insert image");
        expect(picker).toHaveBeenCalledOnce();
        expect(editor.getJSON()).toEqual(before);
        expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      } finally {
        picker.mockRestore();
      }
    },
  );

  it("closes the menu when an incoming revision replaces its editing context", async () => {
    const harness = await mount();
    await openNoteOptions(harness.container);
    await act(async () => harness.replace(note("Synced note")));
    expect(
      document.body.querySelector('[aria-label="Note elements"]'),
    ).toBeNull();
    expect(harness.editor().getJSON()).toEqual(note("Synced note"));
    expect(harness.published).toEqual([]);
  });
});

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
    await chooseNoteOption(harness.container, "Edit Markdown source");
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
      container.querySelector('[aria-label="Vim mode status"]'),
    ).toBeNull();
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
      container.querySelector('[aria-label="Vim mode status"]'),
    ).toBeNull();
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
      container.querySelector('[aria-label="Vim mode status"]'),
    ).toBeNull();
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

describe("attachments linked inside task notes", () => {
  const attachmentNote: NoteNode = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Review PDF",
            marks: [
              {
                type: "link",
                attrs: { href: "daymark://attachment/review.pdf" },
              },
            ],
          },
        ],
      },
    ],
  };
  it("retains native attachment links through rendered HTML, Markdown, and the link editor", async () => {
    const harness = await mount({ initialNote: attachmentNote });
    const editor = harness.editor();
    expect(editor.view.dom.querySelector("a")!.getAttribute("href")).toBe(
      "daymark://attachment/review.pdf",
    );
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("[Review PDF](daymark://attachment/review.pdf)");
    await act(async () => {
      editor.commands.setContent(markdown, { contentType: "markdown" });
      editor.commands.setTextSelection(3);
    });
    expect(editor.view.dom.querySelector("a")!.getAttribute("href")).toBe(
      "daymark://attachment/review.pdf",
    );
    await chooseNoteOption(harness.container, "Add or edit link");
    expect(
      harness.container.querySelector<HTMLInputElement>(
        '[aria-label="Link URL"]',
      )!.value,
    ).toBe("daymark://attachment/review.pdf");
    await act(async () =>
      harness.container
        .querySelector(".note-link-popover form, .note-popover form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(editor.view.dom.querySelector("a")!.getAttribute("href")).toBe(
      "daymark://attachment/review.pdf",
    );
    expect(editor.getText()).toBe("Review PDF");
  });

  it("uses modifier-click to open native attachments while ordinary click keeps the note editable", async () => {
    const postMessage = vi.fn(),
      open = vi.spyOn(window, "open").mockReturnValue(null);
    window.webkit = { messageHandlers: { daymark: { postMessage } } };
    try {
      const { editor: getEditor } = await mount({
        initialNote: attachmentNote,
      });
      const editor = getEditor();
      const before = editor.getJSON();
      const link = editor.view.dom.querySelector("a")!;
      await act(async () =>
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        ),
      );
      expect(postMessage).not.toHaveBeenCalled();
      await act(async () =>
        link.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            metaKey: true,
          }),
        ),
      );
      expect(postMessage).toHaveBeenCalledExactlyOnceWith({
        action: "openAttachment",
        url: "daymark://attachment/review.pdf",
      });
      expect(open).not.toHaveBeenCalled();
      expect(editor.getJSON()).toEqual(before);
    } finally {
      delete window.webkit;
      open.mockRestore();
    }
  });
});

describe("touch link actions", () => {
  const linkedNote = (href: string): NoteNode => ({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Read " },
          {
            type: "text",
            text: "this resource",
            marks: [{ type: "link", attrs: { href } }],
          },
          { type: "text", text: " next." },
        ],
      },
    ],
  });
  it.each(["https://example.com/paper", "daymark://attachment/review.pdf"])(
    "offers deliberate Open/Edit actions for %s on iOS",
    async (href) => {
      window.__DAYMARK_PLATFORM__ = "ios";
      const postMessage = vi.fn(),
        open = vi.spyOn(window, "open").mockReturnValue(null);
      window.webkit = { messageHandlers: { daymark: { postMessage } } };
      try {
        const { editor: getEditor, container } = await mount({
          initialNote: linkedNote(href),
        });
        const editor = getEditor();
        const before = editor.getJSON();
        await act(async () => {
          editor.view.dom
            .querySelector("a")!
            .dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true }),
            );
        });
        const actions = container.querySelector('[aria-label="Link actions"]')!;
        expect(actions).not.toBeNull();
        expect(actions.textContent).toContain("this resource");
        expect(open).not.toHaveBeenCalled();
        expect(postMessage).not.toHaveBeenCalled();
        await act(async () => {
          [...actions.querySelectorAll<HTMLButtonElement>("button")]
            .find((button) => button.textContent === "Open")!
            .click();
        });
        if (href.startsWith("daymark:"))
          expect(postMessage).toHaveBeenCalledExactlyOnceWith({
            action: "openAttachment",
            url: href,
          });
        else
          expect(open).toHaveBeenCalledExactlyOnceWith(
            href,
            "_blank",
            "noopener,noreferrer",
          );
        expect(
          container.querySelector('[aria-label="Link actions"]'),
        ).toBeNull();
        expect(editor.getJSON()).toEqual(before);
      } finally {
        delete window.__DAYMARK_PLATFORM__;
        delete window.webkit;
        open.mockRestore();
      }
    },
  );

  it.each(["actions", "edit"])(
    "closes the %s popover when a synced revision replaces the note",
    async (mode) => {
      window.__DAYMARK_PLATFORM__ = "ios";
      try {
        const {
          editor: getEditor,
          container,
          replace,
          published,
        } = await mount({
          initialNote: linkedNote("https://example.com/original"),
        });
        const editor = getEditor();
        await act(async () => {
          editor.view.dom
            .querySelector("a")!
            .dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true }),
            );
        });
        if (mode === "edit") {
          await act(async () => {
            [
              ...container.querySelectorAll<HTMLButtonElement>(
                ".touch-link-actions button",
              ),
            ]
              .find((button) => button.textContent === "Edit")!
              .click();
          });
          expect(
            container.querySelector('[aria-label="Link URL"]'),
          ).not.toBeNull();
        } else
          expect(
            container.querySelector('[aria-label="Link actions"]'),
          ).not.toBeNull();
        await act(async () => replace(note("Synced replacement text.")));
        expect(
          container.querySelector('[aria-label="Link actions"]'),
        ).toBeNull();
        expect(container.querySelector('[aria-label="Link URL"]')).toBeNull();
        expect(editor.getJSON()).toEqual(note("Synced replacement text."));
        expect(published).toEqual([]);
        expect(editor.view.dom.querySelector("a")).toBeNull();
      } finally {
        delete window.__DAYMARK_PLATFORM__;
      }
    },
  );

  it("edits the tapped link even when the text cursor was somewhere else", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    try {
      const { editor: getEditor, container } = await mount({
        initialNote: linkedNote("https://example.com/original"),
      });
      const editor = getEditor();
      await act(async () => {
        editor.commands.setTextSelection(2);
        editor.view.dom
          .querySelector("a")!
          .dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
      });
      await act(async () => {
        [
          ...container.querySelectorAll<HTMLButtonElement>(
            ".touch-link-actions button",
          ),
        ]
          .find((button) => button.textContent === "Edit")!
          .click();
      });
      expect(container.querySelector('[aria-label="Link actions"]')).toBeNull();
      const input = container.querySelector<HTMLInputElement>(
        '[aria-label="Link URL"]',
      )!;
      expect(input.value).toBe("https://example.com/original");
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "https://example.com/revised");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        container
          .querySelector(".link-popover form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          );
      });
      expect(editor.getText()).toBe("Read this resource next.");
      expect(editor.view.dom.querySelector("a")!.getAttribute("href")).toBe(
        "https://example.com/revised",
      );
      expect(editor.view.dom.querySelector("a")!.textContent).toBe(
        "this resource",
      );
    } finally {
      delete window.__DAYMARK_PLATFORM__;
    }
  });

  it("keeps link actions available above the keyboard during automatic scrolling", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    const originalHeight = window.innerHeight;
    try {
      const { editor: getEditor, container } = await mount({
        initialNote: linkedNote("https://example.com/paper"),
      });
      const editor = getEditor();
      const link = editor.view.dom.querySelector("a")!;
      link.getBoundingClientRect = () => new DOMRect(30, 500, 100, 20);
      await act(async () => {
        link.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
      await act(async () => {
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: 350,
        });
        window.dispatchEvent(new Event("resize"));
        document.dispatchEvent(new Event("scroll"));
      });
      const actions = container.querySelector<HTMLElement>(
        '[aria-label="Link actions"]',
      )!;
      expect(actions).not.toBeNull();
      expect(parseInt(actions.style.top)).toBeLessThanOrEqual(186);
      expect(actions.textContent).toContain("Open");
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
      delete window.__DAYMARK_PLATFORM__;
    }
  });

  it("dismisses touch link actions when the user resumes editing", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    try {
      const { editor: getEditor, container } = await mount({
        initialNote: linkedNote("https://example.com/paper"),
      });
      const editor = getEditor();
      await act(async () => {
        editor.view.dom
          .querySelector("a")!
          .dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
      });
      expect(
        container.querySelector('[aria-label="Link actions"]'),
      ).not.toBeNull();
      await act(async () => {
        editor.view.dom.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        );
      });
      expect(container.querySelector('[aria-label="Link actions"]')).toBeNull();
    } finally {
      delete window.__DAYMARK_PLATFORM__;
    }
  });
});

describe("iPhone note focus with the software keyboard", () => {
  it("reveals an equation after the viewport shrinks and does not scroll again for every edit", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    const originalHeight = window.innerHeight;
    try {
      const { editor: getEditor, container } = await mount({
        initialNote: {
          type: "doc",
          content: [
            note("Before").content![0],
            { type: "blockMath", attrs: { latex: "a+b=c" } },
            note("After").content![0],
          ],
        },
      });
      container.classList.add("detail-scroll");
      container.getBoundingClientRect = () => new DOMRect(0, 60, 375, 290);
      const source =
        container.querySelector<HTMLTextAreaElement>(".math-note-input")!;
      source.getBoundingClientRect = () =>
        new DOMRect(20, 600 - container.scrollTop, 250, 44);
      vi.useFakeTimers();
      await act(async () => {
        container
          .querySelector(".math-note")!
          .dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        Object.defineProperty(window, "innerHeight", {
          configurable: true,
          value: 350,
        });
        window.dispatchEvent(new Event("resize"));
        await vi.advanceTimersByTimeAsync(220);
      });
      expect(document.activeElement).toBe(source);
      expect(container.scrollTop).toBeGreaterThan(0);
      expect(source.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        350 - 66,
      );
      const scroll = container.scrollTop;
      await act(async () => {
        source.value = "a+b=c+d";
        source.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.advanceTimersByTimeAsync(220);
      });
      expect(container.scrollTop).toBe(scroll);
      expect(getEditor().getText()).toContain("Before");
      expect(document.activeElement).toBe(source);
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
      delete window.__DAYMARK_PLATFORM__;
      vi.useRealTimers();
    }
  });
});
