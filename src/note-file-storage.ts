import { uid } from "./model";
import type { Attachment } from "./model";
import { nativeAttachmentLink } from "./note-links";
import { isNative, nativeSend } from "./storage";

export const MAX_NOTE_FILE_BYTES = 25 * 1024 * 1024;
const NATIVE_IMPORT_TIMEOUT_MS = 30_000;
const FILE_DATABASE = "daymark-note-files";
const FILE_STORE = "files";
type BrowserNoteFile = { attachment: Attachment; data: Blob };

function openFileDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(FILE_STORE);
    };
    request.onerror = () =>
      reject(request.error ?? new Error("File storage could not be opened."));
    request.onsuccess = () => resolve(request.result);
  });
}

function isAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Attachment;
  return (
    typeof attachment.id === "string" &&
    !!attachment.id &&
    typeof attachment.name === "string" &&
    typeof attachment.mime === "string" &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    attachment.size <= MAX_NOTE_FILE_BYTES &&
    typeof attachment.url === "string" &&
    !!nativeAttachmentLink(attachment.url)
  );
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      reader.onload = null;
      reader.onerror = null;
      reader.onabort = null;
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("This file could not be read. Please try again."));
    };
    reader.onabort = () => {
      cleanup();
      reject(new Error("Adding the file was cancelled."));
    };
    reader.onload = () => {
      cleanup();
      const result = reader.result;
      if (typeof result !== "string" || !/^data:[^,]*;base64,/.test(result)) {
        reject(new Error("This file could not be read. Please try again."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    };
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function importNativeFile(file: File): Promise<Attachment> {
  const data = await readBase64(file);
  const requestId = `note-file:${uid()}`;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener("daymark-native-message", receive);
    };
    const receive = (event: Event) => {
      const response = (event as CustomEvent).detail;
      if (response?.requestId !== requestId) return;
      if (!["attachment", "error", "cancelled"].includes(response.type)) return;
      cleanup();
      if (response.type === "attachment" && isAttachment(response.attachment))
        resolve(response.attachment);
      else
        reject(
          new Error(
            response.type === "cancelled"
              ? "Adding the file was cancelled."
              : typeof response.message === "string" && response.message
                ? response.message
                : "This file could not be added. Please try again.",
          ),
        );
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Adding the file timed out. Please try again."));
    }, NATIVE_IMPORT_TIMEOUT_MS);
    window.addEventListener("daymark-native-message", receive);
    try {
      nativeSend({
        action: "importAttachment",
        name: file.name || "File",
        mime: file.type || "application/octet-stream",
        data,
        requestId,
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/** Store file bytes before adding a link, so autosave can never persist a broken import. */
export async function importNoteFile(file: File): Promise<Attachment> {
  if (file.size > MAX_NOTE_FILE_BYTES)
    throw new Error("Each file can be up to 25 MB.");
  if (isNative()) return importNativeFile(file);
  const id = uid();
  const extension =
    /\.([a-z0-9]{1,20})$/i.exec(file.name)?.[1].toLowerCase() ?? "bin";
  const attachment: Attachment = {
    id,
    name: file.name || "File",
    mime: file.type || "application/octet-stream",
    size: file.size,
    url: `daymark://attachment/${id}.${extension}`,
  };
  const database = await openFileDatabase();
  try {
    return await new Promise<Attachment>((resolve, reject) => {
      const transaction = database.transaction(FILE_STORE, "readwrite");
      const request = transaction.objectStore(FILE_STORE).put(
        {
          attachment,
          data: file.slice(0, file.size, attachment.mime),
        } satisfies BrowserNoteFile,
        attachment.url,
      );
      request.onerror = () =>
        reject(request.error ?? new Error("This file could not be saved."));
      transaction.onerror = transaction.onabort = () =>
        reject(transaction.error ?? new Error("This file could not be saved."));
      transaction.oncomplete = () => resolve(attachment);
    });
  } finally {
    database.close();
  }
}

export async function readBrowserNoteFile(
  href: string,
): Promise<BrowserNoteFile | null> {
  const url = nativeAttachmentLink(href);
  if (!url) return null;
  const database = await openFileDatabase();
  try {
    return await new Promise<BrowserNoteFile | null>((resolve, reject) => {
      const transaction = database.transaction(FILE_STORE, "readonly");
      const request = transaction.objectStore(FILE_STORE).get(url);
      request.onerror = () =>
        reject(request.error ?? new Error("This file could not be opened."));
      transaction.onerror = transaction.onabort = () =>
        reject(
          transaction.error ?? new Error("This file could not be opened."),
        );
      transaction.oncomplete = () => {
        const record = request.result as BrowserNoteFile | undefined;
        resolve(
          record &&
            isAttachment(record.attachment) &&
            record.attachment.url === url
            ? record
            : null,
        );
      };
    });
  } finally {
    database.close();
  }
}
