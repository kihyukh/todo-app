// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { NodeSelection } from "@tiptap/pm/state";
import { NoteInteractions, NoteListKeymap } from "../src/note-interactions";
import { VimEditor, getVimMode } from "../src/vim-editor";
import { NoteHeading } from "../src/note-heading";
import { NaturalBlockMath, NaturalInlineMath } from "../src/math-editor";

const editors: Editor[] = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});
const paragraph = (text = ""): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const item = (text: string, task = false, checked = false): JSONContent => ({
  type: task ? "taskItem" : "listItem",
  ...(task ? { attrs: { checked } } : {}),
  content: [paragraph(text)],
});
const list = (children: JSONContent[], task = false): JSONContent => ({
  type: task ? "taskList" : "bulletList",
  content: children,
});
const quote = (...children: JSONContent[]): JSONContent => ({
  type: "blockquote",
  content: children,
});
const table = (): JSONContent => ({
  type: "table",
  content: [
    {
      type: "tableRow",
      content: ["first", "second"].map((text) => ({
        type: "tableCell",
        content: [paragraph(text)],
      })),
    },
  ],
});
function createEditor(content: JSONContent[], vim = false) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ listKeymap: false, heading: false }),
      NoteHeading,
      NaturalInlineMath,
      NaturalBlockMath,
      NoteListKeymap,
      NoteInteractions,
      TaskList,
      TaskItem.configure({ nested: true }),
      Image,
      TableKit.configure({ table: { resizable: false } }),
      VimEditor.configure({ enabled: vim }),
    ],
    content: { type: "doc", content },
  });
  editors.push(editor);
  editor.view.focus();
  return editor;
}
function caret(editor: Editor, text: string, offset = 0) {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (position === undefined && node.isTextblock && node.textContent === text)
      position = pos + 1 + offset;
  });
  if (position === undefined) throw new Error(`No textblock ${text}`);
  editor.commands.setTextSelection(position);
}
function key(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}
function ancestors(editor: Editor) {
  const { $from } = editor.state.selection;
  return Array.from(
    { length: $from.depth },
    (_, index) => $from.node(index + 1).type.name,
  );
}

