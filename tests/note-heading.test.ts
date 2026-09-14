// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown } from "@tiptap/markdown";
import { NoteHeading } from "../src/note-heading";
import { NoteInteractions, NoteListKeymap } from "../src/note-interactions";
import { NaturalBlockMath, NaturalInlineMath } from "../src/math-editor";
import { VimEditor, getVimMode } from "../src/vim-editor";

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
  ...(text ? { content: [{ type: "text", text }] } : {}),
});
const heading = (text = "", level = 1): JSONContent => ({
  ...paragraph(text),
  type: "heading",
  attrs: { level },
});
function createEditor(
  content: JSONContent[] | string = [paragraph()],
  vim = false,
) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({ heading: false, listKeymap: false }),
      NoteHeading,
      NoteListKeymap,
      NoteInteractions,
      TaskList,
      TaskItem.configure({ nested: true }),
      NaturalInlineMath,
      NaturalBlockMath,
      Markdown,
      VimEditor.configure({ enabled: vim }),
    ],
    content: typeof content === "string" ? content : { type: "doc", content },
    ...(typeof content === "string"
      ? { contentType: "markdown" as const }
      : {}),
  });
  editors.push(editor);
  editor.view.focus();
  return editor;
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
const block = (editor: Editor) => editor.state.selection.$from.parent;

describe("Markdown heading input", () => {
  it.each([1, 2, 3])(
    "turns exactly %i hashes plus a space into that level",
    (level) => {
      const editor = createEditor();
      type(editor, "#".repeat(level));
      expect(block(editor).type.name).toBe("paragraph");
      type(editor, " ");
      expect(block(editor).type.name).toBe("heading");
      expect(block(editor).attrs.level).toBe(level);
      expect(block(editor).textContent).toBe("");
      expect(editor.state.selection.$from.parentOffset).toBe(0);
      type(editor, "Research questions");
      expect(block(editor).textContent).toBe("Research questions");
    },
  );

  it("converts before existing rich text and preserves its content and marks", () => {
    const original: JSONContent[] = [
      { type: "text", text: "Read ", marks: [{ type: "bold" }] },
      {
        type: "text",
        text: "this paper",
        marks: [{ type: "link", attrs: { href: "https://example.com/paper" } }],
      },
    ];
    const editor = createEditor([{ type: "paragraph", content: original }]);
    const content = editor.state.doc.firstChild!.content;
    type(editor, "## ");
    expect(block(editor).type.name).toBe("heading");
    expect(block(editor).attrs.level).toBe(2);
    expect(block(editor).content.eq(content)).toBe(true);
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    type(editor, "First: ");
    expect(block(editor).textContent).toBe("First: Read this paper");
  });

  it("accepts a WebKit nonbreaking space but does not turn a bare hash into a heading on Enter", () => {
    const editor = createEditor();
    type(editor, "##\u00a0");
    expect(block(editor).attrs.level).toBe(2);
    const literal = createEditor();
    type(literal, "#");
    key(literal, "Enter");
    expect(literal.getJSON().content).toEqual([paragraph("#"), paragraph()]);
  });

  it.each([1, 2, 3])(
    "changes an existing heading to level %i without duplicating its title",
    (level) => {
      const editor = createEditor([heading("Existing title", 2)]);
      type(editor, "#".repeat(level) + " ");
      expect(block(editor).attrs.level).toBe(level);
      expect(block(editor).textContent).toBe("Existing title");
      expect(editor.state.selection.$from.parentOffset).toBe(0);
    },
  );

  it.each([
    "#topic ",
    "#### Heading",
    "text # words",
    "\\# literal",
    " # indented",
  ])("keeps %s as ordinary text", (text) => {
    const editor = createEditor();
    type(editor, text);
    expect(block(editor).type.name).toBe("paragraph");
    expect(block(editor).textContent).toBe(text);
  });

  it("does not reinterpret hashes typed later in a heading or within code", () => {
    const editor = createEditor([heading("Section", 2)]);
    editor.commands.setTextSelection(8);
    type(editor, " # ");
    expect(block(editor).attrs.level).toBe(2);
    expect(block(editor).textContent).toBe("Section # ");
    const code = createEditor([{ type: "codeBlock" }]);
    type(code, "## ");
    expect(block(code).type.name).toBe("codeBlock");
    expect(block(code).textContent).toBe("## ");
  });

  it("undoes a prefix conversion on immediate Backspace and leaves the literal marker on Enter", () => {
    const editor = createEditor([paragraph("Title")]);
    type(editor, "### ");
    expect(key(editor, "Backspace")).toBe(true);
    expect(block(editor).type.name).toBe("paragraph");
    expect(block(editor).textContent).toBe("### Title");
    expect(editor.state.selection.$from.parentOffset).toBe(4);
    key(editor, "Enter");
    expect(editor.state.doc.child(0).toJSON()).toEqual(paragraph("### "));
    expect(editor.state.doc.child(1).toJSON()).toEqual(paragraph("Title"));
  });

  it("restores the previous level and typed marker when undoing a heading-level change", () => {
    const editor = createEditor([heading("Title", 3)]);
    type(editor, "# ");
    expect(block(editor).attrs.level).toBe(1);
    expect(editor.commands.undoInputRule()).toBe(true);
    expect(block(editor).attrs.level).toBe(3);
    expect(block(editor).textContent).toBe("# Title");
  });

  it("supports ordinary history undo and redo of a conversion", () => {
    const editor = createEditor([paragraph("Title")]);
    type(editor, "## ");
    const changed = editor.getJSON();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.textContent).toBe("Title");
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getJSON()).toEqual(changed);
  });
});

