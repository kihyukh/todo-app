// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { NoteImage } from "../src/image-editor";

const editors: Editor[] = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
  window.scrollBy = () => {};
});
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  document.body.replaceChildren();
});
const paragraph = (text = ""): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const picture = (attrs: Record<string, unknown> = {}): JSONContent => ({
  type: "image",
  attrs: {
    src: "data:image/png;base64,AAAA",
    alt: "Research diagram",
    ...attrs,
  },
});
function createEditor(
  content = [paragraph("Before"), picture(), paragraph("After")],
) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      StarterKit,
      NoteImage.configure({ allowBase64: true }),
      Markdown,
    ],
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}
const wrapper = (editor: Editor) =>
  editor.view.dom.querySelector<HTMLElement>(".note-image")!;
const imageAttrs = (editor: Editor) =>
  editor.getJSON().content?.find((node) => node.type === "image")?.attrs;
const control = (editor: Editor, label: string) =>
  wrapper(editor).querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
const click = (element: HTMLElement) =>
  element.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
const key = (
  element: HTMLElement,
  key: string,
  options: KeyboardEventInit = {},
) =>
  element.dispatchEvent(
    new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
const select = (editor: Editor) =>
  click(wrapper(editor).querySelector<HTMLElement>(".note-image-frame")!);
function geometry(editor: Editor) {
  wrapper(editor).getBoundingClientRect = () => new DOMRect(0, 0, 400, 240);
  wrapper(editor).querySelector<HTMLElement>(
    ".note-image-frame",
  )!.getBoundingClientRect = () => new DOMRect(0, 0, 400, 200);
  const image = wrapper(editor).querySelector("img")!;
  Object.defineProperties(image, {
    naturalWidth: { value: 800, configurable: true },
    naturalHeight: { value: 400, configurable: true },
  });
}
function pointer(
  element: HTMLElement | Document,
  type: string,
  x: number,
  y: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  element.dispatchEvent(event);
}

describe("image selection and editing", () => {
  it("selects an image with a visible toolbar and retains editor focus before selecting in WebKit", () => {
    const editor = createEditor();
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-toolbar")!.hidden,
    ).toBe(true);
    const focusAtSelection: Element[] = [];
    editor.on("selectionUpdate", () => {
      if (editor.state.selection instanceof NodeSelection)
        focusAtSelection.push(document.activeElement!);
    });
    select(editor);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(focusAtSelection).toEqual([editor.view.dom]);
    expect(wrapper(editor).classList.contains("ProseMirror-selectednode")).toBe(
      true,
    );
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-toolbar")!.hidden,
    ).toBe(false);
    editor.commands.setTextSelection(2);
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-toolbar")!.hidden,
    ).toBe(true);
  });

  it("resolves the current image position after focus commits a preceding editor change", () => {
    const editor = createEditor();
    const focus = editor.view.focus.bind(editor.view);
    let changed = false;
    editor.view.focus = () => {
      if (!changed) {
        changed = true;
        editor.commands.insertContentAt(1, "prefix ");
      }
      focus();
    };
    select(editor);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe(
      "image",
    );
    expect(editor.state.doc.textContent).toBe("prefix BeforeAfter");
  });

  it("resizes through presets, keeping the original image and a single undo step", () => {
    const editor = createEditor();
    select(editor);
    const original = imageAttrs(editor)?.src;
    click(control(editor, "Small image size"));
    expect(imageAttrs(editor)?.displayWidth).toBe(35);
    expect(imageAttrs(editor)?.src).toBe(original);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect(
      control(editor, "Small image size").getAttribute("aria-pressed"),
    ).toBe("true");
    click(control(editor, "Medium image size"));
    editor.commands.undo();
    expect(imageAttrs(editor)?.displayWidth).toBe(35);
    editor.commands.undo();
    expect(imageAttrs(editor)?.displayWidth).toBeNull();
    editor.commands.redo();
    expect(imageAttrs(editor)?.displayWidth).toBe(35);
  });

  it("previews proportional drag resize and saves only on release; Escape cancels", () => {
    const editor = createEditor();
    geometry(editor);
    select(editor);
    pointer(control(editor, "Resize image"), "pointerdown", 400, 200);
    pointer(document, "pointermove", 280, 140);
    expect(imageAttrs(editor)?.displayWidth).toBeNull();
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-frame")!.style
        .width,
    ).toBe("70%");
    pointer(document, "pointerup", 280, 140);
    expect(imageAttrs(editor)?.displayWidth).toBe(70);
    editor.commands.undo();
    expect(imageAttrs(editor)?.displayWidth).toBeNull();
    select(editor);
    pointer(control(editor, "Resize image"), "pointerdown", 400, 200);
    pointer(document, "pointermove", 200, 100);
    key(document.body, "Escape");
    pointer(document, "pointerup", 200, 100);
    expect(imageAttrs(editor)?.displayWidth).toBeNull();
  });

  it("supports keyboard sizing and returns focus to the image with Escape", () => {
    const editor = createEditor();
    geometry(editor);
    select(editor);
    const handle = control(editor, "Resize image");
    handle.focus();
    key(handle, "ArrowLeft", { shiftKey: true });
    expect(imageAttrs(editor)?.displayWidth).toBe(90);
    key(handle, "ArrowRight");
    expect(imageAttrs(editor)?.displayWidth).toBe(92);
    key(handle, "Escape");
    expect(document.activeElement).toBe(editor.view.dom);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it("deletes only the selected image and leaves an editable caret, with undo", () => {
    const editor = createEditor();
    select(editor);
    click(control(editor, "Delete image"));
    expect(imageAttrs(editor)).toBeUndefined();
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
    expect(editor.state.doc.textContent).toBe("BeforeAfter");
    expect(document.activeElement).toBe(editor.view.dom);
    editor.commands.undo();
    expect(imageAttrs(editor)?.alt).toBe("Research diagram");
  });

  it("deletes from a focused image control and avoids history entries for unchanged sizing", () => {
    const editor = createEditor();
    select(editor);
    click(control(editor, "Small image size"));
    click(control(editor, "Small image size"));
    editor.commands.undo();
    expect(imageAttrs(editor)?.displayWidth).toBeNull();
    expect(editor.commands.undo()).toBe(false);
    select(editor);
    const resize = control(editor, "Resize image");
    resize.focus();
    key(resize, "Backspace");
    expect(imageAttrs(editor)).toBeUndefined();
    expect(editor.state.selection).toBeInstanceOf(TextSelection);
  });

  it("ignores image selection in a read-only note", () => {
    const editor = createEditor();
    editor.setEditable(false);
    select(editor);
    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-toolbar")!.hidden,
    ).toBe(true);
  });
});

