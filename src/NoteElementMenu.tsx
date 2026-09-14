import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { setBlockType } from "@tiptap/pm/commands";
import {
  Bold,
  Italic,
  Strikethrough,
  Link2,
  ListTodo,
  List,
  ListOrdered,
  Quote,
  Code2,
  Sigma,
  ImagePlus,
  Paperclip,
  Table2,
  Minus,
  FileCode2,
  X,
} from "lucide-react";
import { enterMathAt } from "./math-navigation";
import { clearVimPendingAction } from "./vim-editor";
import "./note-element-menu.css";

interface Props {
  editor: Editor;
  anchor: HTMLElement;
  touch: boolean;
  onClose: () => void;
  onLink: () => void;
  onImage: () => void;
  onAttach: () => void;
  onSource: () => void;
}

// Formatting must not silently lift a checkbox or list item out of its list.
function acceptsTextBlock(editor: Editor, name: string) {
  const { $from, $to } = editor.state.selection;
  const type = editor.schema.nodes[name];
  return (
    !!type &&
    $from.depth > 0 &&
    $from.sameParent($to) &&
    $from.parent.isTextblock &&
    $from.node(-1).canReplaceWith($from.index(-1), $from.index(-1) + 1, type)
  );
}

function setTextBlock(editor: Editor, name: string, attrs = {}) {
  editor.commands.command(({ state, dispatch }) =>
    setBlockType(editor.schema.nodes[name], attrs)(state, dispatch),
  );
}

/** Insert beside a selected attachment/equation, retaining the original block. */
function prepareInsertion(editor: Editor) {
  const { selection } = editor.state;
  if (!(selection instanceof NodeSelection)) return;
  const tr = editor.state.tr;
  const pos = selection.to;
  if (selection.node.isBlock) {
    tr.insert(pos, editor.schema.nodes.paragraph.create());
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  } else {
    tr.setSelection(TextSelection.create(tr.doc, pos));
  }
  editor.view.dispatch(tr);
}

function insertEquation(editor: Editor) {
  prepareInsertion(editor);
  const equation = editor.schema.nodes.blockMath.create({ latex: "" });
  let position: number | undefined;
  editor
    .chain()
    .command(({ tr }) => {
      tr.replaceSelectionWith(equation);
      tr.doc.descendants((node, pos) => {
        if (node === equation) position = pos;
      });
      return true;
    })
    .run();
  if (position !== undefined) enterMathAt(editor.view, position, 1);
}

