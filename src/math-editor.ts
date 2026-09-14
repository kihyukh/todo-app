import { InputRule } from "@tiptap/core";
import type { NodeViewRenderer } from "@tiptap/core";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import katex from "katex";
import "./math-editor.css";

/** Keep the existing math schema and Markdown codecs; only replace the editing UI. */
const mathNodeView =
  (display: boolean): NodeViewRenderer =>
  ({ node: initialNode, editor, getPos }) => {
    let node = initialNode;
    let editing = false;
    let destroyed = false;
    let focusVersion = 0;
    const tag = display ? "div" : "span";
    const dom = document.createElement(tag);
    dom.className = `tiptap-mathematics-render math-note ${display ? "math-note-block" : "math-note-inline"}`;
    dom.dataset.type = display ? "block-math" : "inline-math";
    dom.contentEditable = "false";
    dom.title = "Click to edit LaTeX";

    const source = document.createElement(tag);
    source.className = "math-note-source";
    source.hidden = true;
    const opening = document.createElement(tag);
    const closing = document.createElement(tag);
    for (const delimiter of [opening, closing]) {
      delimiter.className = "math-note-delimiter";
      delimiter.textContent = display ? "$$" : "$";
      delimiter.setAttribute("aria-hidden", "true");
    }
    const input = document.createElement(display ? "textarea" : "input");
    input.className = "math-note-input";
    input.setAttribute(
      "aria-label",
      display ? "Display equation LaTeX" : "Inline equation LaTeX",
    );
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("writingsuggestions", "false");
    if (input instanceof HTMLTextAreaElement) input.rows = 1;
    else input.type = "text";
    source.append(opening, input, closing);
    const preview = document.createElement(tag);
    preview.className = "math-note-preview";
    preview.setAttribute("aria-label", "Equation preview");
    dom.append(source, preview);

    const resize = () => {
      if (input instanceof HTMLTextAreaElement) {
        input.style.height = "auto";
        input.style.height = `${Math.max(input.scrollHeight, 22)}px`;
      } else input.style.width = `${Math.max(input.value.length + 1, 3)}ch`;
    };

    const render = () => {
      dom.dataset.latex = node.attrs.latex;
      const latex = String(node.attrs.latex ?? "");
      if (input.value !== latex) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        input.value = latex;
        if (editing && start !== null && end !== null)
          input.setSelectionRange(
            Math.min(start, latex.length),
            Math.min(end, latex.length),
          );
      }
      preview.classList.toggle("is-empty", !latex.trim());
      if (!latex.trim())
        preview.textContent = editing
          ? "Equation preview"
          : "Empty equation · click to edit";
      else {
        try {
          katex.render(latex, preview, {
            displayMode: display,
            throwOnError: false,
            trust: false,
            strict: false,
            output: "htmlAndMathml",
          });
        } catch {
          preview.textContent = latex;
        }
      }
      resize();
    };

    const hideSource = () => {
      editing = false;
      focusVersion += 1;
      source.hidden = true;
      preview.hidden = false;
      dom.classList.remove("is-editing");
      dom.title = "Click to edit LaTeX";
    };

    const showSource = (caret: "start" | "end" = "end") => {
      if (!editor.isEditable || destroyed) return;
      if (!editing) {
        editing = true;
        source.hidden = false;
        preview.hidden = !display;
        dom.classList.add("is-editing");
        dom.removeAttribute("title");
        render();
      }
      // The surrounding view restores its DOM selection after selecting a node.
      // Focus once that update finishes, never on subsequent LaTeX transactions.
      const version = ++focusVersion;
      queueMicrotask(() => {
        if (
          destroyed ||
          !editing ||
          version !== focusVersion ||
          !dom.isConnected
        )
          return;
        input.focus({ preventScroll: true });
        const offset = caret === "start" ? 0 : input.value.length;
        input.setSelectionRange(offset, offset);
        resize();
      });
    };

    const select = () => {
      const pos = getPos();
      if (pos === undefined || !editor.isEditable) return;
      editor.view.dispatch(
        closeHistory(editor.state.tr).setSelection(
          NodeSelection.create(editor.state.doc, pos),
        ),
      );
      showSource();
    };

    const persist = () => {
      const pos = getPos();
      if (destroyed || pos === undefined || !editing) return;
      const current = editor.state.doc.nodeAt(pos);
      if (
        !current ||
        current.type !== node.type ||
        current.attrs.latex === input.value
      )
        return;
      // Resolve the position each time: preceding note edits can move this node.
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...current.attrs,
          latex: input.value,
        }),
      );
    };

    const leave = (direction: -1 | 1) => {
      const pos = getPos();
      if (destroyed || pos === undefined) return;
      persist();
      hideSource();
      const tr = closeHistory(editor.state.tr);
      const current = tr.doc.nodeAt(pos);
      if (!current || current.type !== node.type) return;
      let boundary = direction < 0 ? pos : pos + current.nodeSize;
      if (!String(current.attrs.latex).trim()) {
        if (display) {
          tr.replaceWith(
            pos,
            pos + current.nodeSize,
            editor.schema.nodes.paragraph.create(),
          );
          tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        } else {
          tr.delete(pos, pos + current.nodeSize);
          tr.setSelection(TextSelection.create(tr.doc, pos));
        }
      } else {
        let selection = Selection.findFrom(tr.doc.resolve(boundary), direction);
        if (!selection && display) {
          const paragraph = editor.schema.nodes.paragraph.create();
          const resolved = tr.doc.resolve(boundary);
          if (
            resolved.parent.canReplaceWith(
              resolved.index(),
              resolved.index(),
              paragraph.type,
            )
          ) {
            tr.insert(boundary, paragraph);
            boundary += 1;
            selection = TextSelection.create(tr.doc, boundary);
          }
        }
        tr.setSelection(
          selection ?? Selection.near(tr.doc.resolve(boundary), direction),
        );
      }
      editor.view.dispatch(tr.scrollIntoView());
      editor.view.focus();
    };

    const onClick = (event: Event) => {
      if (editing || !editor.isEditable) return;
      event.preventDefault();
      select();
    };
    const onMouseDown = (event: Event) => {
      if (!editing && editor.isEditable) event.preventDefault();
    };
    const onInput = () => {
      persist();
      resize();
    };
    const onBlur = () => {
      // Clicking another equation or a toolbar must not bring focus back here.
      persist();
      hideSource();
      const pos = getPos();
      if (destroyed || pos === undefined) return;
      const current = editor.state.doc.nodeAt(pos);
      if (current?.type !== node.type || String(current.attrs.latex).trim())
        return;
      const tr = closeHistory(editor.state.tr);
      if (display)
        tr.replaceWith(
          pos,
          pos + current.nodeSize,
          editor.schema.nodes.paragraph.create(),
        );
      else tr.delete(pos, pos + current.nodeSize);
      editor.view.dispatch(tr);
    };
    const onKeyDown = (rawEvent: Event) => {
      const event = rawEvent as KeyboardEvent;
      event.stopPropagation();
      if (event.isComposing) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) editor.commands.redo();
        else editor.commands.undo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        editor.commands.redo();
        return;
      }
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const collapsed = start === end;
      const before =
        collapsed &&
        ((event.key === "ArrowLeft" && start === 0) ||
          (display &&
            event.key === "ArrowUp" &&
            !input.value.slice(0, start).includes("\n")));
      const after =
        collapsed &&
        ((event.key === "ArrowRight" && end === input.value.length) ||
          (display &&
            event.key === "ArrowDown" &&
            !input.value.slice(end).includes("\n")));
      if (
        event.key === "Escape" ||
        (event.key === "Enter" && (modifier || !display)) ||
        (!event.shiftKey && !modifier && (before || after))
      ) {
        event.preventDefault();
        leave(before ? -1 : 1);
      } else if (display && event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        input.setRangeText("  ", start, end, "end");
        onInput();
      }
    };
    dom.addEventListener("mousedown", onMouseDown);
    dom.addEventListener("click", onClick);
    input.addEventListener("input", onInput);
    input.addEventListener("blur", onBlur);
    input.addEventListener("keydown", onKeyDown);
    render();

    return {
      dom,
      update(updated) {
        if (updated.type !== node.type) return false;
        node = updated;
        render();
        return true;
      },
      selectNode() {
        if (editor.isFocused) showSource();
      },
      deselectNode() {
        hideSource();
      },
      stopEvent(event) {
        return dom.contains(event.target as globalThis.Node);
      },
      ignoreMutation() {
        return true;
      },
      destroy() {
        destroyed = true;
        focusVersion += 1;
        dom.removeEventListener("mousedown", onMouseDown);
        dom.removeEventListener("click", onClick);
        input.removeEventListener("input", onInput);
        input.removeEventListener("blur", onBlur);
        input.removeEventListener("keydown", onKeyDown);
      },
    };
  };

export const NaturalInlineMath = InlineMath.extend({
  addNodeView() {
    return mathNodeView(false);
  },
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

export const NaturalBlockMath = BlockMath.extend({
  addNodeView() {
    return mathNodeView(true);
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (
          !empty ||
          $from.parent.type.name !== "paragraph" ||
          $from.parent.textContent !== "$$"
        )
          return false;
        const parent = $from.node(-1);
        if (
          !parent.canReplaceWith(
            $from.index(-1),
            $from.indexAfter(-1),
            this.type,
          )
        )
          return false;
        const pos = $from.before();
        const tr = state.tr.replaceWith(
          pos,
          $from.after(),
          this.type.create({ latex: "" }),
        );
        tr.setSelection(NodeSelection.create(tr.doc, pos));
        view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
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
