import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Flag,
  Link2,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Unlink,
  X,
} from "lucide-react";
import { dateKey, nextWorkDate } from "./model";
import type { Task } from "./model";
import { usesTouchInterface } from "./platform";
import { noTextSuggestions } from "./editor-preferences";
import { openNoteLink } from "./note-links";
import {
  addEventLink,
  calendarRange,
  datetimeLocal,
  eventKey,
  eventLink,
  eventsOnDay,
  eventTime,
  findLinkedEvent,
  linkedTasks,
  linkMatchesEvent,
  localDay,
  positionEvents,
  rangeDays,
  removeEventLink,
  shiftDay,
  taskEntriesOnDay,
} from "./calendar-model";
import type {
  CalendarEvent,
  CalendarEventLink,
  CalendarView,
  TaskCalendarEntry,
} from "./calendar-model";
import type { CalendarsAPI } from "./calendar-client";
import "./calendar.css";

type UpdateTask = (id: string, patch: Partial<Task>) => void;
type CalendarProps = {
  tasks: Task[];
  api: CalendarsAPI;
  onOpenTask: (id: string) => void;
  onUpdateTask: UpdateTask;
};
const dateTitle = (date: string, short = false) =>
  localDay(date).toLocaleDateString(undefined, {
    weekday: short ? "short" : "long",
    month: short ? "short" : "long",
    day: "numeric",
  });
const monthTitle = (date: string) =>
  localDay(date).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
const colorStyle = (color: string): CSSProperties =>
  ({
    "--calendar-color": /^#[0-9a-f]{3,8}$/i.test(color)
      ? color
      : "var(--accent)",
  }) as CSSProperties;

