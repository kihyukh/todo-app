import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { getMarkRange } from "@tiptap/core";
import type { Editor, JSONContent } from "@tiptap/core";
import { APP_NAME } from "./brand";
import { usesTouchInterface } from "./platform";
import { undoDepth, redoDepth } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { NoteNode } from "./model";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { NaturalBlockMath, NaturalInlineMath } from "./math-editor";
import { NoteImage } from "./image-editor";
import {
  ImageImports,
  clipboardImages,
  insertImageFiles,
} from "./image-imports";
import { installNoteFileDrop, insertNoteFiles } from "./note-file-drop";
import { continueFromImage } from "./image-navigation";
import Placeholder from "@tiptap/extension-placeholder";
import { NoteTableKit } from "./note-table";
import NoteTableControls from "./NoteTableControls";
import { Markdown } from "@tiptap/markdown";
import { createNotePublisher } from "./note-publisher";
import {
  isAllowedNoteLink,
  nativeAttachmentLink,
  normalizedNoteLink as normalizedLink,
  openNoteLink,
} from "./note-links";
import { noTextSuggestions } from "./editor-preferences";
import { clearVimPendingAction, VimEditor } from "./vim-editor";
import { NoteInteractions, NoteListKeymap } from "./note-interactions";
import { NoteHeading } from "./note-heading";
import NoteGutter from "./NoteGutter";
import NoteElementMenu from "./NoteElementMenu";
import NoteSlashMenu from "./NoteSlashMenu";
import { NoteSlash, dismissNoteSlash } from "./note-slash";
import type { SlashState } from "./note-slash";
import { X, Ellipsis, Undo2, Redo2, ExternalLink, Link2 } from "lucide-react";
import "katex/dist/katex.min.css";
import "./editor.css";

export { extractCheckboxes, toggleCheckbox, plainText } from "./editor-utils";

const EMPTY_NOTE: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

