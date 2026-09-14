import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotePublisher } from "../src/note-publisher";

afterEach(() => vi.useRealTimers());

describe("note publication", () => {
  it("keeps serialization and app updates out of a typing burst", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const serialize = vi.fn((text: string) => text);
    const pending = vi.fn();
    const buffer = createNotePublisher(publish, pending);
    for (const text of ["h", "he", "hel", "hell", "hello"]) {
      buffer.schedule(() => serialize(text));
      vi.advanceTimersByTime(40);
    }
    expect(serialize).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(pending.mock.calls).toEqual([[true]]);
    vi.advanceTimersByTime(350);
    expect(serialize.mock.calls).toEqual([["hello"]]);
    expect(publish.mock.calls).toEqual([["hello"]]);
    expect(pending.mock.calls).toEqual([[true], [false]]);
  });

  it("publishes periodically during continuous typing", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const buffer = createNotePublisher(publish);
    for (let n = 0; n < 20; n++) {
      buffer.schedule(() => n);
      vi.advanceTimersByTime(100);
    }
    expect(publish.mock.calls).toEqual([[19]]);
    expect(buffer.pending).toBe(false);
  });

  it("flushes the latest draft immediately and leaves no trailing write", () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const buffer = createNotePublisher(publish);
    buffer.schedule(() => "previous");
    buffer.schedule(() => "last keystroke");
    buffer.flush();
    buffer.flush();
    vi.runAllTimers();
    expect(publish.mock.calls).toEqual([["last keystroke"]]);
    expect(buffer.pending).toBe(false);
  });
});
