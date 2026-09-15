// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { CellSelection, columnResizingPluginKey } from "@tiptap/pm/tables";
import {
  NoteTableKit,
  canTableAction,
  getTableInfo,
  runTableAction,
  selectTableTarget,
  tableTargetAtCell,
  type TableTarget,
} from "../src/note-table";

const editors: Editor[] = [];
beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
const cell = (text: string, attrs = {}, header = false): JSONContent => ({
  type: header ? "tableHeader" : "tableCell",
  attrs,
  content: [paragraph(text)],
});
const row = (...content: JSONContent[]): JSONContent => ({
  type: "tableRow",
  content,
});
const table = (...content: JSONContent[]): JSONContent => ({
  type: "table",
  content,
});
function grid() {
  return table(
    row(
      cell("A", { colwidth: [140] }, true),
      cell("B", { colwidth: [220] }, true),
    ),
    row(cell("C", { colwidth: [140] }), cell("D", { colwidth: [220] })),
    row(cell("E", { colwidth: [140] }), cell("F", { colwidth: [220] })),
  );
}
function createEditor(
  content: JSONContent[] | string = [
    paragraph("Before"),
    grid(),
    paragraph("After"),
  ],
) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [StarterKit, NoteTableKit, Markdown],
    content: typeof content === "string" ? content : { type: "doc", content },
    ...(typeof content === "string"
      ? { contentType: "markdown" as const }
      : {}),
  });
  editors.push(editor);
  return editor;
}
function target(
  editor: Editor,
  axis: TableTarget["axis"],
  index: number,
): TableTarget {
  let tablePos = -1;
  editor.state.doc.descendants((node, pos) => {
    if (tablePos < 0 && node.type.name === "table") tablePos = pos;
  });
  return { tablePos, axis, index };
}
function texts(editor: Editor) {
  const info = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
  return info.node.content.content.map((r) =>
    r.content.content.map((c) => c.textContent),
  );
}
function resize(editor: Editor, column: number, difference: number) {
  const info = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
  const cellPos = info.start + info.map.map[column];
  const dom = editor.view.nodeDOM(cellPos) as HTMLElement;
  vi.spyOn(dom, "getBoundingClientRect").mockReturnValue(
    new DOMRect(60, 20, 140, 40),
  );
  vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
    pos: cellPos + 2,
    inside: cellPos,
  });
  editor.view.dispatch(
    editor.state.tr.setMeta(columnResizingPluginKey, { setHandle: cellPos }),
  );
  dom.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX: 200,
    }),
  );
  window.dispatchEvent(
    new MouseEvent("mouseup", { bubbles: true, clientX: 200 + difference }),
  );
}

