import { Extension } from "@tiptap/core";
import { ListKeymap } from "@tiptap/extension-list";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection, Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

// Keep Tiptap's carefully handled list deletion, but let Tab in an ordinary
// paragraph move focus. Its default Tab rule absorbs a paragraph into a list
// immediately above it, even after the writer has deliberately left that list.
export const NoteListKeymap = ListKeymap.extend({
  addKeyboardShortcuts() {
    const { Tab: _paragraphTab, ...shortcuts } = this.parent?.() ?? {};
    return shortcuts;
  },
});

function currentListItem(view: EditorView) {
  const { $from, $to } = view.state.selection;
  if ($from.parent.type.spec.code) return null;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    // A table nested in an item keeps its own cell navigation.
    if (name === "tableCell" || name === "tableHeader") return null;
    if (name === "listItem" || name === "taskItem") {
      const listDepth = depth - 1;
      if (
        $to.depth < listDepth ||
        $from.node(listDepth) !== $to.node(listDepth)
      )
        return null;
      return name;
    }
  }
  return null;
}

function toggleCurrentCheckbox(view: EditorView) {
  const { state } = view;
  if (!state.selection.empty) return false;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const item = $from.node(depth);
    if (item.type.name !== "taskItem") continue;
    view.dispatch(
      state.tr
        .setNodeMarkup($from.before(depth), undefined, {
          ...item.attrs,
          checked: !item.attrs.checked,
        })
        .scrollIntoView(),
    );
    return true;
  }
  return false;
}

function leaveNoteBlock(view: EditorView) {
  const { state } = view;
  const { selection } = state;
  let after: number | undefined;
  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === "image"
  ) {
    after = selection.to;
  } else {
    // Preserve selected text and let the existing code/math editors own their
    // commands. Quotes and tables otherwise have no direct "continue below".
    if (!selection.empty || selection.$from.parent.type.spec.code) return false;
    for (let depth = selection.$from.depth; depth > 0; depth -= 1) {
      const name = selection.$from.node(depth).type.name;
      if (name === "blockquote" || name === "table") {
        after = selection.$from.after(depth);
        break;
      }
    }
  }
  if (after === undefined) return false;

  const $after = state.doc.resolve(after);
  const transaction = state.tr;
  if (
    $after.nodeAfter?.type.name !== "paragraph" ||
    $after.nodeAfter.content.size > 0
  ) {
    const paragraph = state.schema.nodes.paragraph?.create();
    const index = $after.index();
    if (
      !paragraph ||
      !$after.parent.canReplace(index, index, Fragment.from(paragraph))
    )
      return false;
    transaction.insert(after, paragraph);
  }
  transaction.setSelection(TextSelection.create(transaction.doc, after + 1));
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export const NoteInteractions = Extension.create({
  name: "noteInteractions",
  priority: 1000,
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (!view.editable || view.composing || event.isComposing)
              return false;
            const mode = view.dom.dataset.vimMode;
            if (mode && mode !== "off" && mode !== "insert") return false;
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest(
                "input, textarea, select, [contenteditable='false']",
              )
            )
              return false;

            if (
              event.key === "Tab" &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              const item = currentListItem(view);
              if (!item) return false;
              if (event.shiftKey) editor.commands.liftListItem(item);
              else editor.commands.sinkListItem(item);
              // At the first item, a failed indent is a harmless no-op instead
              // of an unexpected jump from the note to another app control.
              return true;
            }
            if (
              event.key !== "Enter" ||
              !(event.metaKey || event.ctrlKey) ||
              event.altKey
            )
              return false;
            return event.shiftKey
              ? toggleCurrentCheckbox(view)
              : leaveNoteBlock(view);
          },
        },
      }),
    ];
  },
});
