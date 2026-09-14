// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { NodeSelection } from "@tiptap/pm/state";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  clipboardImages,
  ImageImports,
  insertImageFiles,
  isImageFile,
} from "../src/image-imports";

class ControlledReader {
  static pending: ControlledReader[] = [];
  result: string | null = null;
  file!: File;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  readAsDataURL(file: File) {
    this.file = file;
    ControlledReader.pending.push(this);
  }
  succeed() {
    this.result = `data:image/png;base64,${btoa(this.file.name)}`;
    this.onload?.();
  }
  fail() {
    this.onerror?.();
  }
}

const editors: Editor[] = [];
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const image = (name: string) =>
  new File(["image bytes"], name, { type: "image/png" });
function createEditor(...text: string[]) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      ImageImports,
      Image.configure({ allowBase64: true }),
    ],
    content: { type: "doc", content: text.map(paragraph) },
  });
  editors.push(editor);
  editor.view.focus();
  return editor;
}
const imageNames = (editor: Editor) => {
  const names: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image") names.push(node.attrs.alt);
  });
  return names;
};
const options = () => ({ isCurrent: () => true, notice: vi.fn() });
const markerCount = (editor: Editor) =>
  editor.view.dom.querySelectorAll(".note-image-loading").length;

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  ControlledReader.pending = [];
  vi.stubGlobal("FileReader", ControlledReader);
});
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    if (!editor.isDestroyed) editor.destroy();
  });
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("asynchronous note image imports", () => {
  it("anchors a paste before text typed while the image loads without stealing the new caret", async () => {
    const editor = createEditor("abcdef");
    editor.commands.setTextSelection(4);
    const importing = insertImageFiles(
      editor,
      [image("pasted.png")],
      options(),
    );
    expect(markerCount(editor)).toBe(1);
    expect(
      editor.getJSON().content?.some((node) => node.type === "image"),
    ).toBe(false);
    editor.view.dispatch(editor.state.tr.insertText("typed"));
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.textContent).toBe("abctypeddef");
    expect(
      editor
        .getJSON()
        .content?.slice(0, 3)
        .map((node) => node.type),
    ).toEqual(["paragraph", "image", "paragraph"]);
    expect(editor.state.doc.child(0).textContent).toBe("abc");
    expect(editor.state.selection.$head.parent.textContent).toBe("typeddef");
    expect(editor.state.selection.$head.parentOffset).toBe(5);
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(markerCount(editor)).toBe(0);
  });

  it("keeps an explicit drop position independent of subsequent caret movement", async () => {
    const editor = createEditor("Alpha", "Beta");
    const importing = insertImageFiles(editor, [image("dropped.png")], {
      ...options(),
      position: 3,
    });
    editor.commands.setTextSelection(10);
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.child(0).textContent).toBe("Al");
    expect(editor.state.doc.child(1).type.name).toBe("image");
    expect(editor.state.selection.$head.parent.textContent).toBe("Beta");
    expect(editor.state.selection.$head.parentOffset).toBe(2);
    expect(imageNames(editor)).toEqual(["dropped.png"]);
  });

  it("maps the paste location through edits made before it", async () => {
    const editor = createEditor("target");
    editor.commands.setTextSelection(4);
    const importing = insertImageFiles(
      editor,
      [image("anchored.png")],
      options(),
    );
    editor.view.dispatch(editor.state.tr.insertText("prefix ", 1));
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.child(0).textContent).toBe("prefix tar");
    expect(editor.state.doc.child(1).type.name).toBe("image");
    expect(editor.state.doc.child(2).textContent).toBe("get");
    expect(imageNames(editor)).toEqual(["anchored.png"]);
  });

  it("replaces the original selected text and selects the image when the user has not moved", async () => {
    const editor = createEditor("abcdef");
    editor.commands.setTextSelection({ from: 2, to: 5 });
    const importing = insertImageFiles(
      editor,
      [image("replacement.png")],
      options(),
    );
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.textContent).toBe("aef");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.attrs.alt).toBe(
      "replacement.png",
    );
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("abcdef");
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(5);
    expect(imageNames(editor)).toEqual([]);
  });

  it("preserves replacement typing if selected text changes before the image finishes", async () => {
    const editor = createEditor("abcdef");
    editor.commands.setTextSelection({ from: 2, to: 5 });
    const importing = insertImageFiles(editor, [image("safe.png")], options());
    editor.view.dispatch(editor.state.tr.insertText("NEW"));
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.textContent).toBe("aNEWef");
    expect(imageNames(editor)).toEqual(["safe.png"]);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("aNEWef");
    expect(imageNames(editor)).toEqual([]);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("abcdef");
  });

  it("preserves edits inside a selected range rather than deleting them on arrival", async () => {
    const editor = createEditor("abcdef");
    editor.commands.setTextSelection({ from: 2, to: 5 });
    const importing = insertImageFiles(
      editor,
      [image("safe-selection.png")],
      options(),
    );
    editor.view.dispatch(editor.state.tr.insertText("NEW", 3));
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.textContent).toBe("abNEWcdef");
    expect(imageNames(editor)).toEqual(["safe-selection.png"]);
  });

  it("cancels an old task import and removes its loading marker after task switching", async () => {
    const editor = createEditor("Original task");
    let current = true;
    const config = { isCurrent: () => current, notice: vi.fn() };
    const importing = insertImageFiles(editor, [image("old-task.png")], config);
    current = false;
    ControlledReader.pending[0].succeed();
    await importing;
    expect(editor.state.doc.textContent).toBe("Original task");
    expect(imageNames(editor)).toEqual([]);
    expect(markerCount(editor)).toBe(0);
    expect(config.notice).toHaveBeenCalledExactlyOnceWith("");
  });

  it("finishes harmlessly if the task editor is destroyed during a read", async () => {
    const editor = createEditor("Original task");
    const importing = insertImageFiles(
      editor,
      [image("destroyed.png")],
      options(),
    );
    editor.destroy();
    ControlledReader.pending[0].succeed();
    await expect(importing).resolves.toBeUndefined();
  });

  it("preserves the file order when reads finish out of order and selects the final image", async () => {
    const editor = createEditor("");
    const importing = insertImageFiles(
      editor,
      [image("first.png"), image("second.png"), image("third.png")],
      options(),
    );
    ControlledReader.pending[2].succeed();
    ControlledReader.pending[0].succeed();
    await Promise.resolve();
    expect(imageNames(editor)).toEqual([]);
    ControlledReader.pending[1].succeed();
    await importing;
    expect(imageNames(editor)).toEqual([
      "first.png",
      "second.png",
      "third.png",
    ]);
    expect((editor.state.selection as NodeSelection).node.attrs.alt).toBe(
      "third.png",
    );
    expect(markerCount(editor)).toBe(0);
  });

  it.each(["first", "second"])(
    "keeps overlapping pastes in invocation order when the %s read finishes first",
    async (resolvedFirst) => {
      const editor = createEditor("after");
      const first = insertImageFiles(editor, [image("first.png")], options());
      const second = insertImageFiles(editor, [image("second.png")], options());
      if (resolvedFirst === "second") {
        ControlledReader.pending[1].succeed();
        await Promise.resolve();
        await Promise.resolve();
        expect(imageNames(editor)).toEqual([]);
        ControlledReader.pending[0].succeed();
        await Promise.all([first, second]);
      } else {
        ControlledReader.pending[0].succeed();
        await first;
        ControlledReader.pending[1].succeed();
        await second;
      }
      expect(imageNames(editor)).toEqual(["first.png", "second.png"]);
      expect(editor.state.doc.textContent).toBe("after");
      expect(markerCount(editor)).toBe(0);
    },
  );

  it("keeps queued drops at their separate mapped locations", async () => {
    const editor = createEditor("Alpha", "Beta");
    const first = insertImageFiles(editor, [image("alpha.png")], {
      ...options(),
      position: 3,
    });
    const second = insertImageFiles(editor, [image("beta.png")], {
      ...options(),
      position: 10,
    });
    ControlledReader.pending[1].succeed();
    await Promise.resolve();
    expect(imageNames(editor)).toEqual([]);
    ControlledReader.pending[0].succeed();
    await Promise.all([first, second]);
    expect(
      editor
        .getJSON()
        .content?.map((node) =>
          node.type === "image"
            ? node.attrs?.alt
            : node.content?.map((child) => child.text ?? "").join(""),
        ),
    ).toEqual(["Al", "alpha.png", "pha", "Be", "beta.png", "ta"]);
    expect(markerCount(editor)).toBe(0);
  });

  it("reports failed files while still inserting successful files in order", async () => {
    const editor = createEditor("after");
    const config = options();
    const importing = insertImageFiles(
      editor,
      [image("first.png"), image("bad.png"), image("last.png")],
      config,
    );
    ControlledReader.pending[0].succeed();
    ControlledReader.pending[1].fail();
    ControlledReader.pending[2].succeed();
    await importing;
    expect(imageNames(editor)).toEqual(["first.png", "last.png"]);
    expect(config.notice).toHaveBeenLastCalledWith(
      "Some images could not be added. Please try those files again.",
    );
    expect(markerCount(editor)).toBe(0);
  });

  it("keeps selected text and undo history unchanged when every file fails", async () => {
    const editor = createEditor("unchanged");
    editor.commands.setTextSelection({ from: 1, to: 4 });
    const before = editor.getJSON();
    const config = options();
    const importing = insertImageFiles(editor, [image("bad.png")], config);
    ControlledReader.pending[0].fail();
    await importing;
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(4);
    expect(editor.can().undo()).toBe(false);
    expect(config.notice).toHaveBeenLastCalledWith(
      "This image could not be added. Please try another image.",
    );
    expect(markerCount(editor)).toBe(0);
  });

  it("keeps typing after import in a separate undo step from the image insertion", async () => {
    const editor = createEditor("after");
    const importing = insertImageFiles(
      editor,
      [image("separate.png")],
      options(),
    );
    ControlledReader.pending[0].succeed();
    await importing;
    editor.commands.setTextSelection(2);
    editor.view.dispatch(editor.state.tr.insertText("typed "));
    expect(editor.state.doc.textContent).toBe("typed after");
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("after");
    expect(imageNames(editor)).toEqual(["separate.png"]);
    editor.commands.undo();
    expect(editor.state.doc.textContent).toBe("after");
    expect(imageNames(editor)).toEqual([]);
  });

  it("cleans up a cancelled file read without changing the note", async () => {
    const editor = createEditor("unchanged");
    const importing = insertImageFiles(
      editor,
      [image("cancelled.png")],
      options(),
    );
    ControlledReader.pending[0].onabort?.();
    await importing;
    expect(editor.state.doc.textContent).toBe("unchanged");
    expect(imageNames(editor)).toEqual([]);
    expect(markerCount(editor)).toBe(0);
  });

  it("skips oversized images and unrelated files without reading them", async () => {
    const editor = createEditor("note");
    const large = image("large.png");
    Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 });
    const config = options();
    const importing = insertImageFiles(
      editor,
      [
        large,
        new File(["pdf"], "paper.pdf", { type: "application/pdf" }),
        image("small.png"),
      ],
      config,
    );
    expect(ControlledReader.pending.map((reader) => reader.file.name)).toEqual([
      "small.png",
    ]);
    ControlledReader.pending[0].succeed();
    await importing;
    expect(imageNames(editor)).toEqual(["small.png"]);
    expect(config.notice).toHaveBeenLastCalledWith(
      "Each image can be up to 10 MB. Larger files can be added as attachments.",
    );
  });
});

