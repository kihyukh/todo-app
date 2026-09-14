import type { VimMode } from "./vim-editor";

type Direction = -1 | 1;
type Operator = "d" | "c" | "y";
type SourceInput = HTMLInputElement | HTMLTextAreaElement;

export interface MathVimOptions {
  input: SourceInput;
  multiline: boolean;
  /** null means that the device's Vim setting is off. */
  getMode: () => VimMode | null;
  setMode: (mode: VimMode) => void;
  leave: (direction: Direction) => void;
  /** Publish a source edit to the existing editor/history, without refocusing it. */
  commit: () => void;
  undo: () => void;
  redo: () => void;
}

interface Line {
  from: number;
  to: number;
}

function lines(text: string): Line[] {
  let from = 0;
  return text.split("\n").map((part) => {
    const line = { from, to: from + part.length };
    from = line.to + 1;
    return line;
  });
}

function currentLine(all: Line[], position: number): Line {
  return all.find((line) => position <= line.to) ?? all[all.length - 1];
}

function previous(text: string, position: number, minimum = 0): number {
  let result = Math.max(minimum, position - 1);
  const code = text.charCodeAt(result);
  if (code >= 0xdc00 && code <= 0xdfff) result = Math.max(minimum, result - 1);
  return result;
}

function next(text: string, position: number, maximum = text.length): number {
  const code = text.codePointAt(position);
  return Math.min(
    maximum,
    position + (code !== undefined && code > 0xffff ? 2 : 1),
  );
}

function normalPosition(text: string, position: number): number {
  position = Math.max(0, Math.min(position, text.length));
  const line = currentLine(lines(text), position);
  position = Math.max(
    line.from,
    Math.min(position, previous(text, line.to, line.from)),
  );
  const code = text.charCodeAt(position);
  if (code >= 0xdc00 && code <= 0xdfff)
    position = Math.max(line.from, position - 1);
  return position;
}

function wordTarget(
  text: string,
  position: number,
  motion: string,
  count: number,
): number {
  const tokens: { from: number; kind: string }[] = [];
  let offset = 0;
  for (const character of text) {
    tokens.push({
      from: offset,
      kind: /\s/u.test(character)
        ? "space"
        : /[\p{L}\p{N}_]/u.test(character)
          ? "word"
          : "punctuation",
    });
    offset += character.length;
  }
  if (!tokens.length) return 0;
  let index = tokens.findIndex((token) => token.from >= position);
  if (index < 0) index = tokens.length;
  for (let iteration = 0; iteration < count; iteration++) {
    if (motion === "b") {
      index = Math.max(0, index - 1);
      while (index > 0 && tokens[index]?.kind === "space") index--;
      const kind = tokens[index]?.kind;
      while (index > 0 && tokens[index - 1].kind === kind) index--;
    } else if (motion === "e" || motion === "cw") {
      if ((motion === "e" || iteration > 0) && index < tokens.length - 1)
        index++;
      while (index < tokens.length - 1 && tokens[index]?.kind === "space")
        index++;
      const kind = tokens[index]?.kind;
      while (index < tokens.length - 1 && tokens[index + 1].kind === kind)
        index++;
    } else {
      const kind = tokens[index]?.kind;
      while (index < tokens.length && tokens[index].kind === kind) index++;
      while (index < tokens.length && tokens[index].kind === "space") index++;
    }
  }
  return tokens[index]?.from ?? text.length;
}

