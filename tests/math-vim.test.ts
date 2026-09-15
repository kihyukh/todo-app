// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMathVim } from "../src/math-vim";
import type { VimMode } from "../src/vim-editor";

afterEach(() => document.body.replaceChildren());

function source(
  text: string,
  initialMode: VimMode | null = "normal",
  multiline = true,
) {
  const input = document.createElement(multiline ? "textarea" : "input");
  input.value = text;
  document.body.append(input);
  input.focus();
  let mode = initialMode;
  const leave = vi.fn();
  const commit = vi.fn();
  const undo = vi.fn();
  const redo = vi.fn();
  const controller = createMathVim({
    input,
    multiline,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
    },
    leave,
    commit,
    undo,
    redo,
  });
  controller.activate("start");
  const press = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent("keydown", {
      key,
      cancelable: true,
      ...options,
    });
    const handled = controller.handleKey(event);
    expect(event.defaultPrevented).toBe(handled);
    return handled;
  };
  const keys = (sequence: string) => {
    for (const key of sequence) press(key);
  };
  const type = (text: string) => {
    expect(input.readOnly).toBe(false);
    input.setRangeText(
      text,
      input.selectionStart ?? 0,
      input.selectionEnd ?? 0,
      "end",
    );
    controller.input();
  };
  return {
    input,
    controller,
    press,
    keys,
    type,
    leave,
    commit,
    undo,
    redo,
    mode: () => mode,
    setExternalMode: (next: VimMode | null) => {
      mode = next;
      controller.sync();
    },
    range: () => [input.selectionStart, input.selectionEnd],
  };
}

