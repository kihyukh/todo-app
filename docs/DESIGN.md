# Design decisions

## Research method

TickTick’s installed Mac app was inspected directly in its board and Today views, including its visual layout and navigation. Todoist’s installed Upcoming screen and Notion’s native editor surface were also inspected read-only. No personal tasks or notes from those apps were imported into Daymark; the sample workspace is fictional.

Things 3 and Microsoft To Do were not installed for hands-on testing during this build. Their official documentation informed the relevant interactions. Wunderlist was reviewed as a historical reference rather than presented as a currently available trial. This was not an exhaustive usability trial of all six apps.

## Adopted patterns

- **TickTick:** lists on the left, tasks in the middle, rich detail on the right; restrained visual density. Its official feature overview describes this three-column structure and rich task notes. [TickTick features](https://ticktick.com/features), [Markdown guide](https://blog.ticktick.com/2019/11/15/ticktick-markdown-quick-start/).
- **Things 3:** the time to work on something is separate from its final deadline. Daymark labels these explicitly as Do date and Deadline. [Things scheduling guide](https://culturedcode.com/things/support/articles/2803579/).
- **Todoist:** current Todoist also distinguishes planned dates and deadlines. We use the user's preferred combination, without assuming competitor limitations remain unchanged. [Todoist deadlines](https://www.todoist.com/help/todoist/features/introduction-to-deadlines-in-todoist-uMqbSLM6U).
- **Microsoft To Do:** a deliberate daily selection and lightweight steps. Daymark keeps earlier do-dates available without automatically crowding Today. [My Day](https://support.microsoft.com/en-US/ToDo/my-day-and-suggestions), [Steps and notes](https://support.microsoft.com/en-us/todo/add-steps-importance-notes-tags-and-categories-to-your-tasks).
- **Wunderlist:** the approachable list-centered simplicity described in Microsoft's retrospective. [Microsoft product retrospective](https://www.microsoft.com/en-us/microsoft-365/blog/2019/09/09/announcing-new-version-microsoft-to-do/).
- **Notion:** equations and editable board groupings. Daymark's equations use KaTeX and familiar Markdown delimiters, with direct click-to-edit controls. [Notion math](https://www.notion.com/help/math-equations), [Notion boards](https://www.notion.com/help/boards).

## Scope

Today is a conscious commitment, not a computed list of everything with a deadline. The deadline remains visible as a separate flag. A long-running task can move to Tomorrow without being completed or changing its due date.

Checkboxes stay inside notes. The aggregate view indexes the same document nodes and writes back to them, so there are no duplicate subtask records to get out of sync.

Status columns can be changed without affecting completion or scheduling. Completion has its own control and archive view.

The visual direction uses charcoal text, readable slate metadata, a cool gray sidebar, and cobalt selection states. A left selection indicator reinforces the active task or view. Do dates use cobalt; deadline flags use dark amber and overdue dates use red. Meaningful text remains readable on both white and selected surfaces.

Task notes use 14px body text at 1.45 line height, 5px paragraph gaps, and 2px checklist item gaps for compact reading. Equation editing follows the local source/render behavior of [Obsidian Live Preview](https://help.obsidian.md/Live%2Bpreview%2Bupdate): selecting the equation reveals editable LaTeX in place, leaving it restores the rendered equation. Display math also shows a live preview below the active source. The separate equation popup and toolbar button have been removed.

Typing stays in ProseMirror. The app holds an immutable document snapshot and serializes it after a 350ms pause, or every 2 seconds during continuous typing. Toolbar buttons subscribe only to changes in formatting and undo availability. Storage waits 800ms for changes to settle; native file-provider reads, writes, and polling share a serial background queue. Before task switches, focus leaves the editor, or the app quits, the final draft is published; native shutdown still waits for confirmation that it was saved. Older save replies cannot label a newer edit as saved.

Autocomplete and automatic correction are disabled per editable surface and in the native WebKit configuration, without changing system preferences. This uses the public [inline-predictions setting](https://developer.apple.com/documentation/webkit/wkwebviewconfiguration/allowsinlinepredictions) and WebKit's [writing suggestions attribute](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/#html).

Vim mode is optional and remembers its setting on each device. It edits rich notes directly with Normal, Insert, characterwise Visual, and linewise Visual modes. There is no persistent mode badge. Paragraphs and checklist items are logical lines rather than visual wraps. This supports common motions, counts, operators, yank/paste, and undo; it is not a full Vim runtime with Ex commands, macros, or plugins. Equation source shares the note's Vim mode and commands. The Markdown source panel remains an ordinary text field.

## Slash insertion

TickTick's official web changelog describes typing `/` in task details to insert headings, bullet points, attachments, and subtasks. This documented pattern informed GreenDay's slash menu; the trigger boundaries and Vim behavior below are GreenDay design choices. [TickTick web changelog](https://ticktick.com/public/changelog/en.html).

The menu opens from a freshly typed `/` at the beginning of a paragraph or heading, allowing leading spaces. Typing narrows the choices, with aliases such as `/check`, `/h2`, and `/math`. The cursor stays in the note while ↑/↓ selects an option and Enter or Tab inserts it; touch users tap a row. Escape dismisses the menu while preserving the literal slash and query. URLs, code, equation source, and Vim Normal/Visual mode do not invoke it.

The insertion subset starts with checklists and lists, then offers H1–H3, quotes, display equations, images, tables, code blocks, and dividers. These actions create or change note elements at the writing position. Inline formatting, links, Markdown source, and task-level file attachments stay in **+**, keeping the typing menu focused. Existing block types are retained when selected again, and schema restrictions protect nested checklist/list structure. The menu adds no permanent toolbar.

## Images inside notes

An image is a selectable block in the note. Clicking it reveals a clear outline and a compact toolbar below the image: Small, Medium, Full, Crop, and Delete. These controls disappear when the writer returns to text. The corner handle resizes proportionally; keyboard users can focus it and use the arrow keys. Cropping reveals the original image with a movable rectangle and corner handles. Apply commits the crop, Cancel keeps the previous view, and Reset restores the full original. Cropping stores a viewing rectangle without changing the original image bytes. Each size, crop, or deletion action can be undone independently.

Clipboard images are embedded at the current writing position. Dropped image files are embedded at the visible drop cursor. A temporary loading marker follows intervening edits, so continuing to type does not relocate the image or lose new text. Multiple file reads can run together, while insertion follows paste order. When the writer stays at the insertion point, the new image is selected for immediate adjustment; otherwise the active text cursor stays put. Pasting beside a selected image keeps the existing image. Embedded image data stays in the note and follows the existing save and iCloud workflow.

Arrow navigation visits the image as a single block, then continues into adjacent text. Backspace at the start of the following paragraph selects the image first; pressing it again deletes the selected image. Enter creates a place to write below. Vim motions also visit images while retaining the current mode, with deletion, yank/paste, and insertion beside the image using familiar commands. Size and crop metadata survive Markdown source editing as an HTML image element; untouched images retain familiar Markdown syntax.

Direct clipboard and file-drop insertion follows the familiar note-taking pattern described in [Obsidian's attachment guide](https://obsidian.md/help/attachments). Resize gestures commit when the gesture finishes, following [Tiptap's resizable node-view lifecycle](https://tiptap.dev/docs/editor/api/resizable-nodeviews), so dragging does not create an undo step for each pixel.

## Implementation references

[Tiptap mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics) and [Markdown examples](https://tiptap.dev/docs/editor/markdown/examples) informed the editor integration. [Apple's directory-access documentation](https://developer.apple.com/documentation/uikit/providing-access-to-directories) informed iOS folder selection and persistent security-scoped access.
