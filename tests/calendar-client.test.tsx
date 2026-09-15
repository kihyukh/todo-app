// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { calendarRequest, useCalendars } from "../src/calendar-client";
import type { CalendarsAPI } from "../src/calendar-client";
import { event } from "./calendar-fixtures";

let root: Root | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete window.webkit;
  localStorage.clear();
  vi.restoreAllMocks();
});
const receive = (payload: unknown) =>
  window.dispatchEvent(
    new CustomEvent("daymark-native-message", { detail: payload }),
  );
const source = {
  id: "work",
  title: "Work",
  color: "#2f805e",
  source: "iCloud",
  writable: true,
};
async function mount() {
  let current!: CalendarsAPI;
  const pending: Record<string, any>[] = [];
  const postMessage = vi.fn((message: any) => {
    if (message.action === "calendarStatus")
      queueMicrotask(() =>
        receive({
          type: "calendarStatus",
          requestId: message.requestId,
          status: "authorized",
          calendars: [source],
          defaultCalendarId: "work",
        }),
      );
    else pending.push(message);
  });
  window.webkit = { messageHandlers: { daymark: { postMessage } } };
  function Harness() {
    current = useCalendars();
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness />);
  });
  return { current: () => current, pending, postMessage };
}
describe("calendar bridge", () => {
  it("retains confirmed saves and deletions in cache even if the following refresh fails", async () => {
    const harness = await mount();
    const original = event(),
      copy = event({ id: "copy", calendarId: "personal" });
    const first = harness.pending.shift()!;
    await act(async () =>
      receive({
        type: "calendarEvents",
        requestId: first.requestId,
        events: [original, copy],
      }),
    );
    let saving!: ReturnType<CalendarsAPI["saveEvent"]>;
    await act(async () => {
      saving = harness
        .current()
        .saveEvent({
          ...original,
          lookupCalendarId: original.calendarId,
          lookupStart: original.start,
          title: "Confirmed update",
        });
    });
    const save = harness.pending.shift()!;
    const updated = { ...original, title: "Confirmed update" };
    await act(async () =>
      receive({
        type: "calendarSaved",
        requestId: save.requestId,
        event: updated,
      }),
    );
    const refresh = harness.pending.shift()!;
    await act(async () => {
      receive({
        type: "error",
        requestId: refresh.requestId,
        message: "Offline refresh",
      });
      await saving;
    });
    expect(harness.current().events).toEqual([copy, updated]);
    expect(harness.current().error).toBe("Offline refresh");
    let deleting!: Promise<void>;
    await act(async () => {
      deleting = harness.current().deleteEvent(updated);
    });
    const deletion = harness.pending.shift()!;
    await act(async () =>
      receive({
        type: "calendarDeleted",
        requestId: deletion.requestId,
        id: updated.id,
      }),
    );
    const retry = harness.pending.shift()!;
    await act(async () => {
      receive({
        type: "error",
        requestId: retry.requestId,
        message: "Still offline",
      });
      await deleting;
    });
    expect(harness.current().events).toEqual([copy]);
  });
  it("correlates request IDs and rejects calendar errors locally", async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { daymark: { postMessage } } };
    const first = calendarRequest({ action: "calendarStatus" }),
      second = calendarRequest({ action: "calendarEvents" });
    const firstId = postMessage.mock.calls[0][0].requestId,
      secondId = postMessage.mock.calls[1][0].requestId;
    expect(firstId).toMatch(/^calendar:/);
    expect(firstId).not.toBe(secondId);
    receive({ type: "calendarEvents", requestId: secondId, events: [] });
    receive({ type: "error", requestId: firstId, message: "Access denied" });
    await expect(first).rejects.toThrow("Access denied");
    await expect(second).resolves.toMatchObject({
      type: "calendarEvents",
      events: [],
    });
  });
  it("keeps task calendars available in browser preview without requesting native permissions", async () => {
    await expect(
      calendarRequest({ action: "calendarConnect" }),
    ).rejects.toThrow("Mac or iPhone");
  });
  it("discards stale date-range replies and retains duplicate invitations in different calendars", async () => {
    const harness = await mount();
    const old = harness.pending.shift()!;
    expect(old.action).toBe("calendarEvents");
    await act(async () =>
      harness.current().setRange({
        start: "2026-10-01T00:00:00Z",
        end: "2026-11-01T00:00:00Z",
      }),
    );
    const latest = harness.pending.shift()!;
    const one = event(),
      two = event({ id: "other-copy", calendarId: "other" });
    await act(async () =>
      receive({
        type: "calendarEvents",
        requestId: latest.requestId,
        events: [one, two],
      }),
    );
    await act(async () =>
      receive({
        type: "calendarEvents",
        requestId: old.requestId,
        events: [event({ title: "Stale" })],
      }),
    );
    expect(harness.current().events.map((event) => event.title)).toEqual([
      one.title,
      two.title,
    ]);
    expect(harness.current().loading).toBe(false);
  });
  it("clears events on permission loss and ignores an earlier authorized reply", async () => {
    const harness = await mount();
    const pending = harness.pending.shift()!;
    harness.postMessage.mockImplementation((message: any) => {
      if (message.action === "calendarStatus")
        queueMicrotask(() =>
          receive({
            type: "calendarStatus",
            requestId: message.requestId,
            status: "denied",
            calendars: [],
          }),
        );
      else harness.pending.push(message);
    });
    await act(async () => window.dispatchEvent(new Event("focus")));
    await act(async () => {
      receive({
        type: "calendarEvents",
        requestId: pending.requestId,
        events: [event()],
      });
      for (const message of harness.pending)
        receive({
          type: "calendarEvents",
          requestId: message.requestId,
          events: [event()],
        });
    });
    expect(harness.current().status).toBe("denied");
    expect(harness.current().events).toEqual([]);
    expect(harness.current().loading).toBe(false);
  });
  it("treats no selected calendars as an explicit empty selection and persists the device preference", async () => {
    const harness = await mount();
    const initial = harness.pending.shift()!;
    await act(async () =>
      receive({
        type: "calendarEvents",
        requestId: initial.requestId,
        events: [event()],
      }),
    );
    await act(async () => harness.current().setSelectedCalendarIds([]));
    expect(harness.current().events).toEqual([]);
    expect(localStorage.getItem("daymark.calendar-selection.v1")).toBe("[]");
    expect(harness.pending).toHaveLength(0);
  });
});
