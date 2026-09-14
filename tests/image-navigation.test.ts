// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { NoteInteractions } from "../src/note-interactions";
import { VimEditor, getVimMode } from "../src/vim-editor";
import { NaturalBlockMath, NaturalInlineMath } from "../src/math-editor";
import {
  continueFromImage,
  deleteSelectedImage,
  selectImageAt,
} from "../src/image-navigation";

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
const picture = (name = "sample"): JSONContent => ({
  type: "image",
  attrs: { src: `https://example.com/${name}.png`, alt: name },
});
function createEditor(content: JSONContent[], vim = false) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      Image,
      NoteInteractions,
      NaturalBlockMath,
      NaturalInlineMath,
      VimEditor.configure({ enabled: vim }),
    ],
    content: { type: "doc", content },
  });
  editors.push(editor);
  editor.view.focus();
  return editor;
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
function caret(editor: Editor, text: string, offset = 0) {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (position === undefined && node.isTextblock && node.textContent === text)
      position = pos + 1 + offset;
  });
  if (position === undefined) throw new Error(`Missing paragraph: ${text}`);
  editor.commands.setTextSelection(position);
}
function imagePosition(editor: Editor, name = "sample") {
  let position: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "image" && node.attrs.alt === name) position = pos;
  });
  if (position === undefined) throw new Error(`Missing image: ${name}`);
  return position;
}
function selectedImage(editor: Editor) {
  return (
    editor.state.selection instanceof NodeSelection &&
    editor.state.selection.node.type.name === "image"
  );
}
function imageCount(editor: Editor) {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") count++;
  });
  return count;
}

