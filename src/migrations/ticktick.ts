import { MarkdownManager } from "@tiptap/markdown";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import type {
  AppState,
  Attachment,
  NamedRecord,
  NoteNode,
  TagRecord,
  Task,
} from "../model";

/** A task-only export. Credentials and account configuration never enter an import. */
export interface TickTickTask {
  id: string;
  title: string;
  kind: string;
  content: string | null;
  description: string | null;
  notionBlockString?: string | null;
  projectId: string;
  columnId?: string | null;
  parentId?: string | null;
  tagsRaw: string | null;
  status: number;
  deletionStatus: number;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt: string | null;
  startDate: string | null;
  endDate: string | null;
  timeZone: string | null;
  allDay: boolean;
  priority?: number;
  repeatRule?: string | null;
  checklistPrimaryKeys: number[];
  attachmentIds: string[];
}

export interface TickTickChecklist {
  Z_PK: number;
  ZENTITYID: string;
  ZTITLE: string | null;
  ZSORTORDER: number;
  ZSTATUS: number;
}

export interface MigrationAttachment {
  attachmentId: string;
  taskId: string;
  filename: string;
  declaredBytes: number;
  actualBytes?: number;
  locallyAvailable: boolean;
  snapshotPath: string | null;
}

export interface TickTickMigrationPlan {
  importedAt: string;
  today: string;
  timeZone: string;
  projects: NamedRecord[];
  columns: NamedRecord[];
  tags: TagRecord[];
  /** Source lists can become projects, board columns, and deliberate Today scheduling. */
  lists: Record<
    string,
    { projectId: string; columnId: string; today?: boolean }
  >;
  fallback: { projectId: string; columnId: string };
  taskTags: Record<string, string[]>;
}