describe("Vim controls inside equation source", () => {
  it("retains Normal mode and uses a character block cursor on either entry edge", () => {
    const s = source("x^2", "normal", false);
    expect(s.mode()).toBe("normal");
    expect(s.range()).toEqual([0, 1]);
    expect(s.input.readOnly).toBe(true);
    s.keys("l");
    expect(s.range()).toEqual([1, 2]);
    expect(s.input.value).toBe("x^2");
    s.controller.activate("end");
    expect(s.range()).toEqual([2, 3]);
    expect(s.mode()).toBe("normal");
    s.keys("l");
    expect(s.leave).toHaveBeenLastCalledWith(1);
    s.controller.activate("start");
    s.keys("h");
    expect(s.leave).toHaveBeenLastCalledWith(-1);
    expect(s.commit).not.toHaveBeenCalled();
  });

  it("retains Insert entry and turns Escape into Normal without leaving source", () => {
    const s = source("x^2", "insert");
    s.controller.activate("end");
    expect(s.range()).toEqual([3, 3]);
    expect(s.press("q")).toBe(false);
    s.type("+y");
    s.press("Escape");
    expect(s.mode()).toBe("normal");
    expect(s.range()).toEqual([4, 5]);
    expect(s.leave).not.toHaveBeenCalled();
    expect(s.input.value).toBe("x^2+y");
    s.press("Escape");
    expect(s.leave).not.toHaveBeenCalled();
  });

  it("switches to Insert only with an editing command and preserves the selected character", () => {
    const s = source("abc");
    s.keys("li");
    expect(s.range()).toEqual([1, 1]);
    expect(s.mode()).toBe("insert");
    s.type("X");
    s.press("Escape");
    expect(s.input.value).toBe("aXbc");
    expect(s.range()).toEqual([1, 2]);
    s.keys("a");
    s.type("Y");
    expect(s.input.value).toBe("aXYbc");
    expect(s.leave).not.toHaveBeenCalled();
  });

  it("handles line starts, ends and counts for word and vertical motions", () => {
    const s = source("one two three\nsecond line\nlast");
    s.keys("2w");
    expect(s.range()).toEqual([8, 9]);
    s.keys("e");
    expect(s.range()).toEqual([12, 13]);
    s.keys("b");
    expect(s.range()).toEqual([8, 9]);
    s.keys("0j");
    expect(s.range()).toEqual([14, 15]);
    s.keys("$h");
    expect(s.range()).toEqual([23, 24]);
    s.keys("gg");
    expect(s.range()).toEqual([0, 1]);
    s.keys("G");
    expect(s.range()).toEqual([26, 27]);
    s.keys("2gg");
    expect(s.range()).toEqual([14, 15]);
    expect(s.input.value).toBe("one two three\nsecond line\nlast");
    expect(s.leave).not.toHaveBeenCalled();
  });

  it("exits only at the source's outer vertical boundaries", () => {
    const s = source("a+b\nc+d\ne+f");
    s.keys("j");
    expect(s.range()).toEqual([4, 5]);
    s.press("ArrowDown");
    expect(s.range()).toEqual([8, 9]);
    expect(s.leave).not.toHaveBeenCalled();
    s.keys("j");
    expect(s.leave).toHaveBeenLastCalledWith(1);
    s.keys("gg");
    s.press("ArrowUp");
    expect(s.leave).toHaveBeenLastCalledWith(-1);
  });

  it("supports I/A and new source lines with o/O", () => {
    const s = source("  x+y\nz");
    s.keys("I");
    expect(s.range()).toEqual([2, 2]);
    s.press("Escape");
    s.keys("A");
    expect(s.range()).toEqual([5, 5]);
    s.press("Escape");
    s.keys("o");
    s.type("a+b");
    expect(s.input.value).toBe("  x+y\na+b\nz");
    s.press("Escape");
    s.keys("O");
    s.type("c+d");
    expect(s.input.value).toBe("  x+y\nc+d\na+b\nz");
    expect(s.mode()).toBe("insert");
    expect(s.commit).toHaveBeenCalledTimes(2);
  });

  it("keeps inline source a single line for o/O", () => {
    const s = source("a+b", "normal", false);
    s.keys("o");
    expect(s.range()).toEqual([3, 3]);
    expect(s.mode()).toBe("insert");
    expect(s.input.value).toBe("a+b");
    s.press("Escape");
    s.keys("O");
    expect(s.range()).toEqual([0, 0]);
    expect(s.input.value).toBe("a+b");
  });

  it.each([
    ["x +\n  y", "x + y", 3],
    ["x  \n\t y", "x  y", 3],
    ["x\t\ny", "x\ty", 2],
    ["x\n  )", "x)", 1],
    ["x\n", "x", 0],
    ["x\n  \t", "x", 0],
    ["\nx", "x", 0],
    ["\n", "", 0],
    ["x\n\u00a0y", "x \u00a0y", 1],
    ["x.\ny", "x. y", 2],
    ["😀\ny", "😀 y", 2],
  ])("joins source lines with Vim spacing: %j", (text, expected, position) => {
    const s = source(text);
    s.press("J", { shiftKey: true });
    expect(s.input.value).toBe(expected);
    expect(s.range()).toEqual([position, expected ? position + 1 : position]);
    expect(s.mode()).toBe("normal");
    expect(s.input.readOnly).toBe(true);
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.leave).not.toHaveBeenCalled();
  });

  it("joins counted lines once, keeps the final join cursor, and leaves other source lines intact", () => {
    const s = source("before\nx\n\n  y\nz\nafter");
    s.keys("j4J");
    expect(s.input.value).toBe("before\nx y z\nafter");
    expect(s.range()).toEqual([10, 11]);
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.mode()).toBe("normal");
    expect(s.leave).not.toHaveBeenCalled();
    s.keys("i");
    s.type("+");
    expect(s.input.value).toBe("before\nx y+ z\nafter");
  });

  it.each(["J", "1J", "2J"])("joins at least two lines with %s", (keys) => {
    const s = source("x\ny\nz");
    s.keys(keys);
    expect(s.input.value).toBe("x y\nz");
    expect(s.range()).toEqual([1, 2]);
  });

  it("caps a large count at the equation boundary without leaving or splitting Unicode", () => {
    const s = source("x\n😀");
    s.keys("9999J");
    expect(s.input.value).toBe("x 😀");
    expect(s.range()).toEqual([1, 2]);
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.leave).not.toHaveBeenCalled();
    s.keys("J");
    expect(s.input.value).toBe("x 😀");
    expect(s.commit).toHaveBeenCalledOnce();
    expect(s.mode()).toBe("normal");
  });

  it.each(["VjjJ", "vjjJ", "jjVkkJ", "jjvkkJ"])(
    "joins all visually selected lines in either direction with %s",
    (keys) => {
      const s = source("x\n y\n z\nafter");
      s.keys(keys);
      expect(s.input.value).toBe("x y z\nafter");
      expect(s.range()).toEqual([3, 4]);
      expect(s.mode()).toBe("normal");
      expect(s.commit).toHaveBeenCalledOnce();
      expect(s.leave).not.toHaveBeenCalled();
    },
  );

  it("joins the next line for a one-line visual selection and preserves its register", () => {
    const s = source("x\ny\nz");
    s.keys("vyvJ");
    expect(s.input.value).toBe("x y\nz");
    expect(s.mode()).toBe("normal");
    s.keys("$p");
    expect(s.input.value).toBe("x yx\nz");
  });

  it("keeps J inside the source and does nothing on the final line or inline source", () => {
    const s = source("x\ny");
    s.keys("GVJ");
    s.keys("J");
    expect(s.input.value).toBe("x\ny");
    expect(s.mode()).toBe("normal");
    expect(s.commit).not.toHaveBeenCalled();
    expect(s.leave).not.toHaveBeenCalled();
    const inline = source("x+y", "normal", false);
    inline.keys("J");
    expect(inline.input.value).toBe("x+y");
    expect(inline.commit).not.toHaveBeenCalled();
    expect(inline.leave).not.toHaveBeenCalled();
  });

  it("preserves the join selection through synchronous history updates and delegates a single undo", () => {
    const s = source("x\ny\nz");
    s.commit.mockImplementation(() => s.controller.sync());
    s.keys("3J");
    expect(s.range()).toEqual([3, 4]);
    expect(s.commit).toHaveBeenCalledOnce();
    s.undo.mockImplementation(() => {
      s.input.value = "x\ny\nz";
    });
    s.keys("u");
    expect(s.input.value).toBe("x\ny\nz");
    expect(s.undo).toHaveBeenCalledOnce();
    expect(s.mode()).toBe("normal");
  });

  it("leaves J as ordinary text in Insert mode or with Vim disabled", () => {
    const s = source("x\ny", "insert");
    expect(s.press("J", { shiftKey: true })).toBe(false);
    expect(s.input.value).toBe("x\ny");
    s.setExternalMode(null);
    expect(s.press("J", { shiftKey: true })).toBe(false);
    expect(s.commit).not.toHaveBeenCalled();
  });

  it("supports counted deletion and change-word without deleting separating whitespace", () => {
    const s = source("one two three four");
    s.keys("2dw");
    expect(s.input.value).toBe("three four");
    expect(s.mode()).toBe("normal");
    s.keys("cw");
    expect(s.input.value).toBe(" four");
    expect(s.mode()).toBe("insert");
    s.type("new");
    expect(s.input.value).toBe("new four");
    s.press("Escape");
    expect(s.mode()).toBe("normal");
    expect(s.leave).not.toHaveBeenCalled();
  });

  it("supports linewise deletion and change without leaving stray newlines", () => {
    const s = source("one\ntwo\nthree");
    s.keys("jdd");
    expect(s.input.value).toBe("one\nthree");
    s.keys("dd");
    expect(s.input.value).toBe("one");
    s.keys("cc");
    expect(s.input.value).toBe("");
    expect(s.mode()).toBe("insert");
    s.type("replacement");
    expect(s.input.value).toBe("replacement");
  });

  it("supports visual motion, yank, delete and paste within the source", () => {
    const s = source("abc def");
    s.keys("vly");
    expect(s.mode()).toBe("normal");
    expect(s.input.value).toBe("abc def");
    s.keys("$p");
    expect(s.input.value).toBe("abc defab");
    s.keys("0vld");
    expect(s.input.value).toBe("c defab");
    expect(s.mode()).toBe("normal");
    s.keys("P");
    expect(s.input.value).toBe("abc defab");
  });

  it("keeps visual selection inside source when moving beyond its boundaries", () => {
    const s = source("a+b");
    s.keys("vh");
    expect(s.range()).toEqual([0, 1]);
    s.keys("$l");
    expect(s.range()).toEqual([0, 3]);
    s.keys("jk");
    expect(s.leave).not.toHaveBeenCalled();
    s.press("Escape");
    expect(s.range()).toEqual([2, 3]);
    expect(s.input.value).toBe("a+b");
  });

  it("supports visual-line selection and linewise paste", () => {
    const s = source("one\ntwo\nthree");
    s.keys("Vjy");
    expect(s.input.value).toBe("one\ntwo\nthree");
    s.keys("Gp");
    expect(s.input.value).toBe("one\ntwo\nthree\none\ntwo");
    expect(s.mode()).toBe("normal");
  });

  it("delegates undo and redo to the existing note history", () => {
    const s = source("abc");
    s.keys("x");
    expect(s.input.value).toBe("bc");
    s.undo.mockImplementation(() => {
      s.input.value = "abc";
    });
    s.redo.mockImplementation(() => {
      s.input.value = "bc";
    });
    s.keys("u");
    expect(s.input.value).toBe("abc");
    expect(s.range()).toEqual([0, 1]);
    s.press("r", { ctrlKey: true });
    expect(s.input.value).toBe("bc");
    expect(s.range()).toEqual([0, 1]);
    expect(s.undo).toHaveBeenCalledOnce();
    expect(s.redo).toHaveBeenCalledOnce();
    expect(s.mode()).toBe("normal");
  });

  it("repeats counted undo and keeps the block cursor after external history updates", () => {
    const s = source("abc");
    s.keys("3u");
    expect(s.undo).toHaveBeenCalledTimes(3);
    s.controller.activate("end");
    s.input.value = "a";
    s.input.setSelectionRange(1, 1);
    s.controller.sync();
    expect(s.range()).toEqual([0, 1]);
    expect(s.mode()).toBe("normal");
  });

  it("preserves source selection when persistence synchronously refreshes the controller", () => {
    const s = source("abc def");
    s.commit.mockImplementation(() => s.controller.sync());
    s.keys("cw");
    expect(s.mode()).toBe("insert");
    expect(s.input.value).toBe(" def");
    expect(s.range()).toEqual([0, 0]);
    s.type("new");
    s.press("Escape");
    expect(s.range()).toEqual([2, 3]);
    s.keys("0x");
    expect(s.range()).toEqual([0, 1]);
    expect(s.input.value).toBe("ew def");
  });

  it("does not split emoji on entry, horizontal/vertical movement, deletion or Escape", () => {
    const s = source("a😀\nxyz😀");
    s.controller.activate("end");
    expect(s.range()).toEqual([7, 9]);
    s.keys("h");
    expect(s.range()).toEqual([6, 7]);
    s.keys("k");
    expect(s.range()).toEqual([1, 3]);
    s.keys("x");
    expect(s.input.value).toBe("a\nxyz😀");
    s.keys("GA");
    s.press("Escape");
    expect(s.range()).toEqual([5, 7]);
  });

  it("handles empty source without losing mode, and leaves only on navigation", () => {
    const s = source("");
    expect(s.range()).toEqual([0, 0]);
    s.keys("x");
    expect(s.input.value).toBe("");
    expect(s.mode()).toBe("normal");
    expect(s.leave).not.toHaveBeenCalled();
    s.keys("i");
    s.type("x");
    s.press("Escape");
    s.keys("l");
    expect(s.leave).toHaveBeenCalledWith(1);
  });

  it("respects setting changes while the source is open", () => {
    const s = source("x+y");
    s.setExternalMode(null);
    expect(s.input.readOnly).toBe(false);
    expect(s.input.dataset.vimMode).toBeUndefined();
    expect(s.press("h")).toBe(false);
    s.type("q");
    expect(s.input.value).toBe("qx+y");
    s.setExternalMode("normal");
    expect(s.input.readOnly).toBe(true);
    expect(s.range()).toEqual([1, 2]);
    expect(s.press("z")).toBe(true);
    expect(s.input.value).toBe("qx+y");
  });

  it("blocks non-keyboard input in Normal and Visual but allows Insert/off", () => {
    const s = source("a+b");
    const inputEvent = () =>
      new InputEvent("beforeinput", {
        cancelable: true,
        inputType: "insertFromPaste",
        data: "paste",
      });
    let event = inputEvent();
    expect(s.controller.handleBeforeInput(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    s.keys("v");
    event = inputEvent();
    expect(s.controller.handleBeforeInput(event)).toBe(true);
    expect(s.input.readOnly).toBe(true);
    s.press("Escape");
    s.keys("i");
    expect(s.controller.handleBeforeInput(inputEvent())).toBe(false);
    s.setExternalMode(null);
    expect(s.controller.handleBeforeInput(inputEvent())).toBe(false);
  });

  it("supports explicit Tab exit and control-bracket Normal transition", () => {
    const s = source("a+b", "insert");
    s.press("[", { ctrlKey: true });
    expect(s.mode()).toBe("normal");
    expect(s.leave).not.toHaveBeenCalled();
    s.press("Tab");
    expect(s.leave).toHaveBeenLastCalledWith(1);
    s.press("Tab", { shiftKey: true });
    expect(s.leave).toHaveBeenLastCalledWith(-1);
  });
});
