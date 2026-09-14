import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { SelectionBookmark } from "@tiptap/pm/state";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Copy,
  Eraser,
  GripHorizontal,
  GripVertical,
  Trash2,
} from "lucide-react";
import { usesTouchInterface } from "./platform";
import { clearVimPendingAction } from "./vim-editor";
import {
  canTableAction,
  getTableInfo,
  runTableAction,
  selectTableTarget,
  tableTargetAtCell,
} from "./note-table";
import type { TableTarget } from "./note-table";
import "./note-table-controls.css";

type ActiveCell = { tablePos: number; row: number; column: number };
type Box = { left: number; top: number; width: number; height: number };
type Layout = {
  row: Box;
  column: Box;
  rows: number;
  columns: number;
  origin: { left: number; top: number };
  viewport: Box;
};
type Menu = {
  target: TableTarget;
  bookmark: SelectionBookmark;
  doc: Editor["state"]["doc"];
};

/** Controls live outside ProseMirror so hovering never edits the note or moves its caret. */
export default function NoteTableControls({
  editor,
  hidden = false,
}: {
  editor: Editor;
  hidden?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const hover = useRef<ActiveCell | null>(null);
  const activeRef = useRef<ActiveCell | null>(null);
  const menuRef = useRef<Menu | null>(null);
  const refresh = useRef<() => void>(() => {});
  const [active, setActive] = useState<ActiveCell | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, maxHeight: 420 });
  const [touch] = useState(usesTouchInterface);

  const close = (restore = true, focus = true) => {
    const previous = menuRef.current;
    menuRef.current = null;
    setMenu(null);
    if (!previous || editor.isDestroyed) return;
    if (focus) editor.view.focus();
    if (restore && previous.doc.eq(editor.state.doc)) {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          previous.bookmark.resolve(editor.state.doc),
        ),
      );
    }
    refresh.current();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!hidden) return;
    hover.current = null;
    closeRef.current(true, false);
  }, [hidden]);

  useEffect(() => {
    if (hidden || editor.isDestroyed) return;
    const surface = rail.current?.parentElement;
    if (!surface) return;
    const dom = editor.view.dom;
    let frame = 0;
    let hideTimer = 0;
    let disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed || editor.isDestroyed) return;
      let next = activeRef.current;
      if (!menuRef.current) {
        const focused =
          editor.view.hasFocus() ||
          rail.current?.contains(document.activeElement);
        next =
          hover.current ??
          (focused
            ? tableTargetAtCell(editor, editor.state.selection.from)
            : null);
      }
      const info = next && getTableInfo(editor, next.tablePos);
      const nodeDOM = info && editor.view.nodeDOM(info.pos);
      const table =
        nodeDOM instanceof HTMLTableElement
          ? nodeDOM
          : nodeDOM instanceof HTMLElement
            ? nodeDOM.querySelector("table")
            : null;
      if (
        !editor.isEditable ||
        !next ||
        !info ||
        !table ||
        !table.isConnected
      ) {
        activeRef.current = null;
        setActive(null);
        setLayout(null);
        return;
      }
      next = {
        tablePos: next.tablePos,
        row: Math.min(next.row, info.map.height - 1),
        column: Math.min(next.column, info.map.width - 1),
      };
      activeRef.current = next;
      setActive((before) =>
        before &&
        before.tablePos === next!.tablePos &&
        before.row === next!.row &&
        before.column === next!.column
          ? before
          : next,
      );
      const surfaceBox = surface.getBoundingClientRect();
      const tableBox = table.getBoundingClientRect();
      const wrapper = table.closest(".tableWrapper") ?? table;
      const visible = wrapper.getBoundingClientRect();
      // Prefer unmerged cells; a merged cell supplies proportional fallback geometry.
      const axisBounds = (axis: "row" | "column", index: number) => {
        let best: { start: number; end: number; span: number } | null = null;
        const offsets = new Set(
          axis === "row"
            ? info.map.map.slice(
                index * info.map.width,
                (index + 1) * info.map.width,
              )
            : Array.from(
                { length: info.map.height },
                (_, row) => info.map.map[row * info.map.width + index],
              ),
        );
        for (const offset of offsets) {
          const rect = info.map.findCell(offset);
          const first = axis === "row" ? rect.top : rect.left;
          const last = axis === "row" ? rect.bottom : rect.right;
          if (index < first || index >= last) continue;
          const cell = editor.view.nodeDOM(info.start + offset);
          if (!(cell instanceof HTMLElement)) continue;
          const box = cell.getBoundingClientRect();
          const start = axis === "row" ? box.top : box.left;
          const size = axis === "row" ? box.height : box.width;
          const span = last - first;
          const candidate = {
            start: start + (size * (index - first)) / span,
            end: start + (size * (index - first + 1)) / span,
            span,
          };
          if (!best || span < best.span) best = candidate;
          if (span === 1) break;
        }
        return best;
      };
      const row = axisBounds("row", next.row),
        column = axisBounds("column", next.column);
      if (!row || !column) {
        setLayout(null);
        return;
      }
      const gutter = touch ? 24 : 18;
      const columnLeft = Math.max(column.start, visible.left);
      const columnRight = Math.min(column.end, visible.right);
      const measured: Layout = {
        origin: { left: surfaceBox.left, top: surfaceBox.top },
        viewport: {
          left: window.visualViewport?.offsetLeft ?? 0,
          top: window.visualViewport?.offsetTop ?? 0,
          width: window.visualViewport?.width ?? window.innerWidth,
          height: window.visualViewport?.height ?? window.innerHeight,
        },
        row: {
          left:
            Math.max(tableBox.left, visible.left) - surfaceBox.left - gutter,
          top: row.start - surfaceBox.top,
          width: gutter,
          height: row.end - row.start,
        },
        column: {
          left: columnLeft - surfaceBox.left,
          top: tableBox.top - surfaceBox.top - gutter,
          width: Math.max(0, columnRight - columnLeft),
          height: gutter,
        },
        rows: info.map.height,
        columns: info.map.width,
      };
      setLayout((before) =>
        JSON.stringify(before) === JSON.stringify(measured) ? before : measured,
      );
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure);
    };
    refresh.current = schedule;
    const pointer = (event: Event) => {
      if (menuRef.current) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-note-table-ui]")) {
        window.clearTimeout(hideTimer);
        return;
      }
      const cell = target.closest<HTMLElement>("td, th");
      if (cell && dom.contains(cell)) {
        window.clearTimeout(hideTimer);
        hover.current = tableTargetAtCell(editor, cell);
        schedule();
      } else {
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
          hover.current = null;
          schedule();
        }, 120);
      }
    };
    const selection = () => {
      if (!menuRef.current && editor.view.hasFocus()) hover.current = null;
      schedule();
    };
    const transaction = ({
      transaction,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (transaction.docChanged) {
        hover.current = null;
        if (menuRef.current) closeRef.current(false, false);
      }
      schedule();
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(surface);
    observer?.observe(dom);
    editor.on("transaction", transaction);
    editor.on("selectionUpdate", selection);
    document.addEventListener("pointermove", pointer);
    document.addEventListener("mousemove", pointer);
    dom.addEventListener("pointerover", pointer);
    dom.addEventListener("focusin", schedule);
    dom.addEventListener("focusout", schedule);
    document.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(hideTimer);
      observer?.disconnect();
      editor.off("transaction", transaction);
      editor.off("selectionUpdate", selection);
      document.removeEventListener("pointermove", pointer);
      document.removeEventListener("mousemove", pointer);
      dom.removeEventListener("pointerover", pointer);
      dom.removeEventListener("focusin", schedule);
      dom.removeEventListener("focusout", schedule);
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      refresh.current = () => {};
    };
  }, [editor, hidden, touch]);

  const open = (axis: TableTarget["axis"]) => {
    const cell = activeRef.current;
    if (!cell || editor.isDestroyed) return;
    const target: TableTarget = {
      tablePos: cell.tablePos,
      axis,
      index: axis === "row" ? cell.row : cell.column,
    };
    const before = menuRef.current;
    const next: Menu = {
      target,
      bookmark: before?.bookmark ?? editor.state.selection.getBookmark(),
      doc: editor.state.doc,
    };
    menuRef.current = next;
    clearVimPendingAction(editor.view);
    if (!selectTableTarget(editor, target)) {
      menuRef.current = null;
      return;
    }
    setMenu(next);
  };

  useLayoutEffect(() => {
    if (!menu || !layout || !rail.current || !popup.current) return;
    const surface = rail.current.parentElement!.getBoundingClientRect();
    const handle = layout[menu.target.axis];
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0,
      topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth,
      height = viewport?.height ?? window.innerHeight;
    const box = popup.current.getBoundingClientRect();
    let x =
      surface.left +
      handle.left +
      (menu.target.axis === "row" ? handle.width + 6 : 0);
    let y =
      surface.top +
      handle.top +
      (menu.target.axis === "column" ? handle.height + 6 : 0);
    // Keep the selected strip visible instead of covering a short table with its menu.
    if (menu.target.axis === "column") {
      const right = surface.left + handle.left + handle.width + 6;
      const left = surface.left + handle.left - box.width - 6;
      if (right + box.width <= leftEdge + width - 8) x = right;
      else if (left >= leftEdge + 8) x = left;
    } else {
      const below = surface.top + handle.top + handle.height + 6;
      const above = surface.top + handle.top - box.height - 6;
      if (below + box.height <= topEdge + height - 8) y = below;
      else if (above >= topEdge + 8) y = above;
    }
    setPosition({
      left: Math.max(
        leftEdge + 8,
        Math.min(x, leftEdge + width - box.width - 8),
      ),
      top: Math.max(
        topEdge + 8,
        Math.min(y, topEdge + height - Math.min(box.height, height - 16) - 8),
      ),
      maxHeight: height - 16,
    });
  }, [menu, layout]);

  useEffect(() => {
    if (!menu) return;
    popup.current
      ?.querySelector<HTMLElement>("[role^='menuitem']:not(:disabled)")
      ?.focus({ preventScroll: true });
    const outside = (event: MouseEvent) => {
      if (
        popup.current?.contains(event.target as Node) ||
        rail.current?.contains(event.target as Node)
      )
        return;
      closeRef.current(true, false);
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("mousedown", outside, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("mousedown", outside, true);
    };
  }, [menu]);

  const run = (action: Parameters<typeof runTableAction>[2]) => {
    const current = menuRef.current;
    if (!current || editor.isDestroyed || !current.doc.eq(editor.state.doc)) {
      close(false);
      return;
    }
    menuRef.current = null;
    setMenu(null);
    editor.view.focus();
    runTableAction(editor, current.target, action);
    hover.current = null;
    refresh.current();
  };

  const axis = menu?.target.axis;
  const noun = axis === "row" ? "row" : "column";
  const info = menu && getTableInfo(editor, menu.target.tablePos);
  const header =
    !!info &&
    [...new Set(info.map.map)]
      .filter((offset) => {
        const cell = info.map.findCell(offset);
        const index = menu!.target.index;
        return axis === "row"
          ? cell.top <= index && cell.bottom > index
          : cell.left <= index && cell.right > index;
      })
      .every((offset) => info.node.nodeAt(offset)?.type.name === "tableHeader");
  const items = menu
    ? [
        {
          action: "insertBefore" as const,
          label: axis === "row" ? "Insert above" : "Insert left",
          icon: axis === "row" ? ArrowUp : ArrowLeft,
        },
        {
          action: "insertAfter" as const,
          label: axis === "row" ? "Insert below" : "Insert right",
          icon: axis === "row" ? ArrowDown : ArrowRight,
        },
        {
          action: "duplicate" as const,
          label: `Duplicate ${noun}`,
          icon: Copy,
        },
        {
          action: "toggleHeader" as const,
          label: `Header ${noun}`,
          icon: null,
        },
        { action: "clear" as const, label: "Clear contents", icon: Eraser },
        { action: "delete" as const, label: `Delete ${noun}`, icon: Trash2 },
        { action: "deleteTable" as const, label: "Delete table", icon: Trash2 },
      ]
    : [];

  return (
    <>
      <div
        ref={rail}
        data-note-table-ui="handles"
        className={`note-table-controls${touch ? " is-touch" : ""}${active && layout && !hidden ? " is-visible" : ""}`}
      >
        {!hidden &&
          active &&
          layout &&
          (["row", "column"] as const).map((direction) => {
            const index = direction === "row" ? active.row : active.column;
            const box = layout[direction];
            if (box.width <= 0 || box.height <= 0) return null;
            return (
              <button
                key={direction}
                type="button"
                className={`note-table-handle is-${direction}${menu?.target.axis === direction ? " is-open" : ""}`}
                style={box}
                aria-label={`${direction === "row" ? "Row" : "Column"} ${index + 1} options`}
                title={`${direction === "row" ? "Row" : "Column"} ${index + 1} options`}
                aria-haspopup="menu"
                aria-expanded={menu?.target.axis === direction}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => open(direction)}
              >
                {direction === "row" ? (
                  <GripVertical size={12} />
                ) : (
                  <GripHorizontal size={12} />
                )}
              </button>
            );
          })}
      </div>
      {!hidden &&
        menu &&
        createPortal(
          <div
            ref={popup}
            data-note-table-ui="menu"
            className="note-table-menu"
            role="menu"
            aria-label={`${axis === "row" ? "Row" : "Column"} ${menu.target.index + 1}`}
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
                return;
              }
              if (event.key === "Tab") {
                event.preventDefault();
                close();
                return;
              }
              if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
                return;
              event.preventDefault();
              event.stopPropagation();
              const buttons = Array.from(
                popup.current?.querySelectorAll<HTMLButtonElement>(
                  "[role^='menuitem']:not(:disabled)",
                ) ?? [],
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length;
              buttons[next]?.focus();
            }}
          >
            <div className="note-table-menu-title">
              {axis === "row" ? "Row" : "Column"} {menu.target.index + 1}
            </div>
            {items.map(({ action, label, icon: Icon }) => (
              <button
                key={action}
                type="button"
                role={
                  action === "toggleHeader" ? "menuitemcheckbox" : "menuitem"
                }
                aria-checked={action === "toggleHeader" ? header : undefined}
                className={`${action === "delete" || action === "deleteTable" ? "is-destructive" : ""}${action === "toggleHeader" || action === "delete" || action === "deleteTable" ? " has-divider" : ""}`}
                disabled={!canTableAction(editor, menu.target, action)}
                onClick={() => run(action)}
              >
                {Icon ? (
                  <Icon size={15} />
                ) : (
                  <span className="note-table-header-icon" aria-hidden="true">
                    H
                  </span>
                )}
                <span>{label}</span>
                {action === "toggleHeader" && header && <Check size={14} />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
