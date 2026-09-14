export type NoteNode = {
  type: string;
  attrs?: Record<string, any>;
  content?: NoteNode[];
  text?: string;
  marks?: any[];
};
export type Attachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
};
export type Task = {
  id: string;
  title: string;
  notes: NoteNode;
  projectId: string;
  columnId: string;
  doDate: string | null;
  deadline: string | null;
  completedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
  tagIds?: string[];
  example?: boolean;
};
export type NamedRecord = {
  id: string;
  name: string;
  color: string;
  order?: number;
  updatedAt: string;
  deletedAt?: string | null;
};
export type TagGroup = "area" | "action" | "topic";
export type TagRecord = NamedRecord & { group?: TagGroup };
export type AppState = {
  schemaVersion: 1;
  tasks: Task[];
  projects: NamedRecord[];
  columns: NamedRecord[];
  tags?: TagRecord[];
};
export type StorageInfo = {
  kind: "icloud" | "local" | "folder";
  path?: string;
  message?: string;
};
export const now = () => new Date().toISOString();
export const uid = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          Number(c) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] &
            (15 >> (Number(c) / 4)))
        ).toString(16),
      );
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function addDays(days: number, from = new Date()): string {
  const day = new Date(from);
  day.setDate(day.getDate() + days);
  return dateKey(day);
}
export function dateLabel(value: string | null, relative = true): string {
  if (!value) return "Not set";
  if (relative && value === dateKey()) return "Today";
  if (relative && value === addDays(1)) return "Tomorrow";
  const date = new Date(value + "T12:00:00");
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear()
      ? { year: "numeric" }
      : {}),
  });
}
export function activeTasks(state: AppState) {
  return state.tasks.filter((t) => !t.deletedAt && !t.completedAt);
}
export function isToday(task: Task, today = dateKey()) {
  return !task.deletedAt && !task.completedAt && task.doDate === today;
}
export function scheduleToday(task: Task, today = dateKey()): Task {
  return { ...task, doDate: today, updatedAt: now() };
}
export function mergeState(a: AppState, b: AppState): AppState {
  function canonical(value: any): string {
    if (value === null || typeof value !== "object")
      return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
        .join(",") +
      "}"
    );
  }
  function merge<
    T extends { id: string; updatedAt: string; deletedAt?: string | null },
  >(left: T[], right: T[]) {
    const map = new Map(left.map((v) => [v.id, v]));
    for (const v of right) {
      const old = map.get(v.id);
      const winsTie =
        old &&
        v.updatedAt === old.updatedAt &&
        (Boolean(v.deletedAt) !== Boolean(old.deletedAt)
          ? Boolean(v.deletedAt)
          : canonical(v) > canonical(old));
      if (!old || v.updatedAt > old.updatedAt || winsTie) map.set(v.id, v);
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  return {
    schemaVersion: 1,
    tasks: merge(a.tasks, b.tasks),
    projects: merge(a.projects, b.projects),
    columns: merge(a.columns, b.columns),
    tags: merge(a.tags ?? [], b.tags ?? []),
  };
}
export const emptyDoc = (): NoteNode => ({
  type: "doc",
  content: [{ type: "paragraph" }],
});
const text = (value: string): NoteNode => ({ type: "text", text: value });
const p = (value: string): NoteNode => ({
  type: "paragraph",
  content: [text(value)],
});
const check = (value: string, checked = false): NoteNode => ({
  type: "taskItem",
  attrs: { checked },
  content: [p(value)],
});
export function createInitialState(): AppState {
  const stamp = now();
  // A new device’s examples must never replace edits already in a shared folder.
  const seedStamp = "2020-01-01T00:00:00.000Z";
  const project = (id: string, name: string, color: string) => ({
    id,
    name,
    color,
    updatedAt: seedStamp,
  });
  const task = (
    id: string,
    title: string,
    projectId: string,
    doDate: string | null,
    deadline: string | null,
    columnId = "next",
    notes = emptyDoc(),
  ): Task => ({
    id,
    title,
    projectId,
    doDate,
    deadline,
    columnId,
    notes,
    completedAt: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: seedStamp,
    attachments: [],
    example: true,
  });
  return {
    schemaVersion: 1,
    tags: [],
    projects: [
      project("research", "Research", "#547ce8"),
      project("teaching", "Teaching", "#bc82b5"),
      project("personal", "Personal", "#4c9f88"),
    ],
    columns: [
      project("next", "To do", "#9da5b3"),
      project("progress", "In progress", "#6484e7"),
      project("waiting", "Waiting", "#c89a4d"),
    ],
    tasks: [
      task(
        "example-review",
        "Review the policy optimization paper",
        "research",
        dateKey(),
        addDays(30),
        "progress",
        {
          type: "doc",
          content: [
            p(
              "Work through the argument a little at a time. Keep the final deadline in sight.",
            ),
            {
              type: "heading",
              attrs: { level: 2 },
              content: [text("Reading notes")],
            },
            p(
              "Focus on the assumptions behind the convergence result and how they compare with the baseline.",
            ),
            {
              type: "blockquote",
              content: [
                p("What changes when the policy class is constrained?"),
              ],
            },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [text("The objective")],
            },
            {
              type: "blockMath",
              attrs: {
                latex:
                  "J(\\theta) = \\mathbb{E}_{\\pi_\\theta}\\!\\left[\\sum_{t=0}^{\\infty} \\gamma^t r_t\\right]",
              },
            },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [text("Next small steps")],
            },
            {
              type: "taskList",
              content: [
                check("Read the abstract and introduction", true),
                check("Check the assumptions in Theorem 1"),
                check("Compare the proof with the baseline"),
                check("Write a first pass of the review"),
              ],
            },
            {
              type: "heading",
              attrs: { level: 2 },
              content: [text("References")],
            },
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "Keep relevant papers and links here.",
                  marks: [{ type: "italic" }],
                },
              ],
            },
          ],
        },
      ),
      task(
        "example-lecture",
        "Prepare next week’s lecture",
        "teaching",
        dateKey(),
        addDays(4),
        "next",
        {
          type: "doc",
          content: [
            p("A clear story, one worked example, and time for questions."),
            {
              type: "taskList",
              content: [
                check("Choose a motivating example"),
                check("Review the practice questions"),
              ],
            },
          ],
        },
      ),
      task(
        "example-walk",
        "Make time for a long walk",
        "personal",
        dateKey(),
        null,
      ),
      task(
        "example-reading",
        "Read the new offline RL paper",
        "research",
        addDays(1),
        null,
        "next",
        {
          type: "doc",
          content: [
            p("Capture the central idea and one question to discuss."),
            {
              type: "taskList",
              content: [
                check("Read the experiment setup"),
                check("Note the strongest baseline"),
              ],
            },
          ],
        },
      ),
      task(
        "example-trip",
        "Plan the workshop trip",
        "personal",
        addDays(3),
        addDays(14),
      ),
      task(
        "example-ideas",
        "Ideas for the next research project",
        "research",
        null,
        null,
        "next",
        {
          type: "doc",
          content: [
            p("A place for ideas that don’t need to become commitments yet."),
          ],
        },
      ),
    ],
  };
}
