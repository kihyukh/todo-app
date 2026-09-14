import { Extension } from "@tiptap/core";
import { Fragment, Slice } from "@tiptap/pm/model";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { closeHistory, redo, undo } from "@tiptap/pm/history";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorView } from "@tiptap/pm/view";
import { enterMathAt, isMathNode } from "./math-navigation";
import {
  continueFromImage,
  deleteSelectedImage,
  isImageNode,
  moveFromImage,
  neighboringImage,
  selectImageAt,
} from "./image-navigation";
import "./vim-editor.css";

export type VimMode = "normal" | "insert" | "visual" | "visual-line";

interface VimOptions {
  enabled: boolean;
  onModeChange: (mode: VimMode | null) => void;
}

interface Register {
  slice: Slice;
  linewise: boolean;
  partialLine?: boolean;
}

interface VimState {
  enabled: boolean;
  mode: VimMode;
  count: string;
  pending: string;
  operator: "d" | "c" | "y" | null;
  operatorCount: number;
  anchor: number | null;
  head: number | null;
  register: Register | null;
}

const INITIAL: VimState = {
  enabled: false,
  mode: "normal",
  count: "",
  pending: "",
  operator: null,
  operatorCount: 1,
  anchor: null,
  head: null,
  register: null,
};

export const vimPluginKey = new PluginKey<VimState>("daymarkVim");

export function getVimMode(view: EditorView): VimMode | null {
  const vim = vimPluginKey.getState(view.state);
  return vim?.enabled ? vim.mode : null;
}

/** Source editors share the mode without moving the surrounding math selection. */
export function setMathVimMode(view: EditorView, mode: VimMode) {
  if (getVimMode(view) === null) return;
  update(
    view,
    reset({ mode, anchor: null, head: null }),
    closeHistory(view.state.tr),
  );
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    daymarkVim: {
      setVimEnabled: (enabled: boolean) => ReturnType;
    };
  }
}

interface Line {
  from: number;
  to: number;
  text: string;
  blockFrom: number;
  blockTo: number;
  partial: boolean;
}

/** Paragraphs and explicit line breaks are logical lines; visual wrapping is not. */
function lines(doc: ProseMirrorNode): Line[] {
  const result: Line[] = [];
  doc.descendants((node, position) => {
    if (!node.isTextblock) return true;
    const parts = node
      .textBetween(0, node.content.size, "", (leaf) =>
        leaf.type.name === "hardBreak" ? "\n" : "\ufffc",
      )
      .split("\n");
    let offset = 0;
    for (const text of parts) {
      result.push({
        from: position + 1 + offset,
        to: position + 1 + offset + text.length,
        text,
        blockFrom: position,
        blockTo: position + node.nodeSize,
        partial: parts.length > 1 || !!node.type.spec.code,
      });
      offset += text.length + 1;
    }
    return false;
  });
  return result;
}

function currentLine(all: Line[], position: number): Line | undefined {
  return (
    all.find((line) => position >= line.from && position <= line.to) ??
    all.find((line) => line.from >= position) ??
    all.at(-1)
  );
}

function nextCharacter(line: Line, position: number): number {
  const code = line.text.codePointAt(Math.max(0, position - line.from));
  return Math.min(
    line.to,
    position + (code !== undefined && code > 0xffff ? 2 : 1),
  );
}

function previousCharacter(line: Line, position: number): number {
  let result = Math.max(line.from, position - 1);
  const code = line.text.charCodeAt(result - line.from);
  if (code >= 0xdc00 && code <= 0xdfff)
    result = Math.max(line.from, result - 1);
  return result;
}

function normalPosition(doc: ProseMirrorNode, position: number): number {
  const line = currentLine(lines(doc), position);
  if (!line) return position;
  let result = Math.max(
    line.from,
    Math.min(position, previousCharacter(line, line.to)),
  );
  // Vertical movement may land in the second UTF-16 unit of an emoji.
  const character = line.text.charCodeAt(result - line.from);
  if (character >= 0xdc00 && character <= 0xdfff)
    result = Math.max(line.from, result - 1);
  return result;
}

