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

The first visual direction is neutral white with a soft gray sidebar, blue selection states, small project colors, and compact toolbar controls. It intentionally leaves room for the user's detailed feedback about density, typography, keyboard behavior, and editor feel.

## Implementation references

[Tiptap mathematics](https://tiptap.dev/docs/editor/extensions/nodes/mathematics) and [Markdown examples](https://tiptap.dev/docs/editor/markdown/examples) informed the editor integration. [Apple's directory-access documentation](https://developer.apple.com/documentation/uikit/providing-access-to-directories) informed iOS folder selection and persistent security-scoped access.
