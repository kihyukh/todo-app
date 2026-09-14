import type { CalendarEvent } from "../src/calendar-model";
import type { CalendarsAPI } from "../src/calendar-client";
import { emptyDoc } from "../src/model";
import type { Task } from "../src/model";

export const event = (
  overrides: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id: "local-event",
  externalId: "shared-event",
  occurrenceDate: null,
  calendarId: "work",
  title: "Design discussion",
  start: "2026-09-14T09:00:00+09:00",
  end: "2026-09-14T10:00:00+09:00",
  allDay: false,
  location: "Room A",
  notes: "Synthetic fixture",
  url: "",
  calendarTitle: "Work",
  calendarColor: "#2f805e",
  isRecurring: false,
  writable: true,
  ...overrides,
});
export const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  notes: emptyDoc(),
  projectId: "",
  columnId: "next",
  doDate: null,
  deadline: null,
  completedAt: null,
  deletedAt: null,
  createdAt: "2026-09-14T00:00:00Z",
  updatedAt: "2026-09-14T00:00:00Z",
  attachments: [],
  ...overrides,
});
export const api = (overrides: Partial<CalendarsAPI> = {}): CalendarsAPI => ({
  native: true,
  status: "authorized",
  calendars: [
    {
      id: "work",
      title: "Work",
      color: "#2f805e",
      source: "iCloud",
      writable: true,
    },
  ],
  events: [],
  selectedCalendarIds: ["work"],
  defaultCalendarId: "work",
  loading: false,
  connecting: false,
  error: "",
  range: { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" },
  setRange: () => {},
  setSelectedCalendarIds: () => {},
  connect: async () => {},
  refresh: async () => {},
  requestEvents: async () => [],
  saveEvent: async () => event(),
  deleteEvent: async () => {},
  clearError: () => {},
  ...overrides,
});
