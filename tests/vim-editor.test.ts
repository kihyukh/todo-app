// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { NoteTableKit } from "../src/note-table";
import { VimEditor, vimPluginKey } from "../src/vim-editor";
import { NaturalBlockMath, NaturalInlineMath } from "../src/math-editor";
import { NoteImage } from "../src/image-editor";

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
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
function createEditor(content: string[] | JSONContent[], enabled = true) {
  const element = document.createElement("div");
  document.body.append(element);
  const onModeChange = vi.fn();
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      NoteTableKit,
      NaturalBlockMath,
      NaturalInlineMath,
      NoteImage.configure({ allowBase64: true }),
      VimEditor.configure({ enabled, onModeChange }),
    ],
    content: {
      type: "doc",
      content: content.map((item) =>
        typeof item === "string" ? paragraph(item) : item,
      ),
    },
  });
  editors.push(editor);
  editor.view.focus();
  return { editor, onModeChange };
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
function keys(editor: Editor, sequence: string) {
  for (const letter of sequence) key(editor, letter);
}
function sourceKey(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  options: KeyboardEventInit = {},
) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  input.dispatchEvent(event);
  return event.defaultPrevented;
}
function sourceType(
  input: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  inputType = "insertText",
) {
  const before = new InputEvent("beforeinput", {
    data: text,
    inputType,
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(before);
  if (before.defaultPrevented) return false;
  const start = input.selectionStart ?? 0;
  const end = input.selectionEnd ?? start;
  input.setRangeText(text, start, end, "end");
  input.dispatchEvent(
    new InputEvent("input", { data: text, inputType, bubbles: true }),
  );
  return true;
}
function type(editor: Editor, text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    let handled = false;
    editor.view.someProp("handleTextInput", (handler) => {
      handled = handler(editor.view, from, to, character, () =>
        editor.state.tr.insertText(character, from, to),
      );
      return handled;
    });
    if (!handled)
      editor.view.dispatch(editor.state.tr.insertText(character, from, to));
  }
}
function mode(editor: Editor) {
  return vimPluginKey.getState(editor.state)?.mode;
}
function paragraphs(editor: Editor) {
  return editor
    .getJSON()
    .content?.map(
      (node) => node.content?.map((child) => child.text ?? "").join("") ?? "",
    );
}

describe("optional Vim note editor", () => {
  it.each([
    {
      name: "wrapped paragraph",
      blocks: [
        paragraph("Earlier line"),
        paragraph(
          "A long paragraph that wraps across several visual rows without a hard break.",
        ),
      ],
      selector: "p:last-child",
      offset: 38,
    },
    {
      name: "empty paragraph",
      blocks: [paragraph("Earlier line"), paragraph("")],
      selector: "p:last-child",
      offset: 0,
    },
    {
      name: "heading",
      blocks: [
        paragraph("Earlier line"),
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Heading with details" }],
        },
        paragraph("After"),
      ],
      selector: "h2",
      offset: 9,
    },
    {
      name: "bullet item",
      blocks: [
        paragraph("Earlier line"),
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [paragraph("First item")] },
            { type: "listItem", content: [paragraph("Second item")] },
          ],
        },
      ],
      selector: "li:last-child p",
      offset: 4,
    },
    {
      name: "checkbox item",
      blocks: [
        paragraph("Earlier line"),
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [paragraph("Next step")],
            },
          ],
        },
      ],
      selector: "li p",
      offset: 4,
    },
    {
      name: "paragraph after display math",
      blocks: [
        paragraph("Earlier line"),
        { type: "blockMath", attrs: { latex: "x^2" } },
        paragraph("After math"),
      ],
      selector: "p:last-child",
      offset: 4,
    },
    {
      name: "paragraph after an image",
      blocks: [
        paragraph("Earlier line"),
        {
          type: "image",
          attrs: { src: "data:image/png;base64,YQ==", alt: "Preserve image" },
        },
        paragraph("After image"),
      ],
      selector: "p:last-child",
      offset: 4,
    },
  ])(
    "enters Insert at the native caret in a $name before selectionchange reaches the editor",
    ({ blocks, selector, offset }) => {
      const { editor } = createEditor(blocks);
      const before = editor.getJSON();
      const target = editor.view.dom.querySelector<HTMLElement>(selector)!;
      const node =
        target.firstChild instanceof Text ? target.firstChild : target;
      const expected = editor.view.posAtDOM(node, offset);
      // WebKit can deliver the next key before its queued selectionchange event.
      // The visible caret is already here, while ProseMirror still has the old line.
      document.getSelection()!.collapse(node, offset);
      expect(editor.state.selection.head).not.toBe(expected);
      expect(key(editor, "i")).toBe(true);
      expect(mode(editor)).toBe("insert");
      expect(editor.state.selection.head).toBe(expected);
      expect(editor.getJSON()).toEqual(before);
      type(editor, "!");
      expect(editor.state.selection.head).toBe(expected + 1);
      expect(editor.state.selection.$from.parent.textContent).toContain("!");
      expect(editor.state.doc.firstChild?.textContent).toBe("Earlier line");
    },
  );

  it.each([
    ["i", 5],
    ["a", 6],
    ["I", 2],
    ["A", 13],
  ] as const)(
    "resolves %s against the current native line rather than the previous editor selection",
    (command, offset) => {
      const { editor } = createEditor(["Earlier line", "  second line"]);
      const target = editor.view.dom.querySelector("p:last-child")!.firstChild!;
      const start = editor.view.posAtDOM(target, 0);
      document.getSelection()!.collapse(target, 5);
      key(editor, command);
      expect(mode(editor)).toBe("insert");
      expect(editor.state.selection.head).toBe(start + offset);
    },
  );

  it.each(["before", "after"])(
    "keeps Insert on the %s side of inline math while a native caret change is pending",
    (side) => {
      const { editor } = createEditor([
        paragraph("Earlier line"),
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Before " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
            { type: "text", text: " after" },
          ],
        },
      ]);
      const math =
        editor.view.dom.querySelector<HTMLElement>(".math-note-inline")!;
      const parent = math.parentElement!;
      const index =
        [...parent.childNodes].indexOf(math) + (side === "after" ? 1 : 0);
      const position = editor.view.posAtDOM(parent, index);
      document.getSelection()!.collapse(parent, index);
      key(editor, "i");
      expect(editor.state.selection.head).toBe(position);
      type(editor, "!");
      const content = editor.getJSON().content?.[1].content!;
      expect(
        content.find((node) => node.type === "inlineMath")?.attrs?.latex,
      ).toBe("x^2");
      expect(content[side === "before" ? 0 : 2].text).toBe(
        side === "before" ? "Before !" : "! after",
      );
      expect(editor.state.doc.firstChild?.textContent).toBe("Earlier line");
    },
  );

  it("defaults off and toggles modes without changing note content", async () => {
    const { editor, onModeChange } = createEditor(["hello"], false);
    await Promise.resolve();
    expect(onModeChange).toHaveBeenLastCalledWith(null);
    expect(key(editor, "h")).toBe(false);
    editor.commands.setVimEnabled(true);
    expect(mode(editor)).toBe("normal");
    expect(onModeChange).toHaveBeenLastCalledWith("normal");
    expect(key(editor, "z")).toBe(true);
    type(editor, "blocked");
    expect(editor.getText()).toBe("hello");
    key(editor, "i");
    expect(mode(editor)).toBe("insert");
    type(editor, "Hi ");
    key(editor, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(editor.getText()).toBe("Hi hello");
    editor.commands.setVimEnabled(false);
    expect(key(editor, "j")).toBe(false);
    expect(editor.getText()).toBe("Hi hello");
  });

  it("supports word, character, line and counted navigation", () => {
    const { editor } = createEditor(["one two three", "second", "last"]);
    keys(editor, "w");
    expect(editor.state.selection.head).toBe(5);
    keys(editor, "e");
    expect(editor.state.selection.head).toBe(7);
    keys(editor, "b");
    expect(editor.state.selection.head).toBe(5);
    keys(editor, "0");
    expect(editor.state.selection.head).toBe(1);
    keys(editor, "2w");
    expect(editor.state.selection.head).toBe(9);
    keys(editor, "$h");
    expect(editor.state.selection.head).toBe(12);
    keys(editor, "G0");
    expect(editor.state.selection.$head.parent.textContent).toBe("last");
    keys(editor, "gg");
    expect(editor.state.selection.head).toBe(1);
    keys(editor, "2j");
    expect(editor.state.selection.$head.parent.textContent).toBe("last");
    keys(editor, "k");
    expect(editor.state.selection.$head.parent.textContent).toBe("second");
    keys(editor, "2gg");
    expect(editor.state.selection.$head.parent.textContent).toBe("second");
  });

  it("supports deletion/change operators, counted motions, and independent undo/redo", () => {
    const { editor } = createEditor(["one two three four"]);
    keys(editor, "2dw");
    expect(editor.getText()).toBe("three four");
    keys(editor, "cw");
    expect(mode(editor)).toBe("insert");
    type(editor, "new");
    key(editor, "Escape");
    expect(editor.getText()).toBe("new four");
    key(editor, "u");
    expect(editor.getText()).toBe("three four");
    key(editor, "r", { ctrlKey: true });
    expect(editor.getText()).toBe("new four");
    keys(editor, "0x");
    expect(editor.getText()).toBe("ew four");
    key(editor, "u");
    expect(editor.getText()).toBe("new four");
  });

  it("deletes and yanks entire paragraphs, preserving formatting on paste", () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [{ type: "text", text: "first", marks: [{ type: "bold" }] }],
      },
      paragraph("second"),
      paragraph("third"),
    ]);
    keys(editor, "yyp");
    expect(paragraphs(editor)).toEqual(["first", "first", "second", "third"]);
    expect(editor.getJSON().content?.[1].content?.[0].marks).toEqual([
      { type: "bold" },
    ]);
    keys(editor, "gg2dd");
    expect(paragraphs(editor)).toEqual(["second", "third"]);
    key(editor, "u");
    expect(paragraphs(editor)).toEqual(["first", "first", "second", "third"]);
    keys(editor, "ggcc");
    type(editor, "replacement");
    key(editor, "Escape");
    expect(paragraphs(editor)).toEqual([
      "replacement",
      "first",
      "second",
      "third",
    ]);
  });

  it("opens lines above and below, and enters insert at logical line boundaries", () => {
    const { editor } = createEditor(["first", "last"]);
    key(editor, "o");
    type(editor, "middle");
    key(editor, "Escape");
    expect(paragraphs(editor)).toEqual(["first", "middle", "last"]);
    key(editor, "O");
    type(editor, "above");
    key(editor, "Escape");
    expect(paragraphs(editor)).toEqual(["first", "above", "middle", "last"]);
    key(editor, "I");
    type(editor, "(");
    key(editor, "Escape");
    key(editor, "A");
    type(editor, ")");
    key(editor, "Escape");
    expect(paragraphs(editor)).toEqual(["first", "(above)", "middle", "last"]);
  });

  it("supports character and line visual selections, yank, change and delete", () => {
    const { editor } = createEditor(["one two", "second", "third"]);
    keys(editor, "v2ly");
    expect(mode(editor)).toBe("normal");
    keys(editor, "$p");
    expect(paragraphs(editor)?.[0]).toBe("one twoone");
    keys(editor, "0v2lc");
    type(editor, "ONE");
    key(editor, "Escape");
    expect(paragraphs(editor)?.[0]).toBe("ONE twoone");
    keys(editor, "ggVjd");
    expect(paragraphs(editor)).toEqual(["third"]);
    key(editor, "u");
    expect(paragraphs(editor)).toEqual(["ONE twoone", "second", "third"]);
  });

  it("handles list-item deletion and opening without flattening checklist structure", () => {
    const { editor } = createEditor([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [paragraph("first")],
          },
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("second")],
          },
        ],
      },
    ]);
    keys(editor, "dd");
    expect(editor.getJSON().content?.[0].content).toHaveLength(1);
    expect(editor.state.doc.textContent).toBe("second");
    key(editor, "o");
    type(editor, "third");
    key(editor, "Escape");
    expect(editor.getJSON().content?.[0].content).toHaveLength(2);
    expect(editor.getJSON().content?.[0].content?.[1].attrs?.checked).toBe(
      false,
    );
    expect(editor.getText()).toContain("third");
  });

  it("preserves Unicode characters and never splits surrogate pairs", () => {
    const { editor } = createEditor(["한글 😀 word"]);
    keys(editor, "w");
    expect(editor.state.selection.head).toBe(4);
    keys(editor, "x");
    expect(editor.getText()).toBe("한글  word");
    key(editor, "u");
    expect(editor.getText()).toBe("한글 😀 word");
  });

  it("changes a single-letter word without consuming its neighbor and keeps an empty last line editable", () => {
    const { editor } = createEditor(["a word"]);
    keys(editor, "cw");
    type(editor, "the");
    key(editor, "Escape");
    expect(editor.getText()).toBe("the word");
    keys(editor, "dd");
    expect(editor.getText()).toBe("");
    key(editor, "i");
    type(editor, "Still editable");
    key(editor, "Escape");
    expect(editor.getText()).toBe("Still editable");
  });

  it("keeps the next paragraph separate when deleting the last word on a line", () => {
    const { editor } = createEditor(["last", "next line"]);
    keys(editor, "dw");
    expect(paragraphs(editor)).toEqual(["", "next line"]);
    key(editor, "p");
    expect(paragraphs(editor)).toEqual(["last", "next line"]);
  });

  it("navigates and edits explicit code-block lines while preserving the code block", () => {
    const { editor } = createEditor([
      {
        type: "codeBlock",
        content: [{ type: "text", text: "first\nsecond\nthird" }],
      },
    ]);
    keys(editor, "j0");
    expect(editor.state.selection.head).toBe(7);
    keys(editor, "$h");
    expect(editor.state.selection.head).toBe(11);
    keys(editor, "0dd");
    expect(editor.state.doc.child(0).textContent).toBe("first\nthird");
    expect(editor.getJSON().content?.[0].type).toBe("codeBlock");
    key(editor, "P");
    expect(editor.state.doc.child(0).textContent).toBe("first\nsecond\nthird");
    key(editor, "o");
    type(editor, "new line");
    key(editor, "Escape");
    expect(editor.state.doc.child(0).textContent).toBe(
      "first\nsecond\nnew line\nthird",
    );
    keys(editor, "gg2dd");
    expect(editor.state.doc.child(0).textContent).toBe("new line\nthird");
    keys(editor, "2ggdd");
    expect(editor.state.doc.child(0).textContent).toBe("new line");
    keys(editor, "dd");
    expect(editor.state.doc.child(0).textContent).toBe("");
    expect(editor.getJSON().content?.[0].type).toBe("codeBlock");
  });

  it("treats explicit soft line breaks as logical lines and preserves marks when yanking them", () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "first", marks: [{ type: "bold" }] },
          { type: "hardBreak" },
          { type: "text", text: "second" },
        ],
      },
    ]);
    keys(editor, "yyp");
    expect(editor.getJSON().content?.[0].content?.[2]).toMatchObject({
      type: "text",
      text: "first",
      marks: [{ type: "bold" }],
    });
    keys(editor, "Gdd");
    expect(editor.state.doc.textContent).toBe("firstfirst");
    expect(editor.getJSON().content).toHaveLength(1);
  });

  it("keeps source movement modal and accepts text only after entering Insert", async () => {
    const { editor } = createEditor([
      paragraph("Before"),
      { type: "blockMath", attrs: { latex: "x^2" } },
      paragraph("After"),
    ]);
    const math =
      editor.view.dom.querySelector<HTMLElement>(".math-note-block")!;
    math.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    math.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    const input = math.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(document.activeElement).toBe(input);
    expect(mode(editor)).toBe("normal");
    expect(sourceKey(input, "h")).toBe(true);
    expect(input.selectionStart).toBe(1);
    expect(sourceKey(input, "z")).toBe(true);
    expect(sourceType(input, "accidental")).toBe(false);
    expect(editor.getJSON().content?.[1].attrs?.latex).toBe("x^2");
    sourceKey(input, "A");
    expect(mode(editor)).toBe("insert");
    expect(sourceKey(input, "j")).toBe(false);
    expect(sourceType(input, "j")).toBe(true);
    expect(editor.getJSON().content?.[1].attrs?.latex).toBe("x^2j");
    expect(sourceKey(input, "f", { metaKey: true })).toBe(false);
    expect(key(editor, "f", { metaKey: true })).toBe(false);
  });

  it("enters inline LaTeX at the approached edge with h/l and returns to Normal mode", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "ab" },
          { type: "inlineMath", attrs: { latex: "x^2" } },
          { type: "text", text: "cd" },
        ],
      },
    ]);
    const input = editor.view.dom.querySelector<HTMLInputElement>(
      ".math-note-inline input",
    )!;
    keys(editor, "ll");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(mode(editor)).toBe("normal");
    sourceKey(input, "$");
    sourceKey(input, "l");
    expect(document.activeElement).toBe(editor.view.dom);
    expect(mode(editor)).toBe("normal");
    expect(editor.state.selection.head).toBe(4);
    key(editor, "h");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length - 1);
    sourceKey(input, "0");
    sourceKey(input, "h");
    expect(editor.state.selection.head).toBe(2);
    expect(document.activeElement).toBe(editor.view.dom);
    expect(mode(editor)).toBe("normal");
  });

  it.each(["w", "e", "b"])(
    "encounters an inline equation during the %s word motion",
    async (motion) => {
      const { editor } = createEditor([
        {
          type: "paragraph",
          content: [
            { type: "text", text: ":" },
            { type: "inlineMath", attrs: { latex: "y" } },
            { type: "text", text: ", next" },
          ],
        },
      ]);
      if (motion === "b") editor.commands.setTextSelection(5);
      key(editor, motion);
      await Promise.resolve();
      const input = editor.view.dom.querySelector<HTMLInputElement>(
        ".math-note-inline input",
      )!;
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("y");
    },
  );

  it("does not skip a display equation with j/k, including equations inside quotes", async () => {
    const { editor } = createEditor([
      {
        type: "blockquote",
        content: [
          paragraph("Before"),
          { type: "blockMath", attrs: { latex: "a+b" } },
          paragraph("After"),
        ],
      },
    ]);
    const input = editor.view.dom.querySelector<HTMLTextAreaElement>(
      ".math-note-block textarea",
    )!;
    key(editor, "j");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    sourceKey(input, "j");
    expect(editor.state.selection.$head.parent.textContent).toBe("After");
    expect(mode(editor)).toBe("normal");
    key(editor, "k");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length - 1);
    expect(editor.getJSON().content?.[0].type).toBe("blockquote");
  });

  it("keeps equations rendered during visual selections and deletion operators", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "text", text: "b" },
        ],
      },
      { type: "blockMath", attrs: { latex: "y^2" } },
      paragraph("After"),
    ]);
    keys(editor, "vl");
    await Promise.resolve();
    expect(mode(editor)).toBe("visual");
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
    key(editor, "y");
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
    keys(editor, "ggVj");
    await Promise.resolve();
    expect(mode(editor)).toBe("visual-line");
    expect(editor.state.selection.from).toBeLessThan(6);
    expect(editor.state.selection.to).toBeGreaterThan(6);
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
    key(editor, "Escape");
    keys(editor, "ggdj");
    await Promise.resolve();
    expect(
      editor.getJSON().content?.some((node) => node.type === "blockMath"),
    ).toBe(false);
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
    key(editor, "u");
    expect(editor.getJSON().content?.[1]).toMatchObject({
      type: "blockMath",
      attrs: { latex: "y^2" },
    });
  });

  it("keeps the vertical cursor on a whole Unicode character across nested checklist and code lines", () => {
    const { editor } = createEditor([
      paragraph("abcd"),
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [paragraph("a😀b")],
          },
        ],
      },
      { type: "codeBlock", content: [{ type: "text", text: "a😀b\nlast" }] },
    ]);
    keys(editor, "llj");
    const first = editor.state.selection.$head;
    expect(first.parent.textContent).toBe("a😀b");
    expect(first.parentOffset).toBe(1);
    key(editor, "j");
    const second = editor.state.selection.$head;
    expect(second.parent.type.name).toBe("codeBlock");
    expect(second.parentOffset).toBe(1);
    key(editor, "x");
    expect(editor.state.doc.child(2).textContent).toBe("ab\nlast");
    expect(editor.getJSON().content?.[1].content?.[0].attrs?.checked).toBe(
      false,
    );
  });

  it("resumes Insert mode after traversing source and saves edits before prose typing", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "text", text: "b" },
        ],
      },
    ]);
    key(editor, "i");
    editor.commands.setTextSelection(2);
    key(editor, "ArrowRight");
    await Promise.resolve();
    const input = editor.view.dom.querySelector<HTMLInputElement>(
      ".math-note-inline input",
    )!;
    expect(document.activeElement).toBe(input);
    expect(mode(editor)).toBe("insert");
    input.value = "x+y";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.setSelectionRange(3, 3);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(mode(editor)).toBe("insert");
    expect(editor.state.selection.head).toBe(3);
    type(editor, "new");
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("x+y");
    expect(editor.state.doc.child(0).lastChild?.textContent).toBe("newb");
  });

  it("moves through touching equations without losing Normal mode or revisiting a separated equation", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "inlineMath", attrs: { latex: "y" } },
          { type: "text", text: "b" },
          { type: "inlineMath", attrs: { latex: "z" } },
          { type: "text", text: "c" },
        ],
      },
    ]);
    const inputs = [
      ...editor.view.dom.querySelectorAll<HTMLInputElement>(
        ".math-note-inline input",
      ),
    ];
    key(editor, "l");
    await Promise.resolve();
    expect(document.activeElement).toBe(inputs[0]);
    sourceKey(inputs[0], "l");
    await Promise.resolve();
    expect(document.activeElement).toBe(inputs[1]);
    expect(inputs[1].selectionStart).toBe(0);
    sourceKey(inputs[1], "l");
    expect(editor.state.selection.head).toBe(4);
    key(editor, "l");
    await Promise.resolve();
    expect(document.activeElement).toBe(inputs[2]);
    sourceKey(inputs[2], "h");
    await Promise.resolve();
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.selection.head).toBe(4);
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
    expect(mode(editor)).toBe("normal");
  });

  it("leaves Shift-arrow selection available without entering math in Normal mode", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "text", text: "b" },
        ],
      },
    ]);
    expect(key(editor, "ArrowRight", { shiftKey: true })).toBe(false);
    await Promise.resolve();
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
  });
});

