import Image from "@tiptap/extension-image";
import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { deleteSelectedImage } from "./image-navigation";
import "./image-editor.css";

export type ImageCrop = { x: number; y: number; width: number; height: number };
const fullCrop = (): ImageCrop => ({ x: 0, y: 0, width: 1, height: 1 });
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
const positive = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const imageWidth = (value: unknown) => {
  const width = positive(value);
  return width === null ? null : clamp(width, 20, 100);
};
function imageCrop(value: unknown): ImageCrop | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object") return null;
  const crop = value as ImageCrop;
  if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite))
    return null;
  if (crop.width <= 0 || crop.height <= 0) return null;
  const x = clamp(crop.x, 0, 0.98);
  const y = clamp(crop.y, 0, 0.98);
  const width = clamp(crop.width, 0.02, 1 - x);
  const height = clamp(crop.height, 0.02, 1 - y);
  if (x === 0 && y === 0 && width === 1 && height === 1) return null;
  return { x, y, width, height };
}
const escapeAttribute = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const imageNodeView: NodeViewRenderer = ({
  node: initialNode,
  editor,
  getPos,
  view,
}) => {
  let node = initialNode;
  let selected = false;
  let cropping = false;
  let destroyed = false;
  let draftCrop = fullCrop();
  let cancelGesture: (() => void) | null = null;
  const dom = document.createElement("div");
  dom.className = "note-image";
  dom.contentEditable = "false";
  const frame = document.createElement("div");
  frame.className = "note-image-frame";
  const image = document.createElement("img");
  image.className = "note-image-content";
  image.draggable = false;
  const status = document.createElement("span");
  status.className = "note-image-status";
  status.textContent = "Image unavailable";
  status.hidden = true;
  frame.append(image, status);
  const toolbar = document.createElement("div");
  toolbar.className = "note-image-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Image editing");
  toolbar.hidden = true;
  const tools = document.createElement("div");
  tools.className = "note-image-tools";
  const cropTools = document.createElement("div");
  cropTools.className = "note-image-tools";
  cropTools.hidden = true;
  toolbar.append(tools, cropTools);
  const hint = document.createElement("div");
  hint.className = "note-image-hint";
  hint.textContent =
    "Drag the edges to crop. Arrow keys move the crop; Shift moves faster.";
  hint.hidden = true;
  dom.append(frame, toolbar, hint);

  const button = (
    label: string,
    title: string,
    action: () => void,
    parent = tools,
  ) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.title = title;
    element.setAttribute("aria-label", title);
    element.addEventListener("click", (event) => {
      event.preventDefault();
      if (editor.isEditable) action();
    });
    parent.append(element);
    return element;
  };
  const position = () => {
    const pos = getPos();
    return !destroyed &&
      pos !== undefined &&
      view.state.doc.nodeAt(pos)?.type === node.type
      ? pos
      : null;
  };
  const select = () => {
    if (position() === null || !editor.isEditable) return false;
    // Focus before selecting the atom: WKWebView otherwise restores its old
    // text selection when focus returns from a native image control.
    view.focus();
    const pos = position();
    if (pos === null) return false;
    view.dispatch(
      view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
    );
    return true;
  };
  const commit = (attrs: Record<string, unknown>) => {
    const pos = position();
    if (pos === null || !editor.isEditable) return;
    if (
      Object.entries(attrs).every(
        ([key, value]) =>
          JSON.stringify(node.attrs[key]) === JSON.stringify(value),
      )
    )
      return;
    const transaction = view.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      ...attrs,
    });
    transaction.setSelection(NodeSelection.create(transaction.doc, pos));
    view.dispatch(closeHistory(transaction));
    view.dispatch(closeHistory(view.state.tr));
  };
  const naturalAspect = () =>
    positive(image.naturalWidth / image.naturalHeight) ??
    positive(node.attrs.imageAspect) ??
    positive(Number(node.attrs.width) / Number(node.attrs.height)) ??
    1;
  const paintCrop = () => {
    cropBox.style.left = `${draftCrop.x * 100}%`;
    cropBox.style.top = `${draftCrop.y * 100}%`;
    cropBox.style.width = `${draftCrop.width * 100}%`;
    cropBox.style.height = `${draftCrop.height * 100}%`;
    cropBox.setAttribute(
      "aria-description",
      `${Math.round(draftCrop.width * 100)}% wide, ${Math.round(draftCrop.height * 100)}% high`,
    );
  };
  const render = () => {
    const src = String(node.attrs.src ?? "");
    if (image.getAttribute("src") !== src) {
      status.hidden = true;
      image.src = src;
    }
    image.alt = String(node.attrs.alt ?? "");
    image.title = String(node.attrs.title ?? "");
    frame.setAttribute(
      "aria-label",
      image.alt ? `Image: ${image.alt}` : "Note image",
    );
    const crop = cropping ? null : imageCrop(node.attrs.crop);
    const width = imageWidth(node.attrs.displayWidth);
    frame.style.width = cropping
      ? "100%"
      : width
        ? `${width}%`
        : positive(node.attrs.width)
          ? `${node.attrs.width}px`
          : "100%";
    frame.style.aspectRatio = crop
      ? String((naturalAspect() * crop.width) / crop.height)
      : "";
    frame.classList.toggle("is-cropped", !!crop);
    dom.classList.toggle("is-cropping", cropping);
    image.style.width = crop ? `${100 / crop.width}%` : "100%";
    image.style.left = crop ? `${(-crop.x / crop.width) * 100}%` : "";
    image.style.top = crop ? `${(-crop.y / crop.height) * 100}%` : "";
    cropBox.hidden = !cropping;
    resize.hidden = !selected || cropping || !editor.isEditable;
    toolbar.hidden = !selected || !editor.isEditable;
    tools.hidden = cropping;
    cropTools.hidden = !cropping;
    hint.hidden = !cropping;
    for (const [preset, element] of presetButtons) {
      element.setAttribute("aria-pressed", String((width ?? 100) === preset));
    }
    resize.setAttribute("aria-valuenow", String(Math.round(width ?? 100)));
    if (cropping) paintCrop();
  };

  const presetButtons = new Map<number, HTMLButtonElement>();
  for (const [label, width] of [
    ["Small", 35],
    ["Medium", 65],
    ["Full", 100],
  ] as const) {
    const element = button(label, `${label} image size`, () => {
      commit({ displayWidth: width });
    });
    presetButtons.set(width, element);
  }
  const separator = document.createElement("span");
  separator.className = "note-image-tool-divider";
  separator.setAttribute("aria-hidden", "true");
  tools.append(separator);
  const finishCrop = (apply: boolean) => {
    cancelGesture?.();
    cropping = false;
    if (apply) {
      const crop = imageCrop(draftCrop);
      commit({ crop, imageAspect: crop ? naturalAspect() : null });
    }
    render();
    select();
  };
  button("Crop", "Crop image", () => {
    cropping = true;
    draftCrop = imageCrop(node.attrs.crop) ?? fullCrop();
    render();
    cropBox.focus({ preventScroll: true });
  });
  const remove = button("Delete", "Delete image", () => {
    if (select()) deleteSelectedImage(view);
  });
  remove.className = "note-image-delete";
  button(
    "Reset",
    "Reset crop to original image",
    () => {
      draftCrop = fullCrop();
      paintCrop();
      cropBox.focus({ preventScroll: true });
    },
    cropTools,
  );
  button("Cancel", "Cancel image crop", () => finishCrop(false), cropTools);
  button(
    "Apply crop",
    "Apply image crop",
    () => finishCrop(true),
    cropTools,
  ).className = "note-image-apply";

  const resize = document.createElement("button");
  resize.type = "button";
  resize.className = "note-image-resize";
  resize.title = "Drag to resize · Arrow keys adjust size";
  resize.setAttribute("aria-label", "Resize image");
  resize.setAttribute("role", "slider");
  resize.setAttribute("aria-valuemin", "20");
  resize.setAttribute("aria-valuemax", "100");
  resize.hidden = true;
  frame.append(resize);
  const cropBox = document.createElement("div");
  cropBox.className = "note-image-crop-box";
  cropBox.setAttribute("role", "group");
  cropBox.setAttribute(
    "aria-label",
    "Crop area. Drag or use arrow keys to move",
  );
  cropBox.tabIndex = 0;
  cropBox.hidden = true;
  frame.append(cropBox);
  const corners = ["nw", "ne", "sw", "se"] as const;
  type Corner = (typeof corners)[number];
  const editCrop = (
    base: ImageCrop,
    dx: number,
    dy: number,
    corner?: Corner,
  ): ImageCrop => {
    if (!corner)
      return {
        ...base,
        x: clamp(base.x + dx, 0, 1 - base.width),
        y: clamp(base.y + dy, 0, 1 - base.height),
      };
    const left = corner.endsWith("w")
      ? clamp(base.x + dx, 0, base.x + base.width - 0.04)
      : base.x;
    const top = corner.startsWith("n")
      ? clamp(base.y + dy, 0, base.y + base.height - 0.04)
      : base.y;
    const right = corner.endsWith("e")
      ? clamp(base.x + base.width + dx, left + 0.04, 1)
      : base.x + base.width;
    const bottom = corner.startsWith("s")
      ? clamp(base.y + base.height + dy, top + 0.04, 1)
      : base.y + base.height;
    return { x: left, y: top, width: right - left, height: bottom - top };
  };
  const gesture = (
    event: PointerEvent,
    move: (event: PointerEvent) => void,
    finish: (cancelled: boolean) => void,
  ) => {
    if (event.button !== 0 || !editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    cancelGesture?.();
    const pointerId = event.pointerId;
    const onMove = (next: PointerEvent) => {
      if (next.pointerId === pointerId) move(next);
    };
    const end = (cancelled: boolean) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("keydown", onEscape, true);
      cancelGesture = null;
      if (!destroyed) finish(cancelled);
    };
    const onUp = (next: PointerEvent) => {
      if (next.pointerId === pointerId) end(false);
    };
    const onCancel = () => end(true);
    const onEscape = (next: KeyboardEvent) => {
      if (next.key === "Escape") {
        next.preventDefault();
        next.stopPropagation();
        end(true);
      }
    };
    cancelGesture = onCancel;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("keydown", onEscape, true);
  };
  const startCrop = (event: PointerEvent, corner?: Corner) => {
    if (!cropping) return;
    const base = { ...draftCrop };
    const rect = frame.getBoundingClientRect();
    const x = event.clientX,
      y = event.clientY;
    gesture(
      event,
      (next) => {
        draftCrop = editCrop(
          base,
          (next.clientX - x) / Math.max(rect.width, 1),
          (next.clientY - y) / Math.max(rect.height, 1),
          corner,
        );
        paintCrop();
      },
      (cancelled) => {
        if (cancelled) {
          draftCrop = base;
          paintCrop();
        }
      },
    );
  };
  const cropKeys = (event: KeyboardEvent, corner?: Corner) => {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 0.05 : 0.01;
    draftCrop = editCrop(
      draftCrop,
      direction[0] * step,
      direction[1] * step,
      corner,
    );
    paintCrop();
  };
  cropBox.addEventListener("pointerdown", (event) => {
    if (event.target === cropBox) startCrop(event);
  });
  cropBox.addEventListener("keydown", (event) => {
    if (event.target === cropBox) cropKeys(event);
  });
  for (const corner of corners) {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `note-image-crop-handle is-${corner}`;
    const label = `${corner.startsWith("n") ? "Top" : "Bottom"} ${corner.endsWith("w") ? "left" : "right"} crop corner`;
    handle.setAttribute("aria-label", label);
    handle.title = `${label} · Drag or use arrow keys`;
    handle.addEventListener("pointerdown", (event) => startCrop(event, corner));
    handle.addEventListener("keydown", (event) => cropKeys(event, corner));
    cropBox.append(handle);
  }
  resize.addEventListener("pointerdown", (event) => {
    const containerWidth = Math.max(dom.getBoundingClientRect().width, 1);
    const startWidth =
      (frame.getBoundingClientRect().width / containerWidth) * 100;
    const x = event.clientX;
    let draftWidth = startWidth;
    gesture(
      event,
      (next) => {
        draftWidth = clamp(
          startWidth + ((next.clientX - x) / containerWidth) * 100,
          20,
          100,
        );
        frame.style.width = `${draftWidth}%`;
        resize.setAttribute("aria-valuenow", String(Math.round(draftWidth)));
      },
      (cancelled) => {
        if (!cancelled && Math.abs(draftWidth - startWidth) > 0.1)
          commit({ displayWidth: Math.round(draftWidth) });
        render();
      },
    );
  });
  resize.addEventListener("keydown", (event) => {
    const direction = ["ArrowLeft", "ArrowDown"].includes(event.key)
      ? -1
      : ["ArrowRight", "ArrowUp"].includes(event.key)
        ? 1
        : 0;
    if (!direction || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    const width =
      imageWidth(node.attrs.displayWidth) ??
      Math.round(
        (frame.getBoundingClientRect().width /
          Math.max(dom.getBoundingClientRect().width, 1)) *
          100,
      );
    commit({
      displayWidth: clamp(
        width + direction * (event.shiftKey ? 10 : 2),
        20,
        100,
      ),
    });
  });
  dom.addEventListener("keydown", (event) => {
    if (
      !cropping &&
      ["Delete", "Backspace"].includes(event.key) &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (select()) deleteSelectedImage(view);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (cropping) finishCrop(false);
      else select();
    } else if (
      (event.metaKey || event.ctrlKey) &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (cropping) finishCrop(false);
      if (event.shiftKey) editor.commands.redo();
      else editor.commands.undo();
    } else if (cropping && event.key === "Enter" && event.target === cropBox) {
      event.preventDefault();
      event.stopPropagation();
      finishCrop(true);
    }
  });
  toolbar.addEventListener("mousedown", (event) => event.preventDefault());
  frame.addEventListener("mousedown", (event) => {
    if (
      !cropping &&
      !(event.target as Element).closest("button") &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      editor.isEditable
    )
      event.preventDefault();
  });
  frame.addEventListener("click", (event) => {
    if (
      cropping ||
      (event.target as Element).closest("button") ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    event.preventDefault();
    select();
  });
  image.addEventListener("load", render);
  image.addEventListener("error", () => {
    status.hidden = false;
  });
  render();
  return {
    dom,
    update(updated) {
      if (updated.type !== node.type) return false;
      node = updated;
      render();
      return true;
    },
    selectNode() {
      selected = true;
      dom.classList.add("ProseMirror-selectednode");
      render();
    },
    deselectNode() {
      selected = false;
      cropping = false;
      cancelGesture?.();
      dom.classList.remove("ProseMirror-selectednode");
      render();
    },
    stopEvent(event) {
      const target = event.target as globalThis.Node;
      return (
        toolbar.contains(target) ||
        resize.contains(target) ||
        cropBox.contains(target)
      );
    },
    ignoreMutation() {
      return true;
    },
    destroy() {
      destroyed = true;
      cancelGesture?.();
    },
  };
};

/** Keep standard images compatible with saved notes and Markdown, adding only
 * presentation attributes. Cropping never changes the original image bytes. */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      displayWidth: {
        default: null,
        parseHTML: (element) =>
          imageWidth(element.getAttribute("data-note-width")),
        renderHTML: (attrs) =>
          imageWidth(attrs.displayWidth) === null
            ? {}
            : { "data-note-width": imageWidth(attrs.displayWidth) },
      },
      crop: {
        default: null,
        parseHTML: (element) =>
          imageCrop(element.getAttribute("data-note-crop")),
        renderHTML: (attrs) =>
          imageCrop(attrs.crop)
            ? { "data-note-crop": JSON.stringify(imageCrop(attrs.crop)) }
            : {},
      },
      imageAspect: {
        default: null,
        parseHTML: (element) =>
          positive(element.getAttribute("data-note-aspect")),
        renderHTML: (attrs) =>
          positive(attrs.imageAspect)
            ? { "data-note-aspect": positive(attrs.imageAspect) }
            : {},
      },
    };
  },
  renderMarkdown(node) {
    const attrs = node.attrs ?? {};
    if (
      attrs.displayWidth === null &&
      attrs.crop === null &&
      attrs.width === null &&
      attrs.height === null
    ) {
      const src = attrs.src ?? "",
        alt = attrs.alt ?? "",
        title = attrs.title ?? "";
      return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
    }
    const values: Record<string, unknown> = {
      src: attrs.src,
      alt: attrs.alt,
      title: attrs.title,
      width: attrs.width,
      height: attrs.height,
      "data-note-width": imageWidth(attrs.displayWidth),
      "data-note-crop": imageCrop(attrs.crop)
        ? JSON.stringify(imageCrop(attrs.crop))
        : null,
      "data-note-aspect": positive(attrs.imageAspect),
    };
    return `<img ${Object.entries(values)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}="${escapeAttribute(value)}"`)
      .join(" ")}>`;
  },
  addNodeView() {
    return imageNodeView;
  },
});