export default function NoteElementMenu({
  editor,
  anchor,
  touch,
  onClose,
  onLink,
  onImage,
  onAttach,
  onSource,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState({
    top: 12,
    left: 12,
    maxHeight: 480,
  });
  const closeRef = useRef(onClose);
  const placeRef = useRef<() => void>(() => {});
  closeRef.current = onClose;
  const restore = () => {
    onClose();
    if (!editor.isDestroyed) editor.view.focus();
  };

  useLayoutEffect(() => {
    const place = () => {
      if (!panel.current) return;
      const viewport = window.visualViewport;
      const topEdge = (viewport?.offsetTop ?? 0) + 12;
      const height = viewport?.height ?? window.innerHeight;
      const bottomEdge = topEdge + height - 24;
      const rect = anchor.getBoundingClientRect();
      const maxHeight = Math.min(480, height - 24);
      const menuHeight = Math.min(panel.current.scrollHeight, maxHeight);
      setPlacement({
        top: Math.max(
          topEdge,
          Math.min(rect.bottom + 6, bottomEdge - menuHeight),
        ),
        left: Math.max(
          12,
          Math.min(
            rect.left,
            window.innerWidth - Math.min(300, window.innerWidth - 24) - 12,
          ),
        ),
        maxHeight,
      });
    };
    placeRef.current = place;
    place();
    const initial =
      panel.current?.querySelector<HTMLButtonElement>(
        '.note-element-text-types button[aria-pressed="true"]:not(:disabled)',
      ) ??
      panel.current?.querySelector<HTMLButtonElement>(
        ".note-element-actions button:not(:disabled)",
      );
    initial?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
    };
  }, [anchor]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.contains(event.target as Node)
      )
        closeRef.current();
    };
    const scroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target)
      )
        placeRef.current();
    };
    const changed = ({
      transaction,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (transaction.docChanged) closeRef.current();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("scroll", scroll, true);
    editor.on("transaction", changed);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("scroll", scroll, true);
      editor.off("transaction", changed);
    };
  }, [editor, anchor]);

  const run = (command: () => void) => {
    onClose();
    clearVimPendingAction(editor.view);
    command();
  };
  const format = (command: () => void) =>
    run(() => {
      editor.view.focus();
      command();
    });
  const text = editor.state.selection.$from.parent.isTextblock;
  const inList =
    editor.isActive("taskList") ||
    editor.isActive("bulletList") ||
    editor.isActive("orderedList");
  const actions = [
    {
      label: "Checklist",
      icon: ListTodo,
      active: editor.isActive("taskList"),
      disabled: !text,
      action: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Bullet list",
      icon: List,
      active: editor.isActive("bulletList"),
      disabled: !text,
      action: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      icon: ListOrdered,
      active: editor.isActive("orderedList"),
      disabled: !text,
      action: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Quote",
      icon: Quote,
      active: editor.isActive("blockquote"),
      disabled: !text || inList,
      action: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      icon: Code2,
      active: editor.isActive("codeBlock"),
      disabled: !acceptsTextBlock(editor, "codeBlock"),
      action: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "Display equation",
      icon: Sigma,
      disabled: inList,
      action: () => insertEquation(editor),
    },
    { label: "Insert image", icon: ImagePlus, action: onImage },
    {
      label: "Attach a file or PDF",
      short: "File or PDF",
      icon: Paperclip,
      action: onAttach,
    },
    {
      label: "Insert table",
      short: "Table",
      icon: Table2,
      disabled: editor.isActive("table"),
      action: () => {
        prepareInsertion(editor);
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
          .run();
      },
    },
    {
      label: "Divider",
      icon: Minus,
      action: () => {
        prepareInsertion(editor);
        editor.chain().focus().setHorizontalRule().run();
      },
    },
  ];

  return createPortal(
    <div
      ref={panel}
      className={`note-element-menu${touch ? " is-touch-menu" : ""}`}
      style={placement}
      role="dialog"
      aria-label="Note elements"
      onMouseDown={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = Array.from(
          panel.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const current = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          restore();
        } else if (
          [
            "ArrowDown",
            "ArrowRight",
            "ArrowUp",
            "ArrowLeft",
            "Home",
            "End",
          ].includes(event.key)
        ) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (current +
                    (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "Tab") {
          event.preventDefault();
          buttons[
            (current + (event.shiftKey ? -1 : 1) + buttons.length) %
              buttons.length
          ]?.focus();
        }
      }}
    >
      <div className="note-element-menu-title">
        <span>Add or change</span>
        <button
          type="button"
          aria-label="Close note elements"
          onClick={restore}
        >
          <X size={15} />
        </button>
      </div>
      <div className="note-element-text-types" aria-label="Text style">
        <button
          type="button"
          aria-label="Plain text"
          aria-pressed={editor.isActive("paragraph")}
          disabled={!acceptsTextBlock(editor, "paragraph")}
          onClick={() =>
            format(() => {
              setTextBlock(editor, "paragraph");
            })
          }
        >
          Text
        </button>
        {([1, 2, 3] as const).map((level) => (
          <button
            key={level}
            type="button"
            aria-label={`Heading ${level}`}
            aria-pressed={editor.isActive("heading", { level })}
            disabled={!acceptsTextBlock(editor, "heading")}
            onClick={() =>
              format(() => {
                setTextBlock(editor, "heading", { level });
              })
            }
          >
            H{level}
          </button>
        ))}
      </div>
      <div className="note-element-actions">
        {actions.map(
          ({ label, short, icon: Icon, active, disabled, action }) => (
            <button
              type="button"
              key={label}
              aria-label={label}
              aria-pressed={active}
              disabled={disabled}
              onClick={() => run(action)}
            >
              <Icon size={17} />
              <span>{short ?? label}</span>
            </button>
          ),
        )}
      </div>
      <div className="note-element-marks" aria-label="Text formatting">
        <button
          type="button"
          aria-label="Bold (⌘B)"
          aria-pressed={editor.isActive("bold")}
          disabled={!text}
          onClick={() =>
            format(() => {
              editor.commands.toggleBold();
            })
          }
        >
          <Bold size={17} />
        </button>
        <button
          type="button"
          aria-label="Italic (⌘I)"
          aria-pressed={editor.isActive("italic")}
          disabled={!text}
          onClick={() =>
            format(() => {
              editor.commands.toggleItalic();
            })
          }
        >
          <Italic size={17} />
        </button>
        <button
          type="button"
          aria-label="Strikethrough"
          aria-pressed={editor.isActive("strike")}
          disabled={!text}
          onClick={() =>
            format(() => {
              editor.commands.toggleStrike();
            })
          }
        >
          <Strikethrough size={17} />
        </button>
        <button
          type="button"
          aria-label="Add or edit link"
          aria-pressed={editor.isActive("link")}
          disabled={!text}
          onClick={() => run(onLink)}
        >
          <Link2 size={17} />
          <span>Link</span>
        </button>
      </div>
      <button
        type="button"
        className="note-element-source"
        aria-label="Edit Markdown source"
        onClick={() => run(onSource)}
      >
        <FileCode2 size={16} />
        <span>Edit Markdown source</span>
      </button>
    </div>,
    document.body,
  );
}
