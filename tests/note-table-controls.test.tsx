// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { CellSelection } from "@tiptap/pm/tables";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import NoteTableControls from "../src/NoteTableControls";
import { NoteTableKit } from "../src/note-table";
import { VimEditor, vimPluginKey } from "../src/vim-editor";

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

const content = `<p>Before table</p><table><tbody>
<tr><th><p>Alpha</p></th><th><p>Bravo</p></th><th><p>Charlie</p></th></tr>
<tr><td><p>One</p></td><td><p>Two</p></td><td><p>Three</p></td></tr>
<tr><td><p>Four</p></td><td><p>Five</p></td><td><p>Six</p></td></tr>
</tbody></table><p>After table</p>`;

async function flushFrames() {
  // Geometry updates and focus restoration may schedule one subsequent frame.
  for (let pass = 0; pass < 5 && frames.size; pass++) {
    await act(async () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((callback) => callback(pass * 16));
    });
  }
}

async function mount(
  touch = false,
  initialContent = content,
  vimEnabled = false,
) {
  if (touch) window.__DAYMARK_PLATFORM__ = "ios";
  editor = new Editor({
    extensions: [
      StarterKit,
      NoteTableKit,
      VimEditor.configure({ enabled: vimEnabled }),
    ],
    content: initialContent,
    editorProps: { attributes: { class: "note-prose" } },
  });
  const instance = editor;
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <div className="note-editor-surface">
        <EditorContent editor={instance} />
        <NoteTableControls editor={instance} />
      </div>,
    ),
  );
  const surface = container.querySelector<HTMLElement>(".note-editor-surface")!;
  surface.getBoundingClientRect = () => new DOMRect(80, 80, 650, 650);
  instance.view.dom.getBoundingClientRect = () =>
    new DOMRect(110, 100, 590, 600);
  const setGeometry = () => {
    const table = instance.view.dom.querySelector<HTMLTableElement>("table");
    if (!table) return;
    table.getBoundingClientRect = () => new DOMRect(110, 150, 450, 120);
    const wrapper = table.closest<HTMLElement>(".tableWrapper");
    if (wrapper)
      wrapper.getBoundingClientRect = () => new DOMRect(110, 150, 450, 120);
    [...table.rows].forEach((row, rowIndex) => {
      row.getBoundingClientRect = () =>
        new DOMRect(110, 150 + rowIndex * 40, row.cells.length * 150, 40);
      [...row.cells].forEach((cell, columnIndex) => {
        cell.getBoundingClientRect = () =>
          new DOMRect(110 + columnIndex * 150, 150 + rowIndex * 40, 150, 40);
      });
    });
  };
  setGeometry();
  await flushFrames();
  const setHidden = async (hidden: boolean) => {
    await act(async () =>
      root!.render(
        <div className="note-editor-surface">
          <EditorContent editor={instance} />
          <NoteTableControls editor={instance} hidden={hidden} />
        </div>,
      ),
    );
    await flushFrames();
  };
  return { editor: instance, container, surface, setGeometry, setHidden };
}

