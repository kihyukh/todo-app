// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Editor } from "@tiptap/core";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import TaskEditor from "../src/TaskEditor";
import type { NoteNode } from "../src/model";
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
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

const paragraph = (text = ""): NoteNode => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const note = (...content: NoteNode[]): NoteNode => ({ type: "doc", content });

async function mount(options: { content?: NoteNode; vim?: boolean } = {}) {
  const published: { id: string; doc: NoteNode }[] = [];
  let select!: (id: "a" | "b") => void;
  let replace!: (content: NoteNode) => void;
  function Harness() {
    const [id, setId] = useState<"a" | "b">("a");
    const [notes, setNotes] = useState({
      a: options.content ?? note(paragraph()),
      b: note(paragraph("Another task")),
    });
    select = setId;
    replace = (content) => setNotes((old) => ({ ...old, [id]: content }));
    return (
      <TaskEditor
        key={id}
        taskId={id}
        content={notes[id]}
        onChange={(doc) => {
          published.push({ id, doc });
          setNotes((old) => ({ ...old, [id]: doc }));
        }}
        onPendingChange={() => {}}
        onAttach={() => {}}
        vimEnabled={options.vim ?? false}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  return {
    container,
    select,
    replace,
    published,
    editor: () =>
      (container.querySelector(".tiptap") as HTMLElement & { editor: Editor })
        .editor,
  };
}

function menu() {
  return document.body.querySelector<HTMLElement>(
    '[role="listbox"][aria-label="Insert note element"]',
  );
}
function options() {
  return [...(menu()?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
}
function option(label: string) {
  const found = options().find(
    (item) =>
      item.getAttribute("aria-label") === label ||
      item.textContent?.startsWith(label),
  );
  expect(found, `The slash list contains ${label}`).toBeDefined();
  return found!;
}
function key(target: HTMLElement, value: string) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** Use the same text-input props as ProseMirror's DOM reader, then its default transaction. */
async function type(editor: Editor, text: string) {
  for (const character of text) {
    await act(async () => {
      editor.view.focus();
      const { from, to } = editor.state.selection;
      const deflt = () => editor.state.tr.insertText(character, from, to);
      const handled = editor.view.someProp("handleTextInput", (handle) =>
        handle(editor.view, from, to, character, deflt),
      );
      if (!handled) editor.view.dispatch(deflt());
    });
  }
}
async function focus(editor: Editor, pos = 1) {
  await act(async () => {
    editor.view.focus();
    editor.commands.setTextSelection(pos);
  });
}

describe("slash insertion through the task note", () => {
  it("opens from typing, filters in the note, and leaves keyboard focus in the editor", async () => {
    const harness = await mount();
    const editor = harness.editor();
    await focus(editor);
    await type(editor, "/");
    expect(menu()).not.toBeNull();
    expect(option("Checklist").getAttribute("aria-selected")).toBe("true");
    expect(editor.view.hasFocus()).toBe(true);
    expect(menu()?.querySelector("input, textarea")).toBeNull();
    await type(editor, "heading 2");
    expect(editor.getText()).toBe("/heading 2");
    expect(option("Heading 2").getAttribute("aria-selected")).toBe("true");
    expect(options()).toHaveLength(1);
    expect(editor.view.hasFocus()).toBe(true);
  });

  it.each(["Enter", "Tab"])(
    "accepts the default Checklist with %s",
    async (accept) => {
      const editor = (await mount()).editor();
      await focus(editor);
      await type(editor, "/");
      await act(async () => {
        expect(key(editor.view.dom, accept).defaultPrevented).toBe(true);
      });
      expect(editor.getJSON().content?.[0].type).toBe("taskList");
      expect(editor.getText()).not.toContain("/");
      expect(menu()).toBeNull();
      expect(editor.view.hasFocus()).toBe(true);
    },
  );

  it("navigates options with arrows without moving the note cursor", async () => {
    const editor = (await mount()).editor();
    await focus(editor);
    await type(editor, "/");
    const caret = editor.state.selection;
    const first = options().find(
      (item) => item.getAttribute("aria-selected") === "true",
    );
    await act(async () => {
      expect(key(editor.view.dom, "ArrowDown").defaultPrevented).toBe(true);
    });
    expect(
      options().find((item) => item.getAttribute("aria-selected") === "true"),
    ).not.toBe(first);
    expect(editor.state.selection.eq(caret)).toBe(true);
    await act(async () => {
      expect(key(editor.view.dom, "ArrowUp").defaultPrevented).toBe(true);
    });
    expect(option("Checklist").getAttribute("aria-selected")).toBe("true");
    expect(editor.state.selection.eq(caret)).toBe(true);
  });

  it("opens a display equation's source while retaining Vim Insert mode", async () => {
    const harness = await mount({ vim: true });
    const editor = harness.editor();
    await focus(editor);
    await act(async () => {
      key(editor.view.dom, "i");
    });
    await type(editor, "/display equation");
    expect(option("Display equation").getAttribute("aria-selected")).toBe(
      "true",
    );
    await act(async () => {
      key(editor.view.dom, "Enter");
    });
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "blockMath",
      attrs: { latex: "" },
    });
    const source = harness.container.querySelector<HTMLTextAreaElement>(
      ".math-note-block .math-note-input",
    );
    expect(source).not.toBeNull();
    expect(document.activeElement).toBe(source);
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("insert");
    expect(menu()).toBeNull();
  });

  it("inserts a table while retaining following text and restores the query in one undo", async () => {
    const editor = (
      await mount({ content: note(paragraph("Keep the explanation")) })
    ).editor();
    await focus(editor);
    await type(editor, "/table");
    const before = editor.getJSON();
    await act(async () => {
      key(editor.view.dom, "Enter");
    });
    expect(
      editor.getJSON().content?.some((block) => block.type === "table"),
    ).toBe(true);
    expect(editor.getText()).toContain("Keep the explanation");
    expect(editor.getText()).not.toContain("/table");
    expect(menu()).toBeNull();
    await act(async () => {
      editor.commands.undo();
    });
    expect(editor.getJSON()).toEqual(before);
    expect(menu()).toBeNull();
  });

  it("keeps trailing note text when a mouse click applies a command, and undo restores its query once", async () => {
    const editor = (
      await mount({ content: note(paragraph("Keep this instruction")) })
    ).editor();
    await focus(editor);
    await type(editor, "/heading 2");
    const before = editor.getJSON();
    const selected = option("Heading 2");
    await act(async () => {
      const down = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
      });
      selected.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      selected.click();
    });
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 2 },
    });
    expect(editor.state.doc.textContent).toBe("Keep this instruction");
    expect(editor.view.hasFocus()).toBe(true);
    expect(menu()).toBeNull();
    await act(async () => {
      editor.commands.undo();
    });
    expect(editor.getJSON()).toEqual(before);
    expect(menu()).toBeNull();
    await type(editor, "!");
    expect(menu()).toBeNull();
  });

  it.each([
    {
      label: "a bullet item",
      block: {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph()] }],
      },
    },
    {
      label: "a checkbox",
      block: {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph()],
          },
        ],
      },
    },
    { label: "a quote", block: { type: "blockquote", content: [paragraph()] } },
  ])(
    "opens in $label and Escape preserves the literal query and container",
    async ({ block }) => {
      const editor = (await mount({ content: note(block) })).editor();
      let position = 1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph") position = pos + 1;
      });
      await focus(editor, position);
      await type(editor, "/check");
      expect(menu()).not.toBeNull();
      const before = editor.getJSON();
      await act(async () => {
        key(editor.view.dom, "Escape");
      });
      expect(menu()).toBeNull();
      expect(editor.getJSON()).toEqual(before);
      expect(editor.getText()).toContain("/check");
    },
  );

  it("Escape dismisses only the menu while retaining Vim Insert mode", async () => {
    const editor = (await mount({ vim: true })).editor();
    await focus(editor);
    await act(async () => {
      key(editor.view.dom, "i");
    });
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("insert");
    await type(editor, "/check");
    expect(menu()).not.toBeNull();
    await act(async () => {
      key(editor.view.dom, "Escape");
    });
    expect(menu()).toBeNull();
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("insert");
    expect(editor.state.doc.textContent).toBe("/check");
    await type(editor, "list");
    expect(editor.getText()).toBe("/checklist");
    expect(menu()).toBeNull();
    await act(async () => {
      key(editor.view.dom, "Escape");
    });
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
  });

  it.each([
    {
      list: "bulletList",
      item: "listItem",
      label: "Divider",
      node: "horizontalRule",
    },
    {
      list: "taskList",
      item: "taskItem",
      label: "Divider",
      node: "horizontalRule",
    },
  ])(
    "inserts $label inside the first $list item without changing its siblings",
    async ({ list, item, label, node }) => {
      const content = note({
        type: list,
        content: [
          {
            type: item,
            ...(item === "taskItem" ? { attrs: { checked: false } } : {}),
            content: [
              paragraph("First instruction"),
              paragraph("Supporting detail"),
            ],
          },
          {
            type: item,
            ...(item === "taskItem" ? { attrs: { checked: true } } : {}),
            content: [paragraph("Another instruction")],
          },
        ],
      });
      const editor = (await mount({ content })).editor();
      const originalList = editor.getJSON().content![0];
      await focus(editor, 3);
      await type(editor, `/${label.toLowerCase()}`);
      expect(option(label)).toBeDefined();
      const before = editor.getJSON();
      await act(async () => {
        key(editor.view.dom, "Enter");
      });
      expect(() => editor.state.doc.check()).not.toThrow();
      const after = editor.getJSON().content![0];
      expect(after.type).toBe(list);
      expect(after.content).toHaveLength(2);
      expect(after.content![0].type).toBe(item);
      expect(after.content![0].attrs).toEqual(originalList.content![0].attrs);
      expect(after.content![1]).toEqual(originalList.content![1]);
      const firstItem = editor.state.doc.firstChild!.firstChild!;
      let insertedInside = false;
      firstItem.descendants((child) => {
        if (child.type.name === node) insertedInside = true;
      });
      expect(insertedInside).toBe(true);
      expect(firstItem.textContent).toBe("First instructionSupporting detail");
      expect(menu()).toBeNull();
      await act(async () => {
        editor.commands.undo();
      });
      expect(editor.getJSON()).toEqual(before);
      expect(menu()).toBeNull();
    },
  );

  it.each([
    { list: "bulletList", item: "listItem" },
    { list: "taskList", item: "taskItem" },
  ])(
    "keeps Table unavailable in $list without disturbing valid actions or literal text",
    async ({ list, item }) => {
      const content = note({
        type: list,
        content: [
          {
            type: item,
            ...(item === "taskItem" ? { attrs: { checked: false } } : {}),
            content: [paragraph("First instruction")],
          },
          {
            type: item,
            ...(item === "taskItem" ? { attrs: { checked: true } } : {}),
            content: [paragraph("Keep sibling")],
          },
        ],
      });
      const editor = (await mount({ content })).editor();
      await focus(editor, 3);
      await type(editor, "/");
      expect(option("Checklist")).toBeDefined();
      expect(option("Divider")).toBeDefined();
      expect(
        options().some(
          (entry) =>
            entry.getAttribute("aria-label") === "Table" ||
            entry.textContent?.startsWith("Table"),
        ),
      ).toBe(false);
      await type(editor, "table");
      expect(options()).toHaveLength(0);
      const before = editor.getJSON();
      await act(async () => {
        key(editor.view.dom, "Escape");
      });
      expect(editor.getJSON()).toEqual(before);
      expect(editor.getJSON().content?.[0].type).toBe(list);
      expect(editor.state.doc.textContent).toBe(
        "/tableFirst instructionKeep sibling",
      );
      expect(() => editor.state.doc.check()).not.toThrow();
      expect(menu()).toBeNull();
    },
  );

  it.each([
    { label: "a URL", initial: "https:", typed: "//example.org" },
    { label: "a path", initial: "/usr", typed: "/local" },
    { label: "the middle of a sentence", initial: "Discuss ", typed: "/check" },
  ])("does not turn $label into a command", async ({ initial, typed }) => {
    const editor = (
      await mount({ content: note(paragraph(initial)) })
    ).editor();
    await focus(editor, initial.length + 1);
    await type(editor, typed);
    expect(menu()).toBeNull();
    expect(editor.getText()).toBe(initial + typed);
  });

  it("keeps a slash literal in code blocks and Vim Normal mode", async () => {
    const harness = await mount({
      content: note({ type: "codeBlock" }),
      vim: true,
    });
    const editor = harness.editor();
    await focus(editor);
    await act(async () => {
      key(editor.view.dom, "i");
    });
    await type(editor, "/check");
    expect(menu()).toBeNull();
    expect(editor.state.doc.textContent).toBe("/check");
    await act(async () => {
      key(editor.view.dom, "Escape");
      editor.commands.setContent(note(paragraph()));
      editor.commands.setTextSelection(1);
      key(editor.view.dom, "/");
    });
    await type(editor, "/");
    expect(menu()).toBeNull();
    expect(editor.getText()).toBe("");
    expect(vimPluginKey.getState(editor.state)?.mode).toBe("normal");
  });

  it("does not trigger for a pasted slash query or a programmatic document change", async () => {
    const editor = (await mount()).editor();
    await focus(editor);
    await act(async () => {
      const paste = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(paste, "clipboardData", {
        value: {
          files: [],
          types: ["text/plain"],
          getData: (type: string) => (type === "text/plain" ? "/check" : ""),
        },
      });
      editor.view.dom.dispatchEvent(paste);
    });
    expect(editor.getText()).toBe("/check");
    expect(menu()).toBeNull();
    await act(async () => {
      editor.commands.setContent(note(paragraph("/heading 2")), {
        emitUpdate: false,
      });
    });
    expect(menu()).toBeNull();
  });

  it("does not open from math source typing", async () => {
    const harness = await mount({
      content: note({ type: "blockMath", attrs: { latex: "x" } }, paragraph()),
    });
    const editor = harness.editor();
    const math =
      harness.container.querySelector<HTMLElement>(".math-note-block")!;
    await act(async () => {
      math.click();
    });
    const input = math.querySelector<HTMLTextAreaElement>(".math-note-input")!;
    expect(input).not.toBeNull();
    await act(async () => {
      input.focus();
      input.value = "/check";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(editor.getJSON().content?.[0].attrs?.latex).toBe("/check");
    expect(menu()).toBeNull();
  });

  it("preserves the slash query when the image picker is cancelled", async () => {
    const harness = await mount();
    const editor = harness.editor();
    const input =
      harness.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picker = vi.spyOn(input, "click").mockImplementation(() => {});
    await focus(editor);
    await type(editor, "/image");
    const before = editor.getJSON();
    await act(async () => {
      option("Image").click();
    });
    expect(picker).toHaveBeenCalledOnce();
    expect(editor.getJSON()).toEqual(before);
    await act(async () => {
      input.dispatchEvent(new Event("cancel", { bubbles: true }));
      window.dispatchEvent(new Event("focus"));
    });
    expect(editor.getJSON()).toEqual(before);
    expect(menu()).toBeNull();
  });

  it("replaces only the slash query when an image is chosen and restores it with undo", async () => {
    const harness = await mount({
      content: note(paragraph("Keep the caption")),
    });
    const editor = harness.editor();
    const input =
      harness.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    vi.spyOn(input, "click").mockImplementation(() => {});
    await focus(editor);
    await type(editor, "/image");
    const before = editor.getJSON();
    await act(async () => {
      option("Image").click();
    });
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [
          new File(["fictional bitmap"], "Slash image.png", {
            type: "image/png",
          }),
        ],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() =>
        expect(
          editor.getJSON().content?.some((block) => block.type === "image"),
        ).toBe(true),
      );
    });
    expect(editor.state.doc.textContent).toBe("Keep the caption");
    expect(menu()).toBeNull();
    await act(async () => {
      editor.commands.undo();
    });
    expect(editor.getJSON()).toEqual(before);
    expect(menu()).toBeNull();
  });

  it("rejects the image picker result when its note changed before the file was chosen", async () => {
    const harness = await mount();
    const editor = harness.editor();
    const input =
      harness.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    vi.spyOn(input, "click").mockImplementation(() => {});
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    await focus(editor);
    await type(editor, "/image");
    await act(async () => {
      option("Image").click();
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("daymark-flush"));
    });
    const replacement = note(paragraph("Updated elsewhere"));
    await act(async () => {
      harness.replace(replacement);
    });
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [new File(["bitmap"], "Late choice.png", { type: "image/png" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(read).not.toHaveBeenCalled();
    expect(editor.getJSON()).toEqual(replacement);
    expect(
      harness.container.querySelector(".note-notice")?.textContent,
    ).toContain("note changed");
    expect(menu()).toBeNull();
  });

  it("ignores an old task's file picker response after switching tasks", async () => {
    const harness = await mount();
    const input =
      harness.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    vi.spyOn(input, "click").mockImplementation(() => {});
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    await focus(harness.editor());
    await type(harness.editor(), "/image");
    await act(async () => {
      option("Image").click();
    });
    await act(async () => {
      harness.select("b");
    });
    const next = harness.editor().getJSON();
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [new File(["bitmap"], "Old task.png", { type: "image/png" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(read).not.toHaveBeenCalled();
    expect(harness.editor().getJSON()).toEqual(next);
    expect(harness.published.at(-1)).toMatchObject({
      id: "a",
      doc: note(paragraph("/image")),
    });
    expect(harness.published.some(({ id }) => id === "b")).toBe(false);
  });

  it("discards a delayed image read when its original task has closed", async () => {
    const harness = await mount();
    const input =
      harness.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    vi.spyOn(input, "click").mockImplementation(() => {});
    let reader!: FileReader;
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function (this: FileReader) {
        reader = this;
      },
    );
    await focus(harness.editor());
    await type(harness.editor(), "/image");
    await act(async () => {
      option("Image").click();
    });
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [new File(["bitmap"], "Slow image.png", { type: "image/png" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(reader).toBeDefined();
    expect(
      harness.container.querySelector(".note-image-loading"),
    ).not.toBeNull();
    await act(async () => {
      harness.select("b");
    });
    const next = harness.editor().getJSON();
    await act(async () => {
      Object.defineProperty(reader, "result", {
        value: "data:image/png;base64,YQ==",
      });
      reader.dispatchEvent(new ProgressEvent("load"));
    });
    expect(harness.editor().getJSON()).toEqual(next);
    expect(
      harness.container.querySelector(".note-image-loading, .note-image"),
    ).toBeNull();
    expect(harness.published.at(-1)).toMatchObject({
      id: "a",
      doc: note(paragraph("/image")),
    });
    expect(harness.published.some(({ id }) => id === "b")).toBe(false);
  });

  it("closes when incoming content replaces the active query and never targets the replacement", async () => {
    const harness = await mount();
    const editor = harness.editor();
    await focus(editor);
    await type(editor, "/check");
    expect(menu()).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("daymark-flush"));
    });
    const replacement = note(paragraph("Synced text"));
    await act(async () => {
      harness.replace(replacement);
    });
    expect(menu()).toBeNull();
    expect(editor.getJSON()).toEqual(replacement);
  });

  it("dismisses on task switch, flushes the first task query, and does not change the next task", async () => {
    const harness = await mount();
    const first = harness.editor();
    await focus(first);
    await type(first, "/check");
    expect(menu()).not.toBeNull();
    await act(async () => {
      harness.select("b");
    });
    expect(menu()).toBeNull();
    expect(harness.editor().getText()).toBe("Another task");
    expect(harness.published.at(-1)).toMatchObject({
      id: "a",
      doc: note(paragraph("/check")),
    });
    expect(harness.published.some(({ id }) => id === "b")).toBe(false);
  });
});