describe("structured note cursor interactions", () => {
  it.each([false, true])(
    "continues an item on Enter and exits one list level on empty Enter (checklist %s)",
    (task) => {
      const editor = createEditor([list([item("first", task, true)], task)]);
      caret(editor, "first", 5);
      expect(key(editor, "Enter")).toBe(true);
      const children = editor.getJSON().content?.[0].content;
      expect(children).toHaveLength(2);
      if (task) expect(children?.[1].attrs?.checked).toBe(false);
      expect(ancestors(editor)).toContain(task ? "taskItem" : "listItem");
      key(editor, "Enter");
      expect(
        editor
          .getJSON()
          .content?.slice(0, 2)
          .map((node) => node.type),
      ).toEqual([task ? "taskList" : "bulletList", "paragraph"]);
      expect(editor.state.selection.$from.parent.textContent).toBe("");
      expect(editor.state.doc.textContent).toBe("first");
    },
  );

  it.each([false, true])(
    "indents and outdents items while retaining content and cursor (checklist %s)",
    (task) => {
      const editor = createEditor([
        list([item("first", task), item("second", task)], task),
      ]);
      caret(editor, "second", 3);
      key(editor, "Tab");
      expect(
        ancestors(editor).filter(
          (type) => type === (task ? "taskList" : "bulletList"),
        ),
      ).toHaveLength(2);
      expect(editor.state.selection.$from.parentOffset).toBe(3);
      key(editor, "Tab", { shiftKey: true });
      expect(
        ancestors(editor).filter(
          (type) => type === (task ? "taskList" : "bulletList"),
        ),
      ).toHaveLength(1);
      expect(editor.getJSON().content?.[0].content).toHaveLength(2);
      expect(editor.state.selection.$from.parentOffset).toBe(3);
      expect(editor.state.doc.textContent).toBe("firstsecond");
    },
  );

  it("keeps first-item Tab in the editor but leaves ordinary paragraph Tab alone", () => {
    const editor = createEditor([list([item("first")]), paragraph("after")]);
    caret(editor, "first");
    const saved = editor.getJSON();
    expect(key(editor, "Tab")).toBe(true);
    expect(editor.getJSON()).toEqual(saved);
    caret(editor, "after");
    expect(key(editor, "Tab")).toBe(false);
    expect(editor.getJSON()).toEqual(saved);
    expect(ancestors(editor)).toEqual(["paragraph"]);
  });

  it.each([false, true])(
    "lifts an empty nested item one level and preserves its siblings (checklist %s)",
    (task) => {
      const first = item("parent", task);
      first.content!.push(list([item("", task)], task));
      const editor = createEditor([list([first, item("sibling", task)], task)]);
      caret(editor, "");
      key(editor, "Enter");
      expect(ancestors(editor)).toEqual([
        task ? "taskList" : "bulletList",
        task ? "taskItem" : "listItem",
        "paragraph",
      ]);
      expect(editor.getJSON().content?.[0].content).toHaveLength(3);
      expect(editor.state.doc.textContent).toBe("parentsibling");
    },
  );

  it.each([false, true])(
    "Backspace removes first-item structure without deleting its words (checklist %s)",
    (task) => {
      const editor = createEditor([
        list([item("first", task), item("second", task)], task),
      ]);
      caret(editor, "first");
      key(editor, "Backspace");
      expect(
        editor
          .getJSON()
          .content?.slice(0, 2)
          .map((node) => node.type),
      ).toEqual(["paragraph", task ? "taskList" : "bulletList"]);
      expect(editor.state.doc.textContent).toBe("firstsecond");
      expect(editor.state.selection.$from.parent.textContent).toBe("first");
      expect(editor.state.selection.$from.parentOffset).toBe(0);
    },
  );

  it.each([false, true])(
    "splits checked items identically with Enter and ShiftEnter (shift %s)",
    (shiftKey) => {
      const editor = createEditor([list([item("first", true, true)], true)]);
      caret(editor, "first", 2);
      key(editor, "Enter", { shiftKey });
      const items = editor.getJSON().content?.[0].content;
      expect(items).toHaveLength(2);
      expect(items?.map((node) => node.attrs?.checked)).toEqual([true, false]);
      expect(items?.map((node) => node.content?.[0].content?.[0].text)).toEqual(
        ["fi", "rst"],
      );
      expect(editor.state.selection.$from.parentOffset).toBe(0);
      expect(JSON.stringify(editor.getJSON())).not.toContain("hardBreak");
    },
  );

  it("matches Enter across paragraphs, lists, quotes, tables and headings, including empty exits", () => {
    const heading = (text: string): JSONContent => ({
      ...paragraph(text),
      type: "heading",
      attrs: { level: 2 },
    });
    const nested = item("parent", true);
    nested.content!.push(list([item("", true)], true));
    const cases: { content: JSONContent[]; text: string; offset: number }[] = [
      { content: [paragraph("before after")], text: "before after", offset: 6 },
      { content: [paragraph("")], text: "", offset: 0 },
      { content: [heading("Title")], text: "Title", offset: 5 },
      { content: [heading("Title")], text: "Title", offset: 2 },
      { content: [heading("")], text: "", offset: 0 },
      { content: [list([item("item")])], text: "item", offset: 4 },
      { content: [list([item("item")])], text: "item", offset: 2 },
      { content: [list([item("")])], text: "", offset: 0 },
      {
        content: [
          { ...list([item("item")]), type: "orderedList", attrs: { start: 3 } },
        ],
        text: "item",
        offset: 2,
      },
      { content: [list([nested], true)], text: "", offset: 0 },
      { content: [quote(paragraph("quoted"))], text: "quoted", offset: 3 },
      { content: [quote(paragraph(""))], text: "", offset: 0 },
      { content: [table()], text: "first", offset: 2 },
    ];
    for (const { content, text, offset } of cases) {
      const enter = createEditor(content);
      caret(enter, text, offset);
      key(enter, "Enter");
      const shifted = createEditor(content);
      caret(shifted, text, offset);
      expect(key(shifted, "Enter", { shiftKey: true })).toBe(true);
      expect(shifted.getJSON()).toEqual(enter.getJSON());
      expect(shifted.state.selection.toJSON()).toEqual(
        enter.state.selection.toJSON(),
      );
      expect(JSON.stringify(shifted.getJSON())).not.toContain("hardBreak");
    }
  });

  it("replaces selected text with a block split and restores text and selection on undo", () => {
    const editor = createEditor([paragraph("before middle after")]);
    editor.commands.setTextSelection({ from: 8, to: 15 });
    const saved = editor.getJSON();
    const selected = editor.state.selection.toJSON();
    key(editor, "Enter", { shiftKey: true });
    expect(
      editor.getJSON().content?.map((node) => node.content?.[0]?.text),
    ).toEqual(["before ", "after"]);
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(saved);
    expect(editor.state.selection.toJSON()).toEqual(selected);
    editor.commands.redo();
    expect(editor.state.doc.childCount).toBe(2);
  });

  it("preserves stored hard breaks while new shifted line breaks create blocks", () => {
    const original: JSONContent = {
      type: "paragraph",
      content: [
        { type: "text", text: "old" },
        { type: "hardBreak" },
        { type: "text", text: "line" },
      ],
    };
    const editor = createEditor([original]);
    expect(editor.getJSON().content?.[0]).toEqual(original);
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize - 1);
    key(editor, "Enter", { shiftKey: true });
    expect(editor.getJSON().content).toEqual([original, { type: "paragraph" }]);
  });

  it("keeps syntax newlines in code and uses the same empty-code exit", () => {
    const editor = createEditor([
      { type: "codeBlock", content: [{ type: "text", text: "code" }] },
    ]);
    caret(editor, "code", 2);
    key(editor, "Enter", { shiftKey: true });
    expect(editor.state.doc.firstChild!.textContent).toBe("co\nde");
    caret(editor, "co\nde", 5);
    key(editor, "Enter", { shiftKey: true });
    key(editor, "Enter", { shiftKey: true });
    key(editor, "Enter", { shiftKey: true });
    expect(ancestors(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.firstChild!.textContent).toBe("co\nde");
  });

  it("starts display math on ShiftEnter and leaves math source Enter handling intact", () => {
    const editor = createEditor([paragraph("$$")]);
    caret(editor, "$$", 2);
    key(editor, "Enter", { shiftKey: true });
    expect(editor.state.doc.firstChild!.type.name).toBe("blockMath");
    const input =
      editor.view.dom.querySelector<HTMLTextAreaElement>(".math-note-input")!;
    expect(document.activeElement).toBe(input);
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
      expect(editor.state.doc.firstChild!.type.name).toBe("blockMath");
    }
  });

  it("continues below selected images identically without replacing the image or following prose", () => {
    const content = [
      { type: "image", attrs: { src: "test.png" } },
      paragraph("After"),
    ];
    const output = [false, true].map((shiftKey) => {
      const editor = createEditor(content);
      editor.commands.setNodeSelection(0);
      key(editor, "Enter", { shiftKey });
      expect(ancestors(editor)).toEqual(["paragraph"]);
      expect(editor.state.selection.$from.parent.textContent).toBe("");
      return editor.getJSON();
    });
    expect(output[1]).toEqual(output[0]);
    expect(output[0].content?.map((node) => node.type)).toEqual([
      "image",
      "paragraph",
      "paragraph",
    ]);
    expect(output[0].content?.[2].content?.[0].text).toBe("After");
  });

  it("splits blocks in Vim Insert while preserving Normal mode commands", () => {
    const editor = createEditor(
      [paragraph("first"), paragraph("second")],
      true,
    );
    caret(editor, "first", 2);
    const saved = editor.getJSON();
    key(editor, "Enter", { shiftKey: true });
    expect(getVimMode(editor.view)).toBe("normal");
    expect(editor.getJSON()).toEqual(saved);
    caret(editor, "first", 2);
    key(editor, "i");
    key(editor, "Enter", { shiftKey: true });
    expect(getVimMode(editor.view)).toBe("insert");
    expect(
      editor.getJSON().content?.map((node) => node.content?.[0]?.text),
    ).toEqual(["fi", "rst", "second"]);
  });

  it("toggles only the nearest checkbox with CmdShiftEnter without moving the caret, and supports undo", () => {
    const parent = item("parent", true);
    parent.content!.push(list([item("child", true)], true));
    const editor = createEditor([list([parent], true)]);
    caret(editor, "child", 3);
    const before = editor.state.selection.from;
    expect(key(editor, "Enter", { metaKey: true, shiftKey: true })).toBe(true);
    const savedParent = editor.getJSON().content?.[0].content?.[0];
    expect(savedParent?.attrs?.checked).toBe(false);
    expect(savedParent?.content?.[1].content?.[0].attrs?.checked).toBe(true);
    expect(editor.state.selection.from).toBe(before);
    editor.commands.undo();
    expect(
      editor.getJSON().content?.[0].content?.[0].content?.[1].content?.[0].attrs
        ?.checked,
    ).toBe(false);
  });

  it("continues a quote on Enter and leaves the quote on an empty Enter", () => {
    const editor = createEditor([quote(paragraph("quoted"))]);
    caret(editor, "quoted", 6);
    key(editor, "Enter");
    expect(ancestors(editor)).toEqual(["blockquote", "paragraph"]);
    key(editor, "Enter");
    expect(
      editor
        .getJSON()
        .content?.slice(0, 2)
        .map((node) => node.type),
    ).toEqual(["blockquote", "paragraph"]);
    expect(ancestors(editor)).toEqual(["paragraph"]);
    expect(editor.state.doc.textContent).toBe("quoted");
  });

  it("CmdEnter exits a quote or table without splitting content or adding redundant empty paragraphs", () => {
    for (const block of [quote(paragraph("quoted")), table()]) {
      const editor = createEditor([block, paragraph()]);
      const saved = editor.getJSON();
      for (let repeat = 0; repeat < 2; repeat += 1) {
        caret(editor, block.type === "table" ? "first" : "quoted", 2);
        key(editor, "Enter", { metaKey: true });
        expect(editor.getJSON()).toEqual(saved);
        expect(ancestors(editor)).toEqual(["paragraph"]);
        expect(editor.state.selection.$from.parent.textContent).toBe("");
        expect(editor.state.selection.$from.parentOffset).toBe(0);
      }
    }
  });

  it("CmdEnter starts a fresh paragraph before existing following text and preserves that text", () => {
    const image: JSONContent = {
      type: "image",
      attrs: { src: "test.png", alt: "Example" },
    };
    for (const block of [quote(paragraph("quoted")), table(), image]) {
      const editor = createEditor([block, paragraph("Reference link")]);
      if (block.type === "image") {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            NodeSelection.create(editor.state.doc, 0),
          ),
        );
      } else {
        caret(editor, block.type === "table" ? "first" : "quoted", 2);
      }
      const original = editor.getJSON().content!;
      key(editor, "Enter", { metaKey: true });
      expect(editor.getJSON().content).toEqual([
        original[0],
        { type: "paragraph" },
        original[1],
      ]);
      expect(ancestors(editor)).toEqual(["paragraph"]);
      expect(editor.state.selection.$from.parent.textContent).toBe("");
      editor.commands.insertContent("New thought");
      expect(editor.state.doc.child(1).textContent).toBe("New thought");
      expect(editor.state.doc.child(2).textContent).toBe("Reference link");
    }
  });

  it("CmdEnter creates a paragraph after a trailing block and exits only the nearest quote", () => {
    const editor = createEditor([
      quote(paragraph("outer"), quote(paragraph("inner"))),
    ]);
    caret(editor, "inner", 2);
    key(editor, "Enter", { metaKey: true });
    expect(ancestors(editor)).toEqual(["blockquote", "paragraph"]);
    expect(
      editor.getJSON().content?.[0].content?.map((node) => node.type),
    ).toEqual(["paragraph", "blockquote", "paragraph"]);
    expect(editor.state.doc.textContent).toBe("outerinner");
  });

  it("retains table-cell Tab navigation even within a list and adds a new row at the last cell", () => {
    const parent = item("parent");
    parent.content!.push(table());
    const editor = createEditor([list([parent])]);
    caret(editor, "first");
    key(editor, "Tab");
    expect(editor.state.selection.$from.parent.textContent).toBe("second");
    key(editor, "Tab", { shiftKey: true });
    expect(editor.state.selection.$from.parent.textContent).toBe("first");
    caret(editor, "second");
    key(editor, "Tab");
    const savedTable = editor.getJSON().content?.[0].content?.[0].content?.[1];
    expect(savedTable?.content).toHaveLength(2);
    expect(ancestors(editor)).toContain("tableCell");
    expect(editor.state.selection.$from.parent.textContent).toBe("");
  });

  it("retains code-block Enter and arrow exits and lets CmdEnter leave code inside a quote", () => {
    const code: JSONContent = {
      type: "codeBlock",
      content: [{ type: "text", text: "code" }],
    };
    const editor = createEditor([code]);
    caret(editor, "code", 2);
    key(editor, "Enter");
    expect(editor.state.doc.child(0).textContent).toBe("co\nde");
    caret(editor, "co\nde", 5);
    key(editor, "ArrowDown");
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "codeBlock",
      "paragraph",
    ]);
    const nested = createEditor([quote(code)]);
    caret(nested, "code", 2);
    // JSDOM identifies as non-Mac, so Tiptap's platform Mod key is Control.
    key(nested, "Enter", { ctrlKey: true });
    expect(ancestors(nested)).toEqual(["blockquote", "paragraph"]);
    expect(nested.state.doc.textContent).toBe("code");
  });

  it("lets a selected image create a paragraph below with CmdEnter without modifying the image", () => {
    const editor = createEditor([
      { type: "image", attrs: { src: "test.png", alt: "Example" } },
    ]);
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 0)),
    );
    key(editor, "Enter", { metaKey: true });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "image",
      "paragraph",
    ]);
    expect(editor.getJSON().content?.[0].attrs?.src).toBe("test.png");
    expect(ancestors(editor)).toEqual(["paragraph"]);
  });

  it("does not consume composition, modified Tab, embedded input, or Vim Normal shortcuts", () => {
    const editor = createEditor([list([item("task", true)], true)]);
    caret(editor, "task");
    const before = editor.getJSON();
    expect(
      key(editor, "Enter", {
        metaKey: true,
        shiftKey: true,
        isComposing: true,
      }),
    ).toBe(false);
    expect(key(editor, "Tab", { altKey: true })).toBe(false);
    const input = document.createElement("textarea");
    editor.view.dom.append(input);
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(editor.getJSON()).toEqual(before);
    const vim = createEditor([list([item("task", true)], true)], true);
    caret(vim, "task");
    const vimBefore = vim.getJSON();
    key(vim, "Enter", { metaKey: true, shiftKey: true });
    expect(vim.getJSON()).toEqual(vimBefore);
    key(vim, "i");
    key(vim, "Enter", { metaKey: true, shiftKey: true });
    expect(vim.getJSON().content?.[0].content?.[0].attrs?.checked).toBe(true);
  });
});