describe("table column resizing and source persistence", () => {
  it("starts resizing on a border press without any preceding hover event", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const info = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
    const cellPos = info.start + info.map.map[0];
    const dom = editor.view.nodeDOM(cellPos) as HTMLElement;
    vi.spyOn(dom, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 20, 140, 40),
    );
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: cellPos + 2,
      inside: cellPos,
    });
    expect(columnResizingPluginKey.getState(editor.state)?.activeHandle).toBe(
      -1,
    );
    const down = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 239,
      clientY: 40,
    });
    dom.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(columnResizingPluginKey.getState(editor.state)?.dragging).toEqual({
      startX: 239,
      startWidth: 140,
    });
    expect(editor.getJSON()).toEqual(before);
    window.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 319, clientY: 40 }),
    );
    const updated = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
    updated.node.content.content.forEach((r) =>
      expect(r.child(0).attrs.colwidth).toEqual([220]),
    );
    expect(columnResizingPluginKey.getState(editor.state)?.dragging).toBeNull();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("leaves ordinary text presses to the editor and does not resize read-only content", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const info = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
    const cellPos = info.start + info.map.map[0];
    const dom = editor.view.nodeDOM(cellPos) as HTMLElement;
    vi.spyOn(dom, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 20, 140, 40),
    );
    vi.spyOn(editor.view, "posAtCoords").mockReturnValue({
      pos: cellPos + 2,
      inside: cellPos,
    });
    const plain = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 170,
      clientY: 40,
    });
    dom.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(columnResizingPluginKey.getState(editor.state)?.activeHandle).toBe(
      -1,
    );
    expect(columnResizingPluginKey.getState(editor.state)?.dragging).toBe(
      false,
    );
    editor.setEditable(false);
    dom.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 239,
        clientY: 40,
      }),
    );
    window.dispatchEvent(
      new MouseEvent("mouseup", { clientX: 319, clientY: 40 }),
    );
    expect(editor.getJSON()).toEqual(before);
    expect(columnResizingPluginKey.getState(editor.state)?.dragging).toBe(
      false,
    );
  });

  it("installs native resize handles and commits width consistently across rows in one undo", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    expect(
      editor.view.dom.querySelector(".tableWrapper colgroup"),
    ).not.toBeNull();
    resize(editor, 0, 75);
    const info = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
    info.node.content.content.forEach((r) =>
      expect(r.child(0).attrs.colwidth).toEqual([215]),
    );
    expect(columnResizingPluginKey.getState(editor.state)?.dragging).toBeNull();
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("resizes the last column, clamps minimum width, and retains the neighboring width", () => {
    const editor = createEditor();
    resize(editor, 1, -500);
    const info = getTableInfo(editor, target(editor, "row", 0).tablePos)!;
    expect(info.node.firstChild?.child(0).attrs.colwidth).toEqual([140]);
    expect(info.node.firstChild?.child(1).attrs.colwidth).toEqual([80]);
  });

  it("reopens resized source without losing widths, surrounding notes, or duplicating the table", () => {
    const editor = createEditor();
    resize(editor, 0, 75);
    const before = editor.getJSON();
    const markdown = editor.getMarkdown();
    expect(markdown).toContain("<!-- greenday-table-widths: 215,220 -->");
    const reopened = createEditor(markdown);
    expect(reopened.getJSON()).toEqual(before);
    reopened.commands.setContent(
      reopened.getMarkdown().replace("| C", "| Changed"),
      { contentType: "markdown" },
    );
    expect(texts(reopened)[1][0]).toBe("Changed");
    expect(
      reopened.getJSON().content?.filter((node) => node.type === "table"),
    ).toHaveLength(1);
    expect(
      getTableInfo(reopened, target(reopened, "row", 0).tablePos)!
        .node.child(1)
        .child(0).attrs.colwidth,
    ).toEqual([215]);
  });

  it("leaves unresized tables in ordinary Markdown and rejects invalid layout metadata", () => {
    const editor = createEditor([
      table(row(cell("Header", {}, true)), row(cell("Body"))),
    ]);
    expect(editor.getMarkdown()).not.toContain("greenday-table-widths");
    const bad = createEditor(
      "<!-- greenday-table-widths: 9999999 -->\n| A |\n| --- |\n| B |",
    );
    expect(
      getTableInfo(bad, target(bad, "row", 0).tablePos)!.node.firstChild
        ?.firstChild?.attrs.colwidth,
    ).toBeNull();
  });

  it.each(["row", "column"] as const)(
    "preserves a custom %s header layout with resized widths through source",
    (axis) => {
      const editor = createEditor();
      runTableAction(editor, target(editor, axis, 1), "toggleHeader");
      const before = editor.getJSON();
      const source = editor.getMarkdown();
      expect(source).toContain("; headers:");
      expect(createEditor(source).getJSON()).toEqual(before);
    },
  );

  it("round-trips a headerless table without introducing a phantom header row", () => {
    const editor = createEditor();
    runTableAction(editor, target(editor, "row", 0), "toggleHeader");
    const before = editor.getJSON();
    const source = editor.getMarkdown();
    expect(source).toContain("headers: 00,00,00");
    const reopened = createEditor(source);
    expect(reopened.getJSON()).toEqual(before);
    expect(createEditor(reopened.getMarkdown()).getJSON()).toEqual(before);
  });

  it("keeps Source edits to added rows or columns even when old header metadata no longer matches", () => {
    const editor = createEditor();
    runTableAction(editor, target(editor, "row", 1), "toggleHeader");
    const source = editor
      .getMarkdown()
      .replace(/(\| E[^\n]*\n)/, "$1| New | Row |\n");
    const reopened = createEditor(source);
    expect(texts(reopened)).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["E", "F"],
      ["New", "Row"],
    ]);
    expect(reopened.state.doc.textContent).toContain("After");
  });
});

