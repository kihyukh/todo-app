// @vitest-environment jsdom
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Attachment } from "../src/model";
import { importNoteFile } from "../src/note-file-storage";
import {
  fileDropPosition,
  insertNoteFiles,
  installNoteFileDrop,
} from "../src/note-file-drop";

vi.mock("../src/note-file-storage", () => ({ importNoteFile: vi.fn() }));

const editors: Editor[] = [];
const cleanups: Array<() => void> = [];
const file = (name = "Review.pdf") =>
  new File(["document"], name, { type: "application/pdf" });
const attachment = (value: File): Attachment => ({
  id: value.name,
  name: value.name,
  mime: value.type,
  size: value.size,
  url: `daymark://attachment/${encodeURIComponent(value.name)}`,
});
const options = () => ({ isCurrent: () => true, notice: vi.fn() });
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function createEditor(content: JSONContent[] = [paragraph("Alpha")]) {
  const host = document.createElement("section");
  host.className = "detail";
  const element = document.createElement("div");
  element.className = "task-note-editor";
  host.append(element);
  document.body.append(host);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit.configure({
        dropcursor: false,
        link: { protocols: ["daymark"], openOnClick: false, autolink: false },
      }),
    ],
    content: { type: "doc", content },
  });
  editors.push(editor);
  editor.view.focus();
  vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue(
    new DOMRect(100, 100, 400, content.length * 40),
  );
  let blockIndex = 0;
  editor.state.doc.forEach((_node, pos) => {
    const block = editor.view.nodeDOM(pos) as HTMLElement;
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 110 + blockIndex++ * 40, 400, 20),
    );
  });
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({ pos: 3, inside: 0 });
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({
    left: 140,
    right: 140,
    top: 110,
    bottom: 130,
  });
  return { editor, host };
}
const links = (editor: Editor) =>
  Array.from(editor.view.dom.querySelectorAll("a")).map((link) => ({
    name: link.textContent,
    href: link.getAttribute("href"),
  }));