function reset(patch: Partial<VimState> = {}): Partial<VimState> {
  return { count: "", pending: "", operator: null, operatorCount: 1, ...patch };
}

function update(
  view: EditorView,
  patch: Partial<VimState>,
  transaction = view.state.tr,
) {
  view.dispatch(transaction.setMeta(vimPluginKey, patch));
}

function select(transaction: Transaction, position: number) {
  return transaction.setSelection(
    Selection.near(
      transaction.doc.resolve(
        Math.max(0, Math.min(position, transaction.doc.content.size)),
      ),
    ),
  );
}

function setMode(view: EditorView, mode: VimMode) {
  const old = vimPluginKey.getState(view.state)!;
  if (
    view.state.selection instanceof NodeSelection &&
    isImageNode(view.state.selection.node)
  ) {
    update(
      view,
      reset({ mode, anchor: null, head: null }),
      closeHistory(view.state.tr),
    );
    return;
  }
  let position = view.state.selection.head;
  if (mode === "normal") {
    if (old.mode === "insert") {
      const line = currentLine(lines(view.state.doc), position);
      if (line) position = previousCharacter(line, position);
    } else position = old.head ?? position;
    position = normalPosition(view.state.doc, position);
  }
  const transaction = select(closeHistory(view.state.tr), position);
  update(view, reset({ mode, anchor: null, head: null }), transaction);
}

function move(view: EditorView, position: number) {
  const vim = vimPluginKey.getState(view.state)!;
  const all = lines(view.state.doc);
  const head = normalPosition(view.state.doc, position);
  let transaction = view.state.tr;
  if (vim.mode === "visual" || vim.mode === "visual-line") {
    const anchor = vim.anchor ?? view.state.selection.head;
    let from = Math.min(anchor, head);
    let to = Math.max(anchor, head);
    if (vim.mode === "visual-line") {
      from = currentLine(all, from)?.from ?? from;
      to = currentLine(all, to)?.to ?? to;
    } else {
      const line = currentLine(all, to);
      if (line) to = nextCharacter(line, to);
    }
    transaction = transaction.setSelection(
      TextSelection.create(
        view.state.doc,
        head >= anchor ? from : to,
        head >= anchor ? to : from,
      ),
    );
    update(view, reset({ anchor, head }), transaction.scrollIntoView());
  } else {
    update(view, reset(), select(transaction, head).scrollIntoView());
  }
}

interface Token {
  position: number;
  end: number;
  kind: string;
}
function words(all: Line[]): Token[] {
  const result: Token[] = [];
  for (let i = 0; i < all.length; i++) {
    const line = all[i];
    let position = line.from;
    for (const character of line.text) {
      result.push({
        position,
        end: position + character.length,
        kind: /\s/u.test(character)
          ? "space"
          : /[\p{L}\p{N}_]/u.test(character)
            ? "word"
            : "punctuation",
      });
      position += character.length;
    }
    if (i < all.length - 1)
      result.push({ position: line.to, end: all[i + 1].from, kind: "space" });
  }
  return result;
}

function wordMotion(
  all: Line[],
  position: number,
  motion: string,
  count: number,
) {
  const tokens = words(all);
  if (!tokens.length) return position;
  let index = tokens.findIndex((token) => token.position >= position);
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
  return tokens[index]?.position ?? all.at(-1)!.to;
}

