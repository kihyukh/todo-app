import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
  CalendarDays,
  X,
} from "lucide-react";
import { dateKey } from "./model";
import { usesTouchInterface } from "./platform";
import "./work-dates.css";

export type WorkDatesFieldProps = {
  dates: string[];
  deadline: string | null;
  today: string;
  onChange: (dates: string[]) => void;
};

function localDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}
function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) && dateKey(localDate(value)) === value
  );
}
function offsetDay(value: string, count: number): string {
  const date = localDate(value);
  date.setDate(date.getDate() + count);
  return dateKey(date);
}
function offsetMonth(value: string, count: number): string {
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
function shortDate(value: string, today: string): string {
  if (value === today) return "Today";
  if (value === offsetDay(today, 1)) return "Tomorrow";
  return localDate(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(value.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}),
  });
}

/** Selected work dates are independent dates, never the endpoints of a range. */
export default function WorkDatesField({
  dates,
  deadline,
  today,
  onChange,
}: WorkDatesFieldProps) {
  const selected = [...new Set(dates.filter(validDate))].sort();
  const next =
    selected.find((date) => date >= today) ?? selected.at(-1) ?? today;
  const tomorrow = offsetDay(today, 1);
  const deadlineDate = deadline && validDate(deadline) ? deadline : null;
  const afterDeadline = deadlineDate
    ? selected.filter((date) => date > deadlineDate).length
    : 0;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(next.slice(0, 7));
  const [focusDate, setFocusDate] = useState(next);
  const [position, setPosition] = useState<CSSProperties>({});
  const [touch] = useState(usesTouchInterface);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const monthDate = localDate(`${month}-01`);
  const monthName = monthDate.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const firstWeekday = (monthDate.getDay() + 6) % 7;
  const monthLength = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0,
    12,
  ).getDate();
  const dayCount = Math.ceil((firstWeekday + monthLength) / 7) * 7;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= monthLength
      ? `${month}-${String(day).padStart(2, "0")}`
      : null;
  });
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const focusDay = (date: string) => {
    setMonth(date.slice(0, 7));
    setFocusDate(date);
  };
  const toggle = (date: string) =>
    onChange(
      selected.includes(date)
        ? selected.filter((value) => value !== date)
        : [...selected, date].sort(),
    );
  const selectedTitle = selected.length
    ? selected.map(fullDate).join("; ")
    : "No work days selected";

  useLayoutEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>(`[data-work-day="${focusDate}"]`)
      ?.focus();
  }, [open, month, focusDate]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      const width = Math.min(touch ? 360 : 340, window.innerWidth - 24);
      const maxHeight = Math.max(120, height - 24);
      const panelHeight = Math.min(
        panel.current?.scrollHeight || 580,
        maxHeight,
      );
      setPosition({
        "--work-popover-left": `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`,
        "--work-popover-top": `${Math.max(top + 12, Math.min(rect.bottom + 8, top + height - panelHeight - 12))}px`,
        "--work-popover-max-height": `${maxHeight}px`,
      } as CSSProperties);
    };
    place();
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, selected.length, afterDeadline, month, touch]);

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
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const dayKey = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const weekday = (localDate(date).getDay() + 6) % 7;
    const target =
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
    if (target) {
      event.preventDefault();
      focusDay(target);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle(date);
    }
  };

  return (
    <div
      ref={anchor}
      className={`date-field work-dates-field ${selected.includes(today) ? "today-date" : ""}`}
    >
      <button
        ref={trigger}
        type="button"
        className="date-field-trigger work-dates-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`Work on: ${selectedTitle}`}
        title={selectedTitle}
        onClick={() => {
          if (open) close();
          else {
            focusDay(next);
            setOpen(true);
          }
        }}
      >
        <CalendarDays size={16} aria-hidden="true" />
        <span>
          <small>Work on</small>
          <strong>
            {selected.length ? shortDate(next, today) : "Choose days"}
            {selected.length > 1 && (
              <span className="work-dates-count">+{selected.length - 1}</span>
            )}
          </strong>
        </span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-help`}
            className={`work-dates-popover ${touch ? "is-touch" : ""}`}
            style={position}
            onKeyDown={(event) => {
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
            <div className="work-dates-heading">
              <h3 id={`${id}-title`}>Work on</h3>
              <button
                type="button"
                aria-label="Close work days"
                onClick={close}
              >
                <X size={17} />
              </button>
            </div>
            <p id={`${id}-help`} className="work-dates-help">
              Choose the individual days you plan to work.
            </p>
            <div className="work-dates-shortcuts">
              {[
                { date: today, label: "Today" },
                { date: tomorrow, label: "Tomorrow" },
              ].map(({ date, label }) => (
                <button
                  key={date}
                  type="button"
                  aria-pressed={selected.includes(date)}
                  onClick={() => {
                    toggle(date);
                    focusDay(date);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="work-calendar-heading">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => focusDay(offsetMonth(focusDate, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <strong id={`${id}-month`} aria-live="polite">
                {monthName}
              </strong>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => focusDay(offsetMonth(focusDate, 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div
              className="work-calendar"
              role="grid"
              aria-labelledby={`${id}-month`}
              aria-multiselectable="true"
            >
              <div className="work-calendar-week" role="row">
                {[
                  "Monday",
                  "Tuesday",
                  "Wednesday",
                  "Thursday",
                  "Friday",
                  "Saturday",
                  "Sunday",
                ].map((day) => (
                  <span
                    key={day}
                    role="columnheader"
                    title={day}
                    aria-label={day}
                  >
                    {day.slice(0, 1)}
                  </span>
                ))}
              </div>
              {Array.from({ length: dayCount / 7 }, (_, week) => (
                <div className="work-calendar-week" role="row" key={week}>
                  {days.slice(week * 7, week * 7 + 7).map((date, index) => (
                    <div
                      key={date ?? `empty-${index}`}
                      role="gridcell"
                      aria-selected={date ? selected.includes(date) : undefined}
                    >
                      {date && (
                        <button
                          type="button"
                          data-work-day={date}
                          tabIndex={focusDate === date ? 0 : -1}
                          aria-label={`${fullDate(date)}${date === deadlineDate ? ", deadline" : ""}`}
                          aria-pressed={selected.includes(date)}
                          aria-current={date === today ? "date" : undefined}
                          className={`work-calendar-day ${selected.includes(date) ? "is-selected" : ""} ${date === today ? "is-today" : ""} ${date === deadlineDate ? "is-deadline" : ""}`}
                          onFocus={() => setFocusDate(date)}
                          onKeyDown={(event) => dayKey(event, date)}
                          onClick={() => toggle(date)}
                        >
                          {Number(date.slice(-2))}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {deadlineDate && (
              <p className="work-dates-deadline">
                <Flag size={12} aria-hidden="true" />
                <span>Deadline: {shortDate(deadlineDate, today)}</span>
              </p>
            )}
            <div className="work-dates-selection">
              <p className="work-dates-selected-label" aria-live="polite">
                {selected.length
                  ? `${selected.length} work ${selected.length === 1 ? "day" : "days"} selected`
                  : "No work days selected"}
              </p>
              {selected.length > 0 && (
                <div
                  className="work-dates-chips"
                  aria-label="Selected work days"
                >
                  {selected.map((date) => (
                    <button
                      type="button"
                      key={date}
                      title={fullDate(date)}
                      aria-label={`Remove ${fullDate(date)}`}
                      onClick={() => {
                        toggle(date);
                        panel.current
                          ?.querySelector<HTMLButtonElement>(
                            `[data-work-day="${focusDate}"]`,
                          )
                          ?.focus();
                      }}
                    >
                      <span>{shortDate(date, today)}</span>
                      <X size={12} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
              {afterDeadline > 0 && (
                <p className="work-dates-warning" role="status">
                  {afterDeadline} work{" "}
                  {afterDeadline === 1 ? "day falls" : "days fall"} after the
                  deadline.
                </p>
              )}
            </div>
            <div className="work-dates-footer">
              <button
                type="button"
                disabled={!selected.length}
                onClick={() => onChange([])}
              >
                Clear all
              </button>
              <button type="button" className="work-dates-done" onClick={close}>
                Done
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
