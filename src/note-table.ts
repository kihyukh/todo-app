import { Extension, type Editor, type JSONContent } from "@tiptap/core";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import {
  addColumn,
  addRow,
  CellSelection,
  columnResizingPluginKey,
  removeColumn,
  removeRow,
  TableMap,
  type TableRect,
} from "@tiptap/pm/tables";

export type TableTarget = {
  /** Position immediately before the table node, not its content. */
  tablePos: number;
  axis: "row" | "column";
  index: number;
};

export type TableAction =
  | "insertBefore"
  | "insertAfter"
  | "duplicate"
  | "delete"
  | "toggleHeader"
  | "clear"
  | "deleteTable";

export type TableInfo = {
  node: ProseMirrorNode;
  map: TableMap;
  pos: number;
  start: number;
};

export function getTableInfo(
  editor: Editor,
  tablePos: number,
): TableInfo | null {
  if (
    !Number.isInteger(tablePos) ||
    tablePos < 0 ||
    tablePos >= editor.state.doc.content.size
  )
    return null;
  const node = editor.state.doc.nodeAt(tablePos);
  if (!node || node.type.spec.tableRole !== "table") return null;
  const map = TableMap.get(node);
  if (!map.width || !map.height || map.problems?.length) return null;
  return { node, map, pos: tablePos, start: tablePos + 1 };
}

/** DOM positions are resolved through the document map, so row/col spans work. */
export function tableTargetAtCell(editor: Editor, cell: HTMLElement | number) {
  try {
    if (typeof cell !== "number" && !editor.view.dom.contains(cell))
      return null;
    const pos = typeof cell === "number" ? cell : editor.view.posAtDOM(cell, 0);
    if (pos < 0 || pos > editor.state.doc.content.size) return null;
    const $pos = editor.state.doc.resolve(pos);
    let tablePos: number | null = null;
    let cellPos: number | null = null;
    for (let depth = $pos.depth; depth > 0; depth--) {
      const role = $pos.node(depth).type.spec.tableRole;
      if (cellPos === null && (role === "cell" || role === "header_cell"))
        cellPos = $pos.before(depth);
      if (role === "table") {
        tablePos = $pos.before(depth);
        break;
      }
    }
    if (
      cellPos === null &&
      ["cell", "header_cell"].includes($pos.nodeAfter?.type.spec.tableRole)
    )
      cellPos = pos;
    if (tablePos === null || cellPos === null) return null;
    const info = getTableInfo(editor, tablePos);
    if (!info) return null;
    const rect = info.map.findCell(cellPos - info.start);
    return {
      tablePos,
      cellPos,
      row: rect.top,
      column: rect.left,
      rowspan: rect.bottom - rect.top,
      colspan: rect.right - rect.left,
    };
  } catch {
    return null;
  }
}

function targetInfo(editor: Editor, target: TableTarget) {
  const info = getTableInfo(editor, target.tablePos);
  const size = target.axis === "row" ? info?.map.height : info?.map.width;
  return info &&
    Number.isInteger(target.index) &&
    target.index >= 0 &&
    size &&
    target.index < size
    ? info
    : null;
}

function targetRect(info: TableInfo, target: TableTarget): TableRect {
  return {
    table: info.node,
    tableStart: info.start,
    map: info.map,
    left: target.axis === "column" ? target.index : 0,
    right: target.axis === "column" ? target.index + 1 : info.map.width,
    top: target.axis === "row" ? target.index : 0,
    bottom: target.axis === "row" ? target.index + 1 : info.map.height,
  };
}

function targetSelection(editor: Editor, info: TableInfo, target: TableTarget) {
  const { map, start } = info;
  const first = target.axis === "row" ? target.index * map.width : target.index;
  const last =
    target.axis === "row"
      ? first + map.width - 1
      : (map.height - 1) * map.width + target.index;
  const anchor = editor.state.doc.resolve(start + map.map[first]);
  const head = editor.state.doc.resolve(start + map.map[last]);
  return target.axis === "row"
    ? CellSelection.rowSelection(anchor, head)
    : CellSelection.colSelection(anchor, head);
}

export function selectTableTarget(
  editor: Editor,
  target: TableTarget,
): boolean {
  const info = targetInfo(editor, target);
  if (!info || !editor.isEditable) return false;
  editor.view.dispatch(
    editor.state.tr.setSelection(targetSelection(editor, info, target)),
  );
  return true;
}

