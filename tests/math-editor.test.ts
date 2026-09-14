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

const inline = (latex: string): JSONContent => ({
  type: "inlineMath",
  attrs: { latex },
});
const richParagraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const text = (value: string): JSONContent => ({ type: "text", text: value });
const sources = (editor: Editor) => [
  ...editor.view.dom.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    ".math-note-input",
  ),
];

describe("cursor passage through equations", () => {
  it("enters inline source from either side and exits to the exact surrounding text", async () => {
    const editor = createEditor([
      richParagraph(text("Before "), inline("x^2"), text(" after")),
    ]);
    editor.view.focus();
    editor.commands.setTextSelection(8);
    key(editor.view.dom, "ArrowRight");
    await Promise.resolve();
    const [input] = sources(editor);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    input.setSelectionRange(3, 3);
    key(input, "ArrowRight");
    expect(editor.state.selection.from).toBe(9);
    expect(document.activeElement).toBe(editor.view.dom);
    key(editor.view.dom, "ArrowLeft");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(3);
    input.setSelectionRange(0, 0);
    key(input, "ArrowLeft");
    expect(editor.state.selection.from).toBe(8);
    expect(editor.view.dom.querySelector(".is-editing")).toBeNull();
  });

  it("passes through adjacent inline equations in both directions without skipped atoms", async () => {
    const editor = createEditor([richParagraph(inline("a"), inline("bbb"))]);
    editor.view.focus();
    editor.commands.setTextSelection(1);
    key(editor.view.dom, "ArrowRight");
    await Promise.resolve();
    const [first, second] = sources(editor);
    first.setSelectionRange(1, 1);
    key(first, "ArrowRight");
    await Promise.resolve();
    expect(document.activeElement).toBe(second);
    expect(second.selectionStart).toBe(0);
    key(second, "ArrowLeft");
    await Promise.resolve();
    expect(document.activeElement).toBe(first);
    expect(first.selectionStart).toBe(1);
    first.setSelectionRange(0, 0);
    key(first, "ArrowLeft");
    expect(editor.state.selection.from).toBe(1);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("enters display math only on the final visual line of surrounding prose", async () => {
    const editor = createEditor([
      paragraph("Wrapped prose"),
      equation("a\nb"),
      paragraph("After"),
    ]);
    editor.view.focus();
    editor.commands.setTextSelection(4);
    const actualBoundary = editor.view.endOfTextblock.bind(editor.view);
    editor.view.endOfTextblock = () => false;
    key(editor.view.dom, "ArrowDown");
    await Promise.resolve();
    expect(document.activeElement).toBe(editor.view.dom);
    editor.view.endOfTextblock = (direction) => direction === "down";
    key(editor.view.dom, "ArrowDown");
    await Promise.resolve();
    const [input] = sources(editor);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    input.setSelectionRange(input.value.length, input.value.length);
    key(input, "ArrowDown");
    expect(editor.state.selection.$from.parent.textContent).toBe("After");
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    editor.view.endOfTextblock = () => true;
    key(editor.view.dom, "ArrowUp");
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(input.value.length);
    input.setSelectionRange(0, 0);
    key(input, "ArrowUp");
    expect(editor.state.selection.$from.parent.textContent).toBe(
      "Wrapped prose",
    );
    expect(editor.state.selection.$from.parentOffset).toBe(
      "Wrapped prose".length,
    );
    editor.view.endOfTextblock = actualBoundary;
  });

  it("moves between adjacent display equations and creates editable prose at document edges", async () => {
    const editor = createEditor([equation("a"), equation("b")]);
    const { input: first } = await openMath(editor);
    key(first, "ArrowDown");
    await Promise.resolve();
    const second = sources(editor)[1];
    expect(document.activeElement).toBe(second);
    expect(second.selectionStart).toBe(0);
    key(second, "ArrowUp");
    await Promise.resolve();
    expect(document.activeElement).toBe(first);
    expect(first.selectionStart).toBe(1);
    first.setSelectionRange(0, 0);
    key(first, "ArrowLeft");
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
      "blockMath",
      "blockMath",
      "paragraph",
    ]);
    expect(editor.state.selection.from).toBe(1);
    await openMath(editor, 1);
    key(second, "ArrowRight");
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual([
      "paragraph",
      "blockMath",
      "blockMath",
      "paragraph",
    ]);
    expect(editor.state.selection.$from.parent.isTextblock).toBe(true);
    expect(document.activeElement).toBe(editor.view.dom);
  });

  it("keeps range selections and programmatic node selection rendered", async () => {
    const editor = createEditor([
      richParagraph(text("A"), inline("x"), text("B")),
    ]);
    editor.view.focus();
    editor.commands.setTextSelection(2);
    key(editor.view.dom, "ArrowRight", { shiftKey: true });
    await Promise.resolve();
    expect(editor.view.dom.querySelector(".is-editing")).toBeNull();
    editor.commands.setTextSelection({ from: 1, to: 4 });
    key(editor.view.dom, "ArrowLeft");
    await Promise.resolve();
    expect(editor.view.dom.querySelector(".is-editing")).toBeNull();
    editor.commands.setNodeSelection(2);
    await Promise.resolve();
    expect(editor.view.dom.querySelector(".is-editing")).toBeNull();
    key(editor.view.dom, "ArrowLeft");
    await Promise.resolve();
    expect(document.activeElement).toBe(sources(editor)[0]);
    expect(sources(editor)[0].selectionStart).toBe(1);
  });

  it("uses Tab to leave source and Backspace at its start without deleting equation content", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("x+y"),
      paragraph("After"),
    ]);
    const { input } = await openMath(editor);
    input.setSelectionRange(0, 0);
    key(input, "Backspace");
    expect(mathContent(editor)[0].attrs?.latex).toBe("x+y");
    expect(editor.state.selection.$from.parent.textContent).toBe("Before");
    await openMath(editor);
    key(input, "Tab");
    expect(editor.state.selection.$from.parent.textContent).toBe("After");
    await openMath(editor);
    key(input, "Tab", { shiftKey: true });
    expect(editor.state.selection.$from.parent.textContent).toBe("Before");
    expect(mathContent(editor)[0].attrs?.latex).toBe("x+y");
  });

  it("keeps modifier arrows, selected source text, and inner source lines inside LaTeX", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("a\nb\nc"),
      paragraph("After"),
    ]);
    const { input } = await openMath(editor);
    for (const [offset, code, options] of [
      [2, "ArrowUp", {}],
      [2, "ArrowDown", {}],
      [0, "ArrowLeft", { shiftKey: true }],
      [0, "ArrowLeft", { metaKey: true }],
    ] as const) {
      input.setSelectionRange(offset, offset);
      const event = new KeyboardEvent("keydown", {
        key: code,
        bubbles: true,
        cancelable: true,
        ...options,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    input.setSelectionRange(0, 1);
    key(input, "ArrowLeft");
    expect(document.activeElement).toBe(input);
  });

  it("crosses from nested bullet and quote text into math without flattening their structure", async () => {
    const editor = createEditor([
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("Item"), equation("x")] },
        ],
      },
      { type: "blockquote", content: [equation("y"), paragraph("Quoted")] },
    ]);
    editor.view.focus();
    editor.commands.setTextSelection(7);
    key(editor.view.dom, "ArrowRight");
    await Promise.resolve();
    expect(document.activeElement).toBe(sources(editor)[0]);
    sources(editor)[0].setSelectionRange(0, 0);
    key(sources(editor)[0], "ArrowLeft");
    expect(editor.state.selection.$from.parent.textContent).toBe("Item");
    expect(editor.state.selection.$from.node(-1).type.name).toBe("listItem");
    await openMath(editor, 1);
    key(sources(editor)[1], "ArrowRight");
    expect(editor.state.selection.$from.parent.textContent).toBe("Quoted");
    expect(editor.state.selection.$from.node(-1).type.name).toBe("blockquote");
  });
});

