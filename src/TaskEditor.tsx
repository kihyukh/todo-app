import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { InputRule } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import type { NoteNode } from "./model";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Code2,
  Sigma,
  Link2,
  Paperclip,
  ImagePlus,
  X,
  Check,
  Table2,
  FileCode2,
  Undo2,
  Redo2,
} from "lucide-react";
import katex from "katex";
import "katex/dist/katex.min.css";
import "./editor.css";

export { extractCheckboxes, toggleCheckbox, plainText } from "./editor-utils";

const EMPTY_NOTE: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Match the familiar Obsidian / HackMD syntax while retaining Tiptap's math nodes.
// The upstream typing rules use double / triple dollars, unlike its Markdown parser.
const NaturalInlineMath = InlineMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /(?<![$\\])\$([^$\n]+)\$$/,
        handler: ({ state, range, match }) => {
          state.tr.replaceWith(
            range.from,
            range.to,
            this.type.create({ latex: match[1].trim() }),
          );
        },
      }),
    ];
  },
});

const NaturalBlockMath = BlockMath.extend({
  addInputRules() {
    return [
      new InputRule({
        find: /^\$\$([^$]+)\$\$$/,
        handler: ({ state, range, match }) => {
          const position = state.doc.resolve(range.from);
          const consumesParagraph =
            position.depth > 0 &&
            position.parent.isTextblock &&
            range.from === position.start() &&
            range.to === position.end();
          const canReplace =
            consumesParagraph &&
            position
              .node(-1)
              .canReplaceWith(
                position.index(-1),
                position.indexAfter(-1),
                this.type,
              );
          state.tr.replaceWith(
            canReplace ? position.before() : range.from,
            canReplace ? position.after() : range.to,
            this.type.create({ latex: match[1].trim() }),
          );
        },
      }),
    ];
  },
});