/** The real source input remains the editor; Vim controls its native selection. */
export function createMathVim(options: MathVimOptions) {
  const { input } = options;
  let knownMode = options.getMode();
  let paintedValue = input.value;
  let head = 0;
  let anchor: number | null = null;
  let count = "";
  let pending = "";
  let operator: Operator | null = null;
  let operatorCount = 1;
  let register: { text: string; linewise: boolean } | null = null;

  function reset() {
    count = "";
    pending = "";
    operator = null;
    operatorCount = 1;
  }

  function isVisual(mode = options.getMode()) {
    return mode === "visual" || mode === "visual-line";
  }

  function paint() {
    const mode = options.getMode();
    paintedValue = input.value;
    input.readOnly = mode !== null && mode !== "insert";
    if (mode) input.dataset.vimMode = mode;
    else delete input.dataset.vimMode;
    delete input.dataset.vimEmptyLine;
    delete input.dataset.vimEmptySource;
    if (!mode || mode === "insert") return;
    head = normalPosition(input.value, head);
    const all = lines(input.value);
    const line = currentLine(all, head);
    if (mode === "normal" && line.from === line.to) {
      input.dataset.vimEmptyLine = "true";
      if (!input.value) input.dataset.vimEmptySource = "true";
    }
    if (isVisual(mode)) {
      const origin = anchor ?? head;
      let from = Math.min(origin, head);
      let to = Math.max(origin, head);
      if (mode === "visual-line") {
        from = currentLine(all, from).from;
        const last = currentLine(all, to);
        to = Math.min(input.value.length, last.to + 1);
      } else to = next(input.value, to, currentLine(all, to).to);
      input.setSelectionRange(from, to, head < origin ? "backward" : "forward");
    } else {
      // A native character selection provides a visible block cursor in both
      // WKWebView and browser inputs, including horizontal/vertical scrolling.
      input.setSelectionRange(head, next(input.value, head, line.to));
    }
  }

  function setMode(mode: VimMode, position = head) {
    reset();
    head = position;
    if (!isVisual(mode)) anchor = null;
    // Set local state first: the mode bridge may synchronously call sync().
    knownMode = mode;
    options.setMode(mode);
    if (mode === "insert") input.setSelectionRange(position, position);
    paint();
  }

  function move(position: number) {
    head = normalPosition(input.value, position);
    reset();
    paint();
  }

  function sync() {
    const mode = options.getMode();
    if (mode === knownMode) {
      // Platform Undo can update the NodeView without going through handleKey.
      // Preserve native mouse selections when only selection, not text, changed.
      if (input.value !== paintedValue) paint();
      return;
    }
    const oldMode = knownMode;
    knownMode = mode;
    reset();
    anchor = null;
    head = input.selectionStart ?? head;
    if (mode === "normal" && oldMode === "insert") {
      const line = currentLine(lines(input.value), head);
      head = previous(input.value, head, line.from);
    }
    if (!mode || mode === "insert") input.setSelectionRange(head, head);
    paint();
  }

  function activate(caret: "start" | "end") {
    knownMode = options.getMode();
    head = caret === "start" ? 0 : input.value.length;
    anchor = null;
    reset();
    input.setSelectionRange(head, head);
    paint();
  }

  function replace(from: number, to: number, text: string, position: number) {
    input.value = input.value.slice(0, from) + text + input.value.slice(to);
    head = position;
    input.setSelectionRange(position, position);
    options.commit();
  }

  function lineRange(from: number, to: number, deleting: boolean) {
    const all = lines(input.value);
    const first = currentLine(all, Math.min(from, to));
    const last = currentLine(all, Math.max(from, to));
    let start = first.from;
    let end = last.to;
    // Consume the newline below; the final line instead consumes the one above.
    if (end < input.value.length) end++;
    else if (deleting && start > 0) start--;
    return { from: start, to: end, first, last };
  }

  function operate(op: Operator, from: number, to: number, linewise = false) {
    const line = linewise ? lineRange(from, to, op === "d") : null;
    let start = line ? line.from : Math.min(from, to);
    let end = line ? line.to : Math.max(from, to);
    register = {
      text: line
        ? input.value.slice(line.first.from, line.last.to)
        : input.value.slice(start, end),
      linewise,
    };
    if (op === "c" && line) {
      start = line.first.from;
      end = line.last.to;
    }
    if (op !== "y") replace(start, end, "", start);
    setMode(op === "c" ? "insert" : "normal", start);
  }

  function motionTarget(motion: string, repeats: number): number | null {
    const text = input.value;
    const all = lines(text);
    const line = currentLine(all, head);
    const index = all.indexOf(line);
    let target = head;
    switch (motion) {
      case "h":
      case "ArrowLeft":
        for (let i = 0; i < repeats; i++)
          target = previous(text, target, line.from);
        return target;
      case "l":
      case "ArrowRight":
        for (let i = 0; i < repeats; i++) target = next(text, target, line.to);
        return target;
      case "j":
      case "ArrowDown":
      case "k":
      case "ArrowUp": {
        const direction = motion === "j" || motion === "ArrowDown" ? 1 : -1;
        const nextLine =
          all[
            Math.max(0, Math.min(all.length - 1, index + repeats * direction))
          ];
        return Math.min(nextLine.to, nextLine.from + head - line.from);
      }
      case "0":
      case "Home":
        return line.from;
      case "^":
        return (
          line.from + Math.max(0, text.slice(line.from, line.to).search(/\S/u))
        );
      case "$":
      case "End":
        return all[Math.min(all.length - 1, index + repeats - 1)].to;
      case "w":
      case "b":
      case "e":
      case "cw":
        return wordTarget(text, head, motion, repeats);
      case "gg":
      case "G":
        return all[Math.min(all.length - 1, repeats - 1)].from;
      default:
        return null;
    }
  }

  function boundary(motion: string): Direction | null {
    const all = lines(input.value);
    const line = currentLine(all, head);
    if ((motion === "h" || motion === "ArrowLeft") && head === 0) return -1;
    if (
      (motion === "l" || motion === "ArrowRight") &&
      head === normalPosition(input.value, input.value.length)
    )
      return 1;
    if ((motion === "k" || motion === "ArrowUp") && line === all[0]) return -1;
    if (
      (motion === "j" || motion === "ArrowDown") &&
      line === all[all.length - 1]
    )
      return 1;
    return null;
  }

  function handleKey(event: KeyboardEvent): boolean {
    sync();
    const mode = options.getMode();
    if (!mode || event.isComposing) return false;
    const key = event.key;
    const consume = () => {
      event.preventDefault();
      return true;
    };
    if (key === "Escape" || (event.ctrlKey && (key === "[" || key === "c"))) {
      if (mode === "insert") {
        const caret = input.selectionStart ?? head;
        const line = currentLine(lines(input.value), caret);
        setMode("normal", previous(input.value, caret, line.from));
      } else setMode("normal");
      return consume();
    }
    if (mode === "insert") return false;
    // Keep platform copy/paste/select shortcuts and text selection available.
    if (event.metaKey || event.altKey) return false;
    if (
      event.shiftKey &&
      [
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ].includes(key)
    )
      return false;
    if (event.ctrlKey) {
      if (key.toLowerCase() === "r") {
        options.redo();
        move(head);
        return consume();
      }
      return false;
    }
    // Tab remains the explicit navigation shortcut between source and prose.
    if (key === "Tab") {
      reset();
      options.leave(event.shiftKey ? -1 : 1);
      return consume();
    }
    if (key === "Enter") {
      reset();
      options.leave(1);
      return consume();
    }
    if (/^[1-9]$/.test(key) || (key === "0" && count)) {
      count = (count + key).slice(0, 4);
      return consume();
    }
    let repeats = Math.min(1000, Number(count) || 1);
    let motion = key;
    if (pending === "g") {
      if (key !== "g") {
        reset();
        return consume();
      }
      motion = "gg";
    } else if (key === "g") {
      pending = "g";
      return consume();
    }
    if (key === "G" && !count) repeats = lines(input.value).length;
    if (isVisual(mode)) {
      if (key === "v" || key === "V") {
        const nextMode = key === "v" ? "visual" : "visual-line";
        setMode(mode === nextMode ? "normal" : nextMode);
        return consume();
      }
      if (["d", "x", "c", "y"].includes(key)) {
        const origin = anchor ?? head;
        operate(
          key === "x" ? "d" : (key as Operator),
          mode === "visual-line" ? origin : (input.selectionStart ?? head),
          mode === "visual-line" ? head : (input.selectionEnd ?? head),
          mode === "visual-line",
        );
        return consume();
      }
    }
    if (operator) {
      repeats = Math.min(1000, repeats * operatorCount);
      if (key === operator) {
        const all = lines(input.value);
        const line = currentLine(all, head);
        operate(
          operator,
          head,
          all[Math.min(all.length - 1, all.indexOf(line) + repeats - 1)].to,
          true,
        );
        return consume();
      }
      if (
        operator === "c" &&
        key === "w" &&
        /\S/u.test(input.value[head] ?? "")
      )
        motion = "cw";
      let target = motionTarget(motion, repeats);
      if (target !== null) {
        const line = currentLine(lines(input.value), head);
        if (
          motion === "w" &&
          repeats === 1 &&
          target > line.to &&
          /\S/u.test(input.value[head] ?? "")
        )
          target = line.to;
        if (motion === "e" || motion === "cw")
          target = next(input.value, target);
        operate(
          operator,
          head,
          target,
          ["j", "k", "ArrowDown", "ArrowUp", "gg", "G"].includes(motion),
        );
      } else reset();
      return consume();
    }
    const target = motionTarget(motion, repeats);
    if (target !== null) {
      const exit = mode === "normal" ? boundary(motion) : null;
      if (exit) {
        reset();
        options.leave(exit);
      } else move(target);
      return consume();
    }
    const text = input.value;
    const line = currentLine(lines(text), head);
    switch (key) {
      case "i":
        setMode("insert");
        break;
      case "a":
        setMode("insert", next(text, head, line.to));
        break;
      case "I":
        setMode(
          "insert",
          line.from + Math.max(0, text.slice(line.from, line.to).search(/\S/u)),
        );
        break;
      case "A":
        setMode("insert", line.to);
        break;
      case "o":
      case "O": {
        if (!options.multiline) {
          setMode("insert", key === "O" ? line.from : line.to);
          break;
        }
        const position = key === "O" ? line.from : line.to;
        const insertion = position + (key === "O" ? 0 : 1);
        replace(position, position, "\n", insertion);
        setMode("insert", insertion);
        break;
      }
      case "v":
      case "V":
        anchor = head;
        setMode(key === "v" ? "visual" : "visual-line");
        break;
      case "d":
      case "c":
      case "y":
        operator = key;
        operatorCount = repeats;
        count = "";
        break;
      case "x":
      case "Delete": {
        let end = head;
        for (let i = 0; i < repeats; i++) end = next(text, end, line.to);
        operate("d", head, end);
        break;
      }
      case "X":
      case "Backspace": {
        let from = head;
        for (let i = 0; i < repeats; i++)
          from = previous(text, from, line.from);
        operate("d", from, head);
        break;
      }
      case "D":
        operate("d", head, line.to);
        break;
      case "C":
        operate("c", head, line.to);
        break;
      case "s":
        operate("c", head, next(text, head, line.to));
        break;
      case "S":
        operate("c", head, line.to, true);
        break;
      case "p":
      case "P": {
        if (!register) {
          reset();
          break;
        }
        let position = key === "P" ? head : next(text, head, line.to);
        let paste = register.text.repeat(repeats);
        if (register.linewise && options.multiline) {
          position = key === "P" ? line.from : line.to;
          paste =
            key === "P"
              ? `${register.text}\n`.repeat(repeats)
              : `\n${register.text}`.repeat(repeats);
        }
        const caret =
          register.linewise && options.multiline
            ? position + (key === "P" ? 0 : 1)
            : previous(
                text.slice(0, position) + paste,
                position + paste.length,
              );
        replace(position, position, paste, caret);
        move(caret);
        break;
      }
      case "u":
        for (let i = 0; i < repeats; i++) options.undo();
        move(head);
        break;
      default:
        reset();
        break;
    }
    return consume();
  }

  function selectionChanged() {
    sync();
    const mode = options.getMode();
    if (!mode || mode === "insert") return;
    head =
      input.selectionDirection === "backward"
        ? (input.selectionStart ?? 0)
        : (input.selectionEnd ?? 0);
    if (isVisual(mode))
      anchor =
        input.selectionDirection === "backward"
          ? input.selectionEnd
          : input.selectionStart;
    paint();
  }

  function onInput() {
    if (options.getMode() === "insert" || !options.getMode())
      head = input.selectionStart ?? head;
    else paint();
  }

  function handleBeforeInput(event: InputEvent): boolean {
    const mode = options.getMode();
    if (!mode || mode === "insert") return false;
    event.preventDefault();
    return true;
  }

  return {
    activate,
    handleKey,
    sync,
    input: onInput,
    selectionChanged,
    handleBeforeInput,
  };
}
