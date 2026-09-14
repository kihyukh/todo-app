import { describe, expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { activeTasks } from "../src/model";
import type { NamedRecord, NoteNode } from "../src/model";
import { extractCheckboxes, plainText } from "../src/editor-utils";
import { convertTickTick, sourceDay } from "../src/migrations/ticktick";
import type {
  MigrationAttachment,
  TickTickChecklist,
  TickTickMigrationPlan,
  TickTickTask,
} from "../src/migrations/ticktick";

const importedAt = "2026-09-14T06:00:00Z";
const schema = getSchema([
  StarterKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  BlockMath,
  InlineMath,
  Image.configure({ allowBase64: true }),
  TableKit,
]);
const record = (id: string): NamedRecord => ({
  id,
  name: id,
  color: "#315fd5",
  updatedAt: importedAt,
});
const plan = (): TickTickMigrationPlan => ({
  importedAt,
  today: "2026-09-14",
  timeZone: "Asia/Seoul",
  projects: [record("work"), record("personal")],
  columns: [record("next"), record("progress")],
  tags: [{ ...record("research"), group: "area" }],
  lists: {
    "source-work": { projectId: "work", columnId: "progress" },
    "source-today": { projectId: "work", columnId: "next", today: true },
    "source-personal": { projectId: "personal", columnId: "next" },
  },
  fallback: { projectId: "", columnId: "next" },
  taskTags: { alpha: ["research"] },
});
const task = (patch: Partial<TickTickTask> = {}): TickTickTask => ({
  id: "alpha",
  title: "A synthetic task",
  kind: "TEXT",
  content: "",
  description: null,
  projectId: "source-work",
  tagsRaw: "research",
  status: 0,
  deletionStatus: 0,
  createdAt: "2025-01-01T01:02:03Z",
  modifiedAt: "2026-09-12T01:02:03Z",
  completedAt: null,
  startDate: null,
  endDate: null,
  timeZone: "Asia/Seoul",
  allDay: true,
  checklistPrimaryKeys: [],
  attachmentIds: [],
  ...patch,
});
const attachment = (
  patch: Partial<MigrationAttachment> = {},
): MigrationAttachment => ({
  attachmentId: "image-1",
  taskId: "alpha",
  filename: "Figure.png",
  declaredBytes: 100,
  actualBytes: 103,
  locallyAvailable: true,
  snapshotPath: "/private/synthetic/Figure.png",
  ...patch,
});
function nodes(note: NoteNode, type: string): NoteNode[] {
  return [
    ...(note.type === type ? [note] : []),
    ...(note.content ?? []).flatMap((child) => nodes(child, type)),
  ];
}
const links = (note: NoteNode) =>
  nodes(note, "text").flatMap((node) =>
    (node.marks ?? [])
      .filter((mark) => mark.type === "link")
      .map((mark) => mark.attrs?.href),
  );

describe("TickTick task migration", () => {
  it("uses the source timezone instead of dropping the previous UTC calendar day", () => {
    expect(sourceDay("2026-09-13T15:00:00Z", "Asia/Seoul")).toBe("2026-09-14");
    expect(sourceDay("2026-09-13T15:00:00Z", "America/Los_Angeles")).toBe(
      "2026-09-13",
    );
    const converted = convertTickTick(
      [task({ startDate: "2026-09-13T15:00:00Z" })],
      [],
      [],
      plan(),
    ).state.tasks[0];
    expect(converted.deadline).toBe("2026-09-14");
    expect(converted.doDate).toBeNull();
    expect(converted.projectId).toBe("work");
    expect(converted.columnId).toBe("progress");
    expect(converted.tagIds).toEqual(["research"]);
  });

  it("keeps a source date range as separate do and deadline dates", () => {
    const converted = convertTickTick(
      [
        task({
          startDate: "2026-09-13T15:00:00Z",
          endDate: "2026-09-16T15:00:00Z",
        }),
      ],
      [],
      [],
      plan(),
    ).state.tasks[0];
    expect(converted.doDate).toBe("2026-09-14");
    expect(converted.deadline).toBe("2026-09-17");
  });

  it("uses Today list or tag scheduling only for open tasks", () => {
    const state = convertTickTick(
      [
        task({ id: "open", projectId: "source-today" }),
        task({
          id: "done",
          projectId: "source-today",
          status: 2,
          completedAt: "2026-08-01T01:00:00Z",
        }),
        task({ id: "trash", projectId: "source-today", deletionStatus: 1 }),
        task({ id: "tagged", tagsRaw: "research,today" }),
        task({ id: "ordinary", projectId: "source-personal" }),
      ],
      [],
      [],
      plan(),
    ).state;
    expect(state.tasks.map((item) => item.doDate)).toEqual([
      "2026-09-14",
      null,
      null,
      "2026-09-14",
      null,
    ]);
    expect(state.tasks[4].projectId).toBe("personal");
    expect(activeTasks(state).map((item) => item.id)).toEqual([
      "ticktick-open",
      "ticktick-tagged",
      "ticktick-ordinary",
    ]);
  });

  it("preserves completed and deleted history without making it active", () => {
    const state = convertTickTick(
      [
        task({ id: "done", status: 2, completedAt: "2026-08-01T01:00:00Z" }),
        task({
          id: "trashed-done",
          status: 2,
          deletionStatus: 1,
          completedAt: null,
        }),
        task({ id: "old-list", projectId: "removed-list", deletionStatus: 1 }),
      ],
      [],
      [],
      plan(),
    ).state;
    expect(activeTasks(state)).toEqual([]);
    expect(state.tasks[0].completedAt).toBe("2026-08-01T01:00:00Z");
    expect(state.tasks[0].deletedAt).toBeNull();
    expect(state.tasks[1].completedAt).toBe("2026-09-12T01:02:03Z");
    expect(state.tasks[1].deletedAt).toBe("2026-09-12T01:02:03Z");
    expect(state.tasks[2].projectId).toBe("");
    expect(state.tasks[2].createdAt).toBe("2025-01-01T01:02:03Z");
  });

  it("orders checklist items and preserves both checked source statuses", () => {
    const checklist: TickTickChecklist[] = [
      {
        Z_PK: 1,
        ZENTITYID: "item-a",
        ZTITLE: "First",
        ZSORTORDER: 10,
        ZSTATUS: 0,
      },
      {
        Z_PK: 2,
        ZENTITYID: "item-b",
        ZTITLE: "Second with $x^2$",
        ZSORTORDER: 20,
        ZSTATUS: 1,
      },
      {
        Z_PK: 3,
        ZENTITYID: "item-c",
        ZTITLE: "Third",
        ZSORTORDER: 30,
        ZSTATUS: 2,
      },
    ];
    const note = convertTickTick(
      [
        task({
          kind: "CHECKLIST",
          description: "Instructions",
          content: "Related **notes**",
          checklistPrimaryKeys: [3, 1, 2],
        }),
      ],
      checklist,
      [],
      plan(),
    ).state.tasks[0].notes;
    expect(plainText(note)).toContain("Instructions Related notes");
    expect(
      extractCheckboxes(note).map((item) => [item.text, item.checked]),
    ).toEqual([
      ["First", false],
      ["Second with x^2", true],
      ["Third", true],
    ]);
    expect(nodes(note, "inlineMath")[0].attrs?.latex).toBe("x^2");
  });

  it("preserves Markdown links, inline and display math, and nested checkbox state", () => {
    const content =
      "# Review\n\nRead [the paper](https://example.com/paper) with $\\alpha^2$.\n\n$$\nJ(x)=x^2\n$$\n\n- [ ] Read\n  - [x] Abstract\n- [x] Discuss";
    const note = convertTickTick([task({ content })], [], [], plan()).state
      .tasks[0].notes;
    expect(links(note)).toContain("https://example.com/paper");
    expect(nodes(note, "inlineMath")[0].attrs?.latex).toBe("\\alpha^2");
    expect(nodes(note, "blockMath")[0].attrs?.latex).toBe("J(x)=x^2");
    expect(extractCheckboxes(note).map((item) => item.checked)).toEqual([
      false,
      true,
      true,
    ]);
    expect(nodes(note, "heading")).toHaveLength(1);
  });

  it("turns PDF file tokens into links and preserves image tokens as images", () => {
    const inventory = [
      attachment(),
      attachment({
        attachmentId: "pdf-1",
        filename: "Report [draft].pdf",
        snapshotPath: "/private/synthetic/report.pdf",
      }),
    ];
    const result = convertTickTick(
      [
        task({
          content:
            "![Figure](image-1/image.png)\n\n![Document](pdf-1/document.pdf)",
          attachmentIds: ["image-1", "pdf-1"],
        }),
      ],
      [],
      inventory,
      plan(),
    );
    const note = result.state.tasks[0].notes;
    expect(nodes(note, "image")).toHaveLength(1);
    expect(nodes(note, "image")[0].attrs?.src).toBe(
      "migration-attachment://image-1",
    );
    expect(links(note)).toContain("migration-attachment://pdf-1");
    expect(plainText(note)).toContain("Report [draft].pdf");
    expect(
      result.state.tasks[0].attachments.map((file) => [
        file.id,
        file.mime,
        file.size,
      ]),
    ).toEqual([
      ["image-1", "image/png", 103],
      ["pdf-1", "application/pdf", 103],
    ]);
    expect(result.attachments).toEqual([
      { id: "image-1", path: "/private/synthetic/Figure.png" },
      { id: "pdf-1", path: "/private/synthetic/report.pdf" },
    ]);
  });

  it("appends unreferenced images and documents without duplicating referenced attachments", () => {
    const inventory = [
      attachment(),
      attachment({ attachmentId: "pdf-1", filename: "Unreferenced.pdf" }),
    ];
    const note = convertTickTick(
      [
        task({
          content: "![Figure](image-1/image.png)",
          attachmentIds: ["image-1", "pdf-1"],
        }),
      ],
      [],
      inventory,
      plan(),
    ).state.tasks[0].notes;
    expect(nodes(note, "image")).toHaveLength(1);
    expect(
      links(note).filter((url) => url === "migration-attachment://pdf-1"),
    ).toHaveLength(1);
    const unreferenced = convertTickTick(
      [task({ attachmentIds: ["image-1"] })],
      [],
      inventory,
      plan(),
    ).state.tasks[0].notes;
    expect(nodes(unreferenced, "image")[0].attrs?.alt).toBe("Figure.png");
  });

  it("keeps inline-adjacent images and surrounding prose in valid editable blocks", () => {
    const note = convertTickTick(
      [
        task({
          content: "Before ![Figure](image-1/figure.png) after",
          attachmentIds: ["image-1"],
        }),
      ],
      [],
      [attachment()],
      plan(),
    ).state.tasks[0].notes;
    expect(() => schema.nodeFromJSON(note).check()).not.toThrow();
    expect(nodes(note, "image")).toHaveLength(1);
    expect(plainText(note)).toContain("Before");
    expect(plainText(note)).toContain("after");
    expect(note.content?.map((node) => node.type)).toEqual([
      "paragraph",
      "image",
      "paragraph",
    ]);
  });

  it("keeps consecutive images separated by single newlines without nesting blocks inside a paragraph", () => {
    const note = convertTickTick(
      [
        task({
          content:
            "![First](image-1/first.png)\n![Second](image-2/second.png)\nAfter images",
          attachmentIds: ["image-1", "image-2"],
        }),
      ],
      [],
      [
        attachment(),
        attachment({ attachmentId: "image-2", filename: "Second.png" }),
      ],
      plan(),
    ).state.tasks[0].notes;
    expect(() => schema.nodeFromJSON(note).check()).not.toThrow();
    expect(nodes(note, "image").map((node) => node.attrs?.src)).toEqual([
      "migration-attachment://image-1",
      "migration-attachment://image-2",
    ]);
    expect(plainText(note)).toContain("After images");
  });

  it("preserves empty and block-formatted checklist rows as valid task items", () => {
    const checklist: TickTickChecklist[] = [
      { Z_PK: 1, ZENTITYID: "empty", ZTITLE: null, ZSORTORDER: 1, ZSTATUS: 0 },
      {
        Z_PK: 2,
        ZENTITYID: "heading",
        ZTITLE: "# Heading",
        ZSORTORDER: 2,
        ZSTATUS: 1,
      },
      {
        Z_PK: 3,
        ZENTITYID: "image",
        ZTITLE: "![Figure](image-1/figure.png)",
        ZSORTORDER: 3,
        ZSTATUS: 0,
      },
    ];
    const note = convertTickTick(
      [task({ checklistPrimaryKeys: [1, 2, 3], attachmentIds: ["image-1"] })],
      checklist,
      [attachment()],
      plan(),
    ).state.tasks[0].notes;
    expect(() => schema.nodeFromJSON(note).check()).not.toThrow();
    const items = nodes(note, "taskItem");
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.content?.[0].type === "paragraph")).toBe(
      true,
    );
    expect(items.map((item) => item.attrs?.checked)).toEqual([
      false,
      true,
      false,
    ]);
    expect(nodes(note, "heading")).toHaveLength(1);
    expect(nodes(note, "image")).toHaveLength(1);
  });

  it.each(["missing", "wrong-task", "not-downloaded", "no-path"])(
    "rejects %s attachments before producing an incomplete migration",
    (problem) => {
      const file = attachment(
        problem === "wrong-task"
          ? { taskId: "someone-else" }
          : problem === "not-downloaded"
            ? { locallyAvailable: false }
            : problem === "no-path"
              ? { snapshotPath: null }
              : {},
      );
      expect(() =>
        convertTickTick(
          [task({ attachmentIds: ["image-1"] })],
          [],
          problem === "missing" ? [] : [file],
          plan(),
        ),
      ).toThrow(/downloaded before importing/);
    },
  );

  it("uses stable source IDs across repeated imports and rejects duplicate or unsafe IDs", () => {
    const first = convertTickTick(
      [task({ id: "source-A" }), task({ id: "source-B" })],
      [],
      [],
      plan(),
    ).state;
    const second = convertTickTick(
      [task({ id: "source-B" }), task({ id: "source-A" })],
      [],
      [],
      { ...plan(), importedAt: "2026-09-15T06:00:00Z" },
    ).state;
    expect(first.tasks.map((item) => item.id).sort()).toEqual(
      second.tasks.map((item) => item.id).sort(),
    );
    expect(() => convertTickTick([task(), task()], [], [], plan())).toThrow(
      /duplicate/,
    );
    expect(() =>
      convertTickTick([task({ id: "../unsafe" })], [], [], plan()),
    ).toThrow(/source task ID/);
  });

  it("retains exact source metadata for recovery alongside the mapped dates and tags", () => {
    const source = {
      ...task({
        parentId: "parent-task",
        priority: 5,
        repeatRule: "RRULE:FREQ=WEEKLY",
        startDate: "2026-09-13T15:00:00Z",
      }),
      rawPrimaryKey: 42,
      sortOrder: -8000,
      customLegacyMetadata: { original: true },
    };
    const migrationPlan = plan();
    const result = convertTickTick([source], [], [], migrationPlan);
    expect(
      (result.state.tasks[0] as unknown as { importSource: unknown })
        .importSource,
    ).toEqual({ app: "ticktick", importedAt, task: source });
    expect(result.state.projects).toEqual(migrationPlan.projects);
    expect(result.state.columns).toEqual(migrationPlan.columns);
    expect(result.state.tags).toEqual(migrationPlan.tags);
  });

  it("includes rich URL blocks that are absent from the ordinary content field", () => {
    const source = {
      ...task({ content: "A separate note" }),
      notionBlockString: JSON.stringify([
        {
          key: "demo-block",
          value: {
            type: "url",
            url: "https://app.notion.com/synthetic-reference",
          },
        },
      ]),
    };
    const note = convertTickTick([source], [], [], plan()).state.tasks[0].notes;
    expect(plainText(note)).toContain("A separate note");
    expect(links(note)).toContain("https://app.notion.com/synthetic-reference");
  });

  it("rejects missing checklist records, unknown assigned tags, and unsupported task statuses", () => {
    expect(() =>
      convertTickTick([task({ checklistPrimaryKeys: [404] })], [], [], plan()),
    ).toThrow(/Missing checklist item/);
    expect(() =>
      convertTickTick([task()], [], [], {
        ...plan(),
        taskTags: { alpha: ["missing-tag"] },
      }),
    ).toThrow(/Unknown tag/);
    expect(() =>
      convertTickTick([task({ status: 1 })], [], [], plan()),
    ).toThrow(/Unsupported task status/);
    expect(() => sourceDay("invalid", "Asia/Seoul")).toThrow(
      /Invalid source date/,
    );
  });
});
