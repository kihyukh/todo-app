// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { VimEditor, vimPluginKey } from "../src/vim-editor";
import { NaturalBlockMath } from "../src/math-editor";

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

  it("leaves native math source typing and platform shortcuts untouched", async () => {
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
    const event = new KeyboardEvent("keydown", {
      key: "j",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    input.value = "j(x)";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(editor.getJSON().content?.[1].attrs?.latex).toBe("j(x)");
    expect(key(editor, "f", { metaKey: true })).toBe(false);
  });
});
