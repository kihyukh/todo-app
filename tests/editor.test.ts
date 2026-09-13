import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import {
  extractCheckboxes,
  plainText,
  toggleCheckbox,
} from "../src/editor-utils";

const markdown = new MarkdownManager({
  extensions: [
    StarterKit,
    TaskList,
    TaskItem.configure({ nested: true }),
    BlockMath,
    InlineMath,
    Image.configure({ allowBase64: true }),
    TableKit,
  ],
  markedOptions: { gfm: true },
  indentation: { style: "space", size: 2 },
});

function descendants(doc: JSONContent, type: string): JSONContent[] {
  return [
    ...(doc.type === type ? [doc] : []),
    ...(doc.content ?? []).flatMap((child) => descendants(child, type)),
  ];
}

const researchNote = `# Paper review

Read **carefully** with $\\alpha^2 + \\beta$ as the reference.

$$
J(\\theta)=\\sum_{t=0}^{T}r_t
$$

- [ ] Read the paper
  - [x] Abstract
  - [ ] Proof
- [x] Discuss

![Figure](data:image/png;base64,aGVsbG8= "Diagram")

[Reference](https://example.com/paper)

| Symbol | Meaning |
| --- | --- |
| x | State |`;

describe("research notes in Markdown", () => {
  it("preserves equations, nested checklist status, images, links, and tables through source editing", () => {
    const note = markdown.parse(researchNote);
    const reopened = markdown.parse(markdown.serialize(note));

    expect(reopened).toEqual(note);
    expect(descendants(reopened, "inlineMath")[0].attrs?.latex).toBe(
      "\\alpha^2 + \\beta",
    );
    expect(descendants(reopened, "blockMath")[0].attrs?.latex).toBe(
      "J(\\theta)=\\sum_{t=0}^{T}r_t",
    );
    expect(descendants(reopened, "image")[0].attrs).toMatchObject({
      src: "data:image/png;base64,aGVsbG8=",
      alt: "Figure",
      title: "Diagram",
    });
    expect(descendants(reopened, "table")).toHaveLength(1);
    expect(
      descendants(reopened, "text").some((node) =>
        node.marks?.some(
          (mark) =>
            mark.type === "link" &&
            mark.attrs?.href === "https://example.com/paper",
        ),
      ),
    ).toBe(true);
    expect(extractCheckboxes(reopened).map((item) => item.checked)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("leaves equation and checkbox examples inside code as literal text", () => {
    const note = markdown.parse(
      "Use `$x$` as an example.\n\n```md\n$$x$$\n- [ ] This is code\n```",
    );

    expect(descendants(note, "inlineMath")).toHaveLength(0);
    expect(descendants(note, "blockMath")).toHaveLength(0);
    expect(extractCheckboxes(note)).toHaveLength(0);
    expect(plainText(note)).toContain("$$x$$");
  });
});

describe("checkboxes across notes", () => {
  it("extracts nested steps separately without duplicating child text on their parent", () => {
    const items = extractCheckboxes(markdown.parse(researchNote));

    expect(items.map((item) => item.text)).toEqual([
      "Read the paper",
      "Abstract",
      "Proof",
      "Discuss",
    ]);
    expect(items[1].path.slice(0, items[0].path.length)).toEqual(items[0].path);
    expect(items[1].path).not.toEqual(items[2].path);
  });

  it("changes only the targeted nested checkbox and keeps the original note intact", () => {
    const note = markdown.parse(researchNote);
    const snapshot = JSON.stringify(note);
    const originalItems = extractCheckboxes(note);
    const updated = toggleCheckbox(note, originalItems[2].path, true);

    expect(JSON.stringify(note)).toBe(snapshot);
    expect(extractCheckboxes(updated).map((item) => item.checked)).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(extractCheckboxes(note).map((item) => item.checked)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(descendants(updated, "blockMath")[0]).toBe(
      descendants(note, "blockMath")[0],
    );
    expect(markdown.parse(markdown.serialize(updated))).toEqual(updated);
  });

  it("ignores stale or malformed paths instead of modifying another part of the note", () => {
    const note = markdown.parse(researchNote);

    for (const path of [[], [-1], [999], [0, 0], [1.5]])
      expect(toggleCheckbox(note, path, true)).toBe(note);
  });

  it("produces readable search text from formatting, equations, and images", () => {
    const text = plainText(markdown.parse(researchNote));

    expect(text).toContain("Read carefully with");
    expect(text).toContain("\\alpha^2 + \\beta");
    expect(text).toContain("Figure");
    expect(text).not.toContain("data:image");
    expect(extractCheckboxes(null)).toEqual([]);
    expect(plainText(undefined)).toBe("");
  });
});
