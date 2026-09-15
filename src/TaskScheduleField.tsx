import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Flag,
  Sun,
  Sunrise,
  X,
} from "lucide-react";
import { dateKey } from "./model";
import { usesTouchInterface } from "./platform";
import "./task-schedule.css";

export type TaskSchedule = { dates: string[]; deadline: string | null };
export type TaskScheduleFieldProps = TaskSchedule & {
  today: string;
  onChange: (value: TaskSchedule) => void;
};
type Tab = "work" | "deadline";
const localDate = (value: string) => new Date(`${value}T12:00:00`);
const validDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(localDate(value)) === value;
const normalizedDates = (dates: string[]) =>
  [...new Set(dates.filter(validDate))].sort();
function offsetDay(value: string, count: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + count);
  return dateKey(date);
}
function offsetMonth(value: string, count: number) {
  const date = localDate(value);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + count);
  const last = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0,
    12,
  ).getDate();
  date.setDate(Math.min(day, last));
  return dateKey(date);
}
const fullDate = (value: string) =>
  localDate(value).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
function shortDate(value: string, today: string, relative = true) {
  if (relative && value === today) return "Today";
  if (relative && value === offsetDay(today, 1)) return "Tomorrow";
  return localDate(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  });
}
const nextDate = (dates: string[], today: string) =>
  dates.find((date) => date >= today) ?? dates.at(-1) ?? today;
const scheduleKey = (value: TaskSchedule) =>
  JSON.stringify([value.dates, value.deadline]);

function revealCalendarFocus(panel: HTMLDivElement | null) {
  const target = document.activeElement;
  const body = panel?.querySelector<HTMLElement>(".task-schedule-body");
  if (!(target instanceof HTMLElement) || !body?.contains(target)) return;
  const bounds = body.getBoundingClientRect();
  if (bounds.height <= 0) return;
  const rect = target.getBoundingClientRect();
  if (rect.top < bounds.top + 4) body.scrollTop += rect.top - bounds.top - 4;
  else if (rect.bottom > bounds.bottom - 4)
    body.scrollTop += Math.min(
      rect.bottom - bounds.bottom + 4,
      rect.top - bounds.top - 4,
    );
}