describe("Vim Shift+J joins", () => {
  it.each([
    { before: ["one", "two"], after: "one two", cursor: 4 },
    { before: ["one", "  two"], after: "one two", cursor: 4 },
    { before: ["one ", "\ttwo"], after: "one two", cursor: 5 },
    { before: ["one\t", "two"], after: "one\ttwo", cursor: 5 },
    { before: ["(one", "  )"], after: "(one)", cursor: 5 },
    { before: ["one.", "Two"], after: "one. Two", cursor: 5 },
    { before: ["one", ""], after: "one", cursor: 3 },
    { before: ["one", "   "], after: "one", cursor: 3 },
    { before: ["", "two"], after: "two", cursor: 1 },
    { before: ["", ""], after: "", cursor: 1 },
    { before: ["한글 😀", "  다음"], after: "한글 😀 다음", cursor: 6 },
  ])(
    "joins $before with Vim spacing and a cursor at the join",
    ({ before, after, cursor }) => {
      const { editor } = createEditor(before);
      expect(key(editor, "J", { shiftKey: true })).toBe(true);
      expect(paragraphs(editor)).toEqual([after]);
      expect(editor.state.selection.head).toBe(cursor);
      expect(mode(editor)).toBe("normal");
    },
  );

  it("joins a count of logical lines, independent of cursor column, in one undo step", () => {
    const { editor } = createEditor(["one", "two", "three", "four"]);
    keys(editor, "l3J");
    expect(paragraphs(editor)).toEqual(["one two three", "four"]);
    expect(editor.state.selection.head).toBe(8);
    key(editor, "u");
    expect(paragraphs(editor)).toEqual(["one", "two", "three", "four"]);
    key(editor, "r", { ctrlKey: true });
    expect(paragraphs(editor)).toEqual(["one two three", "four"]);
    keys(editor, "99J");
    expect(paragraphs(editor)).toEqual(["one two three four"]);
    const before = editor.getJSON();
    keys(editor, "1J");
    expect(editor.getJSON()).toEqual(before);
    expect(vimPluginKey.getState(editor.state)?.count).toBe("");
  });

  it.each(["x", "insert", "native"])(
    "keeps %s edits after a join in a separate undo step",
    (change) => {
      const { editor } = createEditor(["one", "two"]);
      key(editor, "J");
      if (change === "x") key(editor, "x");
      else if (change === "insert") {
        key(editor, "i");
        type(editor, "!");
        key(editor, "Escape");
      } else editor.view.dispatch(editor.state.tr.insertText("!"));
      key(editor, "u");
      expect(paragraphs(editor)).toEqual(["one two"]);
      key(editor, "u");
      expect(paragraphs(editor)).toEqual(["one", "two"]);
    },
  );

  it("leaves the yank register and ordinary j navigation unchanged", () => {
    const { editor } = createEditor(["one", "two", "three"]);
    keys(editor, "yy");
    const register = vimPluginKey.getState(editor.state)?.register;
    key(editor, "J");
    expect(vimPluginKey.getState(editor.state)?.register).toBe(register);
    key(editor, "j");
    expect(editor.state.selection.$head.parent.textContent).toBe("three");
    key(editor, "p");
    expect(paragraphs(editor)).toEqual(["one two", "three", "one"]);
  });

  it.each(["VjJ", "vjJ", "jVkJ", "jvkJ", "VJ", "vJ"])(
    "%s joins selected logical lines and returns to Normal",
    (sequence) => {
      const { editor } = createEditor(["one", "two", "three"]);
      keys(editor, sequence);
      expect(paragraphs(editor)).toEqual(["one two", "three"]);
      expect(mode(editor)).toBe("normal");
      expect(editor.state.selection.empty).toBe(true);
      expect(vimPluginKey.getState(editor.state)?.anchor).toBeNull();
      expect(vimPluginKey.getState(editor.state)?.head).toBeNull();
    },
  );

  it("keeps marks, links and inline equations intact, without making the added space a link", () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [{ type: "text", text: "bold", marks: [{ type: "bold" }] }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "  paper",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.com/paper.pdf" },
              },
            ],
          },
          { type: "inlineMath", attrs: { latex: "x^2" } },
          { type: "text", text: " italic", marks: [{ type: "italic" }] },
        ],
      },
    ]);
    key(editor, "J");
    const content = editor.getJSON().content?.[0].content;
    expect(content?.[0]).toMatchObject({
      text: "bold",
      marks: [{ type: "bold" }],
    });
    expect(content?.[1]).toEqual({ type: "text", text: " " });
    expect(content?.[2]).toMatchObject({
      text: "paper",
      marks: [
        { type: "link", attrs: { href: "https://example.com/paper.pdf" } },
      ],
    });
    expect(content?.[3]).toMatchObject({
      type: "inlineMath",
      attrs: { latex: "x^2" },
    });
    expect(content?.[4]).toMatchObject({
      text: " italic",
      marks: [{ type: "italic" }],
    });
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
  });

  it.each([true, false])(
    "retains the first block's heading or paragraph style (%s)",
    (headingFirst) => {
      const heading = {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Title" }],
      };
      const { editor } = createEditor(
        headingFirst
          ? [heading, paragraph("body")]
          : [paragraph("body"), heading],
      );
      key(editor, "J");
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: headingFirst ? "heading" : "paragraph",
        ...(headingFirst ? { attrs: { level: 2 } } : {}),
      });
      expect(editor.state.doc.textContent).toBe(
        headingFirst ? "Title body" : "body Title",
      );
    },
  );

  it.each(["bulletList", "orderedList"])(
    "merges sibling %s items and retains nested children",
    (type) => {
      const nested: JSONContent = {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph("Nested")] }],
      };
      const { editor } = createEditor([
        {
          type,
          ...(type === "orderedList" ? { attrs: { start: 5 } } : {}),
          content: [
            { type: "listItem", content: [paragraph("one")] },
            { type: "listItem", content: [paragraph("two"), nested] },
            { type: "listItem", content: [paragraph("three")] },
          ],
        },
      ]);
      key(editor, "J");
      const list = editor.getJSON().content?.[0];
      expect(list?.type).toBe(type);
      if (type === "orderedList") expect(list?.attrs?.start).toBe(5);
      expect(list?.content).toHaveLength(2);
      expect(list?.content?.[0].content).toEqual([
        paragraph("one two"),
        nested,
      ]);
      const before = editor.getJSON();
      key(editor, "J");
      expect(editor.getJSON()).toEqual(before);
      key(editor, "u");
      expect(editor.getJSON().content?.[0].content).toHaveLength(3);
    },
  );

  it("joins a continuation paragraph to the next bullet without discarding previous paragraphs", () => {
    const { editor } = createEditor([
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [paragraph("first"), paragraph("continued")],
          },
          {
            type: "listItem",
            content: [paragraph("next"), paragraph("detail")],
          },
        ],
      },
    ]);
    keys(editor, "jJ");
    expect(editor.getJSON().content?.[0].content).toEqual([
      {
        type: "listItem",
        content: [
          paragraph("first"),
          paragraph("continued next"),
          paragraph("detail"),
        ],
      },
    ]);
  });

  it.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ])(
    "preserves separate checkbox identities and completion values %s/%s",
    (first, second) => {
      const { editor } = createEditor([
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: first },
              content: [paragraph("one"), paragraph("detail")],
            },
            {
              type: "taskItem",
              attrs: { checked: second },
              content: [paragraph("two")],
            },
          ],
        },
      ]);
      keys(editor, "3J");
      expect(editor.getJSON().content?.[0].content).toEqual([
        {
          type: "taskItem",
          attrs: { checked: first },
          content: [paragraph("one detail")],
        },
        {
          type: "taskItem",
          attrs: { checked: second },
          content: [paragraph("two")],
        },
      ]);
      const before = editor.getJSON();
      key(editor, "J");
      expect(editor.getJSON()).toEqual(before);
    },
  );

  it("joins within one quote but never crosses quote boundaries or changes nesting", () => {
    const { editor } = createEditor([
      { type: "blockquote", content: [paragraph("one"), paragraph("two")] },
      { type: "blockquote", content: [paragraph("three")] },
      paragraph("outside"),
    ]);
    keys(editor, "4J");
    expect(editor.getJSON().content).toEqual([
      { type: "blockquote", content: [paragraph("one two")] },
      { type: "blockquote", content: [paragraph("three")] },
      paragraph("outside"),
    ]);
    keys(editor, "jJ");
    expect(editor.getJSON().content).toHaveLength(3);
  });

  it("joins code lines without converting the block or joining the following prose", () => {
    const { editor } = createEditor([
      {
        type: "codeBlock",
        attrs: { language: "javascript" },
        content: [{ type: "text", text: "call(\n  value\n)" }],
      },
      paragraph("outside"),
    ]);
    keys(editor, "9J");
    expect(editor.getJSON().content?.[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: [{ type: "text", text: "call( value)" }],
    });
    expect(paragraphs(editor)?.[1]).toBe("outside");
    key(editor, "u");
    expect(editor.state.doc.firstChild?.textContent).toBe("call(\n  value\n)");
  });

  it("joins legacy hard breaks and following paragraphs while preserving other lines", () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "first" },
          { type: "hardBreak" },
          { type: "text", text: "  second", marks: [{ type: "bold" }] },
        ],
      },
      paragraph("third"),
      paragraph("fourth"),
    ]);
    keys(editor, "3J");
    expect(paragraphs(editor)).toEqual(["first second third", "fourth"]);
    expect(editor.getJSON().content?.[0].content?.[1]).toMatchObject({
      text: "second",
      marks: [{ type: "bold" }],
    });
  });

  it.each([
    { type: "blockMath", attrs: { latex: "x^2" } },
    { type: "image", attrs: { src: "data:image/png;base64,YQ==" } },
    { type: "horizontalRule" },
  ])(
    "stops counted and visual joins at a $type without skipping or deleting it",
    (object) => {
      const { editor } = createEditor([
        paragraph("one"),
        paragraph("two"),
        object,
        paragraph("three"),
      ]);
      const original = editor.getJSON();
      keys(editor, "9J");
      expect(editor.getJSON().content).toEqual([
        paragraph("one two"),
        original.content?.[2],
        paragraph("three"),
      ]);
      key(editor, "u");
      keys(editor, "ggV2jJ");
      expect(editor.getJSON().content).toEqual([
        paragraph("one two"),
        original.content?.[2],
        paragraph("three"),
      ]);
    },
  );

  it("allows paragraphs within one table cell but never joins across cells, rows or table edges", () => {
    const { editor } = createEditor([
      paragraph("before"),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("a"), paragraph("b")] },
              { type: "tableCell", content: [paragraph("c")] },
            ],
          },
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("d")] },
              { type: "tableCell", content: [paragraph("e")] },
            ],
          },
        ],
      },
      paragraph("after"),
    ]);
    const before = editor.getJSON();
    key(editor, "J");
    expect(editor.getJSON()).toEqual(before);
    keys(editor, "j9J");
    expect(editor.state.doc.child(1).child(0).child(0).textContent).toBe("a b");
    expect(editor.state.doc.child(1).child(0).child(1).textContent).toBe("c");
    expect(editor.state.doc.child(1).child(1).textContent).toBe("de");
    keys(editor, "jjjJ");
    expect(editor.state.doc.lastChild?.textContent).toBe("after");
    expect(editor.state.doc.child(1).childCount).toBe(2);
  });

  it("does not run J in Insert mode or when Vim is disabled", () => {
    const { editor } = createEditor(["one", "two"]);
    key(editor, "i");
    expect(key(editor, "J", { shiftKey: true })).toBe(false);
    type(editor, "J");
    expect(paragraphs(editor)).toEqual(["Jone", "two"]);
    editor.commands.setVimEnabled(false);
    expect(key(editor, "J", { shiftKey: true })).toBe(false);
  });
});

