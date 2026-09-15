import { textblockTypeInputRule } from "@tiptap/core";
import Heading from "@tiptap/extension-heading";
import { setBlockType } from "@tiptap/pm/commands";
import { TextSelection } from "@tiptap/pm/state";

/** Keep the heading schema and Markdown codec shared with existing notes. */
export const NoteHeading = Heading.extend({
  // Heading formatting is removed before list-boundary joining; Vim and the
  // image/math interaction plugins still own their higher-priority commands.
  priority: 200,
  addOptions() {
    return { ...this.parent?.(), levels: [1, 2, 3], HTMLAttributes: {} };
  },

  addInputRules() {
    const rule = textblockTypeInputRule({
      // Require a typed space, including WebKit's nonbreaking space. A literal
      // marker restored by undo must not become a heading again on Enter.
      find: /^(#{1,3})[ \u00a0](?![\s\S])/,
      type: this.type,
      getAttributes: (match) => ({ level: match[1].length }),
    });
    const convert = rule.handler;
    rule.handler = (context) => {
      if (convert(context) === null) return null;
      // StarterKit otherwise appends this paragraph in a second transaction,
      // which clears the input-rule metadata needed for immediate Backspace.
      const trailing = this.editor.extensionManager.extensions.find(
        (extension) => extension.name === "trailingNode",
      );
      if (!trailing) return;
      const { tr, schema } = context.state;
      const name =
        trailing.options.node ||
        schema.topNodeType.contentMatch.defaultType?.name ||
        "paragraph";
      const excluded = [name, ...[trailing.options.notAfter ?? []].flat()];
      const last = tr.doc.lastChild;
      if (last && !excluded.includes(last.type.name))
        tr.insert(tr.doc.content.size, schema.nodes[name].create());
    };
    return [rule];
  },

  addKeyboardShortcuts() {
    const atHeadingStart = () => {
      const { view, state } = this.editor;
      const mode = view.dom.dataset.vimMode;
      if (
        !view.editable ||
        view.composing ||
        (mode && mode !== "off" && mode !== "insert")
      )
        return false;
      const selection = state.selection;
      return (
        selection instanceof TextSelection &&
        selection.empty &&
        selection.$from.parent.type === this.type &&
        selection.$from.parentOffset === 0
      );
    };
    const toParagraph = () => {
      const { state, view } = this.editor;
      return setBlockType(state.schema.nodes.paragraph)(
        state,
        view.dispatch,
        view,
      );
    };
    return {
      ...this.parent?.(),
      Enter: () => {
        if (
          !atHeadingStart() ||
          this.editor.state.selection.$from.parent.content.size !== 0
        )
          return false;
        return toParagraph();
      },
      Backspace: () => {
        if (!atHeadingStart()) return false;
        // Undo the prefix conversion before removing ordinary heading format.
        return this.editor.commands.undoInputRule() || toParagraph();
      },
    };
  },
});
