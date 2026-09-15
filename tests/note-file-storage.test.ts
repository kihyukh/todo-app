// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { File as NodeFile } from "node:buffer";
import { IDBObjectStore } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "../src/model";
import {
  importNoteFile,
  MAX_NOTE_FILE_BYTES,
  readBrowserNoteFile,
} from "../src/note-file-storage";

const file = (bytes: string | Uint8Array = "file bytes", name = "paper.PDF") =>
  // fake-indexeddb uses Node's structuredClone, so use its serializable Blob implementation.
  new NodeFile([bytes], name, { type: "application/pdf" }) as unknown as File;
const receive = (detail: unknown) =>
  window.dispatchEvent(new CustomEvent("daymark-native-message", { detail }));
const attachment = (name = "paper.pdf"): Attachment => ({
  id: "saved-file",
  name,
  mime: "application/pdf",
  size: 3,
  url: "daymark://attachment/saved-file.pdf",
});
function bridge() {
  const postMessage = vi.fn();
  window.webkit = { messageHandlers: { daymark: { postMessage } } };
  return postMessage;
}
function immediateReader() {
  vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
    function () {
      Object.defineProperty(this, "result", {
        value: "data:application/pdf;base64,YWJj",
      });
      this.onload?.(new ProgressEvent("load") as ProgressEvent<FileReader>);
    },
  );
}

afterEach(() => {
  delete window.webkit;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("browser note files", () => {
  it("persists exact binary bytes and metadata across independent database reads", async () => {
    const bytes = new Uint8Array([0, 255, 1, 128, 10, 13]);
    const imported = await importNoteFile(file(bytes, "논문.PDF"));
    expect(imported).toMatchObject({
      name: "논문.PDF",
      mime: "application/pdf",
      size: 6,
    });
    expect(imported.url).toMatch(/^daymark:\/\/attachment\/[\da-f-]+\.pdf$/);
    const first = await readBrowserNoteFile(imported.url);
    const second = await readBrowserNoteFile(imported.url);
    expect(first?.attachment).toEqual(imported);
    expect(second?.attachment).toEqual(imported);
    expect(new Uint8Array(await second!.data.arrayBuffer())).toEqual(bytes);
    expect(second!.data.type).toBe("application/pdf");
    expect(
      (await indexedDB.databases()).find(
        (database) => database.name === "daymark-note-files",
      )?.version,
    ).toBe(1);
  });

  it("keeps same-name imports separate and accepts empty, untyped files", async () => {
    const empty = new NodeFile([], "no extension") as unknown as File;
    const first = await importNoteFile(empty);
    const second = await importNoteFile(empty);
    expect(first.url).not.toBe(second.url);
    expect(first.url).toMatch(/\.bin$/);
    expect(first.mime).toBe("application/octet-stream");
    const stored = await readBrowserNoteFile(first.url);
    expect(stored?.data.size).toBe(0);
    expect(await stored?.data.text()).toBe("");
  });

  it("rejects oversized files before touching storage or reading bytes", async () => {
    const oversized = file();
    Object.defineProperty(oversized, "size", {
      value: MAX_NOTE_FILE_BYTES + 1,
    });
    const open = vi.spyOn(indexedDB, "open");
    const read = vi.spyOn(FileReader.prototype, "readAsDataURL");
    await expect(importNoteFile(oversized)).rejects.toThrow("25 MB");
    expect(open).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects an aborted write even when the put request had succeeded", async () => {
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      ...args
    ) {
      const request = put.apply(this, args);
      request.addEventListener("success", () => this.transaction.abort());
      return request;
    });
    await expect(importNoteFile(file())).rejects.toThrow("could not be saved");
  });

  it("recovers from an opening failure on the next import", async () => {
    vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      throw new DOMException("Storage unavailable", "SecurityError");
    });
    await expect(importNoteFile(file())).rejects.toThrow("Storage unavailable");
    const imported = await importNoteFile(file());
    expect((await readBrowserNoteFile(imported.url))?.attachment).toEqual(
      imported,
    );
  });

  it.each([
    "https://example.com/file.pdf",
    "daymark://workspace/state",
    "daymark://attachment/../secret",
    "daymark://attachment/%2fsecret",
    "daymark://attachment/%2e%2e",
    "daymark://attachment/file.pdf?other=1",
    "daymark://attachment/file%00.pdf",
  ])("rejects unsafe lookups before opening storage: %s", async (href) => {
    const open = vi.spyOn(indexedDB, "open");
    await expect(readBrowserNoteFile(href)).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("returns null for a valid link with missing bytes", async () => {
    await expect(
      readBrowserNoteFile("daymark://attachment/missing.pdf"),
    ).resolves.toBeNull();
  });
});