describe("Vim cursor arrival at equation line boundaries", () => {
  it.each(["$", "End"])(
    "reveals terminal inline math when %s lands on its normal cursor position",
    async (motion) => {
      const { editor } = createEditor([
        {
          type: "paragraph",
          content: [
            { type: "text", text: "prefix " },
            { type: "inlineMath", attrs: { latex: "x^2" } },
          ],
        },
      ]);
      key(editor, motion);
      await Promise.resolve();
      const input = editor.view.dom.querySelector<HTMLInputElement>(
        ".math-note-inline input",
      )!;
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(mode(editor)).toBe("normal");
    },
  );

  it("enters source when l moves from a rendered inline atom under the normal cursor", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "text", text: " after" },
        ],
      },
    ]);
    expect(editor.state.selection.head).toBe(1);
    expect(editor.view.dom.querySelector(".is-editing")).toBeNull();
    key(editor, "l");
    await Promise.resolve();
    const input = editor.view.dom.querySelector<HTMLInputElement>(
      ".math-note-inline input",
    )!;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
  });

  it("keeps end-of-line visual ranges and deletion operators atomic", async () => {
    const { editor } = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "prefix " },
          { type: "inlineMath", attrs: { latex: "x" } },
        ],
      },
    ]);
    keys(editor, "v$");
    await Promise.resolve();
    expect(editor.view.dom.querySelector(".is-editing")).toBeNull();
    expect(mode(editor)).toBe("visual");
    key(editor, "Escape");
    key(editor, "0");
    keys(editor, "d$");
    await Promise.resolve();
    expect(editor.view.dom.querySelector(".math-note")).toBeNull();
    expect(editor.state.doc.textContent).toBe("");
  });
});

