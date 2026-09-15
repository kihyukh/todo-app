import { Extension } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
interface PendingImage {
  id: number;
  from: number;
  to: number;
  moved: boolean;
  count: number;
}
type ImportAction = { add: PendingImage } | { remove: number };
const imageImportsKey = new PluginKey<PendingImage[]>("noteImageImports");
let nextImport = 0;
const importQueues = new WeakMap<Editor, Promise<void>>();

/** Loading markers live outside the document and follow edits while files load. */
export const ImageImports = Extension.create({
  name: "imageImports",
  addProseMirrorPlugins() {
    return [
      new Plugin<PendingImage[]>({
        key: imageImportsKey,
        state: {
          init: () => [],
          apply(transaction, pending, previousState) {
            const action = transaction.getMeta(imageImportsKey) as
              ImportAction | undefined;
            const resolved =
              action && "remove" in action ? action.remove : undefined;
            const mapped = pending
              .filter((item) => item.id !== resolved)
              .map((item) => {
                let { from, to } = item;
                for (const map of transaction.mapping.maps) {
                  let touched = false;
                  map.forEach((oldFrom, oldTo) => {
                    if (from < to && oldFrom < to && oldTo > from)
                      touched = true;
                  });
                  // Later imports at the same location stay after earlier ones.
                  const bias =
                    resolved !== undefined && item.id > resolved ? 1 : -1;
                  const newFrom = map.map(from, from === to ? bias : 1);
                  const newTo = map.map(to, -1);
                  from = newFrom;
                  // If selected text changed meanwhile, never overwrite the new edit.
                  to = touched ? from : Math.max(from, newTo);
                }
                return {
                  ...item,
                  from,
                  to,
                  moved:
                    item.moved ||
                    (resolved === undefined &&
                      ((transaction.selectionSet &&
                        !transaction.selection.eq(previousState.selection)) ||
                        transaction.docChanged)),
                };
              });
            if (action && "add" in action) mapped.push(action.add);
            return mapped;
          },
        },
        props: {
          decorations(state) {
            return DecorationSet.create(
              state.doc,
              (imageImportsKey.getState(state) ?? []).map((item) =>
                Decoration.widget(
                  item.from,
                  () => {
                    const marker = document.createElement("span");
                    marker.className = "note-image-loading";
                    marker.contentEditable = "false";
                    marker.setAttribute("role", "status");
                    marker.textContent =
                      item.count === 1
                        ? "Adding image…"
                        : `Adding ${item.count} images…`;
                    return marker;
                  },
                  { key: `image-import-${item.id}`, side: -1 },
                ),
              ),
            );
          },
        },
      }),
    ];
  },
});

export function isImageFile(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    (!file.type &&
      /\.(png|jpe?g|gif|webp|avif|heic|heif|tiff?|bmp|svg)$/i.test(file.name))
  );
}

export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  // Preserve the note's size/crop metadata when copying one of its own images.
  if (/data-pm-slice=/.test(data.getData("text/html"))) return [];
  const files = Array.from(data.files ?? []).filter(isImageFile);
  if (files.length) return files;
  return Array.from(data.items ?? []).flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    return file && isImageFile(file) ? [file] : [];
  });
}

function readImage(file: File): Promise<JSONContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Image could not be read"));
    reader.onabort = () => reject(new Error("Image loading was cancelled"));
    reader.onload = () =>
      resolve({
        type: "image",
        attrs: {
          src: reader.result as string,
          alt: file.name || "Pasted image",
          title: file.name || null,
        },
      });
    reader.readAsDataURL(file);
  });
}

/** A paste/drop is anchored immediately, without blocking typing or saving. */
export async function insertImageFiles(
  editor: Editor,
  files: File[],
  options: {
    position?: number;
    isCurrent: () => boolean;
    notice: (message: string) => void;
  },
) {
  const images = files.filter(isImageFile);
  const safeImages = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
  const oversized = safeImages.length !== images.length;
  if (oversized)
    options.notice(
      "Each image can be up to 10 MB. Larger files can be added as attachments.",
    );
  else options.notice("");
  if (!safeImages.length || editor.isDestroyed) return;
  const selection = editor.state.selection;
  const { from, to } =
    options.position === undefined
      ? selection instanceof NodeSelection &&
        selection.node.type.name === "image"
        ? { from: selection.to, to: selection.to }
        : selection
      : { from: options.position, to: options.position };
  const id = ++nextImport;
  editor.view.dispatch(
    editor.state.tr.setMeta(imageImportsKey, {
      add: { id, from, to, moved: false, count: safeImages.length },
    } satisfies ImportAction),
  );
  const previousImport = importQueues.get(editor) ?? Promise.resolve();
  let release!: () => void;
  const completion = new Promise<void>((resolve) => {
    release = resolve;
  });
  importQueues.set(editor, completion);
  try {
    const results = await Promise.allSettled(safeImages.map(readImage));
    // Files read concurrently; committing in order keeps rapid pastes predictable.
    await previousImport;
    if (editor.isDestroyed || !options.isCurrent()) return;
    const pending = imageImportsKey
      .getState(editor.state)
      ?.find((item) => item.id === id);
    if (!pending) return;
    const nodes = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    if (nodes.length) {
      // Focus before setting a NodeSelection: WKWebView can reset selection on focus.
      const shouldSelect = !pending.moved && editor.view.hasFocus();
      if (shouldSelect) editor.view.focus();
      editor
        .chain()
        .command(({ tr }) => {
          closeHistory(tr);
          return true;
        })
        .insertContentAt({ from: pending.from, to: pending.to }, nodes, {
          updateSelection: false,
        })
        .command(({ tr }) => {
          tr.setMeta(imageImportsKey, { remove: id } satisfies ImportAction);
          if (shouldSelect) {
            let insertionStart = tr.doc.content.size;
            let insertionEnd = 0;
            tr.mapping.maps.forEach((map, index) => {
              const remaining = tr.mapping.slice(index + 1);
              map.forEach((_oldFrom, _oldTo, newFrom, newTo) => {
                insertionStart = Math.min(
                  insertionStart,
                  remaining.map(newFrom, -1),
                );
                insertionEnd = Math.max(insertionEnd, remaining.map(newTo, 1));
              });
            });
            let lastImage: number | undefined;
            tr.doc.descendants((node, pos) => {
              if (
                node.type.name === "image" &&
                pos >= insertionStart &&
                pos <= insertionEnd &&
                node.attrs.src === nodes.at(-1)?.attrs?.src
              )
                lastImage = pos;
            });
            if (lastImage !== undefined)
              tr.setSelection(NodeSelection.create(tr.doc, lastImage));
            tr.scrollIntoView();
          }
          return true;
        })
        .run();
      // The next keystroke must undo separately from the asynchronous insertion.
      editor.view.dispatch(closeHistory(editor.state.tr));
    }
    if (results.some((result) => result.status === "rejected")) {
      options.notice(
        nodes.length
          ? "Some images could not be added. Please try those files again."
          : "This image could not be added. Please try another image.",
      );
    }
  } catch {
    if (!editor.isDestroyed && options.isCurrent())
      options.notice(
        "This image could not be added. Please try another image.",
      );
  } finally {
    if (!editor.isDestroyed)
      editor.view.dispatch(
        editor.state.tr.setMeta(imageImportsKey, {
          remove: id,
        } satisfies ImportAction),
      );
    release();
    if (importQueues.get(editor) === completion) importQueues.delete(editor);
  }
}