interface TouchLink {
  href: string;
  label: string;
  from: number;
  to: number;
  top: number;
  left: number;
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
  onPendingChange: (pending: boolean) => void;
  onAttach: () => void;
  onOpenFile?: (href: string, label: string) => void | Promise<void>;
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

export default function TaskEditor({
  taskId,
  content,
  onChange,
  onPendingChange,
  onAttach,
  onOpenFile,
  vimEnabled,
}: TaskEditorProps) {
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const [touch] = useState(usesTouchInterface);
  const [touchLink, setTouchLink] = useState<TouchLink | null>(null);
  const touchLinkPanel = useRef<HTMLDivElement>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuFallback = useRef<HTMLButtonElement>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashKeyHandler = useRef<
    (view: EditorView, event: KeyboardEvent) => boolean
  >(() => false);
  const imageSlash = useRef<{
    taskId: string;
    editor: Editor;
    doc: Editor["state"]["doc"];
    range: SlashState;
  } | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const onChangeRef = useRef(onChange);
  const onPendingRef = useRef(onPendingChange);
  const onOpenFileRef = useRef(onOpenFile);
  const editorRef = useRef<Editor | null>(null);
  const taskIdRef = useRef(taskId);
  const receivedContent = useRef(content);
  const imageInput = useRef<HTMLInputElement>(null);
  onChangeRef.current = onChange;
  onPendingRef.current = onPendingChange;
  onOpenFileRef.current = onOpenFile;
  taskIdRef.current = taskId;
  const activateLink = (href: string, label: string) => {
    if (nativeAttachmentLink(href) && onOpenFileRef.current) {
      void Promise.resolve(onOpenFileRef.current(href, label)).catch((error) =>
        setNotice(
          error instanceof Error
            ? error.message
            : "This file could not be opened.",
        ),
      );
    } else if (openNoteLink(href) === "native-only") {
      setNotice(`Open this attachment in the ${APP_NAME} mobile or Mac app.`);
    }
  };
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

  useEffect(() => {
    if (!touchLink) return;
    const outside = (event: PointerEvent) => {
      if (!touchLinkPanel.current?.contains(event.target as Node))
        setTouchLink(null);
    };
    const resize = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      setTouchLink(
        (current) =>
          current && {
            ...current,
            top: Math.max(12, Math.min(current.top, height - 164)),
            left: Math.max(12, Math.min(current.left, window.innerWidth - 312)),
          },
      );
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [touchLink]);

  const insertImages = (files: File[], position?: number, focus = false) => {
    const destinationTaskId = taskIdRef.current;
    const currentEditor = editorRef.current;
    if (!currentEditor) return;
    if (focus) currentEditor.view.focus();
    const selection = currentEditor.state.selection;
    return insertImageFiles(currentEditor, files, {
      position:
        position ??
        (selection instanceof NodeSelection ? selection.to : undefined),
      isCurrent: () =>
        destinationTaskId === taskIdRef.current &&
        editorRef.current === currentEditor,
      notice: setNotice,
    });
  };

  const chooseImage = (range?: SlashState) => {
    const currentEditor = editorRef.current;
    imageSlash.current =
      range && currentEditor
        ? {
            taskId: taskIdRef.current,
            editor: currentEditor,
            doc: currentEditor.state.doc,
            range,
          }
        : null;
    imageInput.current?.click();
  };

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          listKeymap: false,
          dropcursor: { color: "var(--accent, #23764d)", width: 2 },
          heading: false,
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: "https",
            protocols: ["https", "http", "mailto", "daymark"],
            isAllowedUri: isAllowedNoteLink,
            HTMLAttributes: {
              target: "_blank",
              rel: "noopener noreferrer nofollow",
              title: touch
                ? "Tap for link actions"
                : "Click to open · Option/Alt-click to edit text",
            },
          },
        }),
        NoteHeading.configure({ levels: [1, 2, 3] }),
        TaskList,
        TaskItem.configure({ nested: true }),
        NoteListKeymap,
        NoteInteractions,
        NoteSlash.configure({
          onChange: (next) => setSlash(next),
          onKeyDown: (view, event) => slashKeyHandler.current(view, event),
        }),
        NaturalInlineMath,
        NaturalBlockMath,
        ImageImports,
        NoteImage.configure({
          allowBase64: true,
          HTMLAttributes: { loading: "lazy" },
        }),
        Placeholder.configure({
          placeholder: "Write a note, or type / to add an element…",
        }),
        NoteTableKit,
        Markdown.configure({
          markedOptions: { gfm: true },
          indentation: { style: "space", size: 2 },
        }),
        VimEditor.configure({
          enabled: vimEnabled,
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
          mousedown: (view, event) => {
            if (touch || event.button !== 0 || event.altKey) return false;
            const link =
              event.target instanceof Element
                ? event.target.closest("a[href]")
                : null;
            if (!link || !view.dom.contains(link)) return false;
            // Opening a link must not first relocate the caret. In Vim normal
            // mode that redraws the block cursor and can replace the anchor
            // between mouse-down and click, swallowing the first click.
            // Activate on click (not mouse-down) so a cancelled press stays inert.
            event.preventDefault();
            return true;
          },
          click: (view, event) => {
            const target = event.target;
            const link =
              target instanceof Element
                ? target.closest<HTMLAnchorElement>("a[href]")
                : null;
            if (!link || !view.dom.contains(link) || event.button !== 0)
              return false;
            // Filename links behave like ordinary links; Option-click still
            // lets a mouse user place the caret directly inside their text.
            event.preventDefault();
            if (!touch && event.altKey) return false;
            if (!touch || event.metaKey || event.ctrlKey) {
              clearVimPendingAction(view);
              activateLink(
                link.getAttribute("href") ?? "",
                link.textContent ?? "File",
              );
              return true;
            }
            if (touch) {
              const from = view.posAtDOM(link, 0);
              const range = getMarkRange(
                view.state.doc.resolve(from),
                view.state.schema.marks.link,
              );
              const rect = link.getBoundingClientRect();
              const height =
                window.visualViewport?.height ?? window.innerHeight;
              setLinkDraft(null);
              setTouchLink({
                href: link.getAttribute("href") ?? "",
                label: link.textContent ?? "Link",
                from: range?.from ?? from,
                to: range?.to ?? from + (link.textContent?.length ?? 0),
                top: Math.max(12, Math.min(rect.bottom + 8, height - 164)),
                left: Math.max(
                  12,
                  Math.min(rect.left, window.innerWidth - 312),
                ),
              });
              return true;
            }
            return false;
          },
        },
        handlePaste: (view, event) => {
          const images = clipboardImages(event.clipboardData);
          if (images.length) {
            void insertImages(images);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain") ?? "";
          const html = event.clipboardData?.getData("text/html");
          if (text || html) continueFromImage(view, 1);
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
      },
      onCreate: ({ editor: instance }) => {
        editorRef.current = instance;
      },
      onUpdate: ({ editor: instance }) => {
        setTouchLink(null);
        // ProseMirror documents are immutable, so holding the current document is
        // cheap. Large notes/images are serialized once per batch, not per key.
        const document = instance.state.doc;
        publisher.schedule(() => document.toJSON() as NoteNode);
      },
    },
    [taskId],
  );

  const context = useEditorState({
    editor,
    selector: ({ editor: current }) =>
      current
        ? {
            taskList: current.isActive("taskList"),
            bulletList:
              current.isActive("bulletList") || current.isActive("orderedList"),
            codeBlock: current.isActive("codeBlock"),
            link: current.isActive("link"),
            table: current.isActive("table"),
            quote: current.isActive("blockquote"),
            equation:
              current.isActive("inlineMath") || current.isActive("blockMath"),
            image: current.isActive("image"),
            canUndo: undoDepth(current.state) > 0,
            canRedo: redoDepth(current.state) > 0,
          }
        : null,
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.commands.setVimEnabled(vimEnabled);
  }, [editor, vimEnabled]);

  useEffect(() => {
    if (!editor || source !== null) return;
    const destination = taskId;
    let active = true;
    const removeDrop = installNoteFileDrop(editor, (files, position) => {
      void insertNoteFiles(editor, files, position, {
        isCurrent: () => active && taskIdRef.current === destination,
        notice: setNotice,
      });
    });
    return () => {
      active = false;
      removeDrop();
    };
  }, [editor, source, taskId]);

  useEffect(() => {
    const input = imageInput.current;
    const cancel = () => {
      imageSlash.current = null;
    };
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, [editor]);

  useEffect(() => {
    if (!touch || !editor) return;
    let frame = 0;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const reveal = () => {
      if (editor.isDestroyed) return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !editor.view.dom.contains(active))
        return;
      const scroll = editor.view.dom.closest<HTMLElement>(".detail-scroll");
      if (!scroll) return;
      try {
        // A math input owns its native caret; the outer NodeSelection describes
        // the whole rendered equation and is too large to scroll accurately.
        const rect =
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement
            ? active.getBoundingClientRect()
            : editor.view.coordsAtPos(editor.state.selection.head);
        const viewport = window.visualViewport;
        const viewportTop = viewport?.offsetTop ?? 0;
        const viewportBottom =
          viewportTop + (viewport?.height ?? window.innerHeight);
        const bounds = scroll.getBoundingClientRect();
        const top = Math.max(bounds.top, viewportTop) + 12;
        const bottom = Math.min(bounds.bottom, viewportBottom - 66) - 12;
        if (bottom <= top) return;
        if (rect.bottom > bottom)
          scroll.scrollTop += Math.min(
            rect.bottom - bottom,
            Math.max(0, rect.top - top),
          );
        else if (rect.top < top) scroll.scrollTop += rect.top - top;
      } catch {
        /* Native caret geometry may be unavailable during view replacement. */
      }
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
      clearTimeout(settle);
      // The iOS keyboard animates after focus, then changes the usable viewport.
      // One settled pass handles its final geometry without scrolling on typing.
      settle = setTimeout(reveal, 180);
    };
    editor.view.dom.addEventListener("focusin", schedule);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      editor.view.dom.removeEventListener("focusin", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, [editor, touch]);

  // A new editor per task keeps undo history scoped to that task. External checkbox
  // changes still update the visible note without replacing it on each keystroke.
  useEffect(() => {
    editorRef.current = editor;
    setSource(null);
    setMenuAnchor(null);
    setSlash(null);
    setLinkDraft(null);
    setTouchLink(null);
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
    // Context menus and link ranges belong to this document, not a synced revision.
    setMenuAnchor(null);
    dismissNoteSlash(editor.view);
    setTouchLink(null);
    setLinkDraft(null);
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
      : context?.equation
        ? "Arrow keys move in and out of math"
        : context?.table
          ? "Tab next cell · ⇧Tab previous cell"
          : context?.taskList || context?.bulletList
            ? "Tab indent · ⇧Tab outdent"
            : context?.codeBlock || context?.quote
              ? "⌘Enter to continue below"
              : context?.image
                ? "Select an image to resize or crop · Delete to remove · Enter to continue"
                : context?.link
                  ? touch
                    ? "Tap a link to open or edit it"
                    : "Click to open · Option/Alt-click to edit text"
                  : "Type / on a new line for elements · Markdown & LaTeX";

  const applyLink = () => {
    if (!linkDraft) return;
    const url = normalizedLink(linkDraft.url);
    if (url === null) {
      setNotice(`Use a valid web, email, or ${APP_NAME} attachment link.`);
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
      className={`task-note-editor ${touch ? "is-touch-editor" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          publisher.flush();
      }}
      onKeyDownCapture={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === "/" &&
          source === null &&
          event.target instanceof HTMLElement &&
          !event.target.closest("input, textarea")
        ) {
          event.preventDefault();
          event.stopPropagation();
          dismissNoteSlash(editor.view);
          setMenuAnchor(menuAnchor ? null : menuFallback.current);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && touchLink) {
          setTouchLink(null);
          event.stopPropagation();
        }
        if (event.key === "Escape" && linkDraft) {
          setLinkDraft(null);
          editor.commands.focus();
          event.stopPropagation();
        }
      }}
    >
      {slash && !menuAnchor && source === null && (
        <NoteSlashMenu
          editor={editor}
          slash={slash}
          touch={touch}
          keyHandler={slashKeyHandler}
          onImage={chooseImage}
        />
      )}
      {menuAnchor && source === null && (
        <NoteElementMenu
          editor={editor}
          anchor={menuAnchor}
          touch={touch}
          onClose={() => setMenuAnchor(null)}
          onLink={() => {
            const { from, to } = editor.state.selection;
            setLinkDraft({
              url: editor.getAttributes("link").href ?? "",
              from,
              to,
            });
          }}
          onImage={() => chooseImage()}
          onAttach={onAttach}
          onSource={() => {
            setSource(editor.getMarkdown());
            setLinkDraft(null);
          }}
        />
      )}

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

      {touchLink && (
        <div
          ref={touchLinkPanel}
          className="touch-link-actions"
          role="dialog"
          aria-label="Link actions"
          style={{ top: touchLink.top, left: touchLink.left }}
        >
          <span title={touchLink.href}>{touchLink.label}</span>
          <div>
            <button
              type="button"
              onClick={() => {
                activateLink(touchLink.href, touchLink.label);
                setTouchLink(null);
              }}
            >
              <ExternalLink size={16} />
              Open
            </button>
            <button
              type="button"
              onClick={() => {
                editor.commands.setTextSelection({
                  from: touchLink.from,
                  to: touchLink.to,
                });
                setLinkDraft({
                  url: touchLink.href,
                  from: touchLink.from,
                  to: touchLink.to,
                });
                setTouchLink(null);
              }}
            >
              <Link2 size={16} />
              Edit
            </button>
            <button
              type="button"
              aria-label="Close link actions"
              onClick={() => setTouchLink(null)}
            >
              <X size={17} />
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
        <div className="note-editor-surface">
          <EditorContent editor={editor} />
          <NoteGutter
            editor={editor}
            menuOpen={menuAnchor !== null}
            onOpenMenu={(anchor) => {
              dismissNoteSlash(editor.view);
              setTouchLink(null);
              setMenuAnchor(anchor);
            }}
          />
          <NoteTableControls
            editor={editor}
            hidden={menuAnchor !== null || slash !== null}
          />
        </div>
      )}

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          const ticket = imageSlash.current;
          imageSlash.current = null;
          event.target.value = "";
          if (!files.length) return;
          if (ticket) {
            if (
              ticket.taskId !== taskIdRef.current ||
              ticket.editor !== editor ||
              editor.isDestroyed ||
              !ticket.doc.eq(editor.state.doc)
            ) {
              setNotice(
                "The note changed while you were choosing an image. Please insert it again.",
              );
              return;
            }
            editor.view.focus();
            editor.commands.setTextSelection({
              from: ticket.range.from,
              to: ticket.range.to,
            });
          }
          // The existing import queue replaces the range only after a file loads.
          // Cancelling or failing the picker leaves /query and surrounding text intact.
          void insertImages(files, undefined, !ticket);
        }}
      />
      <div className="note-editor-footnote">
        <span>{editorHint}</span>
        <div>
          {source === null && (
            <button
              ref={menuFallback}
              type="button"
              className="note-tool"
              aria-label="Note options"
              title="Note options (⌘/)"
              aria-haspopup="dialog"
              aria-expanded={menuAnchor !== null}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                dismissNoteSlash(editor.view);
                setTouchLink(null);
                setMenuAnchor(menuAnchor ? null : event.currentTarget);
              }}
            >
              <Ellipsis size={16} />
            </button>
          )}
          <ToolButton
            label="Undo (⌘Z)"
            disabled={source !== null || !context?.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={13} />
          </ToolButton>
          <ToolButton
            label="Redo (⌘⇧Z)"
            disabled={source !== null || !context?.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={13} />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
