import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addEventLink,
  calendarRange,
  eventKey,
  eventLink,
  eventOnDay,
  eventsOnDay,
  findLinkedEvent,
  linkedTasks,
  linkMatchesEvent,
  positionEvents,
  rangeDays,
  removeEventLink,
  taskEntriesOnDay,
} from "../src/calendar-model";
import { event, task } from "./calendar-fixtures";

afterEach(() => vi.unstubAllEnvs());
describe("calendar event links", () => {
  it("keeps an all-day recurring link when a different device time zone shifts EventKit timestamps", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const link = eventLink(
      event({
        allDay: true,
        isRecurring: true,
        occurrenceDate: "2026-09-13T15:00:00Z",
      }),
    );
    expect(link.occurrenceDay).toBe("2026-09-14");
    vi.stubEnv("TZ", "America/Los_Angeles");
    const shifted = event({
      id: "iphone-id",
      allDay: true,
      isRecurring: true,
      occurrenceDate: "2026-09-14T07:00:00Z",
      start: "2026-09-16T07:00:00Z",
    });
    expect(linkMatchesEvent(link, shifted)).toBe(true);
    expect(
      linkMatchesEvent(link, {
        ...shifted,
        occurrenceDate: "2026-09-15T07:00:00Z",
      }),
    ).toBe(false);
  });
  it("matches shared external identity when local device identifiers change", () => {
    const link = eventLink(event());
    expect(
      linkMatchesEvent(
        link,
        event({ id: "iphone-id", calendarId: "iphone-calendar" }),
      ),
    ).toBe(true);
    expect(linkMatchesEvent(link, event({ externalId: "other-event" }))).toBe(
      false,
    );
    expect(
      linkMatchesEvent(
        eventLink(event({ externalId: null })),
        event({ externalId: null }),
      ),
    ).toBe(true);
  });
  it("links only one recurring occurrence and retains its identity when its start moves", () => {
    const occurrenceDate = "2026-09-14T00:00:00Z";
    const link = eventLink(event({ occurrenceDate, isRecurring: true }));
    expect(
      linkMatchesEvent(
        link,
        event({
          id: "new",
          occurrenceDate,
          isRecurring: true,
          start: "2026-09-15T11:00:00+09:00",
        }),
      ),
    ).toBe(true);
    expect(
      linkMatchesEvent(
        link,
        event({ occurrenceDate: "2026-09-21T00:00:00Z", isRecurring: true }),
      ),
    ).toBe(false);
    expect(linkMatchesEvent(link, event())).toBe(false);
  });
  it("keeps duplicate invitations in separate calendars visible and prefers linked calendar metadata", () => {
    const work = event(),
      personal = event({
        id: "personal-id",
        calendarId: "personal",
        title: "Personal copy",
      });
    expect(eventKey(work)).not.toBe(eventKey(personal));
    expect(findLinkedEvent([personal, work], eventLink(work))).toBe(work);
    expect(findLinkedEvent([personal], eventLink(work))).toBe(personal);
  });
  it("updates one cached link without losing another occurrence and unlinks without touching notes", () => {
    const first = event({ occurrenceDate: "2026-09-14T00:00:00Z" }),
      second = event({ occurrenceDate: "2026-09-21T00:00:00Z" });
    const original = task("paper", {
      calendarLinks: [eventLink(first), eventLink(second)],
    });
    const links = addEventLink(original, { ...first, title: "New title" });
    expect(links).toHaveLength(2);
    expect(links.at(-1)?.title).toBe("New title");
    expect(
      removeEventLink({ ...original, calendarLinks: links }, eventLink(first)),
    ).toEqual([eventLink(second)]);
    expect(original.calendarLinks?.[0].title).toBe("Design discussion");
  });
  it("includes completed linked tasks but excludes deleted task records", () => {
    const link = eventLink(event());
    const tasks = [
      task("active", { calendarLinks: [link] }),
      task("done", { calendarLinks: [link], completedAt: "2026-09-14" }),
      task("deleted", { calendarLinks: [link], deletedAt: "2026-09-14" }),
    ];
    expect(linkedTasks(tasks, event()).map((task) => task.id)).toEqual([
      "active",
      "done",
    ]);
  });
});
describe("calendar dates and layout", () => {
  it("separates visual collisions for short appointments and repeated daylight-saving hours", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const first = event({ end: "2026-09-14T09:05:00+09:00" });
    const second = event({
      id: "short",
      start: "2026-09-14T09:05:00+09:00",
      end: "2026-09-14T09:10:00+09:00",
    });
    expect(
      positionEvents([first, second], "2026-09-14").map((item) => item.column),
    ).toEqual([0, 1]);
    vi.stubEnv("TZ", "America/New_York");
    const earlier = event({
      start: "2026-11-01T05:30:00Z",
      end: "2026-11-01T05:45:00Z",
    });
    const repeated = event({
      id: "repeat",
      start: "2026-11-01T06:30:00Z",
      end: "2026-11-01T06:45:00Z",
    });
    expect(
      positionEvents([earlier, repeated], "2026-11-01").map(
        ({ top, column, columns }) => ({ top, column, columns }),
      ),
    ).toEqual([
      { top: 90, column: 0, columns: 2 },
      { top: 90, column: 1, columns: 2 },
    ]);
  });
  it("uses local midnight and exclusive event ends across time zones", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const overnight = event({
      start: "2026-09-14T14:30:00Z",
      end: "2026-09-14T15:00:00Z",
    });
    expect(eventOnDay(overnight, "2026-09-14")).toBe(true);
    expect(eventOnDay(overnight, "2026-09-15")).toBe(false);
    expect(
      eventOnDay({ ...overnight, end: "2026-09-14T15:30:00Z" }, "2026-09-15"),
    ).toBe(true);
  });
  it("does not add an extra day to multi-day all-day events", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const allDay = event({
      start: "2026-09-14T00:00:00+09:00",
      end: "2026-09-17T00:00:00+09:00",
      allDay: true,
    });
    expect(
      ["2026-09-13", "2026-09-14", "2026-09-16", "2026-09-17"].map((day) =>
        eventOnDay(allDay, day),
      ),
    ).toEqual([false, true, true, false]);
  });
  it("builds Monday-based weeks and a complete month grid without shifting DST dates", () => {
    vi.stubEnv("TZ", "America/New_York");
    const week = rangeDays(calendarRange("2026-03-08", "week"));
    expect(week).toEqual([
      "2026-03-02",
      "2026-03-03",
      "2026-03-04",
      "2026-03-05",
      "2026-03-06",
      "2026-03-07",
      "2026-03-08",
    ]);
    const day = calendarRange("2026-03-08", "day");
    expect(Date.parse(day.end) - Date.parse(day.start)).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(rangeDays(calendarRange("2026-09-14", "month"))).toHaveLength(42);
  });
  it("lays out overlapping appointments in separate columns and reuses columns after a group", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const first = event(),
      overlap = event({
        id: "second",
        start: "2026-09-14T09:30:00+09:00",
        end: "2026-09-14T10:30:00+09:00",
      }),
      after = event({
        id: "third",
        start: "2026-09-14T10:30:00+09:00",
        end: "2026-09-14T11:00:00+09:00",
      });
    expect(
      positionEvents([after, overlap, first], "2026-09-14").map(
        ({ column, columns, top, height }) => ({
          column,
          columns,
          top,
          height,
        }),
      ),
    ).toEqual([
      { column: 0, columns: 2, top: 540, height: 60 },
      { column: 1, columns: 2, top: 570, height: 60 },
      { column: 0, columns: 1, top: 630, height: 30 },
    ]);
  });
  it("orders all-day events first and hides duplicate work chips while preserving deadlines", () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const meeting = event(),
      allDay = event({ id: "all-day", allDay: true });
    expect(eventsOnDay([meeting, allDay], "2026-09-14")[0]).toBe(allDay);
    const tasks = [
      task("linked", {
        doDates: ["2026-09-14"],
        calendarLinks: [eventLink(meeting)],
      }),
      task("due", {
        doDates: ["2026-09-14"],
        deadline: "2026-09-14",
        calendarLinks: [eventLink(meeting)],
      }),
      task("work", { doDates: ["2026-09-14"] }),
    ];
    expect(
      taskEntriesOnDay(tasks, [meeting], "2026-09-14").map(
        ({ task, work, deadline }) => [task.id, work, deadline],
      ),
    ).toEqual([
      ["due", false, true],
      ["work", true, false],
    ]);
    expect(taskEntriesOnDay(tasks, [], "2026-09-14")).toHaveLength(3);
  });
});