function motionTarget(
  view: EditorView,
  key: string,
  count: number,
  position: number,
): number | null {
  const all = lines(view.state.doc);
  const line = currentLine(all, position);
  if (!line) return null;
  const index = all.indexOf(line);
  switch (key) {
    case "h":
    case "ArrowLeft":
      for (let i = 0; i < count; i++)
        position = previousCharacter(line, position);
      return position;
    case "l":
    case "ArrowRight":
      for (let i = 0; i < count; i++) position = nextCharacter(line, position);
      return position;
    case "j":
    case "ArrowDown":
    case "k":
    case "ArrowUp": {
      const next =
        all[
          Math.max(
            0,
            Math.min(
              all.length - 1,
              index + (key === "j" || key === "ArrowDown" ? count : -count),
            ),
          )
        ];
      return Math.min(next.to, next.from + position - line.from);
    }
    case "0":
    case "Home":
      return line.from;
    case "^":
      return (
        line.from + (line.text.search(/\S/u) < 0 ? 0 : line.text.search(/\S/u))
      );
    case "$":
    case "End":
      return all[Math.min(all.length - 1, index + count - 1)].to;
    case "w":
    case "b":
    case "e":
    case "cw":
      return wordMotion(all, position, key, count);
    case "gg":
      return all[Math.min(all.length - 1, count - 1)].from;
    case "G":
      return all[Math.min(all.length - 1, count - 1)].from;
    default:
      return null;
  }
}

/** Plain cursor movement reveals math; operators and visual ranges stay atomic. */
function enterAtomAlongMotion(
  view: EditorView,
  motion: string,
  from: number,
  to: number,
): boolean {
  const horizontal = [
    "h",
    "l",
    "ArrowLeft",
    "ArrowRight",
    "w",
    "b",
    "e",
  ].includes(motion);
  const vertical = ["j", "k", "ArrowDown", "ArrowUp"].includes(motion);
  const direction = ["h", "k", "ArrowLeft", "ArrowUp", "b"].includes(motion)
    ? -1
    : to < from
      ? -1
      : 1;
  const candidates: number[] = [];
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if ((horizontal || vertical) && start !== end) {
    view.state.doc.nodesBetween(
      start,
      Math.min(end + 1, view.state.doc.content.size),
      (node, position) => {
        if (position === from || position < start || position > end) return;
        if (
          node.type.name === "blockMath" ||
          isImageNode(node) ||
          (horizontal && node.type.name === "inlineMath")
        )
          candidates.push(position);
      },
    );
  }
  // Normal mode occupies the final character, rather than the caret after it.
  // Resolve a terminal atom directly instead of walking every note line again.
  const $target = view.state.doc.resolve(to);
  const landing =
    $target.parent.isTextblock &&
    $target.parentOffset === $target.parent.content.size &&
    isMathNode($target.nodeBefore)
      ? to - $target.nodeBefore!.nodeSize
      : to;
  if (isMathNode(view.state.doc.nodeAt(landing))) candidates.push(landing);
  // A restored/visual selection may already put the block cursor on an atom.
  // The next motion enters that source before advancing past it.
  if ((horizontal || vertical) && isMathNode(view.state.doc.nodeAt(from)))
    candidates.push(from);
  if (horizontal) {
    const line = currentLine(lines(view.state.doc), from);
    const backwards = ["h", "ArrowLeft", "b"].includes(motion);
    if (line && (backwards ? to <= line.from : to >= line.to)) {
      const image = neighboringImage(view, backwards ? -1 : 1);
      if (image !== null) candidates.push(image);
    }
  }
  const position = candidates.sort((a, b) => direction * (a - b))[0];
  if (position === undefined) return false;
  update(view, reset());
  return isImageNode(view.state.doc.nodeAt(position))
    ? selectImageAt(view, position)
    : enterMathAt(view, position, direction);
}

