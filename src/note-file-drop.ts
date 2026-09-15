import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { importNoteFile } from "./note-file-storage";

const importMeta = "note-file-import";
let nextImport = 0;
const queues = new WeakMap<Editor, Promise<void>>();

/** Keep the drop anchored while storage runs and the user continues editing. */
export async function insertNoteFiles(
  editor: Editor,
  files: File[],
  position: number,
  options: { isCurrent: () => boolean; notice: (message: string) => void },
) {
  if (!files.length || editor.isDestroyed) return;
  const id = ++nextImport;
  let moved = false;
  const track = ({ transaction }: { transaction: Transaction }) => {
    const resolved = transaction.getMeta(importMeta) as number | undefined;
    position = transaction.mapping.map(
      position,
      resolved && resolved < id ? 1 : -1,
    );
    if (transaction.selectionSet || transaction.docChanged) moved = true;
  };
  editor.on("transaction", track);
  const previous = queues.get(editor) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(editor, completion);
  options.notice("");
  try {
    const results = await Promise.allSettled(files.map(importNoteFile));
    await previous;
    if (editor.isDestroyed || !options.isCurrent()) return;
    const attachments = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (attachments.length) {
      const inline = editor.state.doc.resolve(position).parent.inlineContent;
      const links: JSONContent[] = attachments.map((file) => ({
        type: "text",
        text: file.name,
        marks: [{ type: "link", attrs: { href: file.url } }],
      }));
      const content = inline
        ? links.flatMap((link, index) =>
            index ? [{ type: "text", text: " " }, link] : [link],
          )
        : links.map((link) => ({ type: "paragraph", content: [link] }));
      const follow = !moved && editor.view.hasFocus();
      editor
        .chain()
        .command(({ tr }) => {
          closeHistory(tr);
          return true;
        })
        .insertContentAt(position, content, { updateSelection: follow })
        .command(({ tr }) => {
          tr.setMeta(importMeta, id);
          if (follow) tr.setStoredMarks([]);
          return true;
        })
        .run();
      // Typing after a completed import should undo separately from the link.
      editor.view.dispatch(closeHistory(editor.state.tr));
    }
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            `${files[index].name}: ${result.reason instanceof Error ? result.reason.message : "Could not add this file."}`,
          ]
        : [],
    );
    options.notice(failures.join(" "));
  } catch (error) {
    if (!editor.isDestroyed && options.isCurrent())
      options.notice(
        error instanceof Error
          ? error.message
          : "Could not add these files. Please try again.",
      );
  } finally {
    editor.off("transaction", track);
    release();
    if (queues.get(editor) === completion) queues.delete(editor);
  }
}

function hasFiles(event: DragEvent) {
  return (
    Array.from(event.dataTransfer?.types ?? []).includes("Files") ||
    !!event.dataTransfer?.files?.length
  );
}

/** The same position drives both the visible caret and the eventual insertion. */
export function fileDropPosition(
  view: EditorView,
  x: number,
  y: number,
): number {
  const first = view.state.doc.firstChild;
  if (
    view.state.doc.childCount === 1 &&
    first?.type.name === "paragraph" &&
    !first.content.size
  )
    return 1;
  const bounds = view.dom.getBoundingClientRect();
  let boundary: number | undefined;
  view.state.doc.forEach((_node, pos) => {
    if (boundary !== undefined) return;
    const dom = view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    if (y < rect.top) boundary = pos;
    else if (y <= rect.bottom) boundary = -1;
  });
  if (boundary !== undefined && boundary >= 0) return boundary;
  if (boundary === undefined) return view.state.doc.content.size;
  const pos = view.posAtCoords({
    left: Math.max(bounds.left + 1, Math.min(x, bounds.right - 1)),
    top: y,
  })?.pos;
  if (pos === undefined) return view.state.doc.content.size;
  const resolved = view.state.doc.resolve(pos);
  // Links cannot live inside code blocks or other text-only nodes.
  if (
    resolved.parent.inlineContent &&
    !resolved.parent.type.allowsMarkType(view.state.schema.marks.link)
  )
    return resolved.after();
  return pos;
}

export function installNoteFileDrop(
  editor: Editor,
  onDrop: (files: File[], position: number) => void,
) {
  const view = editor.view;
  const host =
    view.dom.closest<HTMLElement>(".detail") ??
    view.dom.closest<HTMLElement>(".task-note-editor") ??
    view.dom;
  const caret = document.createElement("div");
  caret.className = "note-file-drop-caret";
  caret.setAttribute("aria-hidden", "true");
  let last: { x: number; y: number } | undefined;
  const clear = () => {
    caret.remove();
    last = undefined;
  };
  const show = (position: number) => {
    const resolved = view.state.doc.resolve(position);
    const bounds = view.dom.getBoundingClientRect();
    const inline = resolved.parent.inlineContent;
    let left: number, top: number, width: number, height: number;
    if (inline) {
      const rect = view.coordsAtPos(position);
      left = rect.left;
      top = rect.top;
      width = 2;
      height = Math.max(18, rect.bottom - rect.top);
    } else {
      const before = resolved.nodeBefore;
      const dom = view.nodeDOM(position - (before?.nodeSize ?? 0));
      const rect =
        dom instanceof HTMLElement ? dom.getBoundingClientRect() : bounds;
      left = bounds.left;
      top = before ? rect.bottom + 2 : rect.top - 2;
      width = bounds.width;
      height = 2;
    }
    Object.assign(caret.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
    caret.dataset.position = String(position);
    caret.dataset.mode = inline ? "inline" : "block";
    if (!caret.isConnected) document.body.append(caret);
  };
  const over = (event: DragEvent) => {
    if (!hasFiles(event) || !view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    last = { x: event.clientX, y: event.clientY };
    show(fileDropPosition(view, last.x, last.y));
  };
  const drop = (event: DragEvent) => {
    if (!hasFiles(event) || !view.editable) return;
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.dataTransfer?.files ?? []);
    const position = fileDropPosition(view, event.clientX, event.clientY);
    clear();
    if (files.length) {
      view.focus();
      onDrop(files, position);
    }
  };
  const leave = (event: DragEvent) => {
    if (
      !(event.relatedTarget instanceof Node) ||
      !host.contains(event.relatedTarget)
    )
      clear();
  };
  const scroll = () => {
    if (last) show(fileDropPosition(view, last.x, last.y));
  };
  host.addEventListener("dragover", over, true);
  host.addEventListener("drop", drop, true);
  host.addEventListener("dragleave", leave);
  window.addEventListener("dragend", clear);
  window.addEventListener("drop", clear);
  window.addEventListener("scroll", scroll, true);
  window.addEventListener("blur", clear);
  return () => {
    clear();
    host.removeEventListener("dragover", over, true);
    host.removeEventListener("drop", drop, true);
    host.removeEventListener("dragleave", leave);
    window.removeEventListener("dragend", clear);
    window.removeEventListener("drop", clear);
    window.removeEventListener("scroll", scroll, true);
    window.removeEventListener("blur", clear);
  };
}
