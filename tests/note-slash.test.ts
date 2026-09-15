// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { NodeSelection } from "@tiptap/pm/state";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NaturalInlineMath, NaturalBlockMath } from "../src/math-editor";
import { VimEditor, getVimMode } from "../src/vim-editor";
import { NoteSlash, dismissNoteSlash, noteSlashKey } from "../src/note-slash";

const editors: Editor[] = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  for (const editor of editors.splice(0))
    if (!editor.isDestroyed) editor.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
const paragraph = (text = ""): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
function create(content: JSONContent[] = [paragraph()], vim = false) {
  const onChange = vi.fn(),
    onKeyDown = vi.fn(() => true);
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      NaturalInlineMath,
      NaturalBlockMath,
      VimEditor.configure({ enabled: vim }),
      NoteSlash.configure({ onChange, onKeyDown }),
    ],
    content: { type: "doc", content },
  });
  editors.push(editor);
  editor.view.focus();
  return { editor, onChange, onKeyDown };
}
function caret(editor: Editor, text: string, offset = text.length) {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (position === undefined && node.isTextblock && node.textContent === text)
      position = pos + 1 + offset;
  });
  if (position === undefined)
    throw new Error(`Missing synthetic textblock ${text}`);
  editor.commands.setTextSelection(position);
}
// Emulate ProseMirror's actual typing hook; programmatic insertContent must not
// itself trigger suggestions, even when the inserted text happens to be '/'.
function type(editor: Editor, text: string) {
  const { from, to } = editor.state.selection;
  const handled = editor.view.someProp("handleTextInput", (handler) =>
    handler(editor.view, from, to, text, () =>
      editor.state.tr.insertText(text, from, to),
    ),
  );
  if (!handled)
    editor.view.dispatch(editor.state.tr.insertText(text, from, to));
  return !!handled;
}
function key(editor: Editor, value: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  editor.view.dom.dispatchEvent(event);
  return event.defaultPrevented;
}
const active = (editor: Editor) => noteSlashKey.getState(editor.state);