/** Include a list item's wrapper when linewise commands consume all its text. */
function lineRange(state: EditorState, from: number, to: number) {
  const all = lines(state.doc);
  const first = currentLine(all, Math.min(from, to));
  const last = currentLine(all, Math.max(from, to));
  if (!first || !last) return { from, to, partial: false };
  if (first.blockFrom === last.blockFrom && first.partial) {
    let start = first.from;
    let end = last.to;
    if (last.to < last.blockTo - 1) end++;
    else if (first.from > first.blockFrom + 1) start--;
    return { from: start, to: end, partial: true };
  }
  let start = first.blockFrom;
  let end = last.blockTo;
  const expand = (position: number, side: "start" | "end") => {
    const resolved = state.doc.resolve(position);
    for (let depth = resolved.depth; depth > 0; depth--) {
      const node = resolved.node(depth);
      if (node.type.name === "listItem" || node.type.name === "taskItem") {
        if (side === "start") start = resolved.before(depth);
        else end = resolved.after(depth);
        break;
      }
    }
  };
  expand(first.from, "start");
  expand(last.to, "end");
  return { from: start, to: end, partial: false };
}

function operate(
  view: EditorView,
  operator: "d" | "c" | "y",
  from: number,
  to: number,
  linewise = false,
) {
  const state = view.state;
  const range = linewise
    ? lineRange(state, from, to)
    : { from: Math.min(from, to), to: Math.max(from, to), partial: false };
  if (range.from === range.to) {
    update(
      view,
      reset({
        mode: operator === "c" ? "insert" : "normal",
        anchor: null,
        head: null,
      }),
    );
    return;
  }
  const selectedLines = lines(state.doc);
  const firstLine = currentLine(selectedLines, Math.min(from, to))!;
  const lastLine = currentLine(selectedLines, Math.max(from, to))!;
  const register = {
    slice: range.partial
      ? state.doc.slice(firstLine.from, lastLine.to)
      : state.doc.slice(range.from, range.to),
    linewise,
    partialLine: range.partial,
  };
  let transaction = closeHistory(state.tr);
  if (operator !== "y") {
    if (operator === "c" && linewise) {
      // Keep the current paragraph/list item so typing retains its surrounding structure.
      const all = lines(state.doc);
      const first = currentLine(all, Math.min(from, to))!;
      const last = currentLine(all, Math.max(from, to))!;
      transaction = transaction.delete(first.from, last.to);
      select(transaction, first.from);
    } else {
      transaction = transaction.delete(range.from, range.to);
      select(transaction, range.from);
    }
  } else select(transaction, Math.min(from, to));
  if (operator !== "c")
    select(
      transaction,
      normalPosition(transaction.doc, transaction.selection.head),
    );
  update(
    view,
    reset({
      register,
      mode: operator === "c" ? "insert" : "normal",
      anchor: null,
      head: null,
    }),
    transaction.scrollIntoView(),
  );
}

function paste(view: EditorView, before: boolean, count: number) {
  const vim = vimPluginKey.getState(view.state)!;
  const register = vim.register;
  if (!register) {
    update(view, reset());
    return;
  }
  const selected = view.state.selection;
  if (selected instanceof NodeSelection && isImageNode(selected.node)) {
    if (register.linewise) {
      const position = before ? selected.from : selected.to;
      const transaction = closeHistory(view.state.tr);
      for (let iteration = 0; iteration < count; iteration++)
        transaction.replaceRange(position, position, register.slice);
      if (isImageNode(transaction.doc.nodeAt(position)))
        transaction.setSelection(
          NodeSelection.create(transaction.doc, position),
        );
      else select(transaction, position);
      update(view, reset(), transaction.scrollIntoView());
      return;
    }
    if (!continueFromImage(view, before ? -1 : 1, true)) return;
  }
  const line = currentLine(lines(view.state.doc), view.state.selection.head);
  if (!line) return;
  if (register.linewise && (register.partialLine || line.partial)) {
    const parent = view.state.doc.resolve(line.from).parent;
    const separator = parent.type.spec.code
      ? view.state.schema.text("\n")
      : view.state.schema.nodes.hardBreak.create();
    let content = register.slice.content;
    if (!register.partialLine) {
      const text = content.textBetween(0, content.size, "\n", "\ufffc");
      content = text
        ? Fragment.from(view.state.schema.text(text))
        : Fragment.empty;
    }
    let repeated = Fragment.empty;
    for (let iteration = 0; iteration < count; iteration++) {
      repeated = repeated.append(
        before
          ? content.append(Fragment.from(separator))
          : Fragment.from(separator).append(content),
      );
    }
    const position = before ? line.from : line.to;
    const transaction = closeHistory(view.state.tr).replaceRange(
      position,
      position,
      new Slice(repeated, 0, 0),
    );
    select(transaction, position + (before ? 0 : 1));
    update(view, reset(), transaction.scrollIntoView());
    return;
  }
  let position = before
    ? view.state.selection.head
    : nextCharacter(line, view.state.selection.head);
  if (register.linewise) {
    const range = lineRange(view.state, line.from, line.to);
    position = before ? range.from : range.to;
  }
  let transaction = closeHistory(view.state.tr);
  for (let iteration = 0; iteration < count; iteration++) {
    transaction = transaction.replaceRange(position, position, register.slice);
  }
  if (register.linewise && isImageNode(transaction.doc.nodeAt(position)))
    transaction.setSelection(NodeSelection.create(transaction.doc, position));
  else
    select(
      transaction,
      position +
        (register.linewise ? 1 : Math.max(0, register.slice.size * count - 1)),
    );
  update(view, reset(), transaction.scrollIntoView());
}