describe("math navigation focus safety", () => {
  it("resolves a moved equation at its current offset before entering source", async () => {
    const editor = createEditor([
      richParagraph(text("A"), inline("x"), text("B")),
    ]);
    editor.view.focus();
    editor.commands.insertContentAt(1, "prefix ");
    editor.commands.setTextSelection(9);
    key(editor.view.dom, "ArrowRight");
    await Promise.resolve();
    const [input] = sources(editor);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    edit(input, "x+y");
    expect(mathContent(editor, "inlineMath")[0].attrs?.latex).toBe("x+y");
  });

  it("does not steal focus for shift-clicking an equation or opening a read-only note", async () => {
    const editor = createEditor([
      paragraph("Before"),
      equation("x"),
      paragraph("After"),
    ]);
    editor.view.focus();
    const node = editor.view.dom.querySelector<HTMLElement>(".math-note")!;
    for (const kind of ["mousedown", "click"])
      node.dispatchEvent(
        new MouseEvent(kind, {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
        }),
      );
    await Promise.resolve();
    expect(node.classList.contains("is-editing")).toBe(false);
    editor.setEditable(false);
    node.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(node.classList.contains("is-editing")).toBe(false);
  });

  it("deletes only an emptied inline source when exiting at its boundary", async () => {
    const editor = createEditor([
      richParagraph(text("A"), inline("x"), text("B")),
    ]);
    const { input } = await openMath(editor, 0, true);
    edit(input, "");
    key(input, "Delete");
    expect(editor.state.doc.textContent).toBe("AB");
    expect(editor.state.selection.from).toBe(2);
    expect(mathContent(editor, "inlineMath")).toHaveLength(0);
    expect(document.activeElement).toBe(editor.view.dom);
  });
});