function CalendarDialog({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current
      ?.querySelector<HTMLElement>("button, input, select")
      ?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="calendar-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className={`calendar-dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = [
              ...(panel.current?.querySelectorAll<HTMLElement>(
                "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]",
              ) ?? []),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <button
            type="button"
            aria-label="Close calendar dialog"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CalendarSettings({ api }: { api: CalendarsAPI }) {
  const authorized = api.status === "authorized";
  return (
    <div className="calendar-settings">
      <div className="calendar-connection">
        <CalendarDays size={20} />
        <div>
          <strong>
            {authorized
              ? "Connected to Apple Calendar"
              : "Your calendars, beside your tasks"}
          </strong>
          <p>
            {!api.native
              ? "Open the Mac or iPhone app to connect calendars. Your task work days and deadlines are available here."
              : authorized
                ? "iCloud, Google, and other accounts added to Apple Calendar appear here."
                : api.status === "denied" ||
                    api.status === "restricted" ||
                    api.status === "writeOnly"
                  ? "Allow full calendar access in system Settings, then reconnect."
                  : "Connect Apple Calendar to see events from iCloud, Google, and your other calendar accounts."}
          </p>
        </div>
      </div>
      {api.native && (
        <button
          type="button"
          className="calendar-primary"
          disabled={api.connecting}
          onClick={() => void api.connect()}
        >
          {api.connecting
            ? "Connecting…"
            : authorized
              ? "Refresh calendar access"
              : "Connect calendars"}
        </button>
      )}
      {authorized && (
        <fieldset className="calendar-sources">
          <legend>Show calendars</legend>
          {api.calendars.length === 0 && (
            <p>No calendars are available. Add an account in Apple Calendar.</p>
          )}
          {api.calendars.map((calendar) => (
            <label key={calendar.id}>
              <input
                type="checkbox"
                checked={api.selectedCalendarIds.includes(calendar.id)}
                onChange={(event) =>
                  api.setSelectedCalendarIds(
                    event.target.checked
                      ? [...api.selectedCalendarIds, calendar.id]
                      : api.selectedCalendarIds.filter(
                          (id) => id !== calendar.id,
                        ),
                  )
                }
              />
              <i style={{ background: calendar.color }} />
              <span>
                {calendar.title}
                <small>
                  {calendar.source}
                  {calendar.writable ? "" : " · Read only"}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {api.error && (
        <p className="calendar-error" role="alert">
          {api.error}
        </p>
      )}
    </div>
  );
}

function EventForm({
  api,
  event,
  task,
  day = dateKey(),
  onSaved,
  onClose,
}: {
  api: CalendarsAPI;
  event?: CalendarEvent;
  task?: Task;
  day?: string;
  onSaved: (event: CalendarEvent) => void;
  onClose: () => void;
}) {
  const initialStart = event?.start ?? `${day}T09:00:00`;
  const initialEnd = event?.end ?? `${day}T10:00:00`;
  const [title, setTitle] = useState(event?.title ?? task?.title ?? "");
  const [calendarId, setCalendarId] = useState(
    event?.calendarId ?? api.defaultCalendarId ?? "",
  );
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [start, setStart] = useState(datetimeLocal(initialStart));
  const [end, setEnd] = useState(
    event?.allDay
      ? `${shiftDay(dateKey(new Date(initialEnd)), -1)}T00:00`
      : datetimeLocal(initialEnd),
  );
  const [location, setLocation] = useState(event?.location ?? "");
  const [notes, setNotes] = useState(event?.notes ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const writable = api.calendars.filter((calendar) => calendar.writable);
  const savedCallback = useRef(onSaved);
  savedCallback.current = onSaved;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const startDate = new Date(
      allDay ? `${start.slice(0, 10)}T00:00:00` : start,
    );
    const endDate = new Date(allDay ? `${end.slice(0, 10)}T00:00:00` : end);
    // The form includes the final day; EventKit expects the following midnight.
    if (allDay) endDate.setDate(endDate.getDate() + 1);
    if (!title.trim()) {
      setError("Add an event title.");
      return;
    }
    if (!writable.some((calendar) => calendar.id === calendarId)) {
      setError("Choose a calendar you can edit.");
      return;
    }
    if (
      !Number.isFinite(startDate.getTime()) ||
      !Number.isFinite(endDate.getTime()) ||
      endDate <= startDate
    ) {
      setError(
        allDay
          ? "Choose an end date on or after the start date."
          : "Choose an end time after the start time.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await api.saveEvent({
        ...(event
          ? {
              id: event.id,
              externalId: event.externalId,
              occurrenceDate: event.occurrenceDate,
              lookupStart: event.start,
              lookupCalendarId: event.calendarId,
            }
          : {}),
        calendarId,
        title: title.trim(),
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        allDay,
        location,
        notes,
        url: event?.url ?? "",
      });
      savedCallback.current(saved);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save this event.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <CalendarDialog
      title={
        event ? "Edit event" : task ? "Schedule work session" : "New event"
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="calendar-event-form"
        onSubmit={(event) => void submit(event)}
      >
        {event?.isRecurring && (
          <p className="calendar-callout">
            Changes apply to this occurrence only.
          </p>
        )}
        {task && (
          <p className="calendar-form-hint">
            The new event will be linked to “{task.title}”.
          </p>
        )}
        <label>
          Title
          <input
            {...noTextSuggestions}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={300}
          />
        </label>
        <label>
          Calendar
          <select
            value={calendarId}
            onChange={(e) => setCalendarId(e.target.value)}
          >
            <option value="">Choose a calendar</option>
            {writable.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.title} · {calendar.source}
              </option>
            ))}
          </select>
        </label>
        <label className="calendar-checkbox">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
          />
          All day
        </label>
        <div className="calendar-form-dates">
          <label>
            Starts
            <input
              type={allDay ? "date" : "datetime-local"}
              value={allDay ? start.slice(0, 10) : start}
              onChange={(e) =>
                setStart(allDay ? `${e.target.value}T00:00` : e.target.value)
              }
              required
            />
          </label>
          <label>
            Ends
            <input
              type={allDay ? "date" : "datetime-local"}
              value={allDay ? end.slice(0, 10) : end}
              onChange={(e) =>
                setEnd(allDay ? `${e.target.value}T00:00` : e.target.value)
              }
              required
            />
          </label>
        </div>
        <label>
          Location
          <input
            {...noTextSuggestions}
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label>
          Notes
          <textarea
            {...noTextSuggestions}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        {error && (
          <p className="calendar-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="calendar-primary"
            disabled={busy || !writable.length}
          >
            {busy ? "Saving…" : event ? "Save changes" : "Create event"}
          </button>
        </footer>
      </form>
    </CalendarDialog>
  );
}

function EventDetails({
  event: initial,
  tasks,
  api,
  onOpenTask,
  onUpdateTask,
  onClose,
}: CalendarProps & { event: CalendarEvent; onClose: () => void }) {
  const [event, setEvent] = useState(initial);
  useEffect(() => setEvent(initial), [initial]);
  const [editing, setEditing] = useState(false),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [showPicker, setShowPicker] = useState(false),
    [error, setError] = useState("");
  const current = findLinkedEvent(api.events, eventLink(event)) ?? event;
  const linked = linkedTasks(tasks, current);
  const candidates = tasks.filter(
    (task) =>
      !task.deletedAt &&
      !task.completedAt &&
      !linked.some((item) => item.id === task.id) &&
      task.title.toLowerCase().includes(search.toLowerCase()),
  );
  if (editing)
    return (
      <EventForm
        api={api}
        event={current}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          for (const task of linked)
            onUpdateTask(task.id, {
              calendarLinks: [
                ...(task.calendarLinks ?? []).filter(
                  (link) => !linkMatchesEvent(link, current),
                ),
                eventLink(saved),
              ],
            });
          setEvent(saved);
          setEditing(false);
        }}
      />
    );
  return (
    <CalendarDialog
      title={current.title || "Untitled event"}
      onClose={() => {
        if (!busy) onClose();
      }}
      className="calendar-event-details"
    >
      <div className="calendar-event-meta">
        <i style={{ background: current.calendarColor }} />
        <span>{current.calendarTitle}</span>
      </div>
      <p className="calendar-detail-line">
        <Clock3 size={16} />
        <span>
          {dateTitle(dateKey(new Date(current.start)))}
          {dateKey(new Date(current.start)) !==
            dateKey(
              new Date(Date.parse(current.end) - (current.allDay ? 1 : 0)),
            ) &&
            ` – ${dateTitle(dateKey(new Date(Date.parse(current.end) - (current.allDay ? 1 : 0))))}`}
          <br />
          <strong>{eventTime(current)}</strong>
        </span>
      </p>
      {current.cached && (
        <p className="calendar-callout">
          Saved event details. This event is outside the loaded dates or its
          calendar is unavailable.
        </p>
      )}
      {current.location && (
        <p className="calendar-detail-line">
          <MapPin size={16} />
          {current.location}
        </p>
      )}
      {current.isRecurring && (
        <p className="calendar-form-hint">Repeating event · this occurrence</p>
      )}
      {current.notes && <p className="calendar-event-notes">{current.notes}</p>}
      {/^https?:\/\//i.test(current.url) && (
        <button
          type="button"
          className="calendar-text-button"
          onClick={() => openNoteLink(current.url)}
        >
          <ExternalLink size={14} />
          Open event link
        </button>
      )}
      <section className="calendar-linked-tasks">
        <div className="calendar-section-heading">
          <h3>
            Linked tasks <span>{linked.length}</span>
          </h3>
          <button type="button" onClick={() => setShowPicker(!showPicker)}>
            <Plus size={14} />
            Link task
          </button>
        </div>
        {!linked.length && (
          <p className="calendar-form-hint">
            Link a task to keep its notes and next steps close to this event.
          </p>
        )}
        {linked.map((task) => (
          <div key={task.id} className="calendar-linked-task">
            <button
              type="button"
              data-open-task
              onClick={() => {
                onClose();
                onOpenTask(task.id);
              }}
            >
              <span className={task.completedAt ? "is-complete" : ""}>
                {task.title}
              </span>
              {task.completedAt && <small>Completed</small>}
            </button>
            <button
              type="button"
              aria-label={`Unlink ${task.title}`}
              onClick={() =>
                onUpdateTask(task.id, {
                  calendarLinks: removeEventLink(task, eventLink(current)),
                })
              }
            >
              <Unlink size={15} />
            </button>
          </div>
        ))}
        {showPicker && (
          <div className="calendar-task-picker">
            <label>
              <Search size={15} />
              <input
                {...noTextSuggestions}
                autoFocus
                aria-label="Find a task to link"
                placeholder="Find a task…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div>
              {candidates.slice(0, 50).map((task) => (
                <button
                  type="button"
                  key={task.id}
                  onClick={() =>
                    onUpdateTask(task.id, {
                      calendarLinks: addEventLink(task, current),
                    })
                  }
                >
                  <Plus size={14} />
                  {task.title}
                </button>
              ))}
              {!candidates.length && (
                <p className="calendar-form-hint">No matching tasks.</p>
              )}
            </div>
          </div>
        )}
      </section>
      {error && (
        <p className="calendar-error" role="alert">
          {error}
        </p>
      )}
      {current.writable && api.status === "authorized" && (
        <footer className="calendar-event-actions">
          {deleting ? (
            <div className="calendar-delete-confirm">
              <p>
                Delete {current.isRecurring ? "this occurrence" : "this event"}{" "}
                from Apple Calendar? Linked tasks will be kept.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleting(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="calendar-danger"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.deleteEvent(current);
                    onClose();
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : "Could not delete this event.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "Deleting…"
                  : current.isRecurring
                    ? "Delete occurrence"
                    : "Delete event"}
              </button>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => setEditing(true)}>
                Edit event
              </button>
              <button
                type="button"
                className="calendar-danger"
                onClick={() => setDeleting(true)}
              >
                <Trash2 size={14} />
                Delete
              </button>
            </>
          )}
        </footer>
      )}
    </CalendarDialog>
  );
}

function EventChip({
  event,
  tasks,
  onClick,
  compact = false,
}: {
  event: CalendarEvent;
  tasks: Task[];
  onClick: () => void;
  compact?: boolean;
}) {
  const count = linkedTasks(tasks, event).length;
  return (
    <button
      type="button"
      className={`calendar-event-chip ${compact ? "is-compact" : ""} ${count ? "has-linked-tasks" : ""}`}
      style={colorStyle(event.calendarColor)}
      onClick={onClick}
      title={`${event.title} · ${eventTime(event)}${count ? ` · ${count} linked ${count === 1 ? "task" : "tasks"}` : ""}`}
    >
      <span className="calendar-event-time">
        {event.allDay
          ? "All day"
          : new Date(event.start).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
      </span>
      <strong>{event.title || "Untitled event"}</strong>
      {count > 0 && (
        <span
          className="calendar-link-count"
          role="img"
          aria-label={`${count} linked ${count === 1 ? "task" : "tasks"}`}
        >
          <Link2 size={11} aria-hidden="true" />
          <span aria-hidden="true">{count}</span>
        </span>
      )}
    </button>
  );
}
function TaskDayEntries({
  tasks,
  events,
  day,
  onOpenTask,
}: {
  tasks: Task[];
  events: CalendarEvent[];
  day: string;
  onOpenTask: (id: string) => void;
}) {
  return (
    <>
      {taskEntriesOnDay(tasks, events, day).map(({ task, work, deadline }) => (
        <TaskDayChip
          key={task.id}
          entry={{ task, work, deadline }}
          onOpenTask={onOpenTask}
        />
      ))}
    </>
  );
}
function TaskDayChip({
  entry: { task, work, deadline },
  onOpenTask,
}: {
  entry: TaskCalendarEntry;
  onOpenTask: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`calendar-task-chip ${deadline ? "has-deadline" : ""}`}
      data-open-task
      onClick={() => onOpenTask(task.id)}
      title={
        deadline
          ? `${task.title} · Deadline${work ? " and work day" : ""}`
          : `${task.title} · Work day`
      }
    >
      {deadline ? <Flag size={11} /> : <span className="calendar-work-dot" />}
      <span>{task.title}</span>
      {deadline && <small>Due</small>}
    </button>
  );
}

export default function CalendarWorkspace({
  tasks,
  api,
  onOpenTask,
  onUpdateTask,
}: CalendarProps) {
  const [date, setDate] = useState(dateKey());
  const [view, setView] = useState<CalendarView>(() =>
    usesTouchInterface() ? "day" : "week",
  );
  const [sources, setSources] = useState(false),
    [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const [narrowMonth, setNarrowMonth] = useState(() => window.innerWidth < 700);
  const timeline = useRef<HTMLDivElement>(null);
  const range = useMemo(() => calendarRange(date, view), [date, view]);
  const days = useMemo(() => rangeDays(range), [range]);
  useEffect(() => api.setRange(range), [api.setRange, range]);
  useEffect(() => {
    if (!workspace.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0)
        setNarrowMonth(entry.contentRect.width < 700);
    });
    observer.observe(workspace.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (view === "week" && timeline.current)
      timeline.current.scrollTop = 7 * 36;
  }, [view]);
  const move = (direction: number) => {
    if (view === "month") {
      const next = localDay(date);
      next.setDate(1);
      next.setMonth(next.getMonth() + direction);
      setDate(dateKey(next));
    } else setDate(shiftDay(date, direction * (view === "week" ? 7 : 1)));
  };
  const visibleEvents = api.events.filter((event) =>
    api.selectedCalendarIds.includes(event.calendarId),
  );
  const today = dateKey();
  return (
    <section
      className="calendar-workspace"
      aria-label="Calendar"
      ref={workspace}
    >
      <div className="calendar-toolbar">
        <div className="calendar-period">
          <button
            type="button"
            aria-label={`Previous ${view}`}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => setDate(today)}>
            Today
          </button>
          <button
            type="button"
            aria-label={`Next ${view}`}
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
          <h2 aria-live="polite">
            {view === "day"
              ? dateTitle(date, true)
              : view === "week"
                ? `${dateTitle(days[0], true)} – ${dateTitle(days.at(-1)!, true)}`
                : monthTitle(date)}
          </h2>
        </div>
        <div className="calendar-view-controls">
          <div role="group" aria-label="Calendar view">
            {(["month", "week", "day"] as const).map((item) => (
              <button
                type="button"
                key={item}
                aria-pressed={view === item}
                onClick={() => setView(item)}
              >
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-label="Calendar sources"
            aria-expanded={sources}
            onClick={() => setSources(!sources)}
          >
            <Settings2 size={17} />
          </button>
          {api.status === "authorized" && (
            <button
              type="button"
              aria-label="Refresh calendar"
              disabled={api.loading}
              onClick={() => void api.refresh()}
            >
              <RefreshCw
                size={16}
                className={api.loading ? "is-spinning" : ""}
              />
            </button>
          )}
          <button
            type="button"
            className="calendar-primary"
            disabled={
              api.status !== "authorized" ||
              !api.calendars.some((calendar) => calendar.writable)
            }
            onClick={() => setCreating(true)}
          >
            <Plus size={16} />
            <span>Event</span>
          </button>
        </div>
      </div>
      {(sources || api.status !== "authorized") && (
        <div className="calendar-connection-panel">
          <CalendarSettings api={api} />
        </div>
      )}
      {api.status === "authorized" && api.error && !sources && (
        <p className="calendar-error" role="alert">
          {api.error}
          <button
            type="button"
            onClick={api.clearError}
            aria-label="Dismiss calendar error"
          >
            <X size={14} />
          </button>
        </p>
      )}
      <div className="calendar-legend">
        <span>
          <i />
          Calendar event
        </span>
        <span>
          <b />
          Work day
        </span>
        <span>
          <Flag size={11} />
          Deadline
        </span>
        {api.loading && <span role="status">Refreshing…</span>}
      </div>
      {view === "month" ? (
        <div
          className="calendar-month"
          role="grid"
          aria-label={monthTitle(date)}
        >
          <div className="calendar-month-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => (
              <span key={name}>{name}</span>
            ))}
          </div>
          <div className="calendar-month-days">
            {days.map((day) => {
              const events = eventsOnDay(visibleEvents, day);
              const entries = taskEntriesOnDay(tasks, events, day).sort(
                (a, b) => Number(b.deadline) - Number(a.deadline),
              );
              const itemBudget = narrowMonth ? 2 : 3;
              // Keep a task visible on busy event days, with deadlines first.
              const shownEvents = events.slice(
                0,
                Math.max(0, itemBudget - (entries.length ? 1 : 0)),
              );
              const shownTasks = entries.slice(
                0,
                itemBudget - shownEvents.length,
              );
              const remaining =
                events.length +
                entries.length -
                shownEvents.length -
                shownTasks.length;
              return (
                <div
                  key={day}
                  className={`calendar-month-day ${day.slice(0, 7) === date.slice(0, 7) ? "" : "outside-month"}`}
                  role="gridcell"
                  aria-label={dateTitle(day)}
                >
                  <button
                    type="button"
                    className={`calendar-day-number ${day === today ? "is-today" : ""}`}
                    onClick={() => {
                      setDate(day);
                      setView("day");
                    }}
                    aria-label={`Show ${dateTitle(day)}`}
                  >
                    {Number(day.slice(-2))}
                  </button>
                  <div className="calendar-month-items">
                    {shownEvents.map((event) => (
                      <EventChip
                        key={eventKey(event)}
                        event={event}
                        tasks={tasks}
                        compact
                        onClick={() => setSelected(event)}
                      />
                    ))}
                    {shownTasks.map((entry) => (
                      <TaskDayChip
                        key={entry.task.id}
                        entry={entry}
                        onOpenTask={onOpenTask}
                      />
                    ))}
                  </div>
                  {remaining > 0 && (
                    <button
                      type="button"
                      className="calendar-more"
                      aria-label={`Show ${remaining} more ${remaining === 1 ? "item" : "items"} on ${dateTitle(day)}`}
                      onClick={() => {
                        setDate(day);
                        setView("day");
                      }}
                    >
                      +{remaining} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : view === "week" ? (
        <div className="calendar-week">
          <div className="calendar-week-header">
            <span />
            {days.map((day) => (
              <div key={day}>
                <button
                  type="button"
                  className={day === today ? "is-today" : ""}
                  onClick={() => {
                    setDate(day);
                    setView("day");
                  }}
                >
                  {localDay(day).toLocaleDateString(undefined, {
                    weekday: "short",
                  })}
                  <strong>{Number(day.slice(-2))}</strong>
                </button>
                {eventsOnDay(visibleEvents, day)
                  .filter((event) => event.allDay)
                  .map((event) => (
                    <EventChip
                      key={eventKey(event)}
                      event={event}
                      tasks={tasks}
                      compact
                      onClick={() => setSelected(event)}
                    />
                  ))}
                <TaskDayEntries
                  tasks={tasks}
                  events={eventsOnDay(visibleEvents, day)}
                  day={day}
                  onOpenTask={onOpenTask}
                />
              </div>
            ))}
          </div>
          <div className="calendar-week-scroll" ref={timeline}>
            <div className="calendar-time-grid">
              <div className="calendar-hours">
                {Array.from({ length: 24 }, (_, hour) => (
                  <span key={hour} style={{ top: hour * 36 }}>
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  className={`calendar-timed-day ${day === today ? "is-today" : ""}`}
                >
                  {positionEvents(visibleEvents, day).map(
                    ({ event, top, height, column, columns }) => (
                      <div
                        className="calendar-positioned-event"
                        key={eventKey(event)}
                        style={{
                          top: top * 0.6,
                          height: Math.max(12, height * 0.6),
                          left: `${(column / columns) * 100}%`,
                          width: `${100 / columns}%`,
                        }}
                      >
                        <EventChip
                          event={event}
                          tasks={tasks}
                          onClick={() => setSelected(event)}
                        />
                      </div>
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="calendar-day-agenda">
          <h3>{dateTitle(date)}</h3>
          <div className="calendar-agenda-work">
            <TaskDayEntries
              tasks={tasks}
              events={eventsOnDay(visibleEvents, date)}
              day={date}
              onOpenTask={onOpenTask}
            />
          </div>
          {eventsOnDay(visibleEvents, date).map((event) => (
            <EventChip
              key={eventKey(event)}
              event={event}
              tasks={tasks}
              onClick={() => setSelected(event)}
            />
          ))}
          {!eventsOnDay(visibleEvents, date).length &&
            !taskEntriesOnDay(tasks, visibleEvents, date).length && (
              <p className="calendar-empty">
                No events or planned tasks for this day.
              </p>
            )}
        </div>
      )}
      {selected && (
        <EventDetails
          event={selected}
          tasks={tasks}
          api={api}
          onOpenTask={onOpenTask}
          onUpdateTask={onUpdateTask}
          onClose={() => setSelected(null)}
        />
      )}
      {creating && (
        <EventForm
          api={api}
          day={date}
          onClose={() => setCreating(false)}
          onSaved={(event) => {
            setCreating(false);
            setSelected(event);
          }}
        />
      )}
    </section>
  );
}

function linkFallback(link: CalendarEventLink): CalendarEvent {
  return {
    ...link,
    ...(link.allDay && link.startDay && link.endDay
      ? {
          start: localDay(link.startDay).toISOString(),
          end: localDay(link.endDay).toISOString(),
        }
      : {}),
    id: link.eventId,
    location: "",
    notes: "",
    url: "",
    isRecurring: !!link.occurrenceDate,
    writable: false,
    cached: true,
  };
}
export function TaskCalendarLinks({
  task,
  compact = false,
  tasks = [task],
  api,
  onUpdateTask,
  onOpenTask = () => {},
}: {
  task: Task;
  compact?: boolean;
  tasks?: Task[];
  api: CalendarsAPI;
  onUpdateTask: UpdateTask;
  onOpenTask?: (id: string) => void;
}) {
  const [picker, setPicker] = useState(false),
    [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [day, setDay] = useState(() => nextWorkDate(task) ?? dateKey());
  const [events, setEvents] = useState<CalendarEvent[]>([]),
    [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setPicker(false);
    setCreating(false);
    setSelected(null);
    setDay(nextWorkDate(task) ?? dateKey());
  }, [task.id]);
  useEffect(() => {
    if (!picker || api.status !== "authorized") return;
    let cancelled = false;
    setLoading(true);
    setEvents([]);
    setError("");
    api
      .requestEvents({
        start: localDay(day).toISOString(),
        end: localDay(shiftDay(day, 30)).toISOString(),
      })
      .then((events) => {
        if (!cancelled) setEvents(events);
      })
      .catch((error) => {
        if (!cancelled)
          setError(
            error instanceof Error ? error.message : "Could not load events.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [picker, day, api.status, api.requestEvents, api.selectedCalendarIds]);
  const linked = task.calendarLinks ?? [];
  const openLinked = async (link: CalendarEventLink) => {
    const found = findLinkedEvent(api.events, link);
    if (found) {
      setSelected(found);
      return;
    }
    setSelected(linkFallback(link));
    if (api.status !== "authorized") return;
    try {
      const day =
        link.allDay && link.startDay
          ? link.startDay
          : dateKey(new Date(link.start));
      const events = await api.requestEvents({
        start: localDay(shiftDay(day, -1)).toISOString(),
        end: localDay(shiftDay(day, 2)).toISOString(),
      });
      const found = events.find((event) => linkMatchesEvent(link, event));
      if (found)
        setSelected((current) =>
          current && linkMatchesEvent(link, current) ? found : current,
        );
    } catch {
      /* Cached link remains usable even while its calendar is offline. */
    }
  };
  return (
    <section
      className={`task-calendar-links ${compact ? "is-compact" : ""} ${linked.length ? "has-links" : "is-empty"}`}
      aria-label="Linked calendar events"
    >
      <div className="calendar-section-heading">
        <h3>
          <CalendarDays size={14} />
          Calendar
        </h3>
        <button type="button" onClick={() => setPicker(true)}>
          <Link2 size={13} />
          Link event
        </button>
      </div>
      {linked.map((link) => {
        const live = findLinkedEvent(api.events, link);
        const details = live ?? linkFallback(link);
        return (
          <div
            key={JSON.stringify([
              link.externalId || link.eventId,
              link.occurrenceDate,
            ])}
            className="task-calendar-link"
          >
            <button type="button" onClick={() => void openLinked(link)}>
              <i style={{ background: details.calendarColor }} />
              <span>
                {details.title}
                <small>
                  {dateTitle(dateKey(new Date(details.start)), true)} ·{" "}
                  {eventTime(details)}
                  {!live && " · Saved details"}
                </small>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Unlink ${link.title}`}
              onClick={() =>
                onUpdateTask(task.id, {
                  calendarLinks: removeEventLink(task, link),
                })
              }
            >
              <Unlink size={14} />
            </button>
          </div>
        );
      })}
      {picker && (
        <CalendarDialog
          title="Link a calendar event"
          onClose={() => setPicker(false)}
        >
          {api.status !== "authorized" ? (
            <CalendarSettings api={api} />
          ) : (
            <>
              {api.calendars.some((calendar) => calendar.writable) && (
                <button
                  type="button"
                  className="calendar-text-button"
                  onClick={() => {
                    setPicker(false);
                    setCreating(true);
                  }}
                >
                  <Plus size={13} />
                  Schedule work session
                </button>
              )}
              <p className="calendar-form-hint">
                Events in the next 30 days from the chosen date.
              </p>
              <div className="calendar-event-picker-search">
                <label>
                  Starting
                  <input
                    type="date"
                    value={day}
                    onChange={(event) => {
                      if (event.target.value) setDay(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Find event
                  <input
                    {...noTextSuggestions}
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search titles"
                  />
                </label>
              </div>
              {loading && <p role="status">Loading events…</p>}
              {error && (
                <p className="calendar-error" role="alert">
                  {error}
                </p>
              )}
              <div className="calendar-event-picker-list">
                {events
                  .filter((event) =>
                    event.title.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((event) => {
                    const already = linked.some((link) =>
                      linkMatchesEvent(link, event),
                    );
                    return (
                      <button
                        type="button"
                        key={eventKey(event)}
                        disabled={already}
                        onClick={() =>
                          onUpdateTask(task.id, {
                            calendarLinks: addEventLink(task, event),
                          })
                        }
                      >
                        <span>
                          <strong>{event.title}</strong>
                          <small>
                            {dateTitle(dateKey(new Date(event.start)), true)} ·{" "}
                            {eventTime(event)} · {event.calendarTitle}
                          </small>
                        </span>
                        <span>{already ? "Linked" : "+ Link"}</span>
                      </button>
                    );
                  })}
                {!loading && !events.length && (
                  <p className="calendar-empty">
                    No events in the selected calendars for these dates.
                  </p>
                )}
              </div>
            </>
          )}
        </CalendarDialog>
      )}
      {selected && (
        <EventDetails
          event={selected}
          tasks={tasks}
          api={api}
          onOpenTask={onOpenTask}
          onUpdateTask={onUpdateTask}
          onClose={() => setSelected(null)}
        />
      )}
      {creating && (
        <EventForm
          api={api}
          task={task}
          day={day}
          onClose={() => setCreating(false)}
          onSaved={(event) => {
            onUpdateTask(task.id, { calendarLinks: addEventLink(task, event) });
            setCreating(false);
            setSelected(event);
          }}
        />
      )}
    </section>
  );
}
