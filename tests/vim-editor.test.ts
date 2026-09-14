// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { VimEditor, vimPluginKey } from "../src/vim-editor";
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
      NaturalBlockMath,
      NaturalInlineMath,
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
