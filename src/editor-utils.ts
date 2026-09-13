import type { JSONContent } from "@tiptap/core";

export interface NoteCheckbox {
  path: number[];
  text: string;
  checked: boolean;
}

/** Human-readable note text, including equations, without leaking image data URLs. */
export function plainText(doc: JSONContent | null | undefined): string {
  if (!doc) return "";
  if (doc.type === "text") return doc.text ?? "";
  if (doc.type === "inlineMath" || doc.type === "blockMath")
    return String(doc.attrs?.latex ?? "");
  if (doc.type === "image") return String(doc.attrs?.alt ?? "");
  if (doc.type === "hardBreak") return "\n";
  const separator = ["paragraph", "heading"].includes(doc.type ?? "")
    ? ""
    : " ";
  return (doc.content ?? []).map(plainText).join(separator).trim();
}

/** Paths index through `content` arrays, so nested checkboxes remain individually addressable. */
export function extractCheckboxes(
  doc: JSONContent | null | undefined,
): NoteCheckbox[] {
  const result: NoteCheckbox[] = [];
  const visit = (node: JSONContent, path: number[]) => {
    if (node.type === "taskItem") {
      const ownContent = (node.content ?? []).filter(
        (child) => child.type !== "taskList",
      );
      result.push({
        path,
        text: ownContent.map(plainText).join(" ").trim() || "Untitled step",
        checked: node.attrs?.checked === true,
      });
    }
    node.content?.forEach((child, index) => visit(child, [...path, index]));
  };
  if (doc) visit(doc, []);
  return result;
}

/** Clone only the affected ancestry; never mutate the saved note or neighboring steps. */
export function toggleCheckbox<T extends JSONContent>(
  doc: T,
  path: number[],
  checked: boolean,
): T {
  let target: JSONContent | undefined = doc;
  for (const index of path) {
    if (!Number.isInteger(index) || index < 0) return doc;
    target = target?.content?.[index];
  }
  if (target?.type !== "taskItem") return doc;
  const update = (node: JSONContent, depth: number): JSONContent => {
    if (depth === path.length)
      return { ...node, attrs: { ...node.attrs, checked } };
    return {
      ...node,
      content: node.content?.map((child, index) =>
        index === path[depth] ? update(child, depth + 1) : child,
      ),
    };
  };
  return update(doc, 0) as T;
}