function cell(row: number, column: number): HTMLTableCellElement {
  return editor!.view.dom.querySelector<HTMLTableElement>("table")!.rows[row]
    .cells[column];
}
function button(label: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
}
function menu(label?: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    label ? `[role="menu"][aria-label="${label}"]` : '[role="menu"]',
  );
}
function action(label: string): HTMLButtonElement {
  const result = [
    ...menu()!.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.getAttribute("aria-label") === label ||
      [...candidate.querySelectorAll("span")].some(
        (span) => span.textContent === label,
      ),
  );
  expect(result, `Expected menu action ${label}`).toBeTruthy();
  return result!;
}
async function pointer(
  target: Element,
  type = "pointermove",
  pointerType = "mouse",
) {
  const rect = target.getBoundingClientRect();
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    });
    Object.defineProperty(event, "pointerType", { value: pointerType });
    target.dispatchEvent(event);
  });
  await flushFrames();
}
async function hover(row: number, column: number) {
  await pointer(cell(row, column), "pointerover");
  await pointer(cell(row, column));
}
async function click(target: HTMLElement) {
  expect(target).toBeTruthy();
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    target.click();
  });
  await flushFrames();
}
async function caret(row: number, column: number) {
  const position =
    editor!.view.posAtDOM(cell(row, column).querySelector("p")!, 0) + 1;
  await act(async () => {
    editor!.view.focus();
    editor!.commands.setTextSelection(position);
  });
  await flushFrames();
  return editor!.state.selection;
}
async function escape() {
  await act(async () => {
    (document.activeElement ?? document).dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await flushFrames();
}
function rows(tableIndex = 0): string[][] {
  const table = editor!.state.doc.content.content.filter(
    (node) => node.type.name === "table",
  )[tableIndex];
  return table
    ? table.content.content.map((row) =>
        row.content.content.map((cell) => cell.textContent),
      )
    : [];
}
function selectedTexts(): string[] {
  const selection = editor!.state.selection;
  expect(selection).toBeInstanceOf(CellSelection);
  const texts: string[] = [];
  (selection as CellSelection).forEachCell((cell) =>
    texts.push(cell.textContent),
  );
  return texts.sort();
}

describe("table row and column controls", () => {
  it("shows handles for the hovered cell without editing or serializing the note", async () => {
    const { editor } = await mount();
    const before = editor.getJSON();
    const changed = vi.fn();
    editor.on("update", changed);
    const serialize = vi.spyOn(editor, "getJSON");
    expect(button("Row 1 options")).toBeNull();
    await hover(1, 2);
    expect(button("Row 2 options")).not.toBeNull();
    expect(button("Column 3 options")).not.toBeNull();
    await hover(2, 0);
    expect(button("Row 3 options")).not.toBeNull();
    expect(button("Column 1 options")).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
    expect(editor.getJSON()).toEqual(before);
  });

  it("selects the hovered row, freezes that target while its menu is open, and restores the caret on Escape", async () => {
    const { editor } = await mount();
    const prior = await caret(0, 0);
    const before = editor.getJSON();
    const changed = vi.fn();
    editor.on("update", changed);
    await hover(1, 2);
    await click(button("Row 2 options")!);
    expect(menu("Row 2")).not.toBeNull();
    expect(selectedTexts()).toEqual(["One", "Three", "Two"]);
    await hover(2, 0);
    expect(menu("Row 2")).not.toBeNull();
    expect(selectedTexts()).toEqual(["One", "Three", "Two"]);
    await escape();
    expect(menu()).toBeNull();
    expect(editor.state.selection.eq(prior)).toBe(true);
    expect(editor.getJSON()).toEqual(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it("selects a full column and restores the caret when dismissed outside", async () => {
    const { editor } = await mount();
    const prior = await caret(2, 2);
    await hover(0, 1);
    await click(button("Column 2 options")!);
    expect(menu("Column 2")).not.toBeNull();
    expect(selectedTexts()).toEqual(["Bravo", "Five", "Two"]);
    const outside = document.createElement("button");
    document.body.append(outside);
    await pointer(outside, "pointerdown");
    expect(menu()).toBeNull();
    expect(editor.state.selection.eq(prior)).toBe(true);
  });

  it("inserts beside the hovered column, preserving other cell content, and supports a single undo", async () => {
    const { editor } = await mount();
    await caret(2, 2);
    const before = editor.getJSON();
    await hover(1, 0);
    await click(button("Column 1 options")!);
    await click(action("Insert right"));
    expect(menu()).toBeNull();
    expect(rows()).toEqual([
      ["Alpha", "", "Bravo", "Charlie"],
      ["One", "", "Two", "Three"],
      ["Four", "", "Five", "Six"],
    ]);
    await act(async () => editor.commands.undo());
    expect(editor.getJSON()).toEqual(before);
  });

  it("duplicates the intended row and deletes a different column with undoable actions", async () => {
    const { editor, setGeometry } = await mount();
    const before = editor.getJSON();
    await hover(1, 1);
    await click(button("Row 2 options")!);
    await click(action("Duplicate row"));
    expect(rows()).toEqual([
      ["Alpha", "Bravo", "Charlie"],
      ["One", "Two", "Three"],
      ["One", "Two", "Three"],
      ["Four", "Five", "Six"],
    ]);
    await act(async () => editor.commands.undo());
    expect(editor.getJSON()).toEqual(before);
    setGeometry();
    await hover(2, 1);
    await click(button("Column 2 options")!);
    await click(action("Delete column"));
    expect(rows()).toEqual([
      ["Alpha", "Charlie"],
      ["One", "Three"],
      ["Four", "Six"],
    ]);
    await act(async () => editor.commands.undo());
    expect(editor.getJSON()).toEqual(before);
  });

  it("scopes actions to the hovered table when a note contains several tables", async () => {
    const second = `<table><tbody><tr><td><p>Other A</p></td><td><p>Other B</p></td></tr>
      <tr><td><p>Other C</p></td><td><p>Other D</p></td></tr></tbody></table>`;
    const { editor } = await mount(false, content + second);
    const firstRows = rows();
    const secondTable =
      editor.view.dom.querySelectorAll<HTMLTableElement>("table")[1];
    secondTable.getBoundingClientRect = () => new DOMRect(110, 350, 300, 80);
    [...secondTable.rows].forEach((row, rowIndex) => {
      row.getBoundingClientRect = () =>
        new DOMRect(110, 350 + rowIndex * 40, 300, 40);
      [...row.cells].forEach((cell, columnIndex) => {
        cell.getBoundingClientRect = () =>
          new DOMRect(110 + columnIndex * 150, 350 + rowIndex * 40, 150, 40);
      });
    });
    await caret(0, 0);
    await pointer(secondTable.rows[1].cells[1], "pointerover");
    await pointer(secondTable.rows[1].cells[1]);
    await click(button("Row 2 options")!);
    expect(selectedTexts()).toEqual(["Other C", "Other D"]);
    await click(action("Insert below"));
    expect(rows()).toEqual(firstRows);
    expect(rows(1)).toEqual([
      ["Other A", "Other B"],
      ["Other C", "Other D"],
      ["", ""],
    ]);
  });

  it("clears only the selected row while retaining the table structure", async () => {
    const { editor } = await mount();
    const before = editor.getJSON();
    await hover(2, 0);
    await click(button("Row 3 options")!);
    await click(action("Clear contents"));
    expect(rows()).toEqual([
      ["Alpha", "Bravo", "Charlie"],
      ["One", "Two", "Three"],
      ["", "", ""],
    ]);
    await act(async () => editor.commands.undo());
    expect(editor.getJSON()).toEqual(before);
  });

  it("changes header styling for only the chosen column and exposes its checked state", async () => {
    const { editor, setGeometry } = await mount();
    const before = editor.getJSON();
    await hover(1, 1);
    await click(button("Column 2 options")!);
    const header = action("Header column");
    expect(header.getAttribute("role")).toBe("menuitemcheckbox");
    expect(header.getAttribute("aria-checked")).toBe("false");
    await click(header);
    expect(
      [...editor.view.dom.querySelector<HTMLTableElement>("table")!.rows].map(
        (row) => [...row.cells].map((cell) => cell.tagName),
      ),
    ).toEqual([
      ["TH", "TH", "TH"],
      ["TD", "TH", "TD"],
      ["TD", "TH", "TD"],
    ]);
    setGeometry();
    await hover(1, 1);
    await click(button("Column 2 options")!);
    expect(action("Header column").getAttribute("aria-checked")).toBe("true");
    await escape();
    await act(async () => editor.commands.undo());
    expect(editor.getJSON()).toEqual(before);
  });

  it("deletes the table without affecting surrounding paragraphs and restores it with undo", async () => {
    const { editor } = await mount();
    const before = editor.getJSON();
    await hover(1, 0);
    await click(button("Row 2 options")!);
    await click(action("Delete table"));
    expect(rows()).toEqual([]);
    expect(
      editor.getJSON().content?.map((node) => node.content?.[0]?.text),
    ).toEqual(["Before table", "After table"]);
    expect(menu()).toBeNull();
    await act(async () => editor.commands.undo());
    expect(editor.getJSON()).toEqual(before);
  });

  it("closes stale options after an incoming document change without restoring an old selection", async () => {
    const { editor } = await mount();
    await hover(1, 0);
    await click(button("Row 2 options")!);
    expect(menu()).not.toBeNull();
    await act(async () =>
      editor.commands.setContent("<p>Synced note from another device</p>", {
        emitUpdate: false,
      }),
    );
    const afterSync = editor.state.selection;
    await flushFrames();
    expect(menu()).toBeNull();
    expect(button("Row 2 options")).toBeNull();
    expect(editor.state.selection.eq(afterSync)).toBe(true);
    expect(editor.getText()).toBe("Synced note from another device");
  });

  it("supports keyboard navigation in the popup and returns focus to the preserved caret", async () => {
    const { editor } = await mount();
    const prior = await caret(1, 0);
    await click(button("Row 2 options")!);
    expect(document.activeElement).toBe(action("Insert above"));
    const key = async (value: string) => {
      await act(async () =>
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: value,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
    };
    await key("ArrowDown");
    expect(document.activeElement).toBe(action("Insert below"));
    await key("End");
    expect(document.activeElement).toBe(action("Delete table"));
    await key("ArrowDown");
    expect(document.activeElement).toBe(action("Insert above"));
    await key("ArrowUp");
    expect(document.activeElement).toBe(action("Delete table"));
    await key("Home");
    expect(document.activeElement).toBe(action("Insert above"));
    await escape();
    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.state.selection.eq(prior)).toBe(true);
  });

  it.each(["normal", "insert"] as const)(
    "preserves Vim %s mode through menu dismissal and row/column edits",
    async (mode) => {
      const { editor, setGeometry } = await mount(false, content, true);
      await caret(1, 0);
      const editorKey = async (key: string) => {
        await act(async () =>
          editor.view.dom.dispatchEvent(
            new KeyboardEvent("keydown", {
              key,
              bubbles: true,
              cancelable: true,
            }),
          ),
        );
        await flushFrames();
      };
      if (mode === "insert") await editorKey("i");
      else {
        await editorKey("d");
        expect(vimPluginKey.getState(editor.state)?.operator).toBe("d");
      }
      const prior = editor.state.selection;
      const before = editor.getJSON();
      await click(button("Row 2 options")!);
      expect(vimPluginKey.getState(editor.state)?.mode).toBe(mode);
      expect(vimPluginKey.getState(editor.state)?.operator).toBeNull();
      await escape();
      expect(vimPluginKey.getState(editor.state)?.mode).toBe(mode);
      expect(editor.state.selection.eq(prior)).toBe(true);
      expect(editor.getJSON()).toEqual(before);
      expect(editor.view.hasFocus()).toBe(true);

      await hover(1, 0);
      await click(button("Column 1 options")!);
      await click(action("Insert right"));
      expect(vimPluginKey.getState(editor.state)?.mode).toBe(mode);
      expect(editor.view.hasFocus()).toBe(true);
      expect(rows()[1]).toEqual(["One", "", "Two", "Three"]);
      setGeometry();
      await hover(2, 0);
      await click(button("Row 3 options")!);
      await click(action("Delete row"));
      expect(vimPluginKey.getState(editor.state)?.mode).toBe(mode);
      expect(editor.view.hasFocus()).toBe(true);
      expect(rows()).toEqual([
        ["Alpha", "", "Bravo", "Charlie"],
        ["One", "", "Two", "Three"],
      ]);
    },
  );

  it("repositions its popup when scrolling shifts the table and editor surface together", async () => {
    const { editor, surface } = await mount();
    await hover(1, 0);
    await click(button("Row 2 options")!);
    const initialTop = parseFloat(menu()!.style.top);
    const initialLeft = parseFloat(menu()!.style.left);
    const translated = [
      surface,
      editor.view.dom,
      ...editor.view.dom.querySelectorAll<HTMLElement>(
        ".tableWrapper,table,tr,td,th",
      ),
    ];
    for (const element of translated) {
      const rect = element.getBoundingClientRect();
      element.getBoundingClientRect = () =>
        new DOMRect(rect.left + 30, rect.top - 50, rect.width, rect.height);
    }
    await act(async () => document.dispatchEvent(new Event("scroll")));
    await flushFrames();
    expect(parseFloat(menu()!.style.top)).toBe(initialTop - 50);
    expect(parseFloat(menu()!.style.left)).toBe(initialLeft + 30);
    expect(selectedTexts()).toEqual(["One", "Three", "Two"]);
  });

  it("reclamps its popup when the visual viewport shrinks for the software keyboard", async () => {
    const viewport = Object.assign(new EventTarget(), {
      width: 800,
      height: 700,
      offsetLeft: 0,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    await mount(true);
    await caret(1, 0);
    await click(button("Row 2 options")!);
    menu()!.getBoundingClientRect = () => new DOMRect(0, 0, 224, 300);
    Object.assign(viewport, {
      width: 300,
      height: 200,
      offsetLeft: 25,
      offsetTop: 40,
    });
    await act(async () => viewport.dispatchEvent(new Event("resize")));
    await flushFrames();
    expect(menu()!.style.maxHeight).toBe("184px");
    expect(parseFloat(menu()!.style.top)).toBe(48);
    expect(parseFloat(menu()!.style.left)).toBeLessThanOrEqual(93);
    expect(parseFloat(menu()!.style.left)).toBeGreaterThanOrEqual(33);
    expect(selectedTexts()).toEqual(["One", "Three", "Two"]);
  });

  it("discards an open menu when another editor control hides the table controls", async () => {
    const { editor, setHidden } = await mount();
    const prior = await caret(0, 0);
    const before = editor.getJSON();
    await hover(1, 1);
    await click(button("Row 2 options")!);
    expect(menu()).not.toBeNull();
    await setHidden(true);
    expect(menu()).toBeNull();
    expect(button("Row 2 options")).toBeNull();
    expect(editor.state.selection.eq(prior)).toBe(true);
    await setHidden(false);
    expect(menu()).toBeNull();
    expect(editor.getJSON()).toEqual(before);
    await hover(2, 0);
    await click(button("Row 3 options")!);
    expect(menu("Row 3")).not.toBeNull();
    expect(selectedTexts()).toEqual(["Five", "Four", "Six"]);
  });

  it("offers the active cell's handles for keyboard and touch without requiring mouse hover", async () => {
    await mount(true);
    await caret(2, 1);
    expect(button("Row 3 options")).not.toBeNull();
    expect(button("Column 2 options")).not.toBeNull();
    await click(button("Column 2 options")!);
    expect(menu("Column 2")).not.toBeNull();
    expect(selectedTexts()).toEqual(["Bravo", "Five", "Two"]);
    await escape();
    await act(async () => editor!.commands.setTextSelection(2));
    await flushFrames();
    expect(document.querySelector('[aria-label$=" options"]')).toBeNull();
  });
});