function openLine(view: EditorView, before: boolean) {
  const line = currentLine(lines(view.state.doc), view.state.selection.head);
  if (!line) return;
  const resolved = view.state.doc.resolve(line.from);
  if (line.partial) {
    const separator = resolved.parent.type.spec.code
      ? view.state.schema.text("\n")
      : view.state.schema.nodes.hardBreak.create();
    const position = before ? line.from : line.to;
    const transaction = closeHistory(view.state.tr).insert(position, separator);
    select(transaction, position + (before ? 0 : 1));
    update(
      view,
      reset({ mode: "insert", anchor: null, head: null }),
      transaction.scrollIntoView(),
    );
    return;
  }
  const paragraph = view.state.schema.nodes.paragraph.create();
  let node = paragraph;
  let position = before ? line.blockFrom : line.blockTo;
  for (let depth = resolved.depth; depth > 0; depth--) {
    const parent = resolved.node(depth);
    if (parent.type.name === "listItem" || parent.type.name === "taskItem") {
      node = parent.type.create(
        {
          ...parent.attrs,
          ...(parent.type.name === "taskItem" ? { checked: false } : {}),
        },
        paragraph,
      );
      position = before ? resolved.before(depth) : resolved.after(depth);
      break;
    }
  }
  const transaction = closeHistory(view.state.tr).replaceRange(
    position,
    position,
    new Slice(Fragment.from(node), 0, 0),
  );
  select(transaction, position + (node === paragraph ? 1 : 2));
  update(
    view,
    reset({ mode: "insert", anchor: null, head: null }),
    transaction.scrollIntoView(),
  );
}

