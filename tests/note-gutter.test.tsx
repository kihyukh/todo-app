// @vitest-environment jsdom
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import NoteGutter from "../src/NoteGutter";
import { VimEditor, vimPluginKey } from "../src/vim-editor";
import { NaturalBlockMath, NaturalInlineMath } from "../src/math-editor";

let root: Root | undefined;
let editor: Editor | undefined;
let nextFrame = 0;
let frames = new Map<number, FrameRequestCallback>();
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
beforeEach(() => {
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  editor?.destroy();
  root = undefined;
  editor = undefined;
  document.body.replaceChildren();
  delete window.__DAYMARK_PLATFORM__;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function flushFrame() {
  await act(async () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
}
async function mount(content: string | JSONContent, vim = false) {
  editor = new Editor({
    extensions: [
      StarterKit,
      TableKit,
      NaturalBlockMath,
      NaturalInlineMath,
      VimEditor.configure({ enabled: vim }),
    ],
    content,
    editorProps: { attributes: { class: "note-prose" } },
  });
  const currentEditor = editor;
  const onOpenMenu = vi.fn();
  let commits = 0;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <div className="note-editor-surface">
        <EditorContent editor={currentEditor} />
        <Profiler id="gutter" onRender={() => commits++}>
          <NoteGutter
            editor={currentEditor}
            menuOpen={false}
            onOpenMenu={onOpenMenu}
          />
        </Profiler>
      </div>,
    ),
  );
  const surface = container.querySelector<HTMLElement>(".note-editor-surface")!;
  surface.getBoundingClientRect = () => new DOMRect(100, 100, 350, 500);
  const blocks = [
    ...currentEditor.view.dom.querySelectorAll<HTMLElement>("h1,h2,h3,p"),
  ];
  const tops = blocks.map((_, index) => 112 + index * 40);
  const actualStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = actualStyle(element);
    if (!blocks.includes(element as HTMLElement)) return style;
    const heading = element.tagName.startsWith("H");
    return new Proxy(style, {
      get(target, property) {
        if (property === "fontSize") return heading ? "20px" : "14px";
        if (property === "lineHeight") return heading ? "28px" : "20px";
        if (property === "paddingTop" || property === "borderTopWidth")
          return "0px";
        return Reflect.get(target, property);
      },
    });
  });
  blocks.forEach((block, index) => {
    const heading = block.tagName.startsWith("H");
    block.getBoundingClientRect = () =>
      new DOMRect(132, tops[index], 280, heading ? 28 : 20);
  });
  await flushFrame();
  return {
    editor: currentEditor,
    container,
    onOpenMenu,
    tops,
    commits: () => commits,
  };
}
const label = (name: string) =>
  document.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`);
async function click(button: HTMLButtonElement) {
  await act(async () => {
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    button.click();
  });
}

describe("note gutter", () => {
  it("shows only the focused heading and preserves the cursor when opening its options", async () => {
    const harness = await mount(
      "<h1>Introduction</h1><blockquote><h2>Nested section</h2></blockquote><h3>Detail</h3><p>Body</p>",
      true,
    );
    expect(document.querySelectorAll(".note-gutter-heading")).toHaveLength(0);
    const heading = harness.editor.view.dom.querySelector("h2")!;
    const position = harness.editor.view.posAtDOM(heading, 0) + 4;
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection(position);
    });
    await flushFrame();
    const initial = harness.editor.getJSON();
    expect(label("Heading 1 options")).toBeNull();
    expect(label("Heading 3 options")).toBeNull();
    expect(label("Heading 2 options")?.style.top).toBe("72px");
    expect(harness.editor.view.dom.querySelector(".note-gutter")).toBeNull();
    await act(async () => {
      harness.editor.view.dom.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "d",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(vimPluginKey.getState(harness.editor.state)?.operator).toBe("d");
    await click(label("Heading 2 options")!);
    expect(harness.editor.state.selection.head).toBe(position);
    expect(harness.onOpenMenu).toHaveBeenCalledExactlyOnceWith(
      label("Heading 2 options"),
    );
    expect(harness.editor.getJSON()).toEqual(initial);
    expect(vimPluginKey.getState(harness.editor.state)?.mode).toBe("normal");
    expect(vimPluginKey.getState(harness.editor.state)?.operator).toBeNull();
    const outside = document.createElement("button");
    document.body.append(outside);
    await act(async () => outside.focus());
    await flushFrame();
    expect(document.querySelectorAll(".note-gutter-heading")).toHaveLength(0);
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection(
        harness.editor.view.posAtDOM(
          harness.editor.view.dom.querySelector("p")!,
          0,
        ),
      );
    });
    await flushFrame();
    expect(document.querySelectorAll(".note-gutter-heading")).toHaveLength(0);
  });

  it("aligns a heading label with the cursor's wrapped visual line", async () => {
    const harness = await mount(
      "<h2>A heading spanning two visual lines</h2><p>Body</p>",
    );
    const heading = harness.editor.view.dom.querySelector<HTMLElement>("h2")!;
    heading.getBoundingClientRect = () => new DOMRect(100, 112, 280, 56);
    vi.spyOn(harness.editor.view, "coordsAtPos").mockReturnValue({
      left: 100,
      right: 100,
      top: 140,
      bottom: 168,
    });
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection(20);
    });
    await flushFrame();
    expect(label("Heading 2 options")?.style.top).toBe("60px");
    expect(document.querySelectorAll(".note-gutter-heading")).toHaveLength(1);
    await act(async () =>
      harness.editor.commands.setTextSelection({ from: 2, to: 6 }),
    );
    await flushFrame();
    expect(label("Heading 2 options")).toBeNull();
  });

  it("shows an affordance for the initial empty note without requiring focus", async () => {
    const harness = await mount("<p></p>");
    const plus = label("Add note element")!;
    expect(plus).not.toBeNull();
    expect(plus.classList.contains("is-always-visible")).toBe(true);
    expect(plus.classList.contains("is-empty")).toBe(true);
    expect(harness.editor.view.hasFocus()).toBe(false);
    await click(plus);
    expect(harness.onOpenMenu).toHaveBeenCalledExactlyOnceWith(plus);
    expect(harness.editor.isEmpty).toBe(true);
  });

  it("uses one tall touch target for the active heading instead of controls on neighboring lines", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    const harness = await mount("<h2>One</h2><h2>Two</h2><p>Body</p>");
    harness.tops[1] = harness.tops[0] + 25;
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection(2);
    });
    await flushFrame();
    const headings = [
      ...document.querySelectorAll<HTMLButtonElement>(".note-gutter-heading"),
    ];
    expect(document.querySelector(".note-gutter.is-touch")).not.toBeNull();
    expect(headings).toHaveLength(1);
    expect(headings[0].style.height).toBe("44px");
  });

  it("shows only the active table heading when table cells share a line", async () => {
    const harness = await mount(
      "<h2>Outside</h2><table><tbody><tr><td><h2>Cell one</h2></td><td><h2>Cell two</h2></td></tr></tbody></table><p>After</p>",
    );
    const headings = harness.editor.view.dom.querySelectorAll("h2");
    harness.tops[2] = harness.tops[1];
    for (const index of [2, 1]) {
      await act(async () => {
        harness.editor.view.focus();
        harness.editor.commands.setTextSelection(
          harness.editor.view.posAtDOM(headings[index], 0),
        );
      });
      await flushFrame();
      expect(document.querySelectorAll(".note-gutter-heading")).toHaveLength(1);
      await click(label("Heading 2 options")!);
      expect(harness.editor.state.selection.$head.parent.textContent).toBe(
        index === 2 ? "Cell two" : "Cell one",
      );
    }
  });

  it("preserves a selected text range in a nested paragraph when opening its menu", async () => {
    const harness = await mount(
      "<ul><li><p>Nested item text</p></li></ul>",
      true,
    );
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection({ from: 4, to: 10 });
    });
    await flushFrame();
    const before = harness.editor.getJSON();
    const selection = harness.editor.state.selection;
    const plus = label("Add note element")!;
    expect(plus).not.toBeNull();
    expect(plus.classList.contains("is-empty")).toBe(false);
    await click(plus);
    expect(harness.editor.state.selection.eq(selection)).toBe(true);
    expect(harness.editor.getJSON()).toEqual(before);
    expect(vimPluginKey.getState(harness.editor.state)?.mode).toBe("normal");
  });

  it("hides the paragraph action while a math control has focus and never offers it inside code", async () => {
    const harness = await mount({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Prose " },
            { type: "inlineMath", attrs: { latex: "a+b" } },
          ],
        },
        {
          type: "codeBlock",
          content: [{ type: "text", text: "const value = 1;" }],
        },
      ],
    });
    expect(label("Add note element")).not.toBeNull();
    const math =
      harness.editor.view.dom.querySelector<HTMLElement>(".math-note")!;
    await act(async () =>
      math.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
    );
    await flushFrame();
    expect(label("Add note element")).toBeNull();
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection(11);
    });
    await flushFrame();
    expect(harness.editor.state.selection.$head.parent.type.name).toBe(
      "codeBlock",
    );
    expect(label("Add note element")).toBeNull();
  });

  it("batches measurements without React commits or serialization while typing at unchanged geometry", async () => {
    const harness = await mount("<p>Alpha</p><h2>Heading</h2>");
    await act(async () => {
      harness.editor.view.focus();
      harness.editor.commands.setTextSelection(10);
    });
    await flushFrame();
    const serialize = vi.spyOn(harness.editor, "getJSON");
    const initialCommits = harness.commits();
    await act(async () => {
      harness.editor.commands.insertContent("b");
      harness.editor.commands.insertContent("c");
      window.dispatchEvent(new Event("resize"));
      document.dispatchEvent(new Event("scroll"));
    });
    expect(frames.size).toBe(1);
    await flushFrame();
    expect(harness.commits()).toBe(initialCommits);
    expect(serialize).not.toHaveBeenCalled();
    const heading = label("Heading 2 options")!;
    expect(heading.style.top).toBe("72px");
    harness.tops[1] += 75;
    await act(async () =>
      harness.editor.view.dom.dispatchEvent(
        new Event("load", { bubbles: false }),
      ),
    );
    await flushFrame();
    expect(heading.style.top).toBe("147px");
    expect(harness.commits()).toBe(initialCommits + 1);
    expect(serialize).not.toHaveBeenCalled();
  });
});
