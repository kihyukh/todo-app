import { useCallback, useEffect, useRef, useState } from "react";
import { isNative, nativeSend } from "./storage";
import { dateKey, uid } from "./model";
import { calendarRange, eventKey } from "./calendar-model";
import type {
  CalendarEvent,
  CalendarRange,
  CalendarSaveInput,
  CalendarSource,
} from "./calendar-model";

export type CalendarStatus =
  | "notDetermined"
  | "authorized"
  | "denied"
  | "restricted"
  | "writeOnly"
  | "unavailable";
type NativeResponse = {
  type: string;
  requestId?: string;
  message?: string;
  status?: CalendarStatus;
  calendars?: CalendarSource[];
  defaultCalendarId?: string;
  events?: CalendarEvent[];
  event?: CalendarEvent;
};
const PREFERENCES = "daymark.calendar-selection.v1";

/** Calendar failures remain separate from workspace saving and synchronization. */
export function calendarRequest(
  message: Record<string, unknown>,
): Promise<NativeResponse> {
  if (!isNative())
    return Promise.reject(
      new Error("Connect calendars in the Mac or iPhone app."),
    );
  const requestId = `calendar:${uid()}`;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener("daymark-native-message", receive);
    };
    const receive = (event: Event) => {
      const response = (event as CustomEvent<NativeResponse>).detail;
      if (response?.requestId !== requestId) return;
      cleanup();
      if (response.type === "error")
        reject(new Error(response.message || "Calendar request failed."));
      else resolve(response);
    };
    const timeout = setTimeout(
      () => {
        cleanup();
        reject(
          new Error(
            "Calendar access is taking longer than expected. Please try again.",
          ),
        );
      },
      message.action === "calendarConnect" ? 120000 : 30000,
    );
    window.addEventListener("daymark-native-message", receive);
    try {
      nativeSend({ ...message, requestId });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
function savedSelection(): string[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(PREFERENCES) ?? "null");
    return Array.isArray(value) && value.every((id) => typeof id === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}
export type CalendarsAPI = {
  native: boolean;
  status: CalendarStatus;
  calendars: CalendarSource[];
  events: CalendarEvent[];
  selectedCalendarIds: string[];
  defaultCalendarId: string;
  loading: boolean;
  connecting: boolean;
  error: string;
  range: CalendarRange;
  setRange: (range: CalendarRange) => void;
  setSelectedCalendarIds: (ids: string[]) => void;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
  requestEvents: (range: CalendarRange) => Promise<CalendarEvent[]>;
  saveEvent: (event: CalendarSaveInput) => Promise<CalendarEvent>;
  deleteEvent: (event: CalendarEvent) => Promise<void>;
  clearError: () => void;
};
export function useCalendars(): CalendarsAPI {
  const native = isNative();
  const [status, setStatus] = useState<CalendarStatus>(
    native ? "notDetermined" : "unavailable",
  );
  const [calendars, setCalendars] = useState<CalendarSource[]>([]);
  const preference = useRef(savedSelection());
  const [selectedCalendarIds, setSelection] = useState<string[]>(
    preference.current ?? [],
  );
  const [defaultCalendarId, setDefault] = useState("");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [range, changeRange] = useState<CalendarRange>(() =>
    calendarRange(dateKey(), "month"),
  );
  const [loading, setLoading] = useState(false),
    [connecting, setConnecting] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    readSequence = useRef(0),
    statusSequence = useRef(0);
  const selectedRef = useRef(selectedCalendarIds),
    rangeRef = useRef(range),
    statusRef = useRef(status);
  selectedRef.current = selectedCalendarIds;
  rangeRef.current = range;
  statusRef.current = status;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      readSequence.current++;
      statusSequence.current++;
    };
  }, []);
  const acceptStatus = useCallback((response: NativeResponse) => {
    const available = response.calendars ?? [];
    statusRef.current = response.status ?? "unavailable";
    setStatus(response.status ?? "unavailable");
    setCalendars(available);
    setDefault(
      response.defaultCalendarId ??
        available.find((calendar) => calendar.writable)?.id ??
        "",
    );
    // Preserve unknown IDs while permission is denied; they may return later.
    if (response.status === "authorized") {
      const ids =
        preference.current ?? available.map((calendar) => calendar.id);
      setSelection(
        ids.filter((id) => available.some((calendar) => calendar.id === id)),
      );
    } else {
      readSequence.current++;
      setLoading(false);
      setEvents([]);
    }
  }, []);
  const readStatus = useCallback(
    async (connect = false) => {
      if (!native) return;
      const sequence = ++statusSequence.current;
      if (connect) setConnecting(true);
      try {
        const response = await calendarRequest({
          action: connect ? "calendarConnect" : "calendarStatus",
        });
        if (alive.current && sequence === statusSequence.current) {
          acceptStatus(response);
          setError("");
        }
      } catch (error) {
        if (alive.current && sequence === statusSequence.current)
          setError(
            error instanceof Error
              ? error.message
              : "Could not open calendars.",
          );
      } finally {
        if (alive.current && sequence === statusSequence.current)
          setConnecting(false);
      }
    },
    [native, acceptStatus],
  );
  const requestEvents = useCallback(async (requested: CalendarRange) => {
    if (statusRef.current !== "authorized" || !selectedRef.current.length)
      return [];
    const response = await calendarRequest({
      action: "calendarEvents",
      ...requested,
      calendarIds: selectedRef.current,
    });
    return response.events ?? [];
  }, []);
  const refresh = useCallback(async () => {
    if (statusRef.current !== "authorized") return;
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const loaded = await requestEvents(rangeRef.current);
      if (alive.current && sequence === readSequence.current) {
        setEvents([
          ...new Map(loaded.map((event) => [eventKey(event), event])).values(),
        ]);
        setError("");
      }
    } catch (error) {
      if (alive.current && sequence === readSequence.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not refresh calendars.",
        );
    } finally {
      if (alive.current && sequence === readSequence.current) setLoading(false);
    }
  }, [requestEvents]);
  useEffect(() => {
    void readStatus();
  }, [readStatus]);
  useEffect(() => {
    void refresh();
  }, [status, selectedCalendarIds, range, refresh]);
  useEffect(() => {
    if (!native) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const changed = (event: Event) => {
      if (
        (event as CustomEvent<NativeResponse>).detail?.type !==
        "calendarChanged"
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void readStatus();
        void refresh();
      }, 250);
    };
    const foreground = () => {
      if (document.visibilityState !== "hidden") {
        void readStatus();
        void refresh();
      }
    };
    window.addEventListener("daymark-native-message", changed);
    window.addEventListener("focus", foreground);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("daymark-native-message", changed);
      window.removeEventListener("focus", foreground);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [native, readStatus, refresh]);
  const setRange = useCallback(
    (next: CalendarRange) =>
      changeRange((previous) =>
        previous.start === next.start && previous.end === next.end
          ? previous
          : next,
      ),
    [],
  );
  const selectCalendars = useCallback((ids: string[]) => {
    const next = [...new Set(ids)];
    preference.current = next;
    selectedRef.current = next;
    setSelection(next);
    try {
      localStorage.setItem(PREFERENCES, JSON.stringify(next));
    } catch {
      /* Device preference only. */
    }
  }, []);
  const saveEvent = useCallback(
    async (event: CalendarSaveInput) => {
      const response = await calendarRequest({ action: "calendarSave", event });
      if (!response.event)
        throw new Error("The calendar did not return the saved event.");
      const saved = response.event;
      readSequence.current++;
      if (alive.current && statusRef.current === "authorized")
        setEvents((previous) => [
          ...previous.filter((candidate) => {
            if (eventKey(candidate) === eventKey(saved)) return false;
            const sameOriginal =
              !!event.id &&
              candidate.calendarId ===
                (event.lookupCalendarId ?? event.calendarId) &&
              (candidate.id === event.id ||
                (!!event.externalId &&
                  candidate.externalId === event.externalId)) &&
              (candidate.occurrenceDate || null) ===
                (event.occurrenceDate || null);
            return !sameOriginal;
          }),
          saved,
        ]);
      await refresh();
      return saved;
    },
    [refresh],
  );
  const deleteEvent = useCallback(
    async (event: CalendarEvent) => {
      await calendarRequest({
        action: "calendarDelete",
        id: event.id,
        externalId: event.externalId,
        occurrenceDate: event.occurrenceDate,
        lookupStart: event.start,
        calendarId: event.calendarId,
      });
      readSequence.current++;
      if (alive.current)
        setEvents((previous) =>
          previous.filter(
            (candidate) => eventKey(candidate) !== eventKey(event),
          ),
        );
      await refresh();
    },
    [refresh],
  );
  return {
    native,
    status,
    calendars,
    events,
    selectedCalendarIds,
    defaultCalendarId,
    loading,
    connecting,
    error,
    range,
    setRange,
    setSelectedCalendarIds: selectCalendars,
    connect: () => readStatus(true),
    refresh,
    requestEvents,
    saveEvent,
    deleteEvent,
    clearError: () => setError(""),
  };
}
