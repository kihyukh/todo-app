// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installWindowDragging, isWindowDragTarget } from "../src/window-drag";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

function region(contents = "") {
  const host = document.createElement("div");
  host.innerHTML = `<header data-window-drag>${contents}</header><main class="body-space"></main>`;
  document.body.append(host);
  return {
    host,
    background: host.querySelector<HTMLElement>("header")!,
  };
}

function down(target: EventTarget, extra: MouseEventInit = {}) {
  const event = new MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

describe("window dragging from the top of the app", () => {
  it("requires an explicitly designated header region", () => {
    const { host, background } = region();
    expect(isWindowDragTarget(background)).toBe(true);
    expect(isWindowDragTarget(host)).toBe(false);
    expect(isWindowDragTarget(document.body)).toBe(false);
    expect(isWindowDragTarget(document)).toBe(false);
    expect(isWindowDragTarget(null)).toBe(false);
  });

  it("leaves blank space below the marked header available for normal interaction", () => {
    const { host } = region();
    const body = host.querySelector<HTMLElement>(".body-space")!;
    body.innerHTML = '<section><span id="empty-space"></span></section>';
    const send = vi.fn();
    cleanups.push(installWindowDragging(host, send));
    for (const target of [body, body.querySelector("#empty-space")!]) {
      expect(isWindowDragTarget(target)).toBe(false);
      expect(down(target).defaultPrevented).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("allows static headings and decoration within the draggable background", () => {
    const { background } = region(
      '<header><h1>Today</h1><span><svg id="decoration"></svg></span></header>',
    );
    expect(isWindowDragTarget(background.querySelector("h1"))).toBe(true);
    expect(isWindowDragTarget(background.querySelector("#decoration"))).toBe(
      true,
    );
  });

  it("never overrides a no-drag region, including nested marked backgrounds", () => {
    const { background } = region(
      '<section data-window-no-drag><div data-window-drag><span id="target"></span></div></section>',
    );
    expect(isWindowDragTarget(background.querySelector("section"))).toBe(false);
    expect(isWindowDragTarget(background.querySelector("#target"))).toBe(false);
  });

  it("preserves text entry, links, labels, buttons, and their nested icons", () => {
    const { background } = region(`
      <button><svg><path id="icon"></path></svg></button>
      <button disabled id="disabled">Disabled</button>
      <a href="#">Link</a><input><textarea></textarea><select><option>One</option></select>
      <label><span id="label-text">Setting</span></label>
      <div contenteditable="true"><p id="editable-text">A note</p></div>
      <div contenteditable="plaintext-only" id="plaintext"></div>
    `);
    for (const selector of [
      "button",
      "#icon",
      "#disabled",
      "a",
      "input",
      "textarea",
      "select",
      "option",
      "label",
      "#label-text",
      "#editable-text",
      "#plaintext",
    ]) {
      expect(
        isWindowDragTarget(background.querySelector(selector)),
        selector,
      ).toBe(false);
    }
  });

  it("preserves custom controls, pane resizing, and calendar cells", () => {
    const { background } = region();
    for (const role of [
      "button",
      "checkbox",
      "switch",
      "textbox",
      "combobox",
      "slider",
      "spinbutton",
      "separator",
      "grid",
      "gridcell",
      "menu",
      "menuitem",
      "listbox",
      "option",
      "tab",
      "treeitem",
      "dialog",
    ]) {
      const control = document.createElement("div");
      control.setAttribute("role", role);
      const child = document.createElement("span");
      control.append(child);
      background.append(control);
      expect(isWindowDragTarget(child), role).toBe(false);
    }
  });

  it("does not steal task drags, note blank-space selection, or table controls", () => {
    const { background } = region(`
      <div draggable="true"><span id="draggable-child"></span></div>
      <div class="task-row-shell"><div class="task-row"><span id="task-padding"></span></div></div>
      <div class="task-note-editor"><div id="note-padding"></div></div>
      <div class="calendar-workspace"><div id="calendar-time"></div></div>
      <div data-window-no-drag class="note-table-controls"><div id="table-handle"></div></div>
    `);
    for (const id of [
      "draggable-child",
      "task-padding",
      "note-padding",
      "calendar-time",
      "table-handle",
    ]) {
      expect(isWindowDragTarget(background.querySelector(`#${id}`)), id).toBe(
        false,
      );
    }
  });

  it("preserves popup dismissal, task properties, attachments, and focusable custom controls", () => {
    const { background } = region();
    for (const className of [
      "dropdown",
      "modal-backdrop",
      "calendar-dialog-backdrop",
      "sidebar-scrim",
      "task-properties",
      "task-title-editor",
      "search",
      "quick-add",
      "open-check-row",
    ]) {
      const area = document.createElement("div");
      area.className = className;
      area.append(document.createElement("span"));
      background.append(area);
      expect(isWindowDragTarget(area.firstElementChild), className).toBe(false);
    }
    const input = document.createElement("div");
    input.tabIndex = 0;
    background.append(input);
    expect(isWindowDragTarget(input)).toBe(false);
    background.insertAdjacentHTML(
      "beforeend",
      '<table><tbody><tr><td>Text</td></tr></tbody></table><img src="example.png"><video></video>',
    );
    for (const selector of ["table", "td", "img", "video"]) {
      expect(
        isWindowDragTarget(background.querySelector(selector)),
        selector,
      ).toBe(false);
    }
  });

  it("sends one drag request on primary mouse down and prevents background text selection", () => {
    const { host, background } = region();
    const send = vi.fn();
    cleanups.push(installWindowDragging(host, send));
    const event = down(background, { clientX: 240, clientY: 180, detail: 1 });
    expect(send).toHaveBeenCalledWith({ x: 240, y: 180, clickCount: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    background.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    background.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("leaves right clicks, middle clicks, and modified clicks untouched", () => {
    const { host, background } = region();
    const send = vi.fn();
    cleanups.push(installWindowDragging(host, send));
    for (const extra of [
      { button: 1 },
      { button: 2 },
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      expect(down(background, extra).defaultPrevented).toBe(false);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("honors an interaction that already claimed the mouse event", () => {
    const { host, background } = region();
    const send = vi.fn();
    background.addEventListener("mousedown", (event) => event.preventDefault());
    cleanups.push(installWindowDragging(host, send));
    expect(down(background).defaultPrevented).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps child control events available to their own handlers", () => {
    const { host, background } = region(
      "<button><span>Complete task</span></button>",
    );
    const send = vi.fn();
    const controlHandler = vi.fn();
    background
      .querySelector("button")!
      .addEventListener("mousedown", controlHandler);
    cleanups.push(installWindowDragging(host, send));
    const event = down(background.querySelector("span")!);
    expect(event.defaultPrevented).toBe(false);
    expect(controlHandler).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not listen outside the mounted shell and fully removes its listener", () => {
    const { host, background } = region();
    const other = region();
    const send = vi.fn();
    const cleanup = installWindowDragging(host, send);
    cleanups.push(cleanup);
    expect(down(other.background).defaultPrevented).toBe(false);
    expect(send).not.toHaveBeenCalled();
    down(background);
    expect(send).toHaveBeenCalledTimes(1);
    cleanup();
    expect(down(background).defaultPrevented).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("preserves an overflowing pane's vertical scrollbar, including events from a child", () => {
    const { host, background } = region("<div></div>");
    background.style.overflowY = "auto";
    Object.defineProperties(background, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { value: 400 },
    });
    vi.spyOn(background, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 50, 300, 400),
    );
    const send = vi.fn();
    cleanups.push(installWindowDragging(host, send));
    const child = background.firstElementChild!;
    expect(down(child, { clientX: 395, clientY: 200 }).defaultPrevented).toBe(
      false,
    );
    expect(send).not.toHaveBeenCalled();
    expect(down(child, { clientX: 380, clientY: 200 }).defaultPrevented).toBe(
      true,
    );
    expect(send).toHaveBeenCalledTimes(1);
    // The same edge becomes a window-drag surface when there is no scrollbar.
    Object.defineProperty(background, "scrollHeight", { value: 300 });
    expect(down(child, { clientX: 395, clientY: 200 }).defaultPrevented).toBe(
      true,
    );
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("preserves the horizontal scrollbar without sacrificing the surrounding background", () => {
    const { host, background } = region();
    background.style.overflowX = "scroll";
    Object.defineProperties(background, {
      scrollWidth: { value: 800 },
      clientWidth: { value: 300 },
    });
    vi.spyOn(background, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 50, 300, 400),
    );
    const send = vi.fn();
    cleanups.push(installWindowDragging(host, send));
    expect(
      down(background, { clientX: 200, clientY: 445 }).defaultPrevented,
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(
      down(background, { clientX: 200, clientY: 430 }).defaultPrevented,
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reserves the left scrollbar edge in right-to-left panes", () => {
    const { host, background } = region();
    background.style.overflowY = "auto";
    background.style.direction = "rtl";
    Object.defineProperties(background, {
      scrollHeight: { value: 800 },
      clientHeight: { value: 400 },
    });
    vi.spyOn(background, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 50, 300, 400),
    );
    const send = vi.fn();
    cleanups.push(installWindowDragging(host, send));
    expect(
      down(background, { clientX: 105, clientY: 200 }).defaultPrevented,
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(
      down(background, { clientX: 125, clientY: 200 }).defaultPrevented,
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
