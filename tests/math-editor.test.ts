// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { NodeSelection } from "@tiptap/pm/state";
import { NaturalBlockMath, NaturalInlineMath } from "../src/math-editor";

const editors: Editor[] = [];
beforeAll(() => {
  // JSDOM has no layout; ProseMirror scrolls selections when leaving a node.
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
const equation = (latex: string): JSONContent => ({
  type: "blockMath",
  attrs: { latex },
});
function createEditor(content: JSONContent[]) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, NaturalInlineMath, NaturalBlockMath, Markdown],
    content: { type: "doc", content },
  });
  editors.push(editor);
  return editor;
}
async function openMath(editor: Editor, index = 0, inline = false) {
  const node = editor.view.dom.querySelectorAll<HTMLElement>(
    inline ? ".math-note-inline" : ".math-note-block",
  )[index];
  node.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
  );
  node.dispatchEvent(
    new MouseEvent("click", { bubbles: true, cancelable: true }),
  );
  await Promise.resolve();
  const input = node.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    ".math-note-input",
  )!;
  expect(document.activeElement).toBe(input);
  return { node, input };
}
function edit(
  input: HTMLInputElement | HTMLTextAreaElement,
  latex: string,
  caret = latex.length,
) {
  input.value = latex;
  input.setSelectionRange(caret, caret);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function key(
  input: HTMLElement,
  value: string,
  options: KeyboardEventInit = {},
) {
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
      ...options,
    }),
  );
}
function mathContent(editor: Editor, type = "blockMath") {
  const found: JSONContent[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) found.push(node.toJSON());
  });
  return found;
}
function typeInEditor(editor: Editor, text: string) {
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

describe("direct math editing", () => {
  it("edits display LaTeX where it is rendered, saves each input, and keeps the caret steady", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("x^2"),
      paragraph("After"),
    ]);
    const saved: JSONContent[] = [];
    editor.on("update", () => saved.push(editor.getJSON()));
    const { node, input } = await openMath(editor);

    expect(node.querySelectorAll(".math-note-delimiter")).toHaveLength(2);
    expect(input).toBeInstanceOf(HTMLTextAreaElement);
    edit(input, "x^2 + y^2\n= z^2", 4);

    expect(mathContent(editor)[0].attrs?.latex).toBe("x^2 + y^2\n= z^2");
    expect(saved).toHaveLength(1);
    expect(node.querySelector(".katex")).not.toBeNull();
    expect(node.querySelector(".math-note-input")).toBe(input);
    expect(input.selectionStart).toBe(4);
    expect(document.activeElement).toBe(input);
    expect(editor.view.dom.querySelector('[role="dialog"]')).toBeNull();

    const otherInput = document.createElement("input");
    document.body.append(otherInput);
    otherInput.focus();
    expect(node.classList.contains("is-editing")).toBe(false);
    expect(document.activeElement).toBe(otherInput);
    await openMath(editor);
    expect(input.value).toBe("x^2 + y^2\n= z^2");
  });

  it("updates the correct equation after content before it shifts its document position", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("first"),
      paragraph("Between"),
      equation("second"),
      paragraph("After"),
    ]);
    const { input } = await openMath(editor, 1);
    editor.view.dispatch(
      editor.state.tr.insertText("A newly inserted prefix. ", 1),
    );
    edit(input, "changed_2");
    expect(mathContent(editor).map((node) => node.attrs?.latex)).toEqual([
      "first",
      "changed_2",
    ]);
  });

  it("moves between multiple equations without losing either draft", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("a"),
      equation("b"),
      paragraph("After"),
    ]);
    const first = await openMath(editor);
    edit(first.input, "a_1");
    const second = await openMath(editor, 1);
    expect(first.node.classList.contains("is-editing")).toBe(false);
    edit(second.input, "b_2");
    key(second.input, "Escape");
    expect(mathContent(editor).map((node) => node.attrs?.latex)).toEqual([
      "a_1",
      "b_2",
    ]);
    expect(second.node.classList.contains("is-editing")).toBe(false);
    expect(editor.state.selection.$from.parent.textContent).toBe("After");
  });

  it("creates a focused display source with $$ then Enter and leaves a final equation naturally", async () => {
    const editor = createEditor([paragraph("$$")]);
    editor.view.focus();
    editor.commands.setTextSelection(3);
    key(editor.view.dom, "Enter");
    await Promise.resolve();
    const input =
      editor.view.dom.querySelector<HTMLTextAreaElement>(".math-note-input")!;
    expect(document.activeElement).toBe(input);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    edit(input, "\\sum_{i=1}^{n} x_i");
    key(input, "Enter", { metaKey: true });
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "blockMath",
      "paragraph",
    ]);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(mathContent(editor)[0].attrs?.latex).toBe("\\sum_{i=1}^{n} x_i");
  });

  it("keeps Enter multiline, navigates out with arrows at source edges, and undoes within the note history", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("original"),
      paragraph("After"),
    ]);
    const { input, node } = await openMath(editor);
    edit(input, "revised");
    key(input, "z", { metaKey: true });
    expect(input.value).toBe("original");
    expect(mathContent(editor)[0].attrs?.latex).toBe("original");
    key(input, "z", { metaKey: true, shiftKey: true });
    expect(input.value).toBe("revised");
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(node.classList.contains("is-editing")).toBe(true);
    input.setSelectionRange(0, 0);
    key(input, "ArrowLeft");
    expect(node.classList.contains("is-editing")).toBe(false);
    expect(editor.state.selection.$from.parent.textContent).toBe("Before");
    expect(editor.state.selection.$from.parentOffset).toBe("Before".length);
  });

  it("edits inline equations between dollar delimiters and returns the caret after the equation", async () => {
    const editor = createEditor([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Let " },
          { type: "inlineMath", attrs: { latex: "x" } },
          { type: "text", text: " be positive." },
        ],
      },
    ]);
    const { node, input } = await openMath(editor, 0, true);
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect(node.querySelector(".math-note-delimiter")?.textContent).toBe("$");
    edit(input, "\\alpha^2");
    key(input, "Enter");
    expect(mathContent(editor, "inlineMath")[0].attrs?.latex).toBe("\\alpha^2");
    expect(editor.state.selection.from).toBe(6);
    expect(node.classList.contains("is-editing")).toBe(false);
  });

  it("preserves edited display and inline math through Markdown save and reload", async () => {
    const editor = createEditor([
      equation("x"),
      {
        type: "paragraph",
        content: [{ type: "inlineMath", attrs: { latex: "y" } }],
      },
    ]);
    const { input } = await openMath(editor);
    edit(input, "\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}");
    input.blur();
    const saved = editor.getJSON();
    const markdown = editor.getMarkdown();
    editor.commands.setContent(markdown, { contentType: "markdown" });
    expect(editor.getJSON()).toEqual(saved);
  });

  it("recognizes familiar inline and display delimiters as typed while preserving literal code", () => {
    const inline = createEditor([paragraph("")]);
    typeInEditor(inline, "Use $x^2$ here");
    expect(mathContent(inline, "inlineMath")[0].attrs?.latex).toBe("x^2");
    expect(inline.state.doc.textContent).toBe("Use  here");

    const display = createEditor([paragraph("")]);
    typeInEditor(display, "$$x^2$$");
    expect(mathContent(display)[0].attrs?.latex).toBe("x^2");
    expect(mathContent(display, "inlineMath")).toHaveLength(0);

    const code = createEditor([{ type: "codeBlock", content: [] }]);
    typeInEditor(code, "$$x^2$$");
    expect(mathContent(code)).toHaveLength(0);
    expect(code.state.doc.textContent).toBe("$$x^2$$");
  });

  it("returns an abandoned empty equation to an ordinary paragraph without stealing outside focus", async () => {
    const editor = createEditor([paragraph("$$")]);
    editor.view.focus();
    editor.commands.setTextSelection(3);
    key(editor.view.dom, "Enter");
    await Promise.resolve();
    expect(mathContent(editor)).toHaveLength(1);
    const outside = document.createElement("input");
    document.body.append(outside);
    outside.focus();
    expect(mathContent(editor)).toHaveLength(0);
    expect(editor.getJSON().content?.[0].type).toBe("paragraph");
    expect(document.activeElement).toBe(outside);
  });
});