/** Work sessions are discrete dates; the independent deadline is saved with them. */
export default function TaskScheduleField({
  dates,
  deadline,
  today,
  onChange,
}: TaskScheduleFieldProps) {
  const saved: TaskSchedule = {
    dates: normalizedDates(dates),
    deadline: deadline && validDate(deadline) ? deadline : null,
  };
  const savedKey = scheduleKey(saved);
  const latest = useRef({ value: saved, key: savedKey });
  latest.current = { value: saved, key: savedKey };
  const [draft, setDraft] = useState<TaskSchedule>(saved);
  const baseline = useRef(savedKey);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("work");
  const [focusDate, setFocusDate] = useState(nextDate(saved.dates, today));
  const [month, setMonth] = useState(focusDate.slice(0, 7));
  const [touch] = useState(usesTouchInterface);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const focusIntent = useRef<"day" | "tab" | null>(null);
  const id = useId();
  const next = nextDate(saved.dates, today);
  const selectedTitle = saved.dates.length
    ? saved.dates.map(fullDate).join("; ")
    : "No work days selected";
  const overdue = !!saved.deadline && saved.deadline < today;
  const deadlineTitle = saved.deadline
    ? `${fullDate(saved.deadline)}${overdue ? ", overdue" : ""}`
    : "No deadline";
  const afterDeadline = draft.deadline
    ? draft.dates.filter((date) => date > draft.deadline!).length
    : 0;
  const monthDate = localDate(`${month}-01`);
  const monthName = monthDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const gridStart = offsetDay(`${month}-01`, -((monthDate.getDay() + 6) % 7));
  // Six stable rows avoid shifting the popup when moving between months.
  const days = Array.from({ length: 42 }, (_, index) =>
    offsetDay(gridStart, index),
  );

  const close = useCallback(() => {
    setOpen(false);
    focusIntent.current = null;
    opener.current?.focus({ preventScroll: true });
  }, []);
  const goToDay = (date: string, focus = true) => {
    focusIntent.current = focus ? "day" : null;
    setFocusDate(date);
    setMonth(date.slice(0, 7));
    // A second click on the same date still restores focus after removing a chip.
    if (focus && date === focusDate && date.slice(0, 7) === month) {
      panel.current
        ?.querySelector<HTMLButtonElement>(`[data-schedule-day="${date}"]`)
        ?.focus({ preventScroll: true });
      revealCalendarFocus(panel.current);
    }
  };
  const switchTab = (nextTab: Tab, keyboard = false) => {
    setTab(nextTab);
    const destination =
      nextTab === "deadline"
        ? (draft.deadline ?? today)
        : nextDate(draft.dates, today);
    goToDay(destination, false);
    focusIntent.current = keyboard ? "tab" : null;
  };
  const show = (nextTab: Tab, trigger: HTMLButtonElement) => {
    opener.current = trigger;
    if (open) {
      if (nextTab === tab) close();
      else {
        switchTab(nextTab);
        focusIntent.current = "day";
      }
      return;
    }
    baseline.current = latest.current.key;
    setDraft(latest.current.value);
    setTab(nextTab);
    const destination =
      nextTab === "deadline" ? (saved.deadline ?? today) : next;
    goToDay(destination);
    setOpen(true);
  };
  const pick = (date: string) => {
    setDraft((current) =>
      tab === "deadline"
        ? { ...current, deadline: date }
        : {
            ...current,
            dates: current.dates.includes(date)
              ? current.dates.filter((value) => value !== date)
              : [...current.dates, date].sort(),
          },
    );
    goToDay(date);
  };
  const save = () => {
    // A synced schedule can arrive between pointerdown and click on Save.
    if (baseline.current !== latest.current.key) {
      close();
      return;
    }
    onChange({ dates: [...draft.dates], deadline: draft.deadline });
    close();
  };

  useLayoutEffect(() => {
    if (open && savedKey !== baseline.current) close();
  }, [open, savedKey, close]);

  useLayoutEffect(() => {
    if (!open) return;
    const intent = focusIntent.current;
    focusIntent.current = null;
    const selector =
      intent === "tab"
        ? `[role="tab"][data-schedule-tab="${tab}"]`
        : intent === "day"
          ? `[data-schedule-day="${focusDate}"]`
          : null;
    if (selector)
      panel.current
        ?.querySelector<HTMLButtonElement>(selector)
        ?.focus({ preventScroll: true });
    revealCalendarFocus(panel.current);
  }, [open, month, focusDate, tab]);

  useLayoutEffect(() => {
    if (open) revealCalendarFocus(panel.current);
  }, [open, position]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const place = () => {
      const rect = opener.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const isSheet = window.innerWidth <= 600;
      const margin = viewportWidth < 375 ? 4 : isSheet ? 8 : 12;
      const width = isSheet
        ? Math.min(420, viewportWidth - margin * 2)
        : Math.min(356, viewportWidth - 24);
      const maxHeight = Math.max(120, viewportHeight - (isSheet ? 16 : 24));
      const height = Math.min(panel.current?.scrollHeight || 570, maxHeight);
      setSheet(isSheet);
      setPosition({
        left: isSheet
          ? viewportLeft + (viewportWidth - width) / 2
          : Math.max(
              viewportLeft + 12,
              Math.min(rect.left, viewportLeft + viewportWidth - width - 12),
            ),
        top: isSheet
          ? viewportTop + viewportHeight - height - 8
          : Math.max(
              viewportTop + 12,
              Math.min(
                rect.bottom + 8,
                viewportTop + viewportHeight - height - 12,
              ),
            ),
        width,
        maxHeight,
      });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null;
    if (panel.current) observer?.observe(panel.current);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [open, draft.dates.length, draft.deadline, afterDeadline, touch]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        close();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    // The native New Task menu bypasses DOM keydown. Discard before it forwards.
    window.addEventListener("daymark-new-task", close, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("daymark-new-task", close, true);
    };
  }, [open, close]);

  const dayKey = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const weekday = (localDate(date).getDay() + 6) % 7;
    const destination =
      event.key === "ArrowLeft"
        ? offsetDay(date, -1)
        : event.key === "ArrowRight"
          ? offsetDay(date, 1)
          : event.key === "ArrowUp"
            ? offsetDay(date, -7)
            : event.key === "ArrowDown"
              ? offsetDay(date, 7)
              : event.key === "Home"
                ? offsetDay(date, -weekday)
                : event.key === "End"
                  ? offsetDay(date, 6 - weekday)
                  : event.key === "PageUp"
                    ? offsetMonth(date, event.shiftKey ? -12 : -1)
                    : event.key === "PageDown"
                      ? offsetMonth(date, event.shiftKey ? 12 : 1)
                      : null;
    if (destination) {
      event.preventDefault();
      goToDay(destination);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(date);
    }
  };

  return (
    <div
      ref={anchor}
      className={`task-schedule-field${touch ? " is-touch" : ""}`}
      onPointerDownCapture={() => setKeyboardFocus(false)}
      onKeyDownCapture={() => setKeyboardFocus(true)}
    >
      <button
        type="button"
        className={`task-schedule-trigger is-work${saved.dates.includes(today) ? " is-today" : ""}`}
        aria-label={`Work on: ${selectedTitle}`}
        title={selectedTitle}
        aria-haspopup="dialog"
        aria-expanded={open && tab === "work"}
        aria-controls={open ? id : undefined}
        onClick={(event) => show("work", event.currentTarget)}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span className="task-schedule-trigger-text">
          {saved.dates.length ? shortDate(next, today) : "Work days"}
        </span>
        {saved.dates.length > 1 && (
          <span className="task-schedule-trigger-count">
            +{saved.dates.length - 1}
          </span>
        )}
      </button>
      <button
        type="button"
        className={`task-schedule-trigger is-deadline${saved.deadline ? " has-date" : " is-empty"}${overdue ? " is-overdue" : ""}`}
        aria-label={`Deadline: ${deadlineTitle}`}
        title={`Deadline: ${deadlineTitle}`}
        aria-haspopup="dialog"
        aria-expanded={open && tab === "deadline"}
        aria-controls={open ? id : undefined}
        onClick={(event) => show("deadline", event.currentTarget)}
      >
        <Flag size={14} aria-hidden="true" />
        <span className="task-schedule-trigger-text">
          {saved.deadline
            ? `Due ${shortDate(saved.deadline, today, false)}`
            : "Deadline"}
        </span>
      </button>
      {open &&
        createPortal(
          <>
            {sheet && (
              <div
                className="task-schedule-backdrop"
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.preventDefault();
                  close();
                }}
              />
            )}
            <div
              ref={panel}
              id={id}
              role="dialog"
              aria-label="Task dates"
              aria-modal="true"
              aria-describedby={`${id}-help`}
              className={`task-schedule-popover${touch ? " is-touch" : ""}${sheet ? " is-sheet" : ""}${keyboardFocus ? " has-keyboard-focus" : ""}`}
              style={position}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  ["k", "n"].includes(event.key.toLowerCase())
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                if (event.key !== "Tab") return;
                const buttons = [
                  ...(panel.current?.querySelectorAll<HTMLButtonElement>(
                    'button:not([disabled]):not([tabindex="-1"])',
                  ) ?? []),
                ];
                const first = buttons[0],
                  last = buttons.at(-1);
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }}
            >
              <header className="task-schedule-header">
                <div
                  role="tablist"
                  aria-label="Date type"
                  className="task-schedule-tabs"
                >
                  {(["work", "deadline"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      id={`${id}-${value}`}
                      data-schedule-tab={value}
                      aria-selected={tab === value}
                      aria-controls={`${id}-calendar`}
                      tabIndex={tab === value ? 0 : -1}
                      onClick={() => switchTab(value)}
                      onKeyDown={(event) => {
                        if (
                          ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                            event.key,
                          )
                        ) {
                          event.preventDefault();
                          switchTab(
                            event.key === "Home"
                              ? "work"
                              : event.key === "End"
                                ? "deadline"
                                : value === "work"
                                  ? "deadline"
                                  : "work",
                            true,
                          );
                        }
                      }}
                    >
                      {value === "work" ? "Work days" : "Deadline"}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="task-schedule-icon"
                  aria-label="Close date picker"
                  onClick={close}
                >
                  <X size={17} />
                </button>
              </header>
              <div
                className="task-schedule-body"
                role="tabpanel"
                id={`${id}-calendar`}
                aria-labelledby={`${id}-${tab}`}
              >
                <p className="task-schedule-help" id={`${id}-help`}>
                  {tab === "work"
                    ? "Choose the days you plan to work."
                    : "Choose the task’s final deadline."}
                </p>
                <div className="task-schedule-presets">
                  {[
                    { label: "Today", date: today, Icon: Sun },
                    {
                      label: "Tomorrow",
                      date: offsetDay(today, 1),
                      Icon: Sunrise,
                    },
                    {
                      label: "Next week",
                      date: offsetDay(today, 7),
                      Icon: CalendarDays,
                    },
                  ].map(({ label, date, Icon }) => (
                    <button
                      key={label}
                      type="button"
                      aria-label={label}
                      title={fullDate(date)}
                      aria-pressed={
                        tab === "work"
                          ? draft.dates.includes(date)
                          : draft.deadline === date
                      }
                      onClick={() => pick(date)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
                <div className="task-schedule-month">
                  <strong id={`${id}-month`} aria-live="polite">
                    {monthName}
                  </strong>
                  <div>
                    <button
                      type="button"
                      className="task-schedule-icon"
                      aria-label="Previous month"
                      onClick={() => goToDay(offsetMonth(focusDate, -1))}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <button
                      type="button"
                      className="task-schedule-icon"
                      aria-label="Go to current month"
                      title="Go to current month"
                      onClick={() => goToDay(today)}
                    >
                      <CircleDot size={15} />
                    </button>
                    <button
                      type="button"
                      className="task-schedule-icon"
                      aria-label="Next month"
                      onClick={() => goToDay(offsetMonth(focusDate, 1))}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
                <div
                  className="task-schedule-calendar"
                  role="grid"
                  aria-labelledby={`${id}-month`}
                  aria-multiselectable={tab === "work"}
                >
                  <div className="task-schedule-week" role="row">
                    {[
                      "Monday",
                      "Tuesday",
                      "Wednesday",
                      "Thursday",
                      "Friday",
                      "Saturday",
                      "Sunday",
                    ].map((name) => (
                      <span
                        key={name}
                        role="columnheader"
                        aria-label={name}
                        title={name}
                      >
                        {name[0]}
                      </span>
                    ))}
                  </div>
                  {Array.from({ length: 6 }, (_, week) => (
                    <div className="task-schedule-week" role="row" key={week}>
                      {days.slice(week * 7, week * 7 + 7).map((date) => {
                        const isWork = draft.dates.includes(date),
                          isDeadline = date === draft.deadline;
                        const selected = tab === "work" ? isWork : isDeadline;
                        return (
                          <div
                            key={date}
                            role="gridcell"
                            aria-selected={selected}
                          >
                            <button
                              type="button"
                              data-schedule-day={date}
                              tabIndex={date === focusDate ? 0 : -1}
                              aria-label={`${fullDate(date)}${isWork ? ", work day" : ""}${isDeadline ? ", deadline" : ""}`}
                              aria-pressed={selected}
                              aria-current={date === today ? "date" : undefined}
                              className={`task-schedule-day${selected ? " is-selected" : ""}${date === today ? " is-today" : ""}${date.slice(0, 7) !== month ? " is-adjoining" : ""}${isDeadline ? " has-deadline" : ""}${tab === "deadline" && isWork ? " has-work" : ""}`}
                              onFocus={() => setFocusDate(date)}
                              onKeyDown={(event) => dayKey(event, date)}
                              onClick={() => pick(date)}
                            >
                              <span>{Number(date.slice(-2))}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="task-schedule-selection">
                  <div className="task-schedule-summary">
                    <span aria-live="polite">
                      {draft.dates.length
                        ? `${draft.dates.length} work ${draft.dates.length === 1 ? "day" : "days"}`
                        : "No work days"}
                    </span>
                    <span
                      className={`task-schedule-deadline${draft.deadline ? " has-date" : ""}`}
                      title={
                        draft.deadline ? fullDate(draft.deadline) : undefined
                      }
                    >
                      <Flag size={12} aria-hidden="true" />
                      {draft.deadline
                        ? `Due ${shortDate(draft.deadline, today, false)}`
                        : "No deadline"}
                    </span>
                  </div>
                  {!!draft.dates.length && (
                    <div
                      className="task-schedule-chips"
                      aria-label="Selected work days"
                    >
                      {draft.dates.map((date) => (
                        <button
                          key={date}
                          type="button"
                          aria-label={`Remove work day ${fullDate(date)}`}
                          title={fullDate(date)}
                          onClick={() => {
                            setDraft((current) => ({
                              ...current,
                              dates: current.dates.filter(
                                (value) => value !== date,
                              ),
                            }));
                            goToDay(focusDate);
                          }}
                        >
                          <span>{shortDate(date, today)}</span>
                          <X size={12} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  )}
                  {afterDeadline > 0 && (
                    <p className="task-schedule-warning" role="status">
                      {afterDeadline} work{" "}
                      {afterDeadline === 1 ? "day falls" : "days fall"} after
                      the deadline.
                    </p>
                  )}
                </div>
              </div>
              <footer className="task-schedule-footer">
                <button
                  type="button"
                  className="task-schedule-clear"
                  aria-label={
                    tab === "work" ? "Clear work days" : "Clear deadline"
                  }
                  disabled={
                    tab === "work" ? !draft.dates.length : !draft.deadline
                  }
                  onClick={() =>
                    setDraft((current) =>
                      tab === "work"
                        ? { ...current, dates: [] }
                        : { ...current, deadline: null },
                    )
                  }
                >
                  Clear
                </button>
                <div>
                  <button type="button" onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="task-schedule-save"
                    onClick={save}
                  >
                    Save
                  </button>
                </div>
              </footer>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