describe("native note files", () => {
  it("sends raw base64 and waits for the correlated native attachment reply", async () => {
    const postMessage = bridge();
    const importing = importNoteFile(
      new File([new Uint8Array([0, 255, 128])], "binary.dat", {
        type: "application/octet-stream",
      }),
    );
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce());
    const request = postMessage.mock.calls[0][0];
    expect(request).toMatchObject({
      action: "importAttachment",
      name: "binary.dat",
      mime: "application/octet-stream",
      data: "AP+A",
    });
    expect(request.requestId).toMatch(/^note-file:/);
    const resolved = vi.fn();
    void importing.then(resolved);
    receive({
      type: "attachment",
      requestId: "unrelated",
      attachment: attachment(),
    });
    receive({ type: "saved", requestId: request.requestId });
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    receive({
      type: "attachment",
      requestId: request.requestId,
      attachment: attachment(),
    });
    await expect(importing).resolves.toEqual(attachment());
  });

  it("correlates concurrent success and error replies and removes both listeners", async () => {
    immediateReader();
    const postMessage = bridge();
    const remove = vi.spyOn(window, "removeEventListener");
    const first = importNoteFile(new File(["abc"], "first.pdf"));
    const second = importNoteFile(new File(["abc"], "second.pdf"));
    const firstResult = expect(first).rejects.toThrow("Storage is full");
    await Promise.resolve();
    const firstId = postMessage.mock.calls[0][0].requestId;
    const secondId = postMessage.mock.calls[1][0].requestId;
    expect(firstId).not.toBe(secondId);
    receive({
      type: "attachment",
      requestId: secondId,
      attachment: attachment("second.pdf"),
    });
    receive({ type: "error", requestId: firstId, message: "Storage is full" });
    await firstResult;
    await expect(second).resolves.toEqual(attachment("second.pdf"));
    expect(
      remove.mock.calls.filter(([name]) => name === "daymark-native-message"),
    ).toHaveLength(2);
  });

  it("times out and removes its listener and timer", async () => {
    vi.useFakeTimers();
    immediateReader();
    const postMessage = bridge();
    const remove = vi.spyOn(window, "removeEventListener");
    const importing = importNoteFile(new File(["abc"], "file.pdf"));
    const result = expect(importing).rejects.toThrow("timed out");
    await Promise.resolve();
    expect(postMessage).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    await result;
    expect(remove).toHaveBeenCalledWith(
      "daymark-native-message",
      expect.any(Function),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when the native bridge throws", async () => {
    vi.useFakeTimers();
    immediateReader();
    bridge().mockImplementation(() => {
      throw new Error("Bridge unavailable");
    });
    const remove = vi.spyOn(window, "removeEventListener");
    await expect(importNoteFile(new File(["abc"], "file.pdf"))).rejects.toThrow(
      "Bridge unavailable",
    );
    expect(remove).toHaveBeenCalledWith(
      "daymark-native-message",
      expect.any(Function),
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects read failures without sending a native import", async () => {
    const postMessage = bridge();
    vi.spyOn(FileReader.prototype, "readAsDataURL").mockImplementation(
      function () {
        this.onerror?.(new ProgressEvent("error") as ProgressEvent<FileReader>);
      },
    );
    await expect(importNoteFile(new File(["abc"], "file.pdf"))).rejects.toThrow(
      "could not be read",
    );
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("rejects malformed native attachment replies", async () => {
    immediateReader();
    const postMessage = bridge();
    const importing = importNoteFile(new File(["abc"], "file.pdf"));
    await Promise.resolve();
    receive({
      type: "attachment",
      requestId: postMessage.mock.calls[0][0].requestId,
      attachment: { ...attachment(), url: "daymark://attachment/%2fsecret" },
    });
    await expect(importing).rejects.toThrow("could not be added");
  });
});