function hasMergedCells(info: TableInfo) {
  return info.node.content.content.some((row) =>
    row.content.content.some(
      (cell) => cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1,
    ),
  );
}

export function canTableAction(
  editor: Editor,
  target: TableTarget,
  action: TableAction,
): boolean {
  const info = targetInfo(editor, target);
  if (!info || !editor.isEditable) return false;
  if (action === "delete")
    return (target.axis === "row" ? info.map.height : info.map.width) > 1;
  if (action === "duplicate") return !hasMergedCells(info);
  return [
    "insertBefore",
    "insertAfter",
    "toggleHeader",
    "clear",
    "deleteTable",
  ].includes(action);
}

/** Each operation is one history step and is scoped to the clicked axis. */
export function runTableAction(
  editor: Editor,
  target: TableTarget,
  action: TableAction,
): boolean {
  if (!canTableAction(editor, target, action)) return false;
  const info = targetInfo(editor, target)!;
  const rect = targetRect(info, target);
  const tr = closeHistory(editor.state.tr);
  tr.setSelection(targetSelection(editor, info, target));
  if (action === "deleteTable") {
    tr.delete(info.pos, info.pos + info.node.nodeSize);
  } else if (action === "insertBefore" || action === "insertAfter") {
    const index = target.index + (action === "insertAfter" ? 1 : 0);
    (target.axis === "row" ? addRow : addColumn)(tr, rect, index);
  } else if (action === "delete") {
    (target.axis === "row" ? removeRow : removeColumn)(tr, rect, target.index);
  } else if (action === "duplicate") {
    if (target.axis === "row") {
      let offset = info.start;
      for (let i = 0; i <= target.index; i++)
        offset += info.node.child(i).nodeSize;
      tr.insert(offset, info.node.child(target.index));
    } else {
      const positions = Array.from(
        { length: info.map.height },
        (_, row) => info.map.map[row * info.map.width + target.index],
      );
      for (const pos of positions.reverse()) {
        const cell = info.node.nodeAt(pos)!;
        tr.insert(info.start + pos + cell.nodeSize, cell);
      }
    }
  } else {
    const cells = info.map.cellsInRect(rect);
    // cellsInRect excludes cells which start above/left of the requested axis.
    // Include those spanning cells once, matching the visible cell highlight.
    for (let row = rect.top; row < rect.bottom; row++) {
      for (let col = rect.left; col < rect.right; col++) {
        const pos = info.map.map[row * info.map.width + col];
        if (!cells.includes(pos)) cells.push(pos);
      }
    }
    const allHeaders = cells.every(
      (pos) => info.node.nodeAt(pos)?.type.spec.tableRole === "header_cell",
    );
    const type = editor.schema.nodes[allHeaders ? "tableCell" : "tableHeader"];
    for (const pos of cells.sort((a, b) => b - a)) {
      const cell = info.node.nodeAt(pos)!;
      if (action === "toggleHeader")
        tr.setNodeMarkup(info.start + pos, type, cell.attrs);
      else {
        const empty = cell.type.createAndFill(cell.attrs);
        if (empty)
          tr.replaceWith(
            info.start + pos,
            info.start + pos + cell.nodeSize,
            empty,
          );
      }
    }
  }
  if (!tr.docChanged) return false;
  // Leave a caret in the surviving table/note, never a lingering multi-cell
  // selection that could erase a whole row when the user resumes typing.
  const pos = Math.min(
    tr.mapping.map(
      info.start +
        info.map.map[
          target.axis === "row" ? target.index * info.map.width : target.index
        ],
    ),
    tr.doc.content.size,
  );
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, pos))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

const widthMarker =
  /^<!-- greenday-table-widths: ([\d,]+)(?:; headers: ([01,]+))? -->\r?\n/;
const tableTokenizer = Table.config.markdownTokenizer!;