describe("Vim modes inside equation source", () => {
  async function inlineSource(latex = "x^2") {
    const result = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "a" },
          { type: "inlineMath", attrs: { latex } },
          { type: "text", text: "b" },
        ],
      },
    ]);
    key(result.editor, "l");
    await Promise.resolve();
    const input = result.editor.view.dom.querySelector<HTMLInputElement>(
      ".math-note-inline input",
    )!;
    expect(document.activeElement).toBe(input);
    return { ...result, input };
  }

  it("joins display equation source in one undo step and keeps later typing separate", async () => {
    const { editor } = createEditor([
      paragraph("Before"),
      { type: "blockMath", attrs: { latex: "f(\n  x\n)" } },
      paragraph("After"),
    ]);
    key(editor, "j");
    await Promise.resolve();
    const input = editor.view.dom.querySelector<HTMLTextAreaElement>(
      ".math-note-block textarea",
    )!;
    expect(document.activeElement).toBe(input);
    sourceKey(input, "3");
    sourceKey(input, "J", { shiftKey: true });
    expect(input.value).toBe("f( x)");
    expect(editor.state.doc.child(1).attrs.latex).toBe("f( x)");
    expect(mode(editor)).toBe("normal");
    sourceKey(input, "u");
    expect(input.value).toBe("f(\n  x\n)");
    sourceKey(input, "r", { ctrlKey: true });
    expect(input.value).toBe("f( x)");
    sourceKey(input, "A");
    sourceType(input, "+y");
    sourceKey(input, "Escape");
    expect(input.value).toBe("f( x)+y");
    sourceKey(input, "u");
    expect(input.value).toBe("f( x)");
    sourceKey(input, "u");
    expect(input.value).toBe("f(\n  x\n)");
    expect(editor.state.doc.child(0).textContent).toBe("Before");
    expect(editor.state.doc.child(2).textContent).toBe("After");
    expect(document.activeElement).toBe(input);
  });

  it("shares Insert and Normal mode with the note while Escape keeps source focused", async () => {
    const { editor, onModeChange, input } = await inlineSource();
    sourceKey(input, "A");
    expect(mode(editor)).toBe("insert");
    expect(onModeChange).toHaveBeenLastCalledWith("insert");
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    expect(sourceType(input, "+y")).toBe(true);
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    sourceKey(input, "Escape");
    expect(mode(editor)).toBe("normal");
    expect(onModeChange).toHaveBeenLastCalledWith("normal");
    expect(document.activeElement).toBe(input);
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    expect(input.selectionStart).toBe(4);
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("x^2+y");
    sourceKey(input, "l");
    expect(document.activeElement).toBe(editor.view.dom);
    expect(mode(editor)).toBe("normal");
    expect(editor.state.selection.head).toBe(3);
    expect(editor.view.dom.querySelector(".math-note.is-editing")).toBeNull();
    expect(key(editor, "z")).toBe(true);
    expect(editor.state.doc.child(0).lastChild?.textContent).toBe("b");
  });

  it("uses the note history for source edits without closing the source or merging prose edits", async () => {
    const { editor, input } = await inlineSource("x+y");
    sourceKey(input, "x");
    expect(input.value).toBe("+y");
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("+y");
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    sourceKey(input, "u");
    expect(input.value).toBe("x+y");
    expect(document.activeElement).toBe(input);
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    expect(mode(editor)).toBe("normal");
    sourceKey(input, "r", { ctrlKey: true });
    expect(input.value).toBe("+y");
    expect(document.activeElement).toBe(input);
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    sourceKey(input, "$");
    sourceKey(input, "l");
    key(editor, "i");
    type(editor, "new ");
    key(editor, "Escape");
    key(editor, "u");
    expect(editor.state.doc.child(0).lastChild?.textContent).toBe("b");
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("+y");
  });

  it("blocks non-keyboard text insertion in Normal and allows it in Insert", async () => {
    const { editor, input } = await inlineSource();
    expect(sourceType(input, "pasted", "insertFromPaste")).toBe(false);
    expect(input.value).toBe("x^2");
    sourceKey(input, "i");
    expect(sourceType(input, "pasted", "insertFromPaste")).toBe(true);
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("pastedx^2");
    sourceKey(input, "Escape");
    expect(document.activeElement).toBe(input);
    expect(sourceType(input, "accidental")).toBe(false);
    expect(input.value).toBe("pastedx^2");
  });

  it("retains Insert when it is entered inside math and the arrow cursor exits into prose", async () => {
    const { editor, input } = await inlineSource();
    sourceKey(input, "A");
    sourceType(input, "+y");
    sourceKey(input, "ArrowRight");
    expect(document.activeElement).toBe(editor.view.dom);
    expect(mode(editor)).toBe("insert");
    type(editor, "continued ");
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("x^2+y");
    expect(editor.state.doc.child(0).lastChild?.textContent).toBe(
      "continued b",
    );
  });

  it("shares Visual mode while changing source text without selecting surrounding note content", async () => {
    const { editor, onModeChange, input } = await inlineSource("alpha+beta");
    sourceKey(input, "v");
    sourceKey(input, "e");
    expect(mode(editor)).toBe("visual");
    expect(onModeChange).toHaveBeenLastCalledWith("visual");
    expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe(
      "alpha",
    );
    sourceKey(input, "c");
    expect(mode(editor)).toBe("insert");
    expect(sourceType(input, "gamma")).toBe(true);
    sourceKey(input, "Escape");
    expect(document.activeElement).toBe(input);
    expect(input.closest(".math-note")?.classList.contains("is-editing")).toBe(
      true,
    );
    expect(mode(editor)).toBe("normal");
    expect(editor.state.doc.child(0).child(1).attrs.latex).toBe("gamma+beta");
    expect(editor.state.doc.textContent).toBe("ab");
  });
});