/** An image is an atomic Normal-mode target, never an invisible text position. */
function handleSelectedImage(view: EditorView, key: string, count: number) {
  const selection = view.state.selection;
  if (!(selection instanceof NodeSelection) || !isImageNode(selection.node))
    return false;
  const vim = vimPluginKey.getState(view.state)!;
  const command = vim.operator;
  if (command && key !== command) {
    update(view, reset());
    return true;
  }
  if (["d", "c", "y"].includes(key) && !command) {
    update(view, {
      operator: key as "d" | "c" | "y",
      operatorCount: count,
      count: "",
      pending: "",
    });
    return true;
  }
  if (command || ["x", "X", "Delete", "Backspace", "D", "C"].includes(key)) {
    const operator = command ?? (key === "C" ? "c" : "d");
    const register: Register = {
      slice: view.state.doc.slice(selection.from, selection.to),
      linewise: true,
    };
    if (operator !== "y") deleteSelectedImage(view);
    update(
      view,
      reset({
        register,
        mode: operator === "c" ? "insert" : "normal",
        anchor: null,
        head: null,
      }),
    );
    if (
      operator !== "y" &&
      operator !== "c" &&
      view.state.selection instanceof TextSelection
    )
      move(view, view.state.selection.head);
    return true;
  }
  if (
    [
      "h",
      "k",
      "ArrowLeft",
      "ArrowUp",
      "b",
      "l",
      "j",
      "ArrowRight",
      "ArrowDown",
      "w",
      "e",
    ].includes(key)
  ) {
    update(view, reset());
    moveFromImage(
      view,
      ["h", "k", "ArrowLeft", "ArrowUp", "b"].includes(key) ? -1 : 1,
    );
    if (view.state.selection instanceof TextSelection)
      move(view, view.state.selection.head);
    return true;
  }
  if (["i", "I", "a", "A", "o", "O"].includes(key)) {
    const before = ["i", "I", "O"].includes(key);
    if (continueFromImage(view, before ? -1 : 1, key === "o" || key === "O"))
      update(view, reset({ mode: "insert", anchor: null, head: null }));
    return true;
  }
  if (key === "Enter") {
    continueFromImage(view, 1);
    update(view, reset());
    return true;
  }
  if (key === "p" || key === "P") {
    paste(view, key === "P", count);
    return true;
  }
  if (key === "u") {
    for (let i = 0; i < count; i++) undo(view.state, view.dispatch);
    update(view, reset());
    return true;
  }
  // Whole-document motions can still leave the image. Other printable keys
  // must never fall through as text replacement for the selected object.
  if (key === "g" || key === "G") return false;
  if (key.length === 1) {
    update(view, reset());
    return true;
  }
  return false;
}