describe("native block equation focus ownership", () => {
  it.each(["click", "arrow"])(
    "owns source focus before %s dispatches the outer block selection",
    async (entry) => {
      const editor = createEditor([
        paragraph("Before"),
        equation("x^2"),
        paragraph("After"),
      ]);
      editor.view.focus();
      editor.commands.setTextSelection(7);
      const input = sources(editor)[0];
      const focusAtSelection: Element[] = [];
      editor.on("selectionUpdate", () => {
        const selected = editor.state.selection;
        if (
          !(selected instanceof NodeSelection) ||
          selected.node.type.name !== "blockMath"
        )
          return;
        focusAtSelection.push(document.activeElement!);
        // Model WebKit's block-atom fallback: an outer editable selection moves
        // to prose before a deferred source focus can run. Source-owned focus
        // makes ProseMirror skip that fragile browser selection entirely.
        if (document.activeElement === editor.view.dom) {
          const after = selected.to + 1;
          queueMicrotask(() => editor.commands.setTextSelection(after));
        }
      });
      if (entry === "click") {
        const node =
          editor.view.dom.querySelector<HTMLElement>(".math-note-block")!;
        node.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      } else {
        editor.view.endOfTextblock = () => true;
        key(editor.view.dom, "ArrowDown");
      }
      await Promise.resolve();
      expect(focusAtSelection).toEqual([input]);
      expect(document.activeElement).toBe(input);
      expect(editor.state.selection).toBeInstanceOf(NodeSelection);
      expect(
        input.closest(".math-note")?.classList.contains("is-editing"),
      ).toBe(true);
    },
  );

  it("resolves the target again when focusing it blurs and replaces an emptied preceding equation", async () => {
    const editor = createEditor([
      equation("abandon"),
      equation("keep"),
      paragraph("After"),
    ]);
    const first = await openMath(editor);
    edit(first.input, "");
    const second = await openMath(editor, 1);
    expect(document.activeElement).toBe(second.input);
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.attrs.latex).toBe(
      "keep",
    );
    expect(editor.getJSON().content?.[0].type).toBe("paragraph");
    edit(second.input, "kept^2");
    expect(mathContent(editor)[0].attrs?.latex).toBe("kept^2");
  });
});