describe("image cursor and deletion", () => {
  it("selects an image on either horizontal boundary and continues into adjacent prose", () => {
    const editor = createEditor([
      paragraph("before"),
      picture(),
      paragraph("after"),
    ]);
    caret(editor, "before", 6);
    expect(key(editor, "ArrowRight")).toBe(true);
    expect(selectedImage(editor)).toBe(true);
    key(editor, "ArrowRight");
    expect(editor.state.selection.$from.parent.textContent).toBe("after");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    key(editor, "ArrowLeft");
    expect(selectedImage(editor)).toBe(true);
    key(editor, "ArrowLeft");
    expect(editor.state.selection.$from.parent.textContent).toBe("before");
    expect(editor.state.selection.$from.parentOffset).toBe(6);
  });

  it("uses visual textblock boundaries for vertical arrows", () => {
    const editor = createEditor([
      paragraph("wrapped above"),
      picture(),
      paragraph("below"),
    ]);
    caret(editor, "wrapped above", 4);
    const boundary = vi
      .spyOn(editor.view, "endOfTextblock")
      .mockReturnValue(false);
    key(editor, "ArrowDown");
    expect(selectedImage(editor)).toBe(false);
    boundary.mockReturnValue(true);
    key(editor, "ArrowDown");
    expect(selectedImage(editor)).toBe(true);
    key(editor, "ArrowDown");
    expect(editor.state.selection.$from.parent.textContent).toBe("below");
    key(editor, "ArrowUp");
    expect(selectedImage(editor)).toBe(true);
  });

  it.each(["Backspace", "Delete"])(
    "selects before deleting at a text boundary with %s, and supports undo",
    (command) => {
      const editor = createEditor([
        paragraph("before"),
        picture(),
        paragraph("after"),
      ]);
      const original = editor.getJSON();
      caret(
        editor,
        command === "Backspace" ? "after" : "before",
        command === "Backspace" ? 0 : 6,
      );
      expect(key(editor, command)).toBe(true);
      expect(selectedImage(editor)).toBe(true);
      expect(imageCount(editor)).toBe(1);
      expect(key(editor, command)).toBe(true);
      expect(imageCount(editor)).toBe(0);
      expect(editor.state.doc.textContent).toBe("beforeafter");
      expect(editor.state.selection instanceof TextSelection).toBe(true);
      editor.commands.undo();
      expect(editor.getJSON()).toEqual(original);
    },
  );

  it("does not turn modified/range keys or interior text deletion into image selection", () => {
    const editor = createEditor([
      paragraph("before"),
      picture(),
      paragraph("after"),
    ]);
    caret(editor, "before", 3);
    key(editor, "ArrowRight");
    expect(selectedImage(editor)).toBe(false);
    caret(editor, "after");
    key(editor, "ArrowLeft", { shiftKey: true });
    expect(selectedImage(editor)).toBe(false);
    expect(imageCount(editor)).toBe(1);
  });

  it("Enter creates a writing line below an image without changing the following text", () => {
    const editor = createEditor([
      paragraph("before"),
      picture(),
      paragraph("after"),
    ]);
    selectImageAt(editor.view, imagePosition(editor));
    key(editor, "Enter");
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
      "image",
      "paragraph",
      "paragraph",
    ]);
    expect(editor.state.selection.$from.parent.textContent).toBe("");
    expect(editor.state.doc.textContent).toBe("beforeafter");
    key(editor, "Backspace");
    expect(selectedImage(editor)).toBe(true);
    expect(imageCount(editor)).toBe(1);
  });

  it("reuses an empty writing line and can continue above an image at the document edge", () => {
    const editor = createEditor([picture(), paragraph()]);
    selectImageAt(editor.view, imagePosition(editor));
    key(editor, "Enter");
    expect(editor.state.doc.childCount).toBe(2);
    selectImageAt(editor.view, imagePosition(editor));
    key(editor, "ArrowLeft");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
  });

  it("deleting the only image leaves a usable empty note and restores with undo", () => {
    const editor = createEditor([picture()]);
    selectImageAt(editor.view, imagePosition(editor));
    expect(deleteSelectedImage(editor.view)).toBe(true);
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.selection instanceof TextSelection).toBe(true);
    editor.commands.undo();
    expect(imageCount(editor)).toBe(1);
  });

  it("visits consecutive images separately", () => {
    const editor = createEditor([
      paragraph("before"),
      picture("one"),
      picture("two"),
      paragraph("after"),
    ]);
    caret(editor, "before", 6);
    key(editor, "ArrowRight");
    expect(editor.state.selection.from).toBe(imagePosition(editor, "one"));
    key(editor, "ArrowRight");
    expect(editor.state.selection.from).toBe(imagePosition(editor, "two"));
    key(editor, "ArrowRight");
    expect(editor.state.selection.$from.parent.textContent).toBe("after");
  });

  it("typing while an image is selected continues below without replacing it", () => {
    const editor = createEditor([picture(), paragraph("after")]);
    selectImageAt(editor.view, imagePosition(editor));
    const { from, to } = editor.state.selection;
    let handled = false;
    editor.view.someProp("handleTextInput", (handler) => {
      handled = handler(editor.view, from, to, "hello ", () =>
        editor.state.tr.insertText("hello "),
      );
      return handled;
    });
    expect(handled).toBe(true);
    expect(imageCount(editor)).toBe(1);
    expect(editor.state.doc.textContent).toBe("hello after");
  });

  it("typing after selecting from an empty paragraph reuses that paragraph", () => {
    const editor = createEditor([picture(), paragraph()]);
    caret(editor, "");
    key(editor, "Backspace");
    expect(selectedImage(editor)).toBe(true);
    editor.view.someProp("handleTextInput", (handler) =>
      handler(
        editor.view,
        editor.state.selection.from,
        editor.state.selection.to,
        "new note",
        () => editor.state.tr.insertText("new note"),
      ),
    );
    expect(imageCount(editor)).toBe(1);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.lastChild?.textContent).toBe("new note");
    expect(editor.state.selection instanceof TextSelection).toBe(true);
  });

  it("continues beside an image nested in a quote without escaping its structure", () => {
    const editor = createEditor([
      { type: "blockquote", content: [picture(), paragraph("after")] },
    ]);
    selectImageAt(editor.view, imagePosition(editor));
    expect(continueFromImage(editor.view, -1)).toBe(true);
    expect(editor.state.selection.$from.node(1).type.name).toBe("blockquote");
    expect(imageCount(editor)).toBe(1);
  });
});