describe("nondestructive image crop", () => {
  it("previews a crop without changing saved content, commits once, and restores with undo", () => {
    const editor = createEditor();
    geometry(editor);
    select(editor);
    click(control(editor, "Crop image"));
    pointer(control(editor, "Top left crop corner"), "pointerdown", 0, 0);
    pointer(document, "pointermove", 100, 50);
    pointer(document, "pointerup", 100, 50);
    expect(imageAttrs(editor)?.crop).toBeNull();
    click(control(editor, "Apply image crop"));
    expect(imageAttrs(editor)?.crop).toEqual({
      x: 0.25,
      y: 0.25,
      width: 0.75,
      height: 0.75,
    });
    expect(imageAttrs(editor)?.imageAspect).toBe(2);
    expect(imageAttrs(editor)?.src).toBe("data:image/png;base64,AAAA");
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-frame")!.style
        .aspectRatio,
    ).toBe("2 / 1");
    editor.commands.undo();
    expect(imageAttrs(editor)?.crop).toBeNull();
    editor.commands.redo();
    expect(imageAttrs(editor)?.crop.x).toBe(0.25);
  });

  it("supports crop keyboard adjustments and cancellation without an undo entry", () => {
    const editor = createEditor();
    select(editor);
    click(control(editor, "Crop image"));
    key(control(editor, "Top left crop corner"), "ArrowRight", {
      shiftKey: true,
    });
    key(control(editor, "Top left crop corner"), "ArrowDown", {
      shiftKey: true,
    });
    const cropBox = wrapper(editor).querySelector<HTMLElement>(
      ".note-image-crop-box",
    )!;
    expect(cropBox.style.left).toBe("5%");
    expect(cropBox.style.top).toBe("5%");
    click(control(editor, "Cancel image crop"));
    expect(imageAttrs(editor)?.crop).toBeNull();
    expect(editor.commands.undo()).toBe(false);
    click(control(editor, "Crop image"));
    key(control(editor, "Bottom right crop corner"), "ArrowLeft", {
      shiftKey: true,
    });
    key(cropBox, "Escape");
    expect(imageAttrs(editor)?.crop).toBeNull();
    expect(cropBox.hidden).toBe(true);
  });

  it("restores the original through Reset and Apply and preserves original resize", () => {
    const editor = createEditor([
      paragraph("Before"),
      picture({
        crop: { x: 0.2, y: 0.1, width: 0.7, height: 0.6 },
        imageAspect: 2,
        displayWidth: 65,
      }),
      paragraph("After"),
    ]);
    select(editor);
    click(control(editor, "Crop image"));
    click(control(editor, "Reset crop to original image"));
    expect(imageAttrs(editor)?.crop).not.toBeNull();
    click(control(editor, "Apply image crop"));
    expect(imageAttrs(editor)?.crop).toBeNull();
    expect(imageAttrs(editor)?.displayWidth).toBe(65);
    editor.commands.undo();
    expect(imageAttrs(editor)?.crop).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.7,
      height: 0.6,
    });
  });

  it("cancels an unfinished crop when the cursor leaves the image", () => {
    const editor = createEditor();
    select(editor);
    click(control(editor, "Crop image"));
    key(control(editor, "Top left crop corner"), "ArrowRight");
    editor.commands.setTextSelection(2);
    expect(imageAttrs(editor)?.crop).toBeNull();
    expect(wrapper(editor).classList.contains("is-cropping")).toBe(false);
  });
});

