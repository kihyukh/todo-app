import { isNative, nativeSend } from "./storage";

/** Native attachments are single files inside the workspace's Attachments folder.
 * Do not grant the entire daymark protocol access to note links. */
export function nativeAttachmentLink(value: string): string | null {
  const match = /^daymark:\/\/attachment\/([^/?#]+)$/i.exec(value.trim());
  if (!match) return null;
  try {
    const filename = decodeURIComponent(match[1]);
    if (
      !filename ||
      filename === "." ||
      filename === ".." ||
      /[\\/\u0000-\u001f\u007f]/u.test(filename)
    )
      return null;
    return `daymark://attachment/${encodeURIComponent(filename)}`;
  } catch {
    return null;
  }
}

export function normalizedNoteLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const attachment = nativeAttachmentLink(trimmed);
  if (attachment) return attachment;
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return ["https:", "http:", "mailto:"].includes(url.protocol)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function isAllowedNoteLink(value: string): boolean {
  return (
    !!nativeAttachmentLink(value) ||
    (/^(https?:\/\/|mailto:)/i.test(value) && !!normalizedNoteLink(value))
  );
}

export function openNoteLink(
  value: string,
): "opened" | "native-only" | "invalid" {
  const href = normalizedNoteLink(value);
  if (!href) return "invalid";
  if (nativeAttachmentLink(href)) {
    if (!isNative()) return "native-only";
    nativeSend({ action: "openAttachment", url: href });
  } else window.open(href, "_blank", "noopener,noreferrer");
  return "opened";
}