function handleKey(view: EditorView, event: KeyboardEvent): boolean {
  const vim = vimPluginKey.getState(view.state);
  if (!vim?.enabled || event.isComposing || view.composing) return false;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable='false']")
  )
    return false;
  const key = event.key;
  if (key === "Escape" || (event.ctrlKey && (key === "[" || key === "c"))) {
    setMode(view, "normal");
    return true;
  }
  if (vim.mode === "insert") return false;
  if (event.metaKey || event.altKey) return false;
  // Keep platform range-selection keys available without opening atom sources.
  if (
    event.shiftKey &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
      key,
    )
  )
    return false;
  if (event.ctrlKey) {
    if (key.toLowerCase() === "r") {
      redo(view.state, view.dispatch);
      update(view, reset());
      return true;
    }
    return false;
  }
  const position = vim.head ?? view.state.selection.head;
  const all = lines(view.state.doc);
  const line = currentLine(all, position);
  if (/^[1-9]$/.test(key) || (key === "0" && vim.count)) {
    update(view, { count: (vim.count + key).slice(0, 4) });
    return true;
  }
  let count = Math.min(1000, Number(vim.count) || 1);
  let motion = key;
  if (vim.pending === "g") {
    if (key !== "g") {
      update(view, reset());
      return true;
    }
    motion = "gg";
  } else if (key === "g") {
    update(view, { pending: "g" });
    return true;
  }
  if (key === "G" && !vim.count) count = all.length;
  if (handleSelectedImage(view, key, count)) return true;
  if (!line) return false;

  if (vim.mode === "visual" || vim.mode === "visual-line") {
    if (key === "v" || key === "V") {
      const mode = key === "v" ? "visual" : "visual-line";
      if (vim.mode === mode) setMode(view, "normal");
      else {
        update(view, { mode });
        move(view, position);
      }
      return true;
    }
    if (["d", "x", "c", "y"].includes(key)) {
      operate(
        view,
        key === "x" ? "d" : (key as "d" | "c" | "y"),
        vim.mode === "visual-line"
          ? (vim.anchor ?? position)
          : view.state.selection.from,
        vim.mode === "visual-line" ? position : view.state.selection.to,
        vim.mode === "visual-line",
      );
      return true;
    }
  }

  if (vim.operator) {
    count = Math.min(1000, count * vim.operatorCount);
    if (key === vim.operator) {
      const end =
        all[Math.min(all.length - 1, all.indexOf(line) + count - 1)].to;
      operate(view, vim.operator, position, end, true);
      return true;
    }
    // Vim's cw changes through the word end, leaving separating whitespace.
    if (
      vim.operator === "c" &&
      key === "w" &&
      /\S/u.test(line.text[position - line.from] ?? "")
    )
      motion = "cw";
    let targetPosition = motionTarget(view, motion, count, position);
    if (targetPosition !== null) {
      if (
        motion === "w" &&
        count === 1 &&
        targetPosition > line.to &&
        /\S/u.test(line.text[position - line.from] ?? "")
      )
        targetPosition = line.to;
      if (motion === "e" || motion === "cw") {
        const targetLine = currentLine(all, targetPosition)!;
        targetPosition = nextCharacter(targetLine, targetPosition);
      }
      const linewise = ["j", "k", "ArrowDown", "ArrowUp", "gg", "G"].includes(
        motion,
      );
      operate(view, vim.operator, position, targetPosition, linewise);
    } else update(view, reset());
    return true;
  }

  const targetPosition = motionTarget(view, motion, count, position);
  if (targetPosition !== null) {
    if (
      vim.mode === "normal" &&
      enterAtomAlongMotion(view, motion, position, targetPosition)
    )
      return true;
    move(view, targetPosition);
    return true;
  }

  switch (key) {
    case "i":
    case "a":
    case "I":
    case "A": {
      let insertion = position;
      if (key === "a") insertion = nextCharacter(line, position);
      if (key === "I")
        insertion = line.from + Math.max(0, line.text.search(/\S/u));
      if (key === "A") insertion = line.to;
      update(
        view,
        reset({ mode: "insert", anchor: null, head: null }),
        select(closeHistory(view.state.tr), insertion),
      );
      return true;
    }
    case "o":
    case "O":
      openLine(view, key === "O");
      return true;
    case "v":
    case "V":
      update(
        view,
        reset({
          mode: key === "v" ? "visual" : "visual-line",
          anchor: position,
          head: position,
        }),
      );
      move(view, position);
      return true;
    case "d":
    case "c":
    case "y":
      update(view, {
        operator: key,
        operatorCount: count,
        count: "",
        pending: "",
      });
      return true;
    case "x":
    case "Delete": {
      let end = position;
      for (let i = 0; i < count; i++) end = nextCharacter(line, end);
      operate(view, "d", position, end);
      return true;
    }
    case "X":
    case "Backspace": {
      let start = position;
      for (let i = 0; i < count; i++) start = previousCharacter(line, start);
      operate(view, "d", start, position);
      return true;
    }
    case "D":
    case "C":
      operate(view, key === "D" ? "d" : "c", position, line.to);
      return true;
    case "p":
    case "P":
      paste(view, key === "P", count);
      return true;
    case "u":
      for (let i = 0; i < count; i++) undo(view.state, view.dispatch);
      update(view, reset());
      return true;
    default:
      // Unknown printable commands stay in Normal mode; they never leak into the note.
      if (key.length === 1 || key === "Enter") {
        update(view, reset());
        return true;
      }
      return false;
  }
}