describe("scoped table operations", () => {
  it.each(["row", "column"] as const)(
    "selects the clicked %s even when the caret is elsewhere",
    (axis) => {
      const editor = createEditor();
      const t = target(editor, axis, 1);
      expect(selectTableTarget(editor, t)).toBe(true);
      const selected = editor.state.selection as CellSelection;
      expect(selected).toBeInstanceOf(CellSelection);
      expect(
        axis === "row" ? selected.isRowSelection() : selected.isColSelection(),
      ).toBe(true);
      const content: string[] = [];
      selected.forEachCell((node) => content.push(node.textContent));
      expect(content.sort()).toEqual(
        axis === "row" ? ["C", "D"] : ["B", "D", "F"],
      );
    },
  );

  it("resolves a DOM cell and a text position to the same row and column", () => {
    const editor = createEditor();
    const cells = editor.view.dom.querySelectorAll("td,th");
    const fromDOM = tableTargetAtCell(editor, cells[3] as HTMLElement)!;
    expect(fromDOM).toMatchObject({
      row: 1,
      column: 1,
      rowspan: 1,
      colspan: 1,
    });
    expect(tableTargetAtCell(editor, fromDOM.cellPos + 2)).toEqual(fromDOM);
    expect(tableTargetAtCell(editor, document.createElement("td"))).toBeNull();
    expect(tableTargetAtCell(editor, 1)).toBeNull();
  });

  it.each(["row", "column"] as const)(
    "inserts, duplicates, and deletes a %s as separate undoable steps",
    (axis) => {
      const editor = createEditor();
      const before = editor.getJSON();
      const t = target(editor, axis, 1);
      expect(runTableAction(editor, t, "duplicate")).toBe(true);
      expect(texts(editor)).toEqual(
        axis === "row"
          ? [
              ["A", "B"],
              ["C", "D"],
              ["C", "D"],
              ["E", "F"],
            ]
          : [
              ["A", "B", "B"],
              ["C", "D", "D"],
              ["E", "F", "F"],
            ],
      );
      const duplicated = editor.getJSON();
      expect(runTableAction(editor, t, "delete")).toBe(true);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(duplicated);
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(before);
      expect(runTableAction(editor, t, "insertBefore")).toBe(true);
      expect(texts(editor)).toEqual(
        axis === "row"
          ? [
              ["A", "B"],
              ["", ""],
              ["C", "D"],
              ["E", "F"],
            ]
          : [
              ["A", "", "B"],
              ["C", "", "D"],
              ["E", "", "F"],
            ],
      );
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(before);
    },
  );

  it("keeps header toggles scoped to the selected row and retains widths and text", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    const t = target(editor, "row", 1);
    expect(runTableAction(editor, t, "toggleHeader")).toBe(true);
    const info = getTableInfo(editor, t.tablePos)!;
    expect(info.node.child(1).child(0).type.name).toBe("tableHeader");
    expect(info.node.child(2).child(0).type.name).toBe("tableCell");
    expect(info.node.child(1).child(0).attrs.colwidth).toEqual([140]);
    expect(texts(editor)).toEqual([
      ["A", "B"],
      ["C", "D"],
      ["E", "F"],
    ]);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("clears only one column, preserves its layout, and returns to a caret", () => {
    const editor = createEditor();
    const t = target(editor, "column", 1);
    expect(runTableAction(editor, t, "clear")).toBe(true);
    expect(texts(editor)).toEqual([
      ["A", ""],
      ["C", ""],
      ["E", ""],
    ]);
    expect(
      getTableInfo(editor, t.tablePos)!.node.child(2).child(1).attrs.colwidth,
    ).toEqual([220]);
    expect(editor.state.selection).not.toBeInstanceOf(CellSelection);
  });

  it("rejects a stale, invalid, or read-only target without editing notes", () => {
    const editor = createEditor();
    const before = editor.getJSON();
    expect(
      runTableAction(editor, { tablePos: 0, axis: "row", index: 1 }, "delete"),
    ).toBe(false);
    expect(runTableAction(editor, target(editor, "row", 99), "clear")).toBe(
      false,
    );
    editor.setEditable(false);
    expect(selectTableTarget(editor, target(editor, "row", 1))).toBe(false);
    expect(
      runTableAction(editor, target(editor, "row", 1), "deleteTable"),
    ).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });

  it("requires explicit table deletion for the final row or column, with undo", () => {
    const editor = createEditor([
      paragraph("Before"),
      table(row(cell("Only"))),
      paragraph("After"),
    ]);
    const before = editor.getJSON();
    expect(canTableAction(editor, target(editor, "row", 0), "delete")).toBe(
      false,
    );
    expect(canTableAction(editor, target(editor, "column", 0), "delete")).toBe(
      false,
    );
    expect(
      runTableAction(editor, target(editor, "row", 0), "deleteTable"),
    ).toBe(true);
    expect(editor.state.doc.textContent).toBe("BeforeAfter");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("targets the visual grid with merged cells and safely disables duplication", () => {
    const editor = createEditor([
      paragraph("Before"),
      table(
        row(cell("Span", { rowspan: 2 }), cell("B"), cell("C")),
        row(cell("D"), cell("E")),
        row(cell("F"), cell("G"), cell("H")),
      ),
      paragraph("After"),
    ]);
    const cells = editor.view.dom.querySelectorAll("td");
    expect(tableTargetAtCell(editor, cells[3] as HTMLElement)).toMatchObject({
      row: 1,
      column: 1,
    });
    expect(tableTargetAtCell(editor, cells[0] as HTMLElement)).toMatchObject({
      row: 0,
      column: 0,
      rowspan: 2,
    });
    const t = target(editor, "row", 1);
    const before = editor.getJSON();
    expect(canTableAction(editor, t, "duplicate")).toBe(false);
    expect(runTableAction(editor, t, "delete")).toBe(true);
    const info = getTableInfo(editor, t.tablePos)!;
    expect(info.map.height).toBe(2);
    expect(texts(editor)).toEqual([
      ["Span", "B", "C"],
      ["F", "G", "H"],
    ]);
    expect(info.node.child(0).child(0).attrs.rowspan).toBe(1);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });
});