function transfer(files: File[], types = ["Files"]) {
  return { files, types, dropEffect: "none", getData: vi.fn(() => "") };
}
function drag(
  target: HTMLElement,
  type: string,
  data: ReturnType<typeof transfer>,
  x = 140,
  y = 120,
  relatedTarget: Node | null = null,
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: data },
    clientX: { value: x },
    clientY: { value: y },
    relatedTarget: { value: relatedTarget },
  });
  target.dispatchEvent(event);
  return event;
}

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  vi.mocked(importNoteFile).mockReset();
  vi.mocked(importNoteFile).mockImplementation(async (value) =>
    attachment(value),
  );
});
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  editors.splice(0).forEach((editor) => {
    if (!editor.isDestroyed) editor.destroy();
  });
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("files inserted into note text", () => {
  it("inserts only a filename link at the supplied drop position instead of the current selection", async () => {
    const { editor } = createEditor();
    editor.commands.setTextSelection(6);
    await insertNoteFiles(editor, [file("Report & notes.pdf")], 3, options());

    expect(editor.getText()).toBe("AlReport & notes.pdfpha");
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
    ]);
    const content = editor.getJSON().content![0].content!;
    expect(content.map((node) => node.text)).toEqual([
      "Al",
      "Report & notes.pdf",
      "pha",
    ]);
    expect(content[1].type).toBe("text");
    expect(content[1].marks?.map((mark) => mark.type)).toEqual(["link"]);
    expect(links(editor)).toEqual([
      {
        name: "Report & notes.pdf",
        href: "daymark://attachment/Report%20%26%20notes.pdf",
      },
    ]);
    expect(editor.view.dom.querySelector("a")?.children.length).toBe(0);
    expect(
      editor.view.dom.querySelector(".attachment, img, object"),
    ).toBeNull();
  });

  it("keeps multiple filenames in drop order despite reversed storage completion, and undoes them together", async () => {
    const { editor } = createEditor();
    const first = deferred<Attachment>();
    const second = deferred<Attachment>();
    const files = [file("First.pdf"), file("Second.pdf")];
    vi.mocked(importNoteFile)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const importing = insertNoteFiles(editor, files, 3, options());
    second.resolve(attachment(files[1]));
    await Promise.resolve();
    expect(links(editor)).toEqual([]);
    first.resolve(attachment(files[0]));
    await importing;

    expect(editor.getText()).toBe("AlFirst.pdf Second.pdfpha");
    expect(links(editor).map((link) => link.name)).toEqual([
      "First.pdf",
      "Second.pdf",
    ]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Alpha");
    expect(links(editor)).toEqual([]);
  });

  it("separates later typing from the import undo and leaves the typed text unlinked", async () => {
    const { editor } = createEditor();
    await insertNoteFiles(editor, [file()], 3, options());
    editor.view.dispatch(editor.state.tr.insertText("!"));

    expect(editor.getText()).toBe("AlReview.pdf!pha");
    expect(links(editor).map((link) => link.name)).toEqual(["Review.pdf"]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("AlReview.pdfpha");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Alpha");
  });

  it("maps the drop anchor through typing before it without moving the new caret", async () => {
    const { editor } = createEditor();
    const loading = deferred<Attachment>();
    vi.mocked(importNoteFile).mockReturnValueOnce(loading.promise);
    const importing = insertNoteFiles(editor, [file()], 3, options());
    editor.commands.setTextSelection(1);
    editor.view.dispatch(editor.state.tr.insertText("prefix "));
    const caret = editor.state.selection.from;
    loading.resolve(attachment(file()));
    await importing;

    expect(editor.getText()).toBe("prefix AlReview.pdfpha");
    expect(editor.state.selection.from).toBe(caret);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("prefix Alpha");
  });

  it("preserves the order of separate drops sharing an anchor while storage is pending", async () => {
    const { editor } = createEditor();
    const first = deferred<Attachment>();
    const second = deferred<Attachment>();
    vi.mocked(importNoteFile)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const importingFirst = insertNoteFiles(
      editor,
      [file("First.pdf")],
      3,
      options(),
    );
    const importingSecond = insertNoteFiles(
      editor,
      [file("Second.pdf")],
      3,
      options(),
    );
    second.resolve(attachment(file("Second.pdf")));
    await Promise.resolve();
    expect(links(editor)).toEqual([]);
    first.resolve(attachment(file("First.pdf")));
    await Promise.all([importingFirst, importingSecond]);
    expect(links(editor).map((link) => link.name)).toEqual([
      "First.pdf",
      "Second.pdf",
    ]);
  });

  it("does not insert a completed import after selecting another task", async () => {
    const { editor } = createEditor();
    const loading = deferred<Attachment>();
    let current = true;
    vi.mocked(importNoteFile).mockReturnValueOnce(loading.promise);
    const importing = insertNoteFiles(editor, [file()], 3, {
      ...options(),
      isCurrent: () => current,
    });
    current = false;
    loading.resolve(attachment(file()));
    await importing;
    expect(editor.getText()).toBe("Alpha");
    expect(links(editor)).toEqual([]);
  });

  it("does not dispatch to an editor destroyed while a file is loading", async () => {
    const { editor } = createEditor();
    const loading = deferred<Attachment>();
    vi.mocked(importNoteFile).mockReturnValueOnce(loading.promise);
    const dispatch = vi.spyOn(editor.view, "dispatch");
    const importing = insertNoteFiles(editor, [file()], 3, options());
    editor.destroy();
    dispatch.mockClear();
    loading.resolve(attachment(file()));
    await expect(importing).resolves.toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("inserts successful files and reports failures without leaving a failed filename link", async () => {
    const { editor } = createEditor();
    const notices = options();
    vi.mocked(importNoteFile).mockRejectedValueOnce(
      new Error("File too large"),
    );
    await insertNoteFiles(
      editor,
      [file("Failed.pdf"), file("Good.pdf")],
      3,
      notices,
    );
    expect(links(editor).map((link) => link.name)).toEqual(["Good.pdf"]);
    expect(notices.notice).toHaveBeenLastCalledWith(
      "Failed.pdf: File too large",
    );
  });
});

describe("file drop caret and note boundaries", () => {
  it("fills an empty note without adding a leading blank paragraph", async () => {
    const { editor, host } = createEditor([paragraph("")]);
    let importing: Promise<void> | undefined;
    cleanups.push(
      installNoteFileDrop(editor, (files, position) => {
        importing = insertNoteFiles(editor, files, position, options());
      }),
    );
    drag(host, "dragover", transfer([]), 150, 200);
    expect(
      document.querySelector<HTMLElement>(".note-file-drop-caret")?.dataset,
    ).toMatchObject({ position: "1", mode: "inline" });
    drag(host, "drop", transfer([file()]), 150, 200);
    await importing;
    expect(editor.getJSON().content).toHaveLength(1);
    expect(editor.getText()).toBe("Review.pdf");
    expect(links(editor).map((link) => link.name)).toEqual(["Review.pdf"]);
  });

  it("shows a caret with protected drag data and inserts at the same position on drop", async () => {
    const { editor, host } = createEditor();
    editor.commands.setTextSelection(6);
    let importing: Promise<void> | undefined;
    const onDrop = vi.fn((files: File[], position: number) => {
      importing = insertNoteFiles(editor, files, position, options());
    });
    cleanups.push(installNoteFileDrop(editor, onDrop));
    const protectedData = transfer([]);
    const over = drag(host, "dragover", protectedData);
    const caret = document.querySelector<HTMLElement>(".note-file-drop-caret")!;

    expect(over.defaultPrevented).toBe(true);
    expect(protectedData.dropEffect).toBe("copy");
    expect(caret.dataset).toMatchObject({ position: "3", mode: "inline" });
    expect(caret.style.left).toBe("140px");
    expect(caret.style.width).toBe("2px");
    expect(protectedData.getData).not.toHaveBeenCalled();
    const droppedFile = file();
    const dropped = drag(host, "drop", transfer([droppedFile]));
    expect(dropped.defaultPrevented).toBe(true);
    expect(onDrop).toHaveBeenCalledWith([droppedFile], 3);
    expect(document.querySelector(".note-file-drop-caret")).toBeNull();
    await importing;
    expect(editor.getText()).toBe("AlReview.pdfpha");
  });

  it("shows a block caret below the note and appends filenames in new paragraphs", async () => {
    const { editor, host } = createEditor();
    let importing: Promise<void> | undefined;
    cleanups.push(
      installNoteFileDrop(editor, (files, position) => {
        importing = insertNoteFiles(editor, files, position, options());
      }),
    );
    drag(host, "dragover", transfer([]), 150, 200);
    const caret = document.querySelector<HTMLElement>(".note-file-drop-caret")!;
    expect(caret.dataset).toMatchObject({
      position: String(editor.state.doc.content.size),
      mode: "block",
    });
    expect(caret.style.width).toBe("400px");
    expect(caret.style.height).toBe("2px");
    drag(host, "drop", transfer([file("One.pdf"), file("Two.pdf")]), 150, 200);
    await importing;
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(
      editor
        .getJSON()
        .content?.map((node) =>
          node.content?.map((child) => child.text).join(""),
        ),
    ).toEqual(["Alpha", "One.pdf", "Two.pdf"]);
  });

  it("targets the boundary between blocks and avoids inserting links inside a code block", () => {
    const { editor } = createEditor([paragraph("Alpha"), paragraph("Beta")]);
    expect(fileDropPosition(editor.view, 140, 140)).toBe(7);
    const { editor: codeEditor } = createEditor([
      { type: "codeBlock", content: [{ type: "text", text: "Alpha" }] },
    ]);
    expect(fileDropPosition(codeEditor.view, 140, 120)).toBe(7);
  });

  it("leaves nonfile drags alone and removes its caret and handlers on cleanup", () => {
    const { editor, host } = createEditor();
    const onDrop = vi.fn();
    const cleanup = installNoteFileDrop(editor, onDrop);
    cleanups.push(cleanup);
    const textData = transfer([], ["text/plain"]);
    expect(drag(host, "dragover", textData).defaultPrevented).toBe(false);
    expect(drag(host, "drop", textData).defaultPrevented).toBe(false);
    expect(textData.dropEffect).toBe("none");
    expect(onDrop).not.toHaveBeenCalled();
    expect(document.querySelector(".note-file-drop-caret")).toBeNull();

    drag(host, "dragover", transfer([]));
    expect(document.querySelector(".note-file-drop-caret")).not.toBeNull();
    cleanup();
    expect(document.querySelector(".note-file-drop-caret")).toBeNull();
    expect(drag(host, "dragover", transfer([])).defaultPrevented).toBe(false);
    expect(drag(host, "drop", transfer([file()])).defaultPrevented).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("retains the caret while crossing descendants and clears it when leaving the detail", () => {
    const { editor, host } = createEditor();
    cleanups.push(installNoteFileDrop(editor, vi.fn()));
    drag(host, "dragover", transfer([]));
    drag(host, "dragleave", transfer([]), 140, 120, editor.view.dom);
    expect(document.querySelector(".note-file-drop-caret")).not.toBeNull();
    drag(host, "dragleave", transfer([]), 140, 120, document.body);
    expect(document.querySelector(".note-file-drop-caret")).toBeNull();
  });
});