export const VimEditor = Extension.create<VimOptions>({
  name: "daymarkVim",
  priority: 1100,
  addOptions() {
    return { enabled: false, onModeChange: () => {} };
  },
  addCommands() {
    return {
      setVimEnabled:
        (enabled) =>
        ({ tr, dispatch }) => {
          if (dispatch) {
            tr.setMeta(vimPluginKey, { ...INITIAL, enabled });
            if (
              enabled &&
              !(
                tr.selection instanceof NodeSelection &&
                isImageNode(tr.selection.node)
              )
            )
              select(tr, normalPosition(tr.doc, tr.selection.head));
          }
          return true;
        },
    };
  },
  addProseMirrorPlugins() {
    const options = this.options;
    return [
      new Plugin<VimState>({
        key: vimPluginKey,
        appendTransaction(transactions, _oldState, state) {
          const exit = [...transactions]
            .reverse()
            .map((transaction) => transaction.getMeta("daymarkMathExit"))
            .find(Boolean) as { direction: -1 | 1 } | undefined;
          const vim = vimPluginKey.getState(state)!;
          if (
            !exit ||
            !vim.enabled ||
            vim.mode !== "normal" ||
            !(state.selection instanceof TextSelection) ||
            !state.selection.empty
          )
            return null;
          const { $head } = state.selection;
          const neighbor =
            exit.direction < 0 ? $head.nodeBefore : $head.nodeAfter;
          if (isMathNode(neighbor)) return null;
          const line = currentLine(lines(state.doc), $head.pos);
          if (!line) return null;
          // LaTeX uses a caret; Normal mode resumes on the preceding character
          // when leaving to the left. Never clamp back onto the equation itself.
          const position =
            exit.direction < 0
              ? previousCharacter(line, $head.pos)
              : isMathNode($head.nodeBefore)
                ? $head.pos
                : normalPosition(state.doc, $head.pos);
          if (position === $head.pos) return null;
          return select(state.tr, position);
        },
        state: {
          init: () => ({ ...INITIAL, enabled: options.enabled }),
          apply(transaction, previous) {
            const patch = transaction.getMeta(vimPluginKey) as
              Partial<VimState> | undefined;
            const next = { ...previous, ...patch };
            if (
              !patch &&
              transaction.selectionSet &&
              (previous.mode === "visual" || previous.mode === "visual-line")
            ) {
              // A mouse click or a toolbar action ends a keyboard visual selection.
              next.mode = "normal";
              next.anchor = null;
              next.head = null;
            }
            if (transaction.docChanged) {
              if (next.anchor !== null && patch?.anchor === undefined)
                next.anchor = transaction.mapping.map(next.anchor);
              if (next.head !== null && patch?.head === undefined)
                next.head = transaction.mapping.map(next.head);
            }
            return next;
          },
        },
        props: {
          attributes(state) {
            const vim = vimPluginKey.getState(state)!;
            return { "data-vim-mode": vim.enabled ? vim.mode : "off" };
          },
          handleKeyDown: handleKey,
          handleTextInput(view) {
            const vim = vimPluginKey.getState(view.state)!;
            return vim.enabled && vim.mode !== "insert" && !view.composing;
          },
          decorations(state) {
            const vim = vimPluginKey.getState(state)!;
            if (!vim.enabled || vim.mode !== "normal" || !state.selection.empty)
              return null;
            const position = state.selection.head;
            const line = currentLine(lines(state.doc), position);
            if (!line) return null;
            if (position < line.to)
              return DecorationSet.create(state.doc, [
                Decoration.inline(position, nextCharacter(line, position), {
                  class: "vim-block-cursor",
                }),
              ]);
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                position,
                () => {
                  const cursor = document.createElement("span");
                  cursor.className = "vim-empty-cursor";
                  cursor.setAttribute("aria-hidden", "true");
                  return cursor;
                },
                { side: 1 },
              ),
            ]);
          },
        },
        view(view) {
          let last = vimPluginKey.getState(view.state)!;
          let destroyed = false;
          queueMicrotask(() => {
            if (!destroyed)
              options.onModeChange(last.enabled ? last.mode : null);
          });
          return {
            update(updatedView) {
              const next = vimPluginKey.getState(updatedView.state)!;
              if (next.enabled !== last.enabled || next.mode !== last.mode)
                options.onModeChange(next.enabled ? next.mode : null);
              last = next;
            },
            destroy() {
              destroyed = true;
            },
          };
        },
      }),
    ];
  },
});