describe("Vim images", () => {
  it("h/l and j/k visit images without changing Normal mode", () => {
    const editor = createEditor(
      [paragraph("before"), picture(), paragraph("after")],
      true,
    );
    caret(editor, "before", 5);
    key(editor, "l");
    expect(selectedImage(editor)).toBe(true);
    expect(getVimMode(editor.view)).toBe("normal");
    key(editor, "l");
    expect(editor.state.selection.$from.parent.textContent).toBe("after");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    key(editor, "h");
    expect(selectedImage(editor)).toBe(true);
    key(editor, "h");
    expect(editor.state.selection.$from.parent.textContent).toBe("before");
    expect(editor.state.selection.$from.parentOffset).toBe(5);
    caret(editor, "before", 2);
    key(editor, "j");
    expect(selectedImage(editor)).toBe(true);
    key(editor, "j");
    expect(editor.state.selection.$from.parent.textContent).toBe("after");
    key(editor, "k");
    expect(selectedImage(editor)).toBe(true);
    expect(getVimMode(editor.view)).toBe("normal");
  });

  it.each(["x", "dd"])(
    "%s deletes selected image into the register and p restores a copy",
    (command) => {
      const editor = createEditor(
        [paragraph("before"), picture(), paragraph("after")],
        true,
      );
      selectImageAt(editor.view, imagePosition(editor));
      for (const letter of command) key(editor, letter);
      expect(imageCount(editor)).toBe(0);
      expect(getVimMode(editor.view)).toBe("normal");
      key(editor, "p");
      expect(imageCount(editor)).toBe(1);
      expect(editor.state.doc.textContent).toBe("beforeafter");
      key(editor, "u");
      expect(imageCount(editor)).toBe(0);
      key(editor, "u");
      expect(imageCount(editor)).toBe(1);
    },
  );

  it("yy yanks the selected image and P/p paste adjacent images", () => {
    const editor = createEditor(
      [paragraph("before"), picture(), paragraph("after")],
      true,
    );
    selectImageAt(editor.view, imagePosition(editor));
    key(editor, "y");
    key(editor, "y");
    expect(selectedImage(editor)).toBe(true);
    expect(imageCount(editor)).toBe(1);
    key(editor, "P");
    expect(selectedImage(editor)).toBe(true);
    expect(imageCount(editor)).toBe(2);
    key(editor, "p");
    expect(imageCount(editor)).toBe(3);
    expect(editor.state.doc.textContent).toBe("beforeafter");
  });

  it.each(["i", "a", "o", "O"])(
    "%s enters Insert beside the image and keeps the image",
    (command) => {
      const editor = createEditor(
        [paragraph("before"), picture(), paragraph("after")],
        true,
      );
      selectImageAt(editor.view, imagePosition(editor));
      key(editor, command);
      expect(getVimMode(editor.view)).toBe("insert");
      expect(editor.state.selection instanceof TextSelection).toBe(true);
      expect(editor.state.selection.$from.parent.textContent).toBe(
        command === "i" ? "before" : command === "a" ? "after" : "",
      );
      expect(imageCount(editor)).toBe(1);
      key(editor, "Escape");
      expect(getVimMode(editor.view)).toBe("normal");
      expect(imageCount(editor)).toBe(1);
    },
  );

  it("unknown commands and Escape keep an image selected, including an image-only note", () => {
    const editor = createEditor([picture()], true);
    selectImageAt(editor.view, imagePosition(editor));
    key(editor, "z");
    key(editor, "Escape");
    expect(selectedImage(editor)).toBe(true);
    expect(imageCount(editor)).toBe(1);
    key(editor, "x");
    expect(imageCount(editor)).toBe(0);
    expect(getVimMode(editor.view)).toBe("normal");
  });

  it("encounters math before a later image during a counted motion", () => {
    const editor = createEditor(
      [
        paragraph("before"),
        { type: "blockMath", attrs: { latex: "x+y" } },
        paragraph("middle"),
        picture(),
        paragraph("after"),
      ],
      true,
    );
    caret(editor, "before");
    key(editor, "2");
    key(editor, "j");
    expect(editor.state.selection instanceof NodeSelection).toBe(true);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe(
      "blockMath",
    );
    expect(getVimMode(editor.view)).toBe("normal");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Display equation LaTeX",
    );
  });
});
