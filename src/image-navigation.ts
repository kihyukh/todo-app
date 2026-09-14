import { Fragment } from "@tiptap/pm/model";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { enterMathAt, isMathNode } from "./math-navigation";

export function isImageNode(node: ProseMirrorNode | null | undefined) {
  return node?.type.name === "image";
}

export function selectImageAt(view: EditorView, position: number) {
  if (!view.editable || !isImageNode(view.state.doc.nodeAt(position)))
    return false;
  view.focus();
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .scrollIntoView(),
  );
  return true;
}

/** A selected image is one undoable object; adjacent note text is preserved. */
export function deleteSelectedImage(view: EditorView) {
  const { selection } = view.state;
  if (
    !view.editable ||
    !(selection instanceof NodeSelection) ||
    !isImageNode(selection.node)
  )
    return false;
  const transaction = closeHistory(view.state.tr).deleteSelection();
  transaction.setSelection(
    Selection.near(
      transaction.doc.resolve(
        Math.min(selection.from, transaction.doc.content.size),
      ),
      1,
    ),
  );
  view.dispatch(transaction.scrollIntoView());
  view.focus();
  return true;
}

/** Put a writing position beside the image without replacing the selected image. */
export function continueFromImage(
  view: EditorView,
  direction: -1 | 1,
  createNew = false,
) {
  const { selection } = view.state;
  if (
    !view.editable ||
    !(selection instanceof NodeSelection) ||
    !isImageNode(selection.node)
  )
    return false;
  const boundary = direction < 0 ? selection.from : selection.to;
  const $boundary = view.state.doc.resolve(boundary);
  const neighbor = direction < 0 ? $boundary.nodeBefore : $boundary.nodeAfter;
  const transaction = closeHistory(view.state.tr);
  let position: number;
  if (!createNew && neighbor?.type.name === "paragraph") {
    position = direction < 0 ? boundary - 1 : boundary + 1;
  } else {
    const paragraph = view.state.schema.nodes.paragraph?.create();
    if (
      !paragraph ||
      !$boundary.parent.canReplace(
        $boundary.index(),
        $boundary.index(),
        Fragment.from(paragraph),
      )
    )
      return false;
    transaction.insert(boundary, paragraph);
    position = boundary + 1;
  }
  view.dispatch(
    transaction
      .setSelection(TextSelection.create(transaction.doc, position))
      .scrollIntoView(),
  );
  view.focus();
  return true;
}

/** Arrow keys visit every object once, then resume at the adjacent text edge. */
export function moveFromImage(view: EditorView, direction: -1 | 1) {
  const { selection } = view.state;
  if (!(selection instanceof NodeSelection) || !isImageNode(selection.node))
    return false;
  const boundary = direction < 0 ? selection.from : selection.to;
  const next = Selection.findFrom(view.state.doc.resolve(boundary), direction);
  if (!next) return continueFromImage(view, direction);
  if (next instanceof NodeSelection && isMathNode(next.node))
    return enterMathAt(view, next.from, direction);
  view.dispatch(view.state.tr.setSelection(next).scrollIntoView());
  view.focus();
  return true;
}

/** Immediate neighboring block, including a block beside a list/quote boundary. */
export function neighboringImage(
  view: EditorView,
  direction: -1 | 1,
): number | null {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $head } = selection;
  if (!$head.depth) return null;
  const boundary = direction < 0 ? $head.before() : $head.after();
  const next = Selection.findFrom(view.state.doc.resolve(boundary), direction);
  return next instanceof NodeSelection && isImageNode(next.node)
    ? next.from
    : null;
}

export function imageKeyNavigation(view: EditorView, event: KeyboardEvent) {
  if (
    !view.editable ||
    view.composing ||
    event.isComposing ||
    event.shiftKey ||
    event.altKey ||
    event.metaKey ||
    event.ctrlKey
  )
    return false;
  const { key } = event;
  const selected =
    view.state.selection instanceof NodeSelection &&
    isImageNode(view.state.selection.node);
  if (selected) {
    if (key === "Backspace" || key === "Delete")
      return deleteSelectedImage(view);
    if (key === "Enter") {
      const $after = view.state.doc.resolve(view.state.selection.to);
      return continueFromImage(
        view,
        1,
        $after.nodeAfter?.type.name === "paragraph" &&
          $after.nodeAfter.content.size > 0,
      );
    }
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(key))
      return moveFromImage(
        view,
        key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1,
      );
    return false;
  }
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const backward = ["ArrowLeft", "ArrowUp", "Backspace"].includes(key);
  const forward = ["ArrowRight", "ArrowDown", "Delete"].includes(key);
  if (!backward && !forward) return false;
  const direction = backward ? -1 : 1;
  if (key === "ArrowUp" || key === "ArrowDown") {
    if (!view.endOfTextblock(backward ? "up" : "down")) return false;
  } else if (
    backward
      ? selection.$head.parentOffset !== 0
      : selection.$head.parentOffset !== selection.$head.parent.content.size
  )
    return false;
  const position = neighboringImage(view, direction);
  return position === null ? false : selectImageAt(view, position);
}