const extensions = [
  StarterKit.configure({
    link: { protocols: ["migration-attachment", "daymark"] },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  BlockMath,
  InlineMath,
  Image.configure({ allowBase64: true }),
  TableKit,
];
const noteSchema = getSchema(extensions);
const markdown = new MarkdownManager({
  extensions,
  markedOptions: { gfm: true, breaks: true },
  indentation: { style: "space", size: 2 },
});

export function sourceDay(
  value: string | null,
  timeZone: string,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid source date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function mimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  return (
    (
      {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
        heic: "image/heic",
        pdf: "application/pdf",
        hwp: "application/x-hwp",
      } as Record<string, string>
    )[ext ?? ""] ?? "application/octet-stream"
  );
}

function text(value: string): NoteNode {
  return { type: "text", text: value };
}
function paragraph(value: string): NoteNode {
  return { type: "paragraph", ...(value ? { content: [text(value)] } : {}) };
}

/** TickTick permits image/text lines inside one Markdown paragraph. Our images
 * are blocks, so promote them while preserving the surrounding inline text. */
function normalizeBlocks(node: NoteNode): NoteNode[] {
  const children = node.content?.flatMap(normalizeBlocks);
  const normalized = { ...node, ...(children ? { content: children } : {}) };
  if (
    node.type === "paragraph" &&
    children?.some((child) => child.type === "image")
  ) {
    const blocks: NoteNode[] = [];
    let inline: NoteNode[] = [];
    const flush = () => {
      while (inline[0]?.type === "hardBreak") inline.shift();
      while (inline.at(-1)?.type === "hardBreak") inline.pop();
      if (inline.length) blocks.push({ ...normalized, content: inline });
      inline = [];
    };
    for (const child of children) {
      if (child.type === "image") {
        flush();
        blocks.push(child);
      } else inline.push(child);
    }
    flush();
    return blocks;
  }
  if (
    ["taskItem", "listItem"].includes(node.type) &&
    children?.[0]?.type !== "paragraph"
  ) {
    normalized.content = [paragraph(""), ...(children ?? [])];
  }
  return [normalized];
}

export function convertTickTick(
  tasks: TickTickTask[],
  checklist: TickTickChecklist[],
  inventory: MigrationAttachment[],
  plan: TickTickMigrationPlan,
): { state: AppState; attachments: { id: string; path: string }[] } {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(plan.today) ||
    !Number.isFinite(Date.parse(plan.importedAt))
  )
    throw new Error("A valid migration date is required");
  const ids = new Set<string>();
  const tagIds = new Set(plan.tags.map((tag) => tag.id));
  const items = new Map(checklist.map((item) => [item.Z_PK, item]));
  const files = new Map(inventory.map((file) => [file.attachmentId, file]));
  const manifest = new Map<string, string>();
  const converted: Task[] = tasks.map((source) => {
    if (!/^[\w.-]+$/.test(source.id) || ids.has(source.id))
      throw new Error("Invalid or duplicate source task ID");
    if (
      ![0, 2].includes(source.status) ||
      ![0, 1].includes(source.deletionStatus)
    )
      throw new Error(`Unsupported task status for ${source.id}`);
    ids.add(source.id);
    const mapping = plan.lists[source.projectId] ?? plan.fallback;
    const taskFiles = source.attachmentIds.map((id): Attachment => {
      const file = files.get(id);
      if (
        !file ||
        file.taskId !== source.id ||
        !file.locallyAvailable ||
        !file.snapshotPath
      )
        throw new Error(`Attachment ${id} must be downloaded before importing`);
      manifest.set(id, file.snapshotPath);
      return {
        id,
        name: file.filename.normalize("NFC"),
        mime: mimeType(file.filename),
        size: file.actualBytes ?? file.declaredBytes,
        url: `migration-attachment://${id}`,
      };
    });
    const referenced = new Set<string>();
    const rewrite = (body: string) =>
      body.replace(
        /!\[([^\]]*)\]\(([^)]*)\)/g,
        (full, label: string, destination: string) => {
          const id = destination.split("/")[0];
          const file = taskFiles.find((attachment) => attachment.id === id);
          if (!file) return full;
          referenced.add(id);
          return file.mime.startsWith("image/")
            ? `![${label || "Image"}](${file.url})`
            : `[${file.name.replace(/[\[\]\\]/g, "\\$&")}](${file.url})`;
        },
      );
    // Checklist descriptions and ordinary note content are separate source fields.
    const bodies = [source.description, source.content].filter(
      (body): body is string => Boolean(body?.trim()),
    );
    let notes = markdown.parse(bodies.map(rewrite).join("\n\n")) as NoteNode;
    notes.content ??= [];
    if (source.checklistPrimaryKeys.length) {
      const sourceItems = source.checklistPrimaryKeys
        .map((id) => {
          const item = items.get(id);
          if (!item) throw new Error(`Missing checklist item ${id}`);
          return item;
        })
        .sort((a, b) => a.ZSORTORDER - b.ZSORTORDER || a.Z_PK - b.Z_PK);
      notes.content.push({
        type: "taskList",
        content: sourceItems.map((item) => ({
          type: "taskItem",
          attrs: { checked: item.ZSTATUS !== 0 },
          content: (markdown.parse(rewrite(item.ZTITLE ?? "")).content ?? [
            paragraph(""),
          ]) as NoteNode[],
        })),
      });
    }
    for (const file of taskFiles) {
      if (referenced.has(file.id)) continue;
      notes.content.push(
        file.mime.startsWith("image/")
          ? {
              type: "image",
              attrs: { src: file.url, alt: file.name, title: null },
            }
          : {
              type: "paragraph",
              content: [
                {
                  ...text(file.name),
                  marks: [{ type: "link", attrs: { href: file.url } }],
                },
              ],
            },
      );
    }
    if (source.notionBlockString) {
      const blocks: unknown = JSON.parse(source.notionBlockString);
      if (!Array.isArray(blocks))
        throw new Error(`Unsupported rich note format for ${source.id}`);
      for (const block of blocks) {
        const href = block?.value?.url;
        if (
          block?.value?.type !== "url" ||
          typeof href !== "string" ||
          !/^https?:\/\//i.test(href)
        )
          throw new Error(`Unsupported rich note block for ${source.id}`);
        const url = new URL(href).href;
        if (!JSON.stringify(notes).includes(url))
          notes.content.push({
            type: "paragraph",
            content: [
              { ...text(url), marks: [{ type: "link", attrs: { href: url } }] },
            ],
          });
      }
    }
    if (!notes.content.length) notes.content.push(paragraph(""));
    notes = normalizeBlocks(notes)[0];
    noteSchema.nodeFromJSON(notes).check();
    const assigned = [...new Set(plan.taskTags[source.id] ?? [])];
    if (assigned.some((id) => !tagIds.has(id)))
      throw new Error(`Unknown tag on ${source.id}`);
    const isOpen = source.status === 0 && source.deletionStatus === 0;
    const zone = source.timeZone || plan.timeZone;
    // TickTick's single date becomes the deadline. A real date range also has a do date.
    const deadline = sourceDay(source.endDate || source.startDate, zone);
    const rangeStart =
      source.endDate && source.startDate
        ? sourceDay(source.startDate, zone)
        : null;
    const task = {
      id: `ticktick-${source.id}`,
      title: source.title,
      notes,
      projectId: mapping.projectId,
      columnId: mapping.columnId,
      doDate:
        isOpen &&
        (mapping.today || source.tagsRaw?.split(",").includes("today"))
          ? plan.today
          : rangeStart,
      deadline,
      completedAt:
        source.status === 2
          ? source.completedAt || source.modifiedAt || plan.importedAt
          : null,
      deletedAt: source.deletionStatus
        ? source.modifiedAt || plan.importedAt
        : null,
      createdAt: source.createdAt || plan.importedAt,
      updatedAt: plan.importedAt,
      attachments: taskFiles,
      tagIds: assigned,
      // Exact source dates, priorities, ancestry, and status stay available for later recovery.
      importSource: {
        app: "ticktick",
        importedAt: plan.importedAt,
        task: source,
      },
    };
    return task;
  });
  return {
    state: {
      schemaVersion: 1,
      tasks: converted,
      projects: plan.projects,
      columns: plan.columns,
      tags: plan.tags,
    },
    attachments: [...manifest].map(([id, path]) => ({ id, path })),
  };
}