type MathKind = "inline" | "block";
interface MathDraft {
  latex: string;
  kind: MathKind;
  originalKind: MathKind;
  position?: number;
  from: number;
  to: number;
}
interface LinkDraft {
  url: string;
  from: number;
  to: number;
}
interface TaskEditorProps {
  taskId: string;
  content: NoteNode;
  onChange: (json: NoteNode) => void;
  onAttach: () => void;
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`note-tool${active ? " is-active" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function normalizedLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default function TaskEditor({
  taskId,
  content,
  onChange,
  onAttach,
}: TaskEditorProps) {
  const [mathDraft, setMathDraft] = useState<MathDraft | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [, refreshToolbar] = useState(0);
  const onChangeRef = useRef(onChange);
  const editorRef = useRef<Editor | null>(null);
  const taskIdRef = useRef(taskId);
  const receivedContent = useRef(content);
  const imageInput = useRef<HTMLInputElement>(null);
  const equationInput = useRef<HTMLTextAreaElement>(null);
  const mathPanel = useRef<HTMLDivElement>(null);
  onChangeRef.current = onChange;
  taskIdRef.current = taskId;

  const insertImages = async (files: File[], position?: number) => {
    const destinationTaskId = taskIdRef.current;
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.some((file) => file.size > MAX_IMAGE_BYTES))
      setNotice(
        "Each image can be up to 10 MB. Larger files can be added as attachments.",
      );
    const safeImages = images.filter((file) => file.size <= MAX_IMAGE_BYTES);
    try {
      const nodes = await Promise.all(
        safeImages.map(
          (file) =>
            new Promise<JSONContent>((resolve, reject) => {
              const reader = new FileReader();
              reader.onerror = () =>
                reject(new Error("Image could not be read."));
              reader.onload = () =>
                resolve({
                  type: "image",
                  attrs: {
                    src: reader.result as string,
                    alt: file.name,
                    title: file.name,
                  },
                });
              reader.readAsDataURL(file);
            }),
        ),
      );
      if (
        !nodes.length ||
        currentEditor.isDestroyed ||
        destinationTaskId !== taskIdRef.current
      )
        return;
      const chain = currentEditor.chain().focus();
      if (position !== undefined)
        chain.insertContentAt(
          Math.min(position, currentEditor.state.doc.content.size),
          nodes,
        );
      else chain.insertContent(nodes);
      chain.run();
    } catch {
      setNotice("This image could not be added. Please try another image.");
    }
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: true,
            autolink: true,
            defaultProtocol: "https",
            protocols: ["https", "http", "mailto"],
            isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
            HTMLAttributes: {
              target: "_blank",
              rel: "noopener noreferrer nofollow",
            },
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        NaturalInlineMath.configure({
          katexOptions: { throwOnError: false, trust: false, strict: false },
          onClick: (node, position) => {
            setLinkDraft(null);
            setMathDraft({
              latex: node.attrs.latex,
              kind: "inline",
              originalKind: "inline",
              position,
              from: position,
              to: position + node.nodeSize,
            });
          },
        }),
        NaturalBlockMath.configure({
          katexOptions: {
            throwOnError: false,
            trust: false,
            strict: false,
            displayMode: true,
          },
          onClick: (node, position) => {
            setLinkDraft(null);
            setMathDraft({
              latex: node.attrs.latex,
              kind: "block",
              originalKind: "block",
              position,
              from: position,
              to: position + node.nodeSize,
            });
          },
        }),
        Image.configure({
          allowBase64: true,
          HTMLAttributes: { loading: "lazy" },
        }),
        Placeholder.configure({
          placeholder: "Add notes, a checklist, or an equation…",
        }),
        TableKit.configure({ table: { resizable: false } }),
        Markdown.configure({
          markedOptions: { gfm: true },
          indentation: { style: "space", size: 2 },
        }),
      ],
      content: content ?? EMPTY_NOTE,
      immediatelyRender: true,
      editorProps: {
        attributes: {
          class: "note-prose",
          "aria-label": "Task notes",
          role: "textbox",
          "aria-multiline": "true",
          spellcheck: "true",
        },
        handlePaste: (_view, event) => {
          const images = Array.from(event.clipboardData?.files ?? []).filter(
            (file) => file.type.startsWith("image/"),
          );
          if (images.length) {
            void insertImages(images);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const html = event.clipboardData?.getData("text/html");
          const currentEditor = editorRef.current;
          const looksLikeMarkdown =
            /(^|\n)(#{1,3} |[-*] \[[ xX]\] |```|\$\$|> )|(?<![$\\])\$[^$\n]+\$|\*\*[^*]+\*\*/.test(
              text,
            );
          if (
            !html &&
            looksLikeMarkdown &&
            currentEditor &&
            !currentEditor.isActive("codeBlock")
          ) {
            currentEditor.commands.insertContent(text, {
              contentType: "markdown",
            });
            return true;
          }
          return false;
        },
        handleDrop: (view, event, _slice, moved) => {
          const images = Array.from(event.dataTransfer?.files ?? []).filter(
            (file) => file.type.startsWith("image/"),
          );
          if (moved || !images.length) return false;
          const position = view.posAtCoords({
            left: event.clientX,
            top: event.clientY,
          })?.pos;
          void insertImages(images, position);
          return true;
        },
      },
      onCreate: ({ editor: instance }) => {
        editorRef.current = instance;
      },
      onUpdate: ({ editor: instance }) => {
        const next = instance.getJSON() as NoteNode;
        receivedContent.current = next;
        onChangeRef.current(next);
        refreshToolbar((value) => value + 1);
      },
      onSelectionUpdate: () => refreshToolbar((value) => value + 1),
      onTransaction: ({ transaction }) => {
        if (transaction.getMeta("history$"))
          refreshToolbar((value) => value + 1);
      },
    },
    [taskId],
  );

  // A new editor per task keeps undo history scoped to that task. External checkbox
  // changes still update the visible note without replacing it on each keystroke.
  useEffect(() => {
    editorRef.current = editor;
    setSource(null);
    setMathDraft(null);
    setLinkDraft(null);
    setNotice("");
    receivedContent.current = content;
  }, [taskId, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || receivedContent.current === content)
      return;
    receivedContent.current = content;
    if (
      JSON.stringify(editor.getJSON()) === JSON.stringify(content ?? EMPTY_NOTE)
    )
      return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(content ?? EMPTY_NOTE, { emitUpdate: false });
    const end = editor.state.doc.content.size;
    editor.commands.setTextSelection({
      from: Math.min(from, end),
      to: Math.min(to, end),
    });
    refreshToolbar((value) => value + 1);
  }, [content, editor]);

  useEffect(() => {
    if (!mathDraft) return;
    equationInput.current?.focus();
    mathPanel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [mathDraft?.position, Boolean(mathDraft)]);

  if (!editor) return null;

  const openMath = () => {
    const { from, to } = editor.state.selection;
    setLinkDraft(null);
    setMathDraft({
      latex: editor.state.doc.textBetween(from, to),
      kind: "inline",
      originalKind: "inline",
      from,
      to,
    });
  };

  const applyMath = () => {
    if (!mathDraft?.latex.trim()) return;
    const { latex, kind, originalKind, position, from, to } = mathDraft;
    if (position !== undefined && kind === originalKind) {
      if (kind === "inline")
        editor
          .chain()
          .focus()
          .updateInlineMath({ latex: latex.trim(), pos: position })
          .run();
      else
        editor
          .chain()
          .focus()
          .updateBlockMath({ latex: latex.trim(), pos: position })
          .run();
    } else {
      editor
        .chain()
        .focus()
        .insertContentAt(
          { from, to },
          {
            type: kind === "inline" ? "inlineMath" : "blockMath",
            attrs: { latex: latex.trim() },
          },
        )
        .run();
    }
    setMathDraft(null);
  };

  const applyLink = () => {
    if (!linkDraft) return;
    const url = normalizedLink(linkDraft.url);
    if (url === null) {
      setNotice("Use a valid https, http, or email link.");
      return;
    }
    const chain = editor
      .chain()
      .focus()
      .setTextSelection({ from: linkDraft.from, to: linkDraft.to })
      .extendMarkRange("link");
    if (!url) chain.unsetLink().run();
    else if (linkDraft.from === linkDraft.to && !editor.isActive("link"))
      chain
        .insertContent({
          type: "text",
          text: linkDraft.url.trim(),
          marks: [
            {
              type: "link",
              attrs: {
                href: url,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
              },
            },
          ],
        })
        .run();
    else chain.setLink({ href: url }).run();
    setLinkDraft(null);
    setNotice("");
  };

  const mathPreview = mathDraft
    ? katex.renderToString(mathDraft.latex || "\\phantom{x}", {
        throwOnError: false,
        displayMode: mathDraft.kind === "block",
        trust: false,
        strict: false,
        output: "htmlAndMathml",
      })
    : "";

  return (
    <div
      className="task-note-editor"
      onKeyDown={(event) => {
        if (event.key === "Escape" && (mathDraft || linkDraft)) {
          setMathDraft(null);
          setLinkDraft(null);
          editor.commands.focus();
          event.stopPropagation();
        }
      }}
    >
      <div className="note-toolbar" role="toolbar" aria-label="Note formatting">
        <div className="note-toolbar-main">
          <ToolButton
            label="Bold (⌘B)"
            active={editor.isActive("bold")}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </ToolButton>
          <ToolButton
            label="Italic (⌘I)"
            active={editor.isActive("italic")}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </ToolButton>
          <ToolButton
            label="Heading"
            active={editor.isActive("heading")}
            disabled={source !== null}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 size={16} />
          </ToolButton>
          <span className="note-tool-divider" />
          <ToolButton
            label="Checklist (⌘⇧9)"
            active={editor.isActive("taskList")}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListTodo size={16} />
          </ToolButton>
          <ToolButton
            label="Bullet list"
            active={editor.isActive("bulletList")}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </ToolButton>
          <ToolButton
            label="Code block"
            active={editor.isActive("codeBlock")}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 size={16} />
          </ToolButton>
          <span className="note-tool-divider" />
          <ToolButton
            label="Insert equation"
            active={Boolean(mathDraft)}
            disabled={source !== null}
            onClick={openMath}
          >
            <Sigma size={16} />
          </ToolButton>
          <ToolButton
            label="Add or edit link"
            active={editor.isActive("link")}
            disabled={source !== null}
            onClick={() => {
              const { from, to } = editor.state.selection;
              setMathDraft(null);
              setLinkDraft({
                url: editor.getAttributes("link").href ?? "",
                from,
                to,
              });
            }}
          >
            <Link2 size={15} />
          </ToolButton>
          <ToolButton
            label="Insert image"
            disabled={source !== null}
            onClick={() => imageInput.current?.click()}
          >
            <ImagePlus size={16} />
          </ToolButton>
          <ToolButton label="Attach a file or PDF" onClick={onAttach}>
            <Paperclip size={15} />
          </ToolButton>
          <ToolButton
            label="Insert table"
            disabled={source !== null}
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
                .run()
            }
          >
            <Table2 size={15} />
          </ToolButton>
        </div>
        <ToolButton
          label={
            source === null ? "Edit Markdown source" : "Close Markdown source"
          }
          active={source !== null}
          onClick={() => {
            setSource(source === null ? editor.getMarkdown() : null);
            setMathDraft(null);
            setLinkDraft(null);
          }}
        >
          <FileCode2 size={16} />
        </ToolButton>
      </div>

      {notice && (
        <div className="note-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <X size={13} />
          </button>
        </div>
      )}

      {mathDraft && (
        <div
          className="note-popover equation-popover"
          ref={mathPanel}
          role="dialog"
          aria-label="Edit equation"
        >
          <div className="note-popover-heading">
            <strong>Equation</strong>
            <button
              type="button"
              aria-label="Close equation editor"
              onClick={() => setMathDraft(null)}
            >
              <X size={15} />
            </button>
          </div>
          <div className="equation-mode">
            <button
              type="button"
              className={mathDraft.kind === "inline" ? "selected" : ""}
              onClick={() => setMathDraft({ ...mathDraft, kind: "inline" })}
            >
              Inline <span>$…$</span>
            </button>
            <button
              type="button"
              className={mathDraft.kind === "block" ? "selected" : ""}
              onClick={() => setMathDraft({ ...mathDraft, kind: "block" })}
            >
              Display <span>$$…$$</span>
            </button>
          </div>
          <textarea
            ref={equationInput}
            value={mathDraft.latex}
            onChange={(event) =>
              setMathDraft({ ...mathDraft, latex: event.target.value })
            }
            aria-label="LaTeX equation"
            placeholder="e.g. \\sum_{i=1}^{n} x_i"
            spellCheck={false}
            rows={3}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                applyMath();
              }
            }}
          />
          <div
            className="equation-preview"
            aria-label="Equation preview"
            dangerouslySetInnerHTML={{ __html: mathPreview }}
          />
          <div className="note-popover-footer">
            <span>⌘ Enter to apply</span>
            <button
              type="button"
              className="note-apply"
              disabled={!mathDraft.latex.trim()}
              onClick={applyMath}
            >
              <Check size={13} />
              {mathDraft.position !== undefined ? "Update" : "Insert"}
            </button>
          </div>
        </div>
      )}

      {linkDraft && (
        <div
          className="note-popover link-popover"
          role="dialog"
          aria-label="Edit link"
        >
          <div className="note-popover-heading">
            <strong>
              {editor.isActive("link") ? "Edit link" : "Add a link"}
            </strong>
            <button
              type="button"
              aria-label="Close link editor"
              onClick={() => setLinkDraft(null)}
            >
              <X size={15} />
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              applyLink();
            }}
          >
            <input
              autoFocus
              type="text"
              aria-label="Link URL"
              placeholder="https://"
              value={linkDraft.url}
              onChange={(event) =>
                setLinkDraft({ ...linkDraft, url: event.target.value })
              }
            />
            <button type="submit" className="note-apply">
              Apply
            </button>
          </form>
          {editor.isActive("link") && (
            <button
              type="button"
              className="note-remove-link"
              onClick={() => {
                editor
                  .chain()
                  .focus()
                  .setTextSelection({ from: linkDraft.from, to: linkDraft.to })
                  .extendMarkRange("link")
                  .unsetLink()
                  .run();
                setLinkDraft(null);
              }}
            >
              Remove link
            </button>
          )}
        </div>
      )}

      {source !== null ? (
        <div className="note-source-panel">
          <div className="note-source-label">
            MARKDOWN <span>Changes apply when you save</span>
          </div>
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            aria-label="Markdown source"
            spellCheck={false}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                editor.commands.setContent(source, { contentType: "markdown" });
                setSource(null);
              }
            }}
          />
          <div className="note-source-actions">
            <button type="button" onClick={() => setSource(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="note-apply"
              onClick={() => {
                try {
                  editor.commands.setContent(source, {
                    contentType: "markdown",
                  });
                  setSource(null);
                } catch {
                  setNotice(
                    "Could not read this Markdown. Your existing note has been kept.",
                  );
                }
              }}
            >
              Apply Markdown
            </button>
          </div>
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void insertImages(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <div className="note-editor-footnote">
        <span>Markdown &amp; LaTeX supported</span>
        <div>
          <ToolButton
            label="Undo (⌘Z)"
            disabled={source !== null || !editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={13} />
          </ToolButton>
          <ToolButton
            label="Redo (⌘⇧Z)"
            disabled={source !== null || !editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={13} />
          </ToolButton>
        </div>
      </div>
      {editor.isActive("table") && source === null && (
        <div className="note-table-actions">
          <button
            type="button"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            Add row
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            Add column
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            Delete row
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Remove table
          </button>
        </div>
      )}
    </div>
  );
}
