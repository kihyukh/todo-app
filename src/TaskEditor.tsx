import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import { undoDepth, redoDepth } from "@tiptap/pm/history";
import type { NoteNode } from "./model";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { NaturalBlockMath, NaturalInlineMath } from "./math-editor";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { createNotePublisher } from "./note-publisher";
import { noTextSuggestions } from "./editor-preferences";
import { VimEditor } from "./vim-editor";
import type { VimMode } from "./vim-editor";
import { NoteInteractions, NoteListKeymap } from "./note-interactions";
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Code2,
  Link2,
  Paperclip,
  ImagePlus,
  X,
  Table2,
  FileCode2,
  Undo2,
  Redo2,
} from "lucide-react";
import "katex/dist/katex.min.css";
import "./editor.css";

export { extractCheckboxes, toggleCheckbox, plainText } from "./editor-utils";

const EMPTY_NOTE: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface LinkDraft {
  url: string;
  from: number;
  to: number;
}
interface TaskEditorProps {
  taskId: string;
  content: NoteNode;
  onChange: (json: NoteNode) => void;
  onPendingChange: (pending: boolean) => void;
  onAttach: () => void;
  vimEnabled: boolean;
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
  onPendingChange,
  onAttach,
  vimEnabled,
}: TaskEditorProps) {
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [vimMode, setVimMode] = useState<VimMode>("normal");
  const onChangeRef = useRef(onChange);
  const onPendingRef = useRef(onPendingChange);
  const editorRef = useRef<Editor | null>(null);
  const taskIdRef = useRef(taskId);
  const receivedContent = useRef(content);
  const imageInput = useRef<HTMLInputElement>(null);
  onChangeRef.current = onChange;
  onPendingRef.current = onPendingChange;
  taskIdRef.current = taskId;
  const [publisher] = useState(() =>
    createNotePublisher<NoteNode>(
      (next) => {
        receivedContent.current = next;
        onChangeRef.current(next);
      },
      (pending) => onPendingRef.current(pending),
    ),
  );

  useLayoutEffect(() => {
    // Capture before storage's handler reads the workspace for native quit.
    const flushBeforeSave = () => flushSync(() => publisher.flush());
    window.addEventListener("daymark-flush", flushBeforeSave, true);
    window.addEventListener("pagehide", flushBeforeSave, true);
    return () => {
      publisher.flush();
      window.removeEventListener("daymark-flush", flushBeforeSave, true);
      window.removeEventListener("pagehide", flushBeforeSave, true);
    };
  }, [publisher]);

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
          listKeymap: false,
          heading: { levels: [1, 2, 3] },
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: "https",
            protocols: ["https", "http", "mailto"],
            isAllowedUri: (url) => /^(https?:\/\/|mailto:)/i.test(url),
            HTMLAttributes: {
              target: "_blank",
              rel: "noopener noreferrer nofollow",
              title: "⌘/Ctrl-click to open link",
            },
          },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        NoteListKeymap,
        NoteInteractions,
        NaturalInlineMath,
        NaturalBlockMath,
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
        VimEditor.configure({
          enabled: vimEnabled,
          onModeChange: (mode) => setVimMode(mode ?? "normal"),
        }),
      ],
      content: content ?? EMPTY_NOTE,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: {
          class: "note-prose",
          "aria-label": "Task notes",
          role: "textbox",
          "aria-multiline": "true",
          spellcheck: "false",
          autocomplete: "off",
          autocorrect: "off",
          autocapitalize: "off",
          writingsuggestions: "false",
        },
        handleDOMEvents: {
          click: (view, event) => {
            const target = event.target;
            const link =
              target instanceof Element
                ? target.closest<HTMLAnchorElement>("a[href]")
                : null;
            if (!link || !view.dom.contains(link) || event.button !== 0)
              return false;
            // A normal click places the caret; opening a resource is deliberate.
            event.preventDefault();
            if (event.metaKey || event.ctrlKey) {
              const href = normalizedLink(link.href);
              if (href) window.open(href, "_blank", "noopener,noreferrer");
              return true;
            }
            return false;
          },
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
        // ProseMirror documents are immutable, so holding the current document is
        // cheap. Large notes/images are serialized once per batch, not per key.
        const document = instance.state.doc;
        publisher.schedule(() => document.toJSON() as NoteNode);
      },
    },
    [taskId],
  );

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            bold: current.isActive("bold"),
            italic: current.isActive("italic"),
            heading: current.isActive("heading"),
            taskList: current.isActive("taskList"),
            bulletList: current.isActive("bulletList"),
            codeBlock: current.isActive("codeBlock"),
            link: current.isActive("link"),
            table: current.isActive("table"),
            quote: current.isActive("blockquote"),
            equation:
              current.isActive("inlineMath") || current.isActive("blockMath"),
            canUndo: undoDepth(current.state) > 0,
            canRedo: redoDepth(current.state) > 0,
          }
        : null,
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.commands.setVimEnabled(vimEnabled);
  }, [editor, vimEnabled]);

  // A new editor per task keeps undo history scoped to that task. External checkbox
  // changes still update the visible note without replacing it on each keystroke.
  useEffect(() => {
    editorRef.current = editor;
    setSource(null);
    setLinkDraft(null);
    setNotice("");
    receivedContent.current = content;
  }, [taskId, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed || receivedContent.current === content)
      return;
    // Never replace a local draft with an older echo arriving from storage.
    if (publisher.pending) {
      publisher.flush();
      return;
    }
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
  }, [content, editor, publisher]);

  if (!editor) return null;

  const editorHint =
    source !== null
      ? "⌘Enter to apply Markdown"
      : toolbar?.equation
        ? "Arrow keys move in and out of math"
        : toolbar?.table
          ? "Tab next cell · ⇧Tab previous cell"
          : toolbar?.taskList || toolbar?.bulletList
            ? "Tab indent · ⇧Tab outdent"
            : toolbar?.codeBlock || toolbar?.quote
              ? "⌘Enter to continue below"
              : toolbar?.link
                ? "⌘/Ctrl-click to open link"
                : "Markdown & LaTeX supported";

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

  return (
    <div
      className="task-note-editor"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          publisher.flush();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && linkDraft) {
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
            active={toolbar?.bold}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <Bold size={15} />
          </ToolButton>
          <ToolButton
            label="Italic (⌘I)"
            active={toolbar?.italic}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <Italic size={15} />
          </ToolButton>
          <ToolButton
            label="Heading"
            active={toolbar?.heading}
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
            active={toolbar?.taskList}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListTodo size={16} />
          </ToolButton>
          <ToolButton
            label="Bullet list"
            active={toolbar?.bulletList}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={16} />
          </ToolButton>
          <ToolButton
            label="Code block"
            active={toolbar?.codeBlock}
            disabled={source !== null}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 size={16} />
          </ToolButton>
          <span className="note-tool-divider" />
          <ToolButton
            label="Add or edit link"
            active={toolbar?.link}
            disabled={source !== null}
            onClick={() => {
              const { from, to } = editor.state.selection;
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
              {...noTextSuggestions}
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
            {...noTextSuggestions}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            aria-label="Markdown source"
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
        {vimEnabled && source === null ? (
          <span
            className={`vim-mode vim-mode-${vimMode}`}
            aria-label="Vim mode status"
          >
            Vim · {vimMode.replace("-", " ")}
          </span>
        ) : (
          <span>{editorHint}</span>
        )}
        <div>
          <ToolButton
            label="Undo (⌘Z)"
            disabled={source !== null || !toolbar?.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={13} />
          </ToolButton>
          <ToolButton
            label="Redo (⌘⇧Z)"
            disabled={source !== null || !toolbar?.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={13} />
          </ToolButton>
        </div>
      </div>
      {toolbar?.table && source === null && (
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