/** GFM only supports a first header row; metadata retains other header layouts. */
const NoteTable = Table.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    if (!this.options.resizable) return plugins;
    return [
      new Plugin({
        key: new PluginKey("noteTableResizeStart"),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (!view.editable || event.button !== 0) return false;
              // A quick press-and-drag (including native pointer delivery)
              // may arrive before hover. Refresh the installed resize
              // plugin's own hit-test, then let its normal mousedown handler
              // own the gesture, preview, commit, and listener cleanup.
              const resize = columnResizingPluginKey.get(view.state);
              resize?.props.handleDOMEvents?.mousemove?.call(
                resize,
                view,
                event,
              );
              return false;
            },
          },
        },
      }),
      ...plugins,
    ];
  },
  renderMarkdown(node, helpers, context) {
    const markdown =
      Table.config.renderMarkdown?.(node, helpers, context) ?? "";
    const widths: number[] = [];
    node.content?.[0]?.content?.forEach((cell) => {
      for (let index = 0; index < (cell.attrs?.colspan ?? 1); index++) {
        const value = cell.attrs?.colwidth?.[index];
        widths.push(
          Number.isFinite(value) && value > 0 ? Math.round(value) : 0,
        );
      }
    });
    const headers =
      node.content?.map(
        (row) =>
          row.content
            ?.map((cell) => (cell.type === "tableHeader" ? "1" : "0"))
            .join("") ?? "",
      ) ?? [];
    const customHeaders = headers.some(
      (cells, row) => cells !== (row === 0 ? "1" : "0").repeat(cells.length),
    );
    return widths.some(Boolean) || customHeaders
      ? `<!-- greenday-table-widths: ${widths.join(",")}${customHeaders ? `; headers: ${headers.join(",")}` : ""} -->\n${markdown.trim()}\n`
      : markdown;
  },
  parseMarkdown(token, helpers) {
    const parsed = Table.config.parseMarkdown?.(token, helpers);
    const node =
      parsed && !Array.isArray(parsed) ? (parsed as JSONContent) : null;
    const widths = token.greendayWidths as number[] | undefined;
    const headers = token.greendayHeaders as string[] | undefined;
    if (node?.type === "table" && widths && widths.length <= 200) {
      if (headers && node.content) {
        // The standard GFM serializer inserts an empty first header row for
        // headerless tables. Remove it only while it is still truly empty;
        // text deliberately added there in Source remains a new row.
        if (
          headers.length === node.content.length - 1 &&
          !headers[0]?.includes("1") &&
          node.content[0].content?.every((cell) =>
            cell.content?.every((block) => !block.content?.length),
          )
        ) {
          node.content.shift();
        }
        // If Source edits changed dimensions, ignore the old type map rather
        // than overwriting or dropping newly entered rows/columns.
        if (
          headers.length === node.content.length &&
          node.content.every(
            (row, index) => row.content?.length === headers[index].length,
          )
        ) {
          node.content.forEach((row, rowIndex) =>
            row.content?.forEach((cell, column) => {
              cell.type =
                headers[rowIndex][column] === "1" ? "tableHeader" : "tableCell";
            }),
          );
        }
      }
      node.content?.forEach((row) => {
        let col = 0;
        row.content?.forEach((cell) => {
          const span = cell.attrs?.colspan ?? 1;
          const colwidth = widths.slice(col, col + span);
          if (colwidth.length === span && colwidth.some(Boolean))
            cell.attrs = { ...cell.attrs, colwidth };
          col += span;
        });
      });
    }
    return parsed ?? [];
  },
  markdownTokenizer: {
    ...tableTokenizer,
    start(src) {
      if (widthMarker.test(src)) return 0;
      return typeof tableTokenizer.start === "function"
        ? tableTokenizer.start(src)
        : -1;
    },
    tokenize(src, tokens, helpers) {
      const match = src.match(widthMarker);
      if (!match) return tableTokenizer.tokenize(src, tokens, helpers);
      const widths = match[1].split(",").map(Number);
      const headers = match[2]?.split(",");
      if (
        widths.length > 200 ||
        widths.some((value) => value < 0 || value > 10000) ||
        (headers &&
          (headers.length > 2000 ||
            headers.some((row) => !row.length || row.length > 200)))
      )
        return undefined;
      const remainder = src.slice(match[0].length);
      const blankLine = remainder.indexOf("\n\n");
      // Keep the nested lexer scoped to this table. Lexing the rest of the
      // note here would enqueue later inline tokens twice in marked.
      const candidate =
        blankLine < 0 ? remainder : remainder.slice(0, blankLine);
      const token = helpers.blockTokens(candidate)[0];
      if (token?.type !== "table" || !token.raw) return undefined;
      return {
        ...token,
        raw: match[0] + token.raw,
        greendayWidths: widths,
        greendayHeaders: headers,
      };
    },
  },
});

export const NoteTableKit = Extension.create({
  name: "noteTableKit",
  addExtensions() {
    return [
      NoteTable.configure({
        resizable: true,
        cellMinWidth: 80,
        handleWidth: 5,
        lastColumnResizable: true,
      }),
      TableCell,
      TableHeader,
      TableRow,
    ];
  },
});
