import { useId, useLayoutEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { ChainedCommands, Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { closeHistory } from "@tiptap/pm/history";
import {
  ListTodo,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Code2,
  Sigma,
  ImagePlus,
  Table2,
  Minus,
  Search,
} from "lucide-react";
import { acceptsTextBlock } from "./NoteElementMenu";
import { enterMathAt } from "./math-navigation";
import { clearVimPendingAction } from "./vim-editor";
import { dismissNoteSlash, noteSlashKey } from "./note-slash";
import type { SlashState } from "./note-slash";
import "./note-slash-menu.css";

type SlashKeyHandler = (view: EditorView, event: KeyboardEvent) => boolean;
interface Props {
  editor: Editor;
  slash: SlashState;
  touch: boolean;
  keyHandler: MutableRefObject<SlashKeyHandler>;
  onImage: (range: SlashState) => void;
}

function actions(editor: Editor) {
  const inList = ["taskList", "bulletList", "orderedList"].some((type) =>
    editor.isActive(type),
  );
  return [
    {
      label: "Checklist",
      description: "Small steps you can check off",
      icon: ListTodo,
      keywords: "checkbox task todo subtask check list",
      run: (chain: ChainedCommands) =>
        editor.isActive("taskList") ? chain : chain.toggleTaskList(),
    },
    {
      label: "Bullet list",
      description: "A simple unordered list",
      icon: List,
      keywords: "unordered bullets",
      run: (chain: ChainedCommands) =>
        editor.isActive("bulletList") ? chain : chain.toggleBulletList(),
    },
    {
      label: "Numbered list",
      description: "Steps in order",
      icon: ListOrdered,
      keywords: "ordered number steps",
      run: (chain: ChainedCommands) =>
        editor.isActive("orderedList") ? chain : chain.toggleOrderedList(),
    },
    ...([1, 2, 3] as const).map((level) => ({
      label: `Heading ${level}`,
      description: [
        "Large section heading",
        "Medium section heading",
        "Small section heading",
      ][level - 1],
      icon: [Heading1, Heading2, Heading3][level - 1],
      keywords: `h${level} title header`,
      available: acceptsTextBlock(editor, "heading"),
      run: (chain: ChainedCommands) => chain.setHeading({ level }),
    })),
    {
      label: "Quote",
      description: "A passage worth keeping",
      icon: Quote,
      keywords: "blockquote citation",
      available: !inList,
      run: (chain: ChainedCommands) =>
        editor.isActive("blockquote") ? chain : chain.toggleBlockquote(),
    },
    {
      label: "Display equation",
      description: "A LaTeX equation on its own line",
      icon: Sigma,
      keywords: "math latex formula equation",
      available: !inList,
      run: (chain: ChainedCommands) => chain,
    },
    {
      label: "Image",
      description: "Choose an image for your note",
      icon: ImagePlus,
      keywords: "picture photo screenshot upload",
      run: (chain: ChainedCommands) => chain,
    },
    {
      label: "Table",
      description: "Organize information in columns",
      icon: Table2,
      keywords: "grid rows columns",
      available: !inList && !editor.isActive("table"),
      run: (chain: ChainedCommands) =>
        chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }),
    },
    {
      label: "Code block",
      description: "Code in a separate block",
      icon: Code2,
      keywords: "code snippet monospace",
      available: acceptsTextBlock(editor, "codeBlock"),
      run: (chain: ChainedCommands) => chain.setCodeBlock(),
    },
    {
      label: "Divider",
      description: "A quiet break between sections",
      icon: Minus,
      keywords: "rule horizontal separator line",
      run: (chain: ChainedCommands) => chain.setHorizontalRule(),
    },
  ].filter((action) => !("available" in action) || action.available !== false);
}
type Action = ReturnType<typeof actions>[number];
function matches(editor: Editor, query: string) {
  const words = query.trim().toLowerCase().split(/\s+/);
  return actions(editor).filter((action) =>
    words.every((word) =>
      `${action.label} ${action.keywords}`.toLowerCase().includes(word),
    ),
  );
}