describe("heading cursor behavior", () => {
  it("continues in a paragraph after a heading and preserves following content", () => {
    const editor = createEditor([
      heading("Title", 2),
      paragraph("Existing body"),
    ]);
    editor.commands.setTextSelection(6);
    key(editor, "Enter");
    expect(editor.getJSON().content).toEqual([
      heading("Title", 2),
      paragraph(),
      paragraph("Existing body"),
    ]);
    expect(block(editor).type.name).toBe("paragraph");
    type(editor, "New body");
    expect(editor.state.doc.child(1).textContent).toBe("New body");
    expect(editor.state.doc.child(2).textContent).toBe("Existing body");
  });

  it("retains the established split behavior in the middle or at the beginning of a heading", () => {
    const editor = createEditor([heading("First second", 3)]);
    editor.commands.setTextSelection(7);
    key(editor, "Enter");
    expect(editor.getJSON().content?.slice(0, 2)).toEqual([
      heading("First ", 3),
      heading("second", 3),
    ]);
    const start = createEditor([heading("Title", 2)]);
    key(start, "Enter");
    expect(start.getJSON().content?.slice(0, 2)).toEqual([
      paragraph(),
      heading("Title", 2),
    ]);
  });

  it("exits an empty heading in place, with undo, without adding another blank block", () => {
    const editor = createEditor([heading("", 2), paragraph("Body")]);
    const original = editor.getJSON();
    key(editor, "Enter");
    expect(editor.getJSON().content).toEqual([paragraph(), paragraph("Body")]);
    expect(editor.state.selection.from).toBe(1);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(original);
  });

  it("Backspace at a heading start removes formatting before joining preceding text", () => {
    const editor = createEditor([paragraph("Before"), heading("Title", 2)]);
    editor.commands.setTextSelection(9);
    key(editor, "Backspace");
    expect(editor.getJSON().content?.slice(0, 2)).toEqual([
      paragraph("Before"),
      paragraph("Title"),
    ]);
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    key(editor, "Backspace");
    expect(editor.state.doc.firstChild?.textContent).toBe("BeforeTitle");
  });

  it("converts a heading to a paragraph within a quote without lifting it out", () => {
    const editor = createEditor([
      { type: "blockquote", content: [heading("Title", 2)] },
    ]);
    editor.commands.setTextSelection(2);
    key(editor, "Backspace");
    expect(editor.state.doc.firstChild?.type.name).toBe("blockquote");
    expect(block(editor).type.name).toBe("paragraph");
    expect(block(editor).textContent).toBe("Title");
  });

  it("removes heading formatting before joining a preceding list and handles an empty heading", () => {
    const list: JSONContent = {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("Item")] }],
    };
    const editor = createEditor([list, heading("Title", 2)]);
    editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 1);
    key(editor, "Backspace");
    expect(editor.state.doc.child(0).type.name).toBe("bulletList");
    expect(editor.state.doc.child(1).toJSON()).toEqual(paragraph("Title"));
    const empty = createEditor([heading(), paragraph("After")]);
    key(empty, "Backspace");
    expect(empty.getJSON().content).toEqual([paragraph(), paragraph("After")]);
  });

  it("preserves ShiftEnter and selection deletion instead of removing heading formatting", () => {
    const editor = createEditor([heading("Title", 2)]);
    editor.commands.setTextSelection(6);
    key(editor, "Enter", { shiftKey: true });
    expect(block(editor).type.name).toBe("heading");
    expect(block(editor).lastChild?.type.name).toBe("hardBreak");
    editor.commands.setTextSelection({ from: 1, to: 3 });
    key(editor, "Backspace");
    expect(block(editor).type.name).toBe("heading");
    expect(block(editor).textContent).toBe("tle");
  });

  it("retains list Enter and list deletion behavior", () => {
    const editor = createEditor([
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: true },
            content: [paragraph("Task")],
          },
        ],
      },
    ]);
    editor.commands.setTextSelection(7);
    key(editor, "Enter");
    expect(editor.state.doc.firstChild?.childCount).toBe(2);
    expect(editor.state.doc.firstChild?.child(1).attrs.checked).toBe(false);
    key(editor, "Backspace");
    expect(editor.state.doc.textContent).toBe("Task");
  });

  it("retains Vim Normal mode and enables heading input and Enter in Insert mode", () => {
    const editor = createEditor([heading("Title", 2)], true);
    const original = editor.getJSON();
    key(editor, "Backspace");
    expect(editor.getJSON()).toEqual(original);
    expect(getVimMode(editor.view)).toBe("normal");
    key(editor, "i");
    type(editor, "### ");
    expect(block(editor).attrs.level).toBe(3);
    expect(getVimMode(editor.view)).toBe("insert");
    editor.commands.setTextSelection(6);
    key(editor, "Enter");
    expect(block(editor).type.name).toBe("paragraph");
    expect(getVimMode(editor.view)).toBe("insert");
  });

  it("retains inline math content and its cursor navigation inside headings", async () => {
    const equation = { type: "inlineMath", attrs: { latex: "x^2" } };
    const editor = createEditor([
      {
        ...heading("", 2),
        content: [
          { type: "text", text: "A " },
          equation,
          { type: "text", text: " B" },
        ],
      },
    ]);
    editor.commands.setTextSelection(3);
    key(editor, "ArrowRight");
    await Promise.resolve();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Inline equation LaTeX",
    );
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.firstChild?.child(1).attrs.latex).toBe("x^2");
  });
});

describe("heading persistence", () => {
  it("round-trips levels, inline marks and math through JSON and Markdown", () => {
    const editor = createEditor([
      heading("Research", 1),
      {
        ...heading("", 2),
        content: [
          { type: "text", text: "Assumptions", marks: [{ type: "italic" }] },
        ],
      },
      {
        ...heading("", 3),
        content: [
          { type: "text", text: "Objective " },
          { type: "inlineMath", attrs: { latex: "x^2" } },
        ],
      },
      paragraph("Body text"),
    ]);
    const json = JSON.parse(JSON.stringify(editor.getJSON()));
    expect(createEditor(json.content).getJSON()).toEqual(json);
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("# Research");
    expect(markdown).toContain("## *Assumptions*");
    expect(markdown).toContain("### Objective $x^2$");
    expect(createEditor(markdown).getJSON()).toEqual(json);
  });
});