describe("image persistence", () => {
  it("round-trips resized and cropped images safely through Markdown source and HTML", () => {
    const editor = createEditor([
      picture({
        src: 'https://example.test/image?a=1&b="x"',
        alt: '<diagram> "label"',
        title: "Original image",
        displayWidth: 65,
        crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
        imageAspect: 2,
      }),
    ]);
    const saved = imageAttrs(editor);
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("<img ");
    expect(markdown).toContain("&amp;");
    expect(markdown).toContain("&quot;");
    expect(markdown).not.toContain('<diagram> "label"');
    editor.commands.setContent(markdown, { contentType: "markdown" });
    expect(imageAttrs(editor)).toEqual(saved);
    const html = editor.getHTML();
    editor.commands.setContent(html);
    expect(imageAttrs(editor)).toEqual(saved);
  });

  it("retains standard Markdown for unedited images and preserves legacy pixel size", () => {
    const editor = createEditor([picture()]);
    expect(editor.getMarkdown()).toContain(
      "![Research diagram](data:image/png;base64,AAAA)",
    );
    editor.commands.setContent({
      type: "doc",
      content: [picture({ width: 240, height: 120 })],
    });
    const markdown = editor.getMarkdown();
    expect(markdown).toContain('width="240"');
    editor.commands.setContent(markdown, { contentType: "markdown" });
    expect(Number(imageAttrs(editor)?.width)).toBe(240);
    expect(
      wrapper(editor).querySelector<HTMLElement>(".note-image-frame")!.style
        .width,
    ).toBe("240px");
  });

  it("rejects invalid crop metadata without evaluating it or hiding the image", () => {
    const editor = createEditor();
    editor.commands.setContent(
      '<img src="data:image/png;base64,AAAA" data-note-width="NaN" data-note-crop="not json" data-note-aspect="Infinity">',
    );
    expect(imageAttrs(editor)?.crop).toBeNull();
    expect(imageAttrs(editor)?.displayWidth).toBeNull();
    expect(imageAttrs(editor)?.imageAspect).toBeNull();
    expect(
      wrapper(editor)
        .querySelector<HTMLElement>(".note-image-frame")!
        .classList.contains("is-cropped"),
    ).toBe(false);
  });
});
