import { dateKey, workDates } from "./model";
import type { Task } from "./model";

export type CalendarSource = {
  id: string;
  title: string;
  color: string;
  source: string;
  writable: boolean;
};
export type CalendarEvent = {
  id: string;
  externalId: string | null;
  /** Original occurrence timestamp, not its possibly edited start time. */
  occurrenceDate: string | null;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  notes: string;
  url: string;
  calendarTitle: string;
  calendarColor: string;
  isRecurring: boolean;
  writable: boolean;
  cached?: boolean;
  occurrenceDay?: string;
};
/** Cache enough to keep a link understandable when its calendar is unavailable. */
export type CalendarEventLink = {
  eventId: string;
  externalId: string | null;
  occurrenceDate: string | null;
  /** Floating all-day recurrence identity survives a device time-zone change. */
  occurrenceDay?: string;
  startDay?: string;
  endDay?: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarTitle: string;
  calendarColor: string;
};
export type CalendarView = "month" | "week" | "day";
export type CalendarRange = { start: string; end: string };
export type CalendarSaveInput = {
  id?: string;
  externalId?: string | null;
  occurrenceDate?: string | null;
  lookupStart?: string;
  lookupCalendarId?: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  url?: string;
};

export const localDay = (value: string) => new Date(`${value}T00:00:00`);
export function shiftDay(value: string, count: number): string {
  const date = localDay(value);
  date.setDate(date.getDate() + count);
  return dateKey(date);
}
export function calendarRange(date: string, view: CalendarView): CalendarRange {
  const start = localDay(date);
  if (view === "month") start.setDate(1);
  if (view !== "day")
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(
    end.getDate() + (view === "month" ? 42 : view === "week" ? 7 : 1),
  );
  return { start: start.toISOString(), end: end.toISOString() };
}
export function rangeDays(range: CalendarRange): string[] {
  const days: string[] = [];
  const date = new Date(range.start);
  const end = new Date(range.end).getTime();
  while (date.getTime() < end && days.length < 370) {
    days.push(dateKey(date));
    date.setDate(date.getDate() + 1);
  }
  return days;
}
export function eventKey(
  event: Pick<CalendarEvent, "id" | "calendarId" | "occurrenceDate">,
): string {
  return JSON.stringify([
    event.calendarId,
    event.id,
    event.occurrenceDate || null,
  ]);
}
export function linkMatchesEvent(
  link: CalendarEventLink,
  event: CalendarEvent,
): boolean {
  const sameOccurrence =
    link.allDay && event.allDay && link.occurrenceDay && event.occurrenceDate
      ? link.occurrenceDay ===
        (event.cached && event.occurrenceDay
          ? event.occurrenceDay
          : dateKey(new Date(event.occurrenceDate)))
      : (link.occurrenceDate || null) === (event.occurrenceDate || null);
  if (!sameOccurrence) return false;
  return link.externalId && event.externalId
    ? link.externalId === event.externalId
    : link.eventId === event.id;
}
export function eventLink(event: CalendarEvent): CalendarEventLink {
  const {
    externalId,
    occurrenceDate,
    calendarId,
    title,
    start,
    end,
    allDay,
    calendarTitle,
    calendarColor,
  } = event;
  return {
    eventId: event.id,
    externalId,
    occurrenceDate,
    ...(allDay && occurrenceDate
      ? {
          occurrenceDay:
            event.cached && event.occurrenceDay
              ? event.occurrenceDay
              : dateKey(new Date(occurrenceDate)),
        }
      : {}),
    ...(allDay
      ? { startDay: dateKey(new Date(start)), endDay: dateKey(new Date(end)) }
      : {}),
    calendarId,
    title,
    start,
    end,
    allDay,
    calendarTitle,
    calendarColor,
  };
}
export function findLinkedEvent(
  events: CalendarEvent[],
  link: CalendarEventLink,
): CalendarEvent | undefined {
  return (
    events.find(
      (event) =>
        event.calendarId === link.calendarId && linkMatchesEvent(link, event),
    ) ?? events.find((event) => linkMatchesEvent(link, event))
  );
}
export function addEventLink(
  task: Task,
  event: CalendarEvent,
): CalendarEventLink[] {
  return [
    ...(task.calendarLinks ?? []).filter(
      (link) => !linkMatchesEvent(link, event),
    ),
    eventLink(event),
  ];
}
export function removeEventLink(
  task: Task,
  link: CalendarEventLink,
): CalendarEventLink[] {
  return (task.calendarLinks ?? []).filter(
    (candidate) =>
      !(
        (candidate.externalId && link.externalId
          ? candidate.externalId === link.externalId
          : candidate.eventId === link.eventId) &&
        (candidate.allDay &&
        link.allDay &&
        candidate.occurrenceDay &&
        link.occurrenceDay
          ? candidate.occurrenceDay === link.occurrenceDay
          : (candidate.occurrenceDate || null) ===
            (link.occurrenceDate || null))
      ),
  );
}
export function linkedTasks(tasks: Task[], event: CalendarEvent): Task[] {
  return tasks.filter(
    (task) =>
      !task.deletedAt &&
      (task.calendarLinks ?? []).some((link) => linkMatchesEvent(link, event)),
  );
}
/** EventKit end is exclusive, including midnight at the end of all-day events. */
export function eventOnDay(
  event: Pick<CalendarEvent, "start" | "end">,
  day: string,
): boolean {
  const start = localDay(day).getTime();
  const end = localDay(shiftDay(day, 1)).getTime();
  const eventStart = Date.parse(event.start),
    eventEnd = Date.parse(event.end);
  return eventStart < end && Math.max(eventStart + 1, eventEnd) > start;
}
export function eventsOnDay(
  events: CalendarEvent[],
  day: string,
): CalendarEvent[] {
  return events
    .filter((event) => eventOnDay(event, day))
    .sort(
      (a, b) =>
        Number(b.allDay) - Number(a.allDay) ||
        Date.parse(a.start) - Date.parse(b.start) ||
        a.title.localeCompare(b.title),
    );
}
export type TaskCalendarEntry = {
  task: Task;
  work: boolean;
  deadline: boolean;
};
export function taskEntriesOnDay(
  tasks: Task[],
  events: CalendarEvent[],
  day: string,
): TaskCalendarEntry[] {
  return tasks
    .filter((task) => !task.deletedAt && !task.completedAt)
    .flatMap((task) => {
      const deadline = task.deadline === day;
      const work = workDates(task).includes(day);
      const represented = events.some(
        (event) =>
          eventOnDay(event, day) &&
          (task.calendarLinks ?? []).some((link) =>
            linkMatchesEvent(link, event),
          ),
      );
      return deadline || (work && !represented)
        ? [{ task, work: work && !represented, deadline }]
        : [];
    });
}
export type PositionedEvent = {
  event: CalendarEvent;
  top: number;
  height: number;
  column: number;
  columns: number;
};
/** Partition visible event boxes, including short events and repeated DST hours. */
export function positionEvents(
  events: CalendarEvent[],
  day: string,
): PositionedEvent[] {
  const dayStart = localDay(day).getTime(),
    dayEnd = localDay(shiftDay(day, 1)).getTime();
  const sorted = eventsOnDay(events, day)
    .filter((event) => !event.allDay)
    .map((event) => {
      const start = Math.max(Date.parse(event.start), dayStart);
      const end = Math.min(
        Math.max(Date.parse(event.end), start + 60000),
        dayEnd,
      );
      const startDate = new Date(start),
        endDate = new Date(end);
      const top = startDate.getHours() * 60 + startDate.getMinutes();
      const bottom =
        end === dayEnd ? 1440 : endDate.getHours() * 60 + endDate.getMinutes();
      return {
        event,
        top,
        height: Math.min(
          1440 - top,
          Math.max(20, bottom - top, (end - start) / 60000),
        ),
      };
    })
    .sort(
      (a, b) =>
        a.top - b.top || Date.parse(a.event.start) - Date.parse(b.event.start),
    );
  const result: PositionedEvent[] = [];
  let group: PositionedEvent[] = [],
    ends: number[] = [],
    groupEnd = -Infinity;
  const finish = () => {
    for (const item of group) item.columns = ends.length;
    group = [];
    ends = [];
  };
  for (const { event, top, height } of sorted) {
    const start = top,
      end = top + height;
    if (start >= groupEnd) {
      finish();
      groupEnd = -Infinity;
    }
    let column = ends.findIndex((value) => value <= start);
    if (column < 0) column = ends.length;
    ends[column] = end;
    groupEnd = Math.max(groupEnd, end);
    const positioned = {
      event,
      top,
      height,
      column,
      columns: 1,
    };
    result.push(positioned);
    group.push(positioned);
  }
  finish();
  return result;
}
export function eventTime(
  event: Pick<CalendarEvent, "start" | "end" | "allDay">,
): string {
  if (event.allDay) return "All day";
  const format = (value: string) =>
    new Date(value).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return `${format(event.start)}–${format(event.end)}`;
}
export function datetimeLocal(value: string): string {
  const date = new Date(value);
  return `${dateKey(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
