/** Only designated top headers may move the native window; content retains its gestures. */
const interactive = [
  "[data-window-no-drag]",
  "button",
  "input",
  "textarea",
  "select",
  "option",
  "a",
  "label",
  "summary",
  "form",
  "fieldset",
  "[contenteditable]",
  "[tabindex]",
  '[draggable="true"]',
  "img",
  "video",
  "audio",
  "canvas",
  "iframe",
  "object",
  "embed",
  "table",
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="separator"]',
  '[role="grid"]',
  '[role="gridcell"]',
  '[role="tree"]',
  '[role="treeitem"]',
  '[role="menu"]',
  '[role^="menuitem"]',
  '[role="tab"]',
  '[role="dialog"]',
  ".task-row-shell",
  ".task-row",
  ".open-check-row",
  ".task-note-editor",
  ".task-title-editor",
  ".task-properties",
  ".search",
  ".quick-add",
  ".calendar-workspace",
  ".dropdown",
  ".modal-backdrop",
  ".calendar-dialog-backdrop",
  ".sidebar-scrim",
  ".task-drag-overlay",
].join(",");

export function isWindowDragTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest("[data-window-drag]") &&
    !target.closest(interactive)
  );
}

/** Leave both normal and overlay scrollbars available for scrolling. */
function atScrollbar(target: Element, event: MouseEvent, root: HTMLElement) {
  for (let node: Element | null = target; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    const vertical =
      /auto|scroll/.test(style.overflowY) &&
      node.scrollHeight > node.clientHeight;
    const horizontal =
      /auto|scroll/.test(style.overflowX) &&
      node.scrollWidth > node.clientWidth;
    if (
      (vertical &&
        (style.direction === "rtl"
          ? event.clientX < rect.left + 14
          : event.clientX > rect.right - 14)) ||
      (horizontal && event.clientY > rect.bottom - 14)
    )
      return true;
    if (node === root) break;
  }
  return false;
}

export type WindowDragGesture = { x: number; y: number; clickCount: number };

export function installWindowDragging(
  root: HTMLElement,
  send: (gesture: WindowDragGesture) => void,
) {
  const mouseDown = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      !isWindowDragTarget(event.target)
    )
      return;
    if (atScrollbar(event.target as Element, event, root)) return;
    // Do not begin a text selection or blur the editor when moving the window.
    event.preventDefault();
    send({ x: event.clientX, y: event.clientY, clickCount: event.detail });
  };
  root.addEventListener("mousedown", mouseDown);
  return () => root.removeEventListener("mousedown", mouseDown);
}
