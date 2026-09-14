import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

export type MathDirection = -1 | 1;
type MathSource = {
  getPos: () => number | undefined;
  open: (direction: MathDirection) => void;
};
const sources = new WeakMap<EditorView, Set<MathSource>>();

export function isMathNode(node: ProseMirrorNode | null | undefined) {
  return node?.type.name === "inlineMath" || node?.type.name === "blockMath";
}

/** NodeViews register their live position rather than capturing a stale offset. */
export function registerMathSource(view: EditorView, source: MathSource) {
  let entries = sources.get(view);
  if (!entries) sources.set(view, (entries = new Set()));
  entries.add(source);
  return () => entries.delete(source);
}

/** Only intentional cursor motion/clicks enter source. Range selections stay rendered. */
export function enterMathAt(
  view: EditorView,
  pos: number,
  direction: MathDirection = 1,
): boolean {
  if (
    !view.editable ||
    !Number.isInteger(pos) ||
    pos < 0 ||
    pos >= view.state.doc.content.size ||
    !isMathNode(view.state.doc.nodeAt(pos))
  )
    return false;
  const source = [...(sources.get(view) ?? [])].find(
    (entry) => entry.getPos() === pos,
  );
  if (!source) return false;
  // Give the source input ownership of focus before changing the outer atom
  // selection. WebKit otherwise normalizes a non-editable block selection into
  // adjacent prose and closes its source before deferred focus can run.
  source.open(direction);
  // Focusing can blur an empty preceding source and remove/replace that node.
  const position = source.getPos();
  if (position === undefined || !isMathNode(view.state.doc.nodeAt(position)))
    return false;
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .scrollIntoView(),
  );
  // A decoration/plugin may replace a NodeView during selection dispatch.
  const currentSource = [...(sources.get(view) ?? [])].find(
    (entry) => entry.getPos() === position,
  );
  if (currentSource && currentSource !== source) currentSource.open(direction);
  return true;
}

/** Find the first selectable content beyond the current textblock's boundary. */
function beyondTextblock(view: EditorView, direction: MathDirection) {
  const { $head } = view.state.selection;
  if (!$head.depth) return null;
  const boundary = direction > 0 ? $head.after() : $head.before();
  return Selection.findFrom(view.state.doc.resolve(boundary), direction);
}

export function mathArrowNavigation(view: EditorView, event: KeyboardEvent) {
  if (
    event.shiftKey ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.isComposing ||
    !view.editable
  )
    return false;
  const direction: MathDirection =
    event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown";
  if (!horizontal && !vertical) return false;
  const selection = view.state.selection;
  if (selection instanceof NodeSelection && isMathNode(selection.node))
    return enterMathAt(view, selection.from, direction);
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $head } = selection;
  if (horizontal) {
    const neighbor = direction > 0 ? $head.nodeAfter : $head.nodeBefore;
    if (isMathNode(neighbor))
      return enterMathAt(
        view,
        direction > 0 ? $head.pos : $head.pos - neighbor!.nodeSize,
        direction,
      );
    // A horizontal arrow only leaves a paragraph at its actual text boundary.
    if (
      direction > 0
        ? $head.parentOffset !== $head.parent.content.size
        : $head.parentOffset !== 0
    )
      return false;
  } else {
    // ProseMirror uses browser geometry here, so wrapped prose stays on its line.
    if (!view.endOfTextblock(direction > 0 ? "down" : "up")) return false;
  }
  const next = beyondTextblock(view, direction);
  return next instanceof NodeSelection && isMathNode(next.node)
    ? enterMathAt(view, next.from, direction)
    : false;
}

export function mathNavigationPlugin() {
  return new Plugin({ props: { handleKeyDown: mathArrowNavigation } });
}

/** Mirror the source only for a vertical boundary key, preserving soft-wrapped rows. */
export function atSourceVerticalBoundary(
  input: HTMLTextAreaElement,
  direction: MathDirection,
) {
  const offset = input.selectionStart ?? 0;
  const before = input.value.slice(0, offset);
  const after = input.value.slice(offset);
  if (direction < 0 && before.includes("\n")) return false;
  if (direction > 0 && after.includes("\n")) return false;
  // Layout-free environments (and hidden controls) can use logical lines.
  if (!input.clientWidth) return true;
  const computed = getComputedStyle(input);
  const mirror = document.createElement("div");
  Object.assign(mirror.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    left: "-10000px",
    top: "0",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    width: `${input.clientWidth}px`,
    boxSizing: "border-box",
    font: computed.font,
    letterSpacing: computed.letterSpacing,
    lineHeight: computed.lineHeight,
    padding: computed.padding,
    tabSize: computed.tabSize,
  });
  const first = document.createElement("span");
  const caret = document.createElement("span");
  const last = document.createElement("span");
  first.textContent = "\u200b";
  caret.textContent = "\u200b";
  last.textContent = "\u200b";
  mirror.append(
    first,
    document.createTextNode(before),
    caret,
    document.createTextNode(after),
    last,
  );
  document.body.append(mirror);
  const atEdge =
    Math.abs(
      caret.offsetTop - (direction < 0 ? first.offsetTop : last.offsetTop),
    ) < 2;
  mirror.remove();
  return atEdge;
}