describe("typed note slash commands", () => {
  it.each([
    ["paragraph", [paragraph()]],
    ["leading whitespace", [paragraph(" \t")]],
    ["heading", [{ type: "heading", attrs: { level: 2 } }]],
    ["quote paragraph", [{ type: "blockquote", content: [paragraph()] }]],
    [
      "bullet paragraph",
      [
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [paragraph()] }],
        },
      ],
    ],
    [
      "nested checkbox paragraph",
      [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                paragraph("Parent"),
                {
                  type: "taskList",
                  content: [
                    {
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [paragraph()],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    ],
  ] as [string, JSONContent[]][])(
    "starts in a %s and retains literal query text",
    (_name, content) => {
      const { editor, onChange } = create(content);
      const initialText = _name === "leading whitespace" ? " \t" : "";
      caret(editor, initialText);
      const from = editor.state.selection.from;
      expect(type(editor, "/")).toBe(true);
      expect(active(editor)).toEqual({ from, to: from + 1, query: "" });
      type(editor, "bullet list");
      expect(active(editor)).toEqual({
        from,
        to: from + 12,
        query: "bullet list",
      });
      expect(editor.state.selection.$from.parent.textContent).toBe(
        `${initialText}/bullet list`,
      );
      expect(onChange).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    ["middle of text", [paragraph("text")], "text", 4],
    ["code block", [{ type: "codeBlock", content: [] }], "", 0],
    [
      "inline code",
      [
        {
          type: "paragraph",
          content: [{ type: "text", text: " ", marks: [{ type: "code" }] }],
        },
      ],
      " ",
      1,
    ],
    [
      "link",
      [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: " ",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
      ],
      " ",
      0,
    ],
    [
      "after inline math",
      [
        {
          type: "paragraph",
          content: [{ type: "inlineMath", attrs: { latex: "x" } }],
        },
      ],
      "",
      1,
    ],
  ] as [string, JSONContent[], string, number][])(
    "does not trigger in %s",
    (_name, content, text, offset) => {
      const { editor, onChange } = create(content);
      caret(editor, text, offset);
      expect(type(editor, "/")).toBe(false);
      expect(active(editor)).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("does not replace a selected range or enter a selected equation", () => {
    const { editor } = create([
      paragraph("replace"),
      { type: "blockMath", attrs: { latex: "x=y" } },
    ]);
    editor.commands.setTextSelection({ from: 1, to: 8 });
    expect(type(editor, "/")).toBe(false);
    expect(active(editor)).toBeNull();
    let math = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "blockMath") math = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, math),
      ),
    );
    const slash = editor.view.someProp("handleTextInput", (handler) =>
      handler(editor.view, math, math + 1, "/", () => editor.state.tr),
    );
    expect(slash).toBeFalsy();
    expect(active(editor)).toBeNull();
  });

  it("never opens for existing content, paste, programmatic edits, sync, or clicking back", () => {
    const { editor, onChange } = create([paragraph("/heading")]);
    caret(editor, "/heading");
    expect(active(editor)).toBeNull();
    editor.commands.setContent({ type: "doc", content: [paragraph()] });
    editor.view.pasteText("/bullet list", new Event("paste") as ClipboardEvent);
    expect(active(editor)).toBeNull();
    editor.commands.setContent({ type: "doc", content: [paragraph()] });
    editor.commands.insertContent("/heading");
    expect(active(editor)).toBeNull();
    editor.commands.setContent({ type: "doc", content: [paragraph("/table")] });
    caret(editor, "/table");
    expect(active(editor)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a single active range mapped through edits before it, without serializing the document", () => {
    const { editor, onChange } = create([paragraph("Above"), paragraph()]);
    const json = vi.spyOn(editor, "getJSON");
    caret(editor, "");
    type(editor, "/");
    type(editor, "heading");
    const before = active(editor)!;
    const added = editor.schema.nodes.paragraph.create(
      null,
      editor.schema.text("Added before"),
    );
    editor.view.dispatch(editor.state.tr.insert(0, added));
    expect(active(editor)).toEqual({
      from: before.from + added.nodeSize,
      to: before.to + added.nodeSize,
      query: "heading",
    });
    const current = active(editor);
    editor.view.dispatch(editor.state.tr.setMeta("unrelated", true));
    editor.commands.setTextSelection(current!.to);
    expect(active(editor)).toBe(current);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(json).not.toHaveBeenCalled();
  });

  it.each(["/", "\n", "\t", "  ", "a".repeat(41)])(
    "closes for a disallowed query extension %j",
    (query) => {
      const { editor } = create();
      type(editor, "/");
      type(editor, query);
      expect(active(editor)).toBeNull();
      expect(editor.state.doc.textContent).toBe(`/${query}`);
    },
  );

  it("allows a 40-character query and updates when its end is deleted", () => {
    const { editor } = create();
    type(editor, "/");
    type(editor, "a".repeat(40));
    expect(active(editor)?.query).toHaveLength(40);
    const end = editor.state.selection.from;
    editor.view.dispatch(editor.state.tr.delete(end - 1, end));
    expect(active(editor)?.query).toHaveLength(39);
    editor.view.dispatch(
      editor.state.tr.delete(active(editor)!.from, editor.state.selection.from),
    );
    expect(active(editor)).toBeNull();
  });

  it("dismisses when the cursor enters the query and stays closed when the cursor returns", () => {
    const { editor, onChange } = create();
    type(editor, "/");
    type(editor, "heading");
    const end = active(editor)!.to;
    editor.commands.setTextSelection(end - 1);
    expect(active(editor)).toBeNull();
    editor.commands.setTextSelection(end);
    type(editor, "2");
    expect(active(editor)).toBeNull();
    expect(editor.state.doc.textContent).toBe("/heading2");
    expect(onChange).toHaveBeenLastCalledWith(null, editor.view);
  });

  it("dismisses on Escape or blur, preserving text and avoiding duplicate callbacks", () => {
    const { editor, onChange } = create();
    type(editor, "/");
    type(editor, "quote");
    expect(key(editor, "Escape")).toBe(true);
    expect(active(editor)).toBeNull();
    expect(editor.state.doc.textContent).toBe("/quote");
    dismissNoteSlash(editor.view);
    expect(onChange).toHaveBeenCalledTimes(3);
    editor.commands.setContent({ type: "doc", content: [paragraph()] });
    type(editor, "/");
    editor.view.dom.blur();
    expect(active(editor)).toBeNull();
    expect(editor.state.doc.textContent).toBe("/");
  });

  it("does not open in Vim Normal/Visual and consumes Escape before Vim Insert exits", () => {
    const { editor } = create([paragraph("word")], true);
    expect(getVimMode(editor.view)).toBe("normal");
    type(editor, "/");
    expect(active(editor)).toBeNull();
    expect(editor.state.doc.textContent).toBe("word");
    key(editor, "v");
    expect(getVimMode(editor.view)).toBe("visual");
    type(editor, "/");
    expect(active(editor)).toBeNull();
    key(editor, "Escape");
    key(editor, "i");
    type(editor, "/");
    expect(active(editor)?.query).toBe("");
    expect(key(editor, "Escape")).toBe(true);
    expect(getVimMode(editor.view)).toBe("insert");
    expect(editor.state.doc.textContent).toBe("/word");
    expect(key(editor, "Escape")).toBe(true);
    expect(getVimMode(editor.view)).toBe("normal");
  });

  it("delegates navigation and choice only while active and leaves IME composition alone", () => {
    const { editor, onKeyDown } = create();
    key(editor, "ArrowDown");
    expect(onKeyDown).not.toHaveBeenCalled();
    type(editor, "/");
    for (const name of ["ArrowDown", "ArrowUp", "Enter", "Tab"])
      expect(key(editor, name)).toBe(true);
    expect(onKeyDown).toHaveBeenCalledTimes(4);
    onKeyDown.mockClear();
    for (const name of ["ArrowDown", "Enter", "Tab", "Escape"]) {
      const handled = noteSlashKey
        .get(editor.state)!
        .props.handleKeyDown!.call(
          noteSlashKey.get(editor.state)!,
          editor.view,
          new KeyboardEvent("keydown", { key: name, isComposing: true }),
        );
      expect(handled).toBe(false);
    }
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(active(editor)?.query).toBe("");
    Object.defineProperty(editor.view, "composing", {
      configurable: true,
      value: true,
    });
    expect(key(editor, "Enter")).toBe(false);
    expect(onKeyDown).not.toHaveBeenCalled();
    Object.defineProperty(editor.view, "composing", {
      configurable: true,
      value: false,
    });
  });

  it("does not reopen after undo/redo and clears active state when synced content replaces the note", () => {
    const { editor } = create();
    type(editor, "/");
    type(editor, "heading");
    editor.commands.undo();
    expect(active(editor)).toBeNull();
    editor.commands.redo();
    expect(editor.state.doc.textContent).toBe("/heading");
    expect(active(editor)).toBeNull();
    editor.commands.setContent({ type: "doc", content: [paragraph()] });
    type(editor, "/");
    editor.commands.setContent({
      type: "doc",
      content: [paragraph("/remote")],
    });
    caret(editor, "/remote");
    expect(active(editor)).toBeNull();
  });

  it("clears the active callback on editor destruction and never carries state to a new task", () => {
    const { editor, onChange } = create();
    type(editor, "/");
    const destroyedView = editor.view;
    editor.destroy();
    expect(onChange).toHaveBeenLastCalledWith(null, destroyedView);
    const second = create([paragraph("/heading")]);
    caret(second.editor, "/heading");
    expect(active(second.editor)).toBeNull();
    expect(second.onChange).not.toHaveBeenCalled();
  });
});
