import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Plus } from "lucide-react";
import { usesTouchInterface } from "./platform";
import { clearVimPendingAction } from "./vim-editor";
import "./note-gutter.css";

export interface NoteGutterProps {
  editor: Editor;
  onOpenMenu: (anchor: HTMLElement) => void;
  menuOpen: boolean;
  hidden?: boolean;
}

type Glyph = {
  id: number;
  kind: "heading" | "paragraph";
  level: number;
  top: number;
  height: number;
  empty: boolean;
  alwaysVisible: boolean;
};
type Target = { element: HTMLElement; kind: Glyph["kind"] };

function sameLayout(previous: Glyph[], next: Glyph[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((glyph, index) => {
      const other = next[index];
      return (
        glyph.id === other.id &&
        glyph.kind === other.kind &&
        glyph.level === other.level &&
        glyph.top === other.top &&
        glyph.height === other.height &&
        glyph.empty === other.empty &&
        glyph.alwaysVisible === other.alwaysVisible
      );
    })
  );
}

/** UI outside the editable document; measuring and selecting never edit note content. */
export default function NoteGutter({
  editor,
  onOpenMenu,
  menuOpen,
  hidden = false,
}: NoteGutterProps) {
  const rail = useRef<HTMLDivElement>(null);
  const targets = useRef(new Map<number, Target>());
  const previous = useRef<Glyph[]>([]);
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [touch] = useState(usesTouchInterface);

  useEffect(() => {
    if (hidden || editor.isDestroyed) return;
    const surface = rail.current?.parentElement;
    if (!surface) return;
    const dom = editor.view.dom;
    const ids = new WeakMap<HTMLElement, number>();
    let nextId = 0;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed || editor.isDestroyed || !dom.isConnected) return;
      const next: Glyph[] = [];
      const nextTargets = new Map<number, Target>();
      const surfaceTop = surface.getBoundingClientRect().top;
      const { doc, selection } = editor.state;
      const add = (
        element: HTMLElement,
        kind: Glyph["kind"],
        level = 0,
        empty = false,
        alwaysVisible = false,
      ) => {
        if (
          !element.isConnected ||
          element.closest(
            '[contenteditable="false"], pre, .math-note, .note-image',
          )
        )
          return;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return;
        const fontSize = parseFloat(style.fontSize) || 14;
        const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.4;
        const inset =
          (parseFloat(style.paddingTop) || 0) +
          (parseFloat(style.borderTopWidth) || 0);
        // The first line's typographic baseline is approximately .3em below its center.
        // A baseline coordinate keeps heading labels aligned as heading sizes change.
        const top =
          element.getBoundingClientRect().top -
          surfaceTop +
          inset +
          lineHeight / 2 +
          (kind === "heading" ? fontSize * 0.3 : 0);
        let id = ids.get(element);
        if (id === undefined) {
          id = ++nextId;
          ids.set(element, id);
        }
        next.push({
          id,
          kind,
          level,
          top: Math.round(top * 2) / 2,
          height: touch ? 44 : 24,
          empty,
          alwaysVisible,
        });
        nextTargets.set(id, { element, kind });
      };

      doc.descendants((node, position) => {
        if (node.type.name === "heading") {
          const element = editor.view.nodeDOM(position);
          if (
            element instanceof HTMLElement &&
            (!element.closest("table") || selection.$head.parent === node)
          )
            add(element, "heading", node.attrs.level);
          return false;
        }
        return !node.isAtom && !node.type.spec.code;
      });

      const active = document.activeElement;
      const inEmbeddedControl =
        active instanceof HTMLElement &&
        dom.contains(active) &&
        !!active.closest(
          ".math-note, .note-image, pre, [contenteditable='false']",
        );
      if (
        !inEmbeddedControl &&
        selection instanceof TextSelection &&
        selection.$head.parent.type.name === "paragraph"
      ) {
        const position = selection.$head.before();
        const element = editor.view.nodeDOM(position);
        const empty = selection.$head.parent.content.size === 0;
        const emptyDocument =
          doc.childCount === 1 &&
          doc.firstChild?.type.name === "paragraph" &&
          doc.firstChild.content.size === 0;
        if (element instanceof HTMLElement)
          add(element, "paragraph", 0, empty, emptyDocument);
      }
      next.sort((a, b) => a.top - b.top || a.id - b.id);
      // Keep compact text spacing: expand touch width, then fit each hit area's
      // height between its neighbors instead of overlapping nearby controls.
      const center = (glyph: Glyph) =>
        glyph.top - (glyph.kind === "heading" ? 3 : 0);
      next.forEach((glyph, index) => {
        const above = index
          ? center(glyph) - center(next[index - 1]) - 2
          : Infinity;
        const below =
          index < next.length - 1
            ? center(next[index + 1]) - center(glyph) - 2
            : Infinity;
        glyph.height = Math.max(
          1,
          Math.floor(Math.min(glyph.height, above, below)),
        );
      });
      targets.current = nextTargets;
      if (!sameLayout(previous.current, next)) {
        previous.current = next;
        setGlyphs(next);
      }
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure);
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(surface);
    observer?.observe(dom);
    editor.on("transaction", schedule);
    dom.addEventListener("focusin", schedule);
    dom.addEventListener("focusout", schedule);
    dom.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, true);
    document.fonts?.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      editor.off("transaction", schedule);
      dom.removeEventListener("focusin", schedule);
      dom.removeEventListener("focusout", schedule);
      dom.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, true);
      document.fonts?.removeEventListener("loadingdone", schedule);
    };
  }, [editor, hidden, touch]);

  const open = (id: number, anchor: HTMLButtonElement) => {
    const target = targets.current.get(id);
    if (
      !target ||
      editor.isDestroyed ||
      !editor.view.dom.contains(target.element)
    )
      return;
    // Focus before setting a heading selection: WebKit can otherwise restore its old caret.
    editor.view.focus();
    if (target.kind === "heading") clearVimPendingAction(editor.view);
    const position = editor.view.posAtDOM(target.element, 0);
    const selection = editor.state.selection;
    if (
      target.kind === "heading" ||
      !(selection instanceof TextSelection) ||
      selection.$head.parent !== editor.state.doc.resolve(position).parent
    ) {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(editor.state.doc, position),
        ),
      );
    }
    onOpenMenu(anchor);
  };

  if (hidden) return null;
  return (
    <div
      ref={rail}
      className={`note-gutter ${touch ? "is-touch" : ""} ${menuOpen ? "has-open-menu" : ""}`}
    >
      {glyphs.map((glyph) => (
        <button
          key={glyph.id}
          type="button"
          className={`note-gutter-button note-gutter-${glyph.kind} ${glyph.empty ? "is-empty" : ""} ${glyph.alwaysVisible ? "is-always-visible" : ""}`}
          style={{ top: glyph.top, height: glyph.height }}
          aria-label={
            glyph.kind === "heading"
              ? `Heading ${glyph.level} options`
              : "Add note element"
          }
          title={
            glyph.kind === "heading"
              ? `Heading ${glyph.level} options`
              : "Add note element"
          }
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => open(glyph.id, event.currentTarget)}
        >
          {glyph.kind === "heading" ? (
            <span>H{glyph.level}</span>
          ) : (
            <Plus size={15} strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}
