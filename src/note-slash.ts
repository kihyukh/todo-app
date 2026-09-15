import { Extension } from "@tiptap/core";
import { isHistoryTransaction } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { vimPluginKey } from "./vim-editor";

export type SlashState = { from: number; to: number; query: string };
type SlashOptions = {
  onChange: (state: SlashState | null, view: EditorView) => void;
  onKeyDown: (view: EditorView, event: KeyboardEvent) => boolean;
};
export const noteSlashKey = new PluginKey<SlashState | null>("noteSlash");
const MAX_QUERY_LENGTH = 40;

export function dismissNoteSlash(view: EditorView): void {
  if (noteSlashKey.getState(view.state))
    view.dispatch(view.state.tr.setMeta(noteSlashKey, null));
}

function writingMode(state: EditorState, transaction?: Transaction): boolean {
  const vim = {
    ...vimPluginKey.getState(state),
    ...transaction?.getMeta(vimPluginKey),
  };
  return !vim.enabled || vim.mode === "insert";
}
const forbiddenMark = (mark: {
  type: { name: string; spec: { code?: boolean } };
}) =>
  mark.type.name === "link" ||
  mark.type.name === "code" ||
  !!mark.type.spec.code;

function allowedStart(state: EditorState, from: number): boolean {
  const cursor = state.doc.resolve(from);
  if (!["paragraph", "heading"].includes(cursor.parent.type.name)) return false;
  if ((state.storedMarks ?? cursor.marks()).some(forbiddenMark)) return false;
  // Leaf placeholders prevent a slash after an image or equation being mistaken
  // for the beginning of a line. Only the local textblock is inspected.
  return /^[^\S\r\n]*$/.test(
    cursor.parent.textBetween(0, cursor.parentOffset, "\n", "\ufffc"),
  );
}

function validate(
  state: EditorState,
  from: number,
  to: number,
): SlashState | null {
  const selection = state.selection;
  if (
    !(selection instanceof TextSelection) ||
    !selection.empty ||
    selection.head !== to ||
    from < 0 ||
    to > state.doc.content.size ||
    to <= from ||
    to - from > MAX_QUERY_LENGTH + 1 ||
    !allowedStart(state, from)
  )
    return null;
  const start = state.doc.resolve(from);
  if (start.parent !== selection.$head.parent) return null;
  const text = start.parent.textBetween(
    start.parentOffset,
    selection.$head.parentOffset,
    "\n",
    "\ufffc",
  );
  if (!text.startsWith("/")) return null;
  const query = text.slice(1);
  if (/[\r\n\t/\ufffc]| {2}/.test(query)) return null;
  let marked = false;
  state.doc.nodesBetween(from, to, (node) => {
    if (node.marks.some(forbiddenMark)) marked = true;
    return !marked;
  });
  return marked ? null : { from, to, query };
}

export const NoteSlash = Extension.create<SlashOptions>({
  name: "noteSlash",
  priority: 1200,
  addOptions() {
    return { onChange: () => {}, onKeyDown: () => false };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<SlashState | null>({
        key: noteSlashKey,
        state: {
          init: () => null,
          apply(transaction, previous, oldState, state) {
            const start = transaction.getMeta(noteSlashKey) as
              SlashState | null | undefined;
            if (
              start === null ||
              isHistoryTransaction(transaction) ||
              !writingMode(oldState, transaction)
            )
              return null;
            if (!start && !previous) return null;
            const mapped = start
              ? null
              : transaction.mapping.mapResult(previous!.from, 1);
            if (mapped?.deleted) return null;
            const next = validate(
              state,
              start?.from ?? mapped!.pos,
              start?.to ?? transaction.mapping.map(previous!.to, 1),
            );
            return previous &&
              next &&
              previous.from === next.from &&
              previous.to === next.to &&
              previous.query === next.query
              ? previous
              : next;
          },
        },
        props: {
          handleTextInput(view, from, to, text) {
            if (
              text !== "/" ||
              noteSlashKey.getState(view.state) ||
              !view.editable ||
              view.composing ||
              !writingMode(view.state) ||
              from !== to ||
              !(view.state.selection instanceof TextSelection) ||
              !view.state.selection.empty ||
              view.state.selection.head !== from ||
              !allowedStart(view.state, from)
            )
              return false;
            const transaction = view.state.tr.insertText("/", from, to);
            transaction.setSelection(
              TextSelection.create(transaction.doc, from + 1),
            );
            transaction.setMeta(noteSlashKey, {
              from,
              to: from + 1,
              query: "",
            } satisfies SlashState);
            view.dispatch(transaction);
            return true;
          },
          handleKeyDown(view, event) {
            if (
              !noteSlashKey.getState(view.state) ||
              !view.editable ||
              view.composing ||
              event.isComposing ||
              event.keyCode === 229
            )
              return false;
            if (event.key === "Escape") {
              dismissNoteSlash(view);
              return true;
            }
            return ["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)
              ? options.onKeyDown(view, event)
              : false;
          },
          handleDOMEvents: {
            blur(view) {
              dismissNoteSlash(view);
              return false;
            },
          },
        },
        view(view) {
          let current = noteSlashKey.getState(view.state) ?? null;
          return {
            update(updatedView) {
              const next = noteSlashKey.getState(updatedView.state) ?? null;
              if (next === current) return;
              current = next;
              options.onChange(next, updatedView);
            },
            destroy() {
              if (current) options.onChange(null, view);
              current = null;
            },
          };
        },
      }),
    ];
  },
});