export default function NoteSlashMenu({
  editor,
  slash,
  touch,
  keyHandler,
  onImage,
}: Props) {
  const id = `note-slash-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const panel = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState({ query: slash.query, index: 0 });
  const options = matches(editor, slash.query);
  const active =
    selection.query === slash.query
      ? Math.min(selection.index, Math.max(0, options.length - 1))
      : 0;
  const [placement, setPlacement] = useState({
    top: 0,
    left: 0,
    maxHeight: 360,
    visibility: "hidden" as "hidden" | "visible",
  });

  function choose(action: Action) {
    const current = noteSlashKey.getState(editor.state);
    if (!current || editor.isDestroyed) return;
    // Read the live plugin range, never a position captured by an old render.
    dismissNoteSlash(editor.view);
    clearVimPendingAction(editor.view);
    if (action.label === "Image") {
      onImage(current);
      return;
    }
    editor.view.focus();
    let chain = editor
      .chain()
      .command(({ tr }) => {
        closeHistory(tr);
        return true;
      })
      .deleteRange({ from: current.from, to: current.to });
    let equationPosition: number | undefined;
    if (action.label === "Display equation") {
      const equation = editor.schema.nodes.blockMath.create({ latex: "" });
      chain = chain.command(({ tr }) => {
        tr.replaceSelectionWith(equation);
        tr.doc.descendants((node, position) => {
          if (node === equation) equationPosition = position;
        });
        return true;
      });
    } else chain = action.run(chain);
    chain.scrollIntoView().run();
    // Following typing is a separate undo step from replacing /query.
    editor.view.dispatch(closeHistory(editor.state.tr));
    if (equationPosition !== undefined)
      enterMathAt(editor.view, equationPosition, 1);
  }

  useLayoutEffect(() => {
    keyHandler.current = (view, event) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        view.composing ||
        event.isComposing
      )
        return false;
      const current = noteSlashKey.getState(view.state);
      if (!current) return false;
      const available = matches(editor, current.query);
      const index =
        selection.query === current.query
          ? Math.min(selection.index, Math.max(0, available.length - 1))
          : 0;
      if (!available.length) {
        dismissNoteSlash(view);
        return false;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setSelection({
          query: current.query,
          index:
            (index + (event.key === "ArrowUp" ? -1 : 1) + available.length) %
            available.length,
        });
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choose(available[index]);
        return true;
      }
      return false;
    };
    return () => {
      keyHandler.current = () => false;
    };
  });

  useLayoutEffect(() => {
    const dom = editor.view.dom;
    dom.setAttribute("aria-controls", id);
    dom.setAttribute("aria-expanded", "true");
    dom.setAttribute("aria-haspopup", "listbox");
    if (options.length)
      dom.setAttribute("aria-activedescendant", `${id}-${active}`);
    else dom.removeAttribute("aria-activedescendant");
    panel.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
    return () => {
      for (const attribute of [
        "aria-controls",
        "aria-expanded",
        "aria-haspopup",
        "aria-activedescendant",
      ])
        dom.removeAttribute(attribute);
    };
  }, [editor, id, active, slash.query, options.length]);

  useLayoutEffect(() => {
    let frame = 0;
    const place = () => {
      if (!panel.current || editor.isDestroyed) return;
      try {
        const viewport = window.visualViewport;
        const top = (viewport?.offsetTop ?? 0) + 8;
        const left = (viewport?.offsetLeft ?? 0) + 8;
        const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
        const right = left + (viewport?.width ?? window.innerWidth) - 16;
        const caret = editor.view.coordsAtPos(slash.to);
        const trigger = editor.view.coordsAtPos(slash.from);
        const below = bottom - caret.bottom - 8;
        const above = caret.top - top - 8;
        const useBelow =
          below >= Math.min(panel.current.scrollHeight, 240) || below >= above;
        const maxHeight = Math.max(80, Math.min(360, useBelow ? below : above));
        const height = Math.min(panel.current.scrollHeight, maxHeight);
        setPlacement({
          top: Math.max(
            top,
            Math.min(
              useBelow ? caret.bottom + 8 : caret.top - height - 8,
              bottom - height,
            ),
          ),
          left: Math.max(
            left,
            Math.min(trigger.left, right - panel.current.offsetWidth),
          ),
          maxHeight,
          visibility: "visible",
        });
      } catch {
        /* The editor may be replacing its DOM after a synced change. */
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    const scroll = (event: Event) => {
      if (
        !(event.target instanceof Node) ||
        !panel.current?.contains(event.target)
      )
        schedule();
    };
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node))
        dismissNoteSlash(editor.view);
    };
    place();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("pointerdown", outside);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("pointerdown", outside);
    };
  }, [editor, slash.from, slash.to, slash.query, options.length]);

  return createPortal(
    <div
      ref={panel}
      className={`note-slash-menu ${touch ? "is-touch" : ""}`}
      style={placement}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="note-slash-title">
        <Search size={13} />
        <span>{slash.query ? `Add “${slash.query}”` : "Add to your note"}</span>
        <kbd>esc</kbd>
      </div>
      <div
        id={id}
        role="listbox"
        aria-label="Insert note element"
        className="note-slash-options"
      >
        {options.map((action, index) => (
          <button
            key={action.label}
            id={`${id}-${index}`}
            type="button"
            role="option"
            aria-label={action.label}
            aria-selected={active === index}
            tabIndex={-1}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => choose(action)}
          >
            <span className="note-slash-icon">
              <action.icon size={18} />
            </span>
            <span>
              <strong>{action.label}</strong>
              <small>{action.description}</small>
            </span>
            {active === index && !touch && <kbd>↵</kbd>}
          </button>
        ))}
      </div>
      {!options.length && (
        <div className="note-slash-empty" role="status">
          No matching elements. Keep typing, or press Escape to keep this as
          text.
        </div>
      )}
      <div className="note-slash-footer">
        {touch ? "Tap to insert" : "↑↓ choose · Enter or Tab to insert"}
        <span>More in +</span>
      </div>
    </div>,
    document.body,
  );
}