describe("clipboard image recognition", () => {
  it("recognizes image MIME types and extension fallbacks without misclassifying known non-images", () => {
    expect(isImageFile(image("photo.png"))).toBe(true);
    expect(isImageFile(new File(["png"], "PHOTO.PNG"))).toBe(true);
    expect(isImageFile(new File(["heic"], "photo.heic"))).toBe(true);
    expect(
      isImageFile(new File(["text"], "photo.png", { type: "text/plain" })),
    ).toBe(false);
    expect(isImageFile(new File(["pdf"], "paper.pdf"))).toBe(false);
  });

  it("uses clipboard file items when the files list is empty", () => {
    const pasted = image("clipboard.png");
    const data = {
      files: [],
      items: [
        { kind: "string", getAsFile: () => null },
        { kind: "file", getAsFile: () => pasted },
      ],
      getData: () => "",
    } as unknown as DataTransfer;
    expect(clipboardImages(data)).toEqual([pasted]);
    expect(clipboardImages(null)).toEqual([]);
  });

  it("leaves copied editor slices intact so existing image size and crop metadata survive paste", () => {
    const data = {
      files: [image("copied.png")],
      items: [],
      getData: () =>
        '<div data-pm-slice="0 0 []"><img width="320" data-crop="square"></div>',
    } as unknown as DataTransfer;
    expect(clipboardImages(data)).toEqual([]);
  });
});
