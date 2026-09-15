// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAllowedNoteLink,
  nativeAttachmentLink,
  normalizedNoteLink,
  openNoteLink,
} from "../src/note-links";

afterEach(() => {
  delete window.webkit;
  vi.restoreAllMocks();
});
describe("native attachment links", () => {
  it("recognizes one safe filename, including escaped Korean filenames", () => {
    expect(nativeAttachmentLink("daymark://attachment/review.pdf")).toBe(
      "daymark://attachment/review.pdf",
    );
    expect(nativeAttachmentLink(" daymark://attachment/논문 검토.pdf ")).toBe(
      `daymark://attachment/${encodeURIComponent("논문 검토.pdf")}`,
    );
    expect(normalizedNoteLink("daymark://attachment/review.pdf")).toBe(
      "daymark://attachment/review.pdf",
    );
    expect(isAllowedNoteLink("daymark://attachment/review.pdf")).toBe(true);
  });
  it.each([
    "daymark://app/index.html",
    "daymark://attachment@evil/review.pdf",
    "daymark://attachment:123/review.pdf",
    "daymark://attachment/../review.pdf",
    "daymark://attachment/%2e%2e",
    "daymark://attachment/subdir%2Freview.pdf",
    "daymark://attachment/back%5Cslash.pdf",
    "daymark://attachment/%00.pdf",
    "daymark://attachment/%ZZ.pdf",
    "daymark://attachment/review.pdf?path=../outside",
    "javascript:alert(1)",
    "file:///private/review.pdf",
  ])("rejects unsupported or unsafe URL %s", (value) => {
    expect(nativeAttachmentLink(value)).toBeNull();
    expect(normalizedNoteLink(value)).toBeNull();
    expect(isAllowedNoteLink(value)).toBe(false);
  });
  it("opens attachments through the existing native bridge and keeps web links external", () => {
    const postMessage = vi.fn(),
      open = vi.spyOn(window, "open").mockReturnValue(null);
    window.webkit = { messageHandlers: { daymark: { postMessage } } };
    expect(openNoteLink("daymark://attachment/review.pdf")).toBe("opened");
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      action: "openAttachment",
      url: "daymark://attachment/review.pdf",
    });
    expect(open).not.toHaveBeenCalled();
    expect(openNoteLink("https://example.com/paper")).toBe("opened");
    expect(postMessage).toHaveBeenLastCalledWith({
      action: "openExternal",
      url: "https://example.com/paper",
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("uses ordinary browser navigation when new-window requests are blocked", () => {
    const opened: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      opened.push(this);
    });
    expect(openNoteLink("https://example.com/paper")).toBe("opened");
    expect(opened).toHaveLength(1);
    expect(opened[0].href).toBe("https://example.com/paper");
    expect(opened[0].target).toBe("_self");
    expect(opened[0].rel).toContain("noreferrer");
    expect(opened[0].isConnected).toBe(false);
  });
  it("reports native-only files in the browser and normalizes ordinary link editing", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    expect(openNoteLink("daymark://attachment/review.pdf")).toBe("native-only");
    expect(open).not.toHaveBeenCalled();
    expect(normalizedNoteLink(" example.com/paper ")).toBe(
      "https://example.com/paper",
    );
    expect(normalizedNoteLink("mailto:reader@example.com")).toBe(
      "mailto:reader@example.com",
    );
    expect(normalizedNoteLink("")).toBe("");
  });
});
