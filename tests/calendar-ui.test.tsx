// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import CalendarWorkspace, {
  CalendarSettings,
  TaskCalendarLinks,
} from "../src/CalendarWorkspace";
import { eventLink } from "../src/calendar-model";
import { api, event, task } from "./calendar-fixtures";
let root: Root | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-14T00:00:00Z"));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  delete window.__DAYMARK_PLATFORM__;
});
async function render(element: React.ReactNode) {
  if (!root) {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  await act(async () => root!.render(element));
}
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) =>
      button.getAttribute("aria-label") === name ||
      button.textContent?.trim() === name,
  )!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function click(element: HTMLElement) {
  expect(element).not.toBeNull();
  await act(async () => element.click());
}
async function submit() {
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
}
async function enter(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
describe("all-day event dates", () => {
  it.each([
    ["single-day", "2026-09-14", "2026-09-15"],
    ["multiple-day", "2026-09-16", "2026-09-17"],
  ])(
    "creates a %s event using an inclusive final day",
    async (_, finalDay, exclusiveEnd) => {
      vi.stubEnv("TZ", "Asia/Seoul");
      const saveEvent = vi.fn(async () => event());
      await render(
        <TaskCalendarLinks
          task={task("paper")}
          api={api({ saveEvent })}
          onUpdateTask={vi.fn()}
        />,
      );
      await click(button("Link event"));
      await click(button("Schedule work session"));
      await click(
        dialog()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
      );
      const [startInput, endInput] =
        dialog()!.querySelectorAll<HTMLInputElement>('input[type="date"]');
      expect(startInput.value).toBe("2026-09-14");
      expect(endInput.value).toBe("2026-09-14");
      expect(endInput.closest("label")?.textContent?.trim()).toBe("Ends");
      if (finalDay !== endInput.value) await enter(endInput, finalDay);
      await submit();
      expect(saveEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          allDay: true,
          start: new Date("2026-09-14T00:00:00").toISOString(),
          end: new Date(`${exclusiveEnd}T00:00:00`).toISOString(),
        }),
      );
    },
  );
  it.each([
    ["single-day", "2026-09-14", "2026-09-15"],
    ["multiple-day", "2026-09-16", "2026-09-17"],
  ])(
    "edits a %s event without extending its exclusive native end",
    async (_, finalDay, exclusiveEnd) => {
      vi.stubEnv("TZ", "Asia/Seoul");
      const meeting = event({
        allDay: true,
        start: "2026-09-14T00:00:00+09:00",
        end: `${exclusiveEnd}T00:00:00+09:00`,
      });
      const saveEvent = vi.fn(async () => meeting);
      await render(
        <CalendarWorkspace
          tasks={[]}
          api={api({ events: [meeting], saveEvent })}
          onOpenTask={vi.fn()}
          onUpdateTask={vi.fn()}
        />,
      );
      await click(button("Day"));
      await click(document.querySelector<HTMLElement>(".calendar-event-chip")!);
      await click(button("Edit event"));
      const [startInput, endInput] =
        dialog()!.querySelectorAll<HTMLInputElement>('input[type="date"]');
      expect(startInput.value).toBe("2026-09-14");
      expect(endInput.value).toBe(finalDay);
      await submit();
      expect(saveEvent).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          allDay: true,
          start: new Date(meeting.start).toISOString(),
          end: new Date(meeting.end).toISOString(),
        }),
      );
    },
  );
});
describe("calendar workspace", () => {
  it("bounds month events and tasks together, retains a deadline, and opens every remaining item", async () => {
    const events = Array.from({ length: 4 }, (_, index) =>
      event({
        id: `event-${index}`,
        externalId: `external-${index}`,
        title: `Meeting ${index}`,
      }),
    );
    const tasks = [
      ...Array.from({ length: 4 }, (_, index) =>
        task(`work-${index}`, { doDates: ["2026-09-14"] }),
      ),
      task("deadline", { deadline: "2026-09-14" }),
    ];
    const onOpenTask = vi.fn(),
      onUpdateTask = vi.fn();
    await render(
      <CalendarWorkspace
        tasks={tasks}
        api={api({ events })}
        onOpenTask={onOpenTask}
        onUpdateTask={onUpdateTask}
      />,
    );
    await click(button("Month"));
    const cell = document
      .querySelector(".calendar-day-number.is-today")!
      .closest(".calendar-month-day")!;
    expect(cell.querySelectorAll(".calendar-event-chip")).toHaveLength(2);
    expect(cell.querySelectorAll(".calendar-task-chip")).toHaveLength(1);
    expect(cell.querySelector(".calendar-task-chip")?.textContent).toContain(
      "Task deadline",
    );
    const more = cell.querySelector<HTMLButtonElement>(".calendar-more")!;
    expect(more.textContent).toBe("+6 more");
    expect(more.getAttribute("aria-label")).toMatch(/^Show 6 more items on /);
    await click(more);
    expect(button("Day").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll(".calendar-event-chip")).toHaveLength(4);
    expect(document.querySelectorAll(".calendar-task-chip")).toHaveLength(5);
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(onUpdateTask).not.toHaveBeenCalled();
  });
  it("also limits task-only month cells instead of allowing an unbounded task list", async () => {
    const tasks = Array.from({ length: 5 }, (_, index) =>
      task(`work-${index}`, { doDates: ["2026-09-14"] }),
    );
    await render(
      <CalendarWorkspace
        tasks={tasks}
        api={api()}
        onOpenTask={vi.fn()}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(button("Month"));
    const cell = document
      .querySelector(".calendar-day-number.is-today")!
      .closest(".calendar-month-day")!;
    expect(cell.querySelectorAll(".calendar-task-chip")).toHaveLength(3);
    expect(cell.querySelector(".calendar-more")?.textContent).toBe("+2 more");
    await click(cell.querySelector<HTMLButtonElement>(".calendar-more")!);
    expect(document.querySelectorAll(".calendar-task-chip")).toHaveLength(5);
  });
  it("reduces the month item budget as the calendar narrows and keeps an accurate overflow count", async () => {
    let resize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const events = Array.from({ length: 3 }, (_, index) =>
      event({ id: `event-${index}` }),
    );
    const tasks = [
      task("work", { doDates: ["2026-09-14"] }),
      task("due", { deadline: "2026-09-14" }),
    ];
    await render(
      <CalendarWorkspace
        tasks={tasks}
        api={api({ events })}
        onOpenTask={vi.fn()}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(button("Month"));
    const cell = document
      .querySelector(".calendar-day-number.is-today")!
      .closest(".calendar-month-day")!;
    await act(async () =>
      resize(
        [{ contentRect: { width: 420 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    );
    expect(cell.querySelectorAll(".calendar-event-chip")).toHaveLength(1);
    expect(cell.querySelectorAll(".calendar-task-chip")).toHaveLength(1);
    expect(cell.querySelector(".calendar-task-chip")?.textContent).toContain(
      "Task due",
    );
    expect(cell.querySelector(".calendar-more")?.textContent).toBe("+3 more");
    await act(async () =>
      resize(
        [{ contentRect: { width: 960 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      ),
    );
    expect(cell.querySelectorAll(".calendar-event-chip")).toHaveLength(2);
    expect(cell.querySelector(".calendar-more")?.textContent).toBe("+2 more");
    await act(async () => root!.unmount());
    root = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
  });
  it.each(["Month", "Week", "Day"])(
    "keeps the linked-task count readable by assistive technology in %s view",
    async (view) => {
      const meeting = event(),
        unrelated = event({ id: "unrelated", externalId: "unrelated" });
      const tasks = [
        task("first", { calendarLinks: [eventLink(meeting)] }),
        task("second", { calendarLinks: [eventLink(meeting)] }),
      ];
      await render(
        <CalendarWorkspace
          tasks={tasks}
          api={api({ events: [meeting, unrelated] })}
          onOpenTask={vi.fn()}
          onUpdateTask={vi.fn()}
        />,
      );
      await click(button(view));
      const badges = document.querySelectorAll(".calendar-link-count");
      expect(badges).toHaveLength(1);
      expect(badges[0].getAttribute("role")).toBe("img");
      expect(badges[0].getAttribute("aria-label")).toBe("2 linked tasks");
      expect(badges[0].textContent).toBe("2");
      expect(badges[0].querySelector("svg")?.getAttribute("aria-hidden")).toBe(
        "true",
      );
      await click(badges[0].closest<HTMLButtonElement>("button")!);
      expect(dialog()?.textContent).toContain("Task first");
      expect(dialog()?.textContent).toContain("Task second");
    },
  );
  it("shows real task work days and deadlines in browser preview without invented events", async () => {
    const onOpenTask = vi.fn();
    await render(
      <CalendarWorkspace
        tasks={[
          task("work", { doDates: ["2026-09-14"] }),
          task("due", { deadline: "2026-09-14" }),
        ]}
        api={api({
          native: false,
          status: "unavailable",
          calendars: [],
          selectedCalendarIds: [],
        })}
        onOpenTask={onOpenTask}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(button("Day"));
    expect(document.body.textContent).toContain("Open the Mac or iPhone app");
    expect(button("Connect calendars")).toBeUndefined();
    expect(document.querySelectorAll(".calendar-event-chip")).toHaveLength(0);
    expect(document.querySelectorAll(".calendar-task-chip")).toHaveLength(2);
    await click(document.querySelector<HTMLElement>(".calendar-task-chip")!);
    expect(onOpenTask).toHaveBeenCalledWith("work");
  });
  it("opens the compact event badge into linked tasks and unlinks without deleting a task", async () => {
    const meeting = event(),
      onUpdateTask = vi.fn(),
      onOpenTask = vi.fn();
    const tasks = [
      task("paper", {
        calendarLinks: [eventLink(meeting)],
        doDates: ["2026-09-14"],
        deadline: "2026-09-14",
      }),
      task("done", {
        calendarLinks: [eventLink(meeting)],
        completedAt: "2026-09-14",
      }),
    ];
    await render(
      <CalendarWorkspace
        tasks={tasks}
        api={api({ events: [meeting] })}
        onOpenTask={onOpenTask}
        onUpdateTask={onUpdateTask}
      />,
    );
    await click(button("Day"));
    expect(
      document.querySelector('[aria-label="2 linked tasks"]'),
    ).not.toBeNull();
    expect(document.querySelectorAll(".calendar-task-chip")).toHaveLength(1);
    expect(
      document.querySelector(".calendar-task-chip")?.textContent,
    ).toContain("Due");
    await click(document.querySelector<HTMLElement>(".calendar-event-chip")!);
    expect(dialog()?.textContent).toContain("Task paper");
    expect(dialog()?.textContent).toContain("Completed");
    await click(button("Unlink Task paper"));
    expect(onUpdateTask).toHaveBeenCalledWith("paper", { calendarLinks: [] });
  });
  it("keeps event copies in different calendars visible", async () => {
    const meeting = event(),
      other = event({ id: "copy", calendarId: "personal" });
    await render(
      <CalendarWorkspace
        tasks={[]}
        api={api({
          events: [meeting, other],
          selectedCalendarIds: ["work", "personal"],
        })}
        onOpenTask={vi.fn()}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(button("Day"));
    expect(document.querySelectorAll(".calendar-event-chip")).toHaveLength(2);
  });
  it("explains recurrence scope and requires explicit deletion confirmation", async () => {
    const meeting = event({
        isRecurring: true,
        occurrenceDate: "2026-09-14T00:00:00Z",
      }),
      deleteEvent = vi.fn(async () => {});
    await render(
      <CalendarWorkspace
        tasks={[]}
        api={api({ events: [meeting], deleteEvent })}
        onOpenTask={vi.fn()}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(button("Day"));
    await click(document.querySelector<HTMLElement>(".calendar-event-chip")!);
    await click(button("Delete"));
    expect(deleteEvent).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain("this occurrence");
    await click(button("Delete occurrence"));
    expect(deleteEvent).toHaveBeenCalledExactlyOnceWith(meeting);
    expect(dialog()).toBeNull();
  });
  it("sends original identity when editing a recurring event", async () => {
    const meeting = event({
        isRecurring: true,
        occurrenceDate: "2026-09-14T00:00:00Z",
      }),
      saveEvent = vi.fn(async () => meeting);
    await render(
      <CalendarWorkspace
        tasks={[]}
        api={api({ events: [meeting], saveEvent })}
        onOpenTask={vi.fn()}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(button("Day"));
    await click(document.querySelector<HTMLElement>(".calendar-event-chip")!);
    await click(button("Edit event"));
    expect(dialog()?.textContent).toContain(
      "Changes apply to this occurrence only",
    );
    await submit();
    expect(saveEvent).toHaveBeenCalledOnce();
    expect(saveEvent.mock.calls[0][0]).toMatchObject({
      id: meeting.id,
      externalId: meeting.externalId,
      occurrenceDate: meeting.occurrenceDate,
      lookupStart: meeting.start,
      lookupCalendarId: meeting.calendarId,
      title: meeting.title,
      notes: meeting.notes,
    });
  });
});
describe("task event links", () => {
  it("upgrades a saved-details dialog after a delayed lookup returns the live event outside the current view", async () => {
    const meeting = event();
    let resolve!: (events: ReturnType<typeof event>[]) => void;
    const requestEvents = vi.fn(
      () =>
        new Promise<ReturnType<typeof event>[]>((done) => {
          resolve = done;
        }),
    );
    await render(
      <TaskCalendarLinks
        task={task("paper", { calendarLinks: [eventLink(meeting)] })}
        api={api({ requestEvents })}
        onUpdateTask={vi.fn()}
      />,
    );
    await click(
      document.querySelector<HTMLElement>(".task-calendar-link > button")!,
    );
    expect(dialog()?.textContent).toContain("Saved event details");
    await act(async () => resolve([{ ...meeting, title: "Live event title" }]));
    expect(dialog()?.textContent).toContain("Live event title");
    expect(dialog()?.textContent).not.toContain("Saved event details");
    expect(button("Edit event")).toBeDefined();
  });
  it("keeps a cached all-day event on its floating date after changing device time zones", async () => {
    vi.stubEnv("TZ", "Asia/Seoul");
    const link = eventLink(
      event({
        allDay: true,
        start: "2026-09-13T15:00:00Z",
        end: "2026-09-14T15:00:00Z",
      }),
    );
    vi.stubEnv("TZ", "America/Los_Angeles");
    await render(
      <TaskCalendarLinks
        task={task("paper", { calendarLinks: [link] })}
        api={api({ status: "denied" })}
        onUpdateTask={vi.fn()}
      />,
    );
    expect(
      document.querySelector(".task-calendar-link")?.textContent,
    ).toContain("Sep 14");
  });
  it("keeps an empty property to one row and shows live event metadata without rewriting tasks", async () => {
    const onUpdateTask = vi.fn(),
      meeting = event();
    await render(
      <TaskCalendarLinks
        task={task("paper")}
        api={api()}
        onUpdateTask={onUpdateTask}
      />,
    );
    expect(document.querySelector(".task-calendar-links > p")).toBeNull();
    expect(
      document.querySelectorAll(".task-calendar-links button"),
    ).toHaveLength(1);
    await render(
      <TaskCalendarLinks
        task={task("paper", { calendarLinks: [eventLink(meeting)] })}
        api={api({ events: [{ ...meeting, title: "Updated in Calendar" }] })}
        onUpdateTask={onUpdateTask}
      />,
    );
    expect(
      document.querySelector(".task-calendar-link")?.textContent,
    ).toContain("Updated in Calendar");
    expect(
      document.querySelector(".task-calendar-link")?.textContent,
    ).not.toContain("Saved details");
    expect(onUpdateTask).not.toHaveBeenCalled();
  });
  it("keeps saved metadata when a calendar is unavailable and does not offer destructive event edits", async () => {
    const original = task("paper", { calendarLinks: [eventLink(event())] }),
      onUpdateTask = vi.fn();
    await render(
      <TaskCalendarLinks
        task={original}
        api={api({ status: "denied" })}
        onUpdateTask={onUpdateTask}
      />,
    );
    expect(
      document.querySelector(".task-calendar-link")?.textContent,
    ).toContain("Saved details");
    await click(
      document.querySelector<HTMLElement>(".task-calendar-link > button")!,
    );
    expect(dialog()?.textContent).toContain("Saved event details");
    expect(button("Edit event")).toBeUndefined();
    expect(button("Delete")).toBeUndefined();
    expect(onUpdateTask).not.toHaveBeenCalled();
  });
  it("links a picked event without changing work dates or copying task notes into the event", async () => {
    const meeting = event(),
      onUpdateTask = vi.fn(),
      saveEvent = vi.fn(async () => meeting);
    const original = task("paper", {
      doDates: ["2026-09-18"],
      deadline: "2026-10-01",
    });
    await render(
      <TaskCalendarLinks
        task={original}
        api={api({ requestEvents: async () => [meeting], saveEvent })}
        onUpdateTask={onUpdateTask}
      />,
    );
    await click(button("Link event"));
    await click(
      document.querySelector<HTMLElement>(
        ".calendar-event-picker-list button",
      )!,
    );
    expect(onUpdateTask).toHaveBeenCalledExactlyOnceWith("paper", {
      calendarLinks: [eventLink(meeting)],
    });
    expect(saveEvent).not.toHaveBeenCalled();
  });
  it("creates a work session only on Create event, uses the task title, and preserves links arriving during saving", async () => {
    const meeting = event(),
      other = event({ id: "other", externalId: "other" });
    let finish!: (
      event: ReturnType<typeof import("./calendar-fixtures").event>,
    ) => void;
    const saveEvent = vi.fn(
      () =>
        new Promise<ReturnType<typeof event>>((resolve) => {
          finish = resolve;
        }),
    );
    const onUpdateTask = vi.fn();
    const original = task("paper", {
      notes: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Private synthetic note" }],
          },
        ],
      },
    });
    const calendar = api({ saveEvent });
    await render(
      <TaskCalendarLinks
        task={original}
        api={calendar}
        onUpdateTask={onUpdateTask}
      />,
    );
    await click(button("Link event"));
    await click(button("Schedule work session"));
    expect(saveEvent).not.toHaveBeenCalled();
    expect((document.querySelector("input") as HTMLInputElement).value).toBe(
      original.title,
    );
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("");
    await submit();
    expect(saveEvent).toHaveBeenCalledOnce();
    await render(
      <TaskCalendarLinks
        task={{ ...original, calendarLinks: [eventLink(other)] }}
        api={calendar}
        onUpdateTask={onUpdateTask}
      />,
    );
    await act(async () => finish(meeting));
    expect(onUpdateTask).toHaveBeenCalledExactlyOnceWith("paper", {
      calendarLinks: [eventLink(other), eventLink(meeting)],
    });
  });
  it("lets the user change selected calendars and explains Google account connection", async () => {
    const setSelectedCalendarIds = vi.fn();
    await render(<CalendarSettings api={api({ setSelectedCalendarIds })} />);
    expect(document.body.textContent).toContain("Google");
    await click(
      document.querySelector<HTMLInputElement>('input[type="checkbox"]')!,
    );
    expect(setSelectedCalendarIds).toHaveBeenCalledWith([]);
  });
});
