import { useEffect, useRef, useState } from "react";
import { playCompletionChime } from "./completion-sound";
import "./task-completion.css";

export const COMPLETION_DURATION = 780;
const reducedMotion = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Move keyboard focus only if the disappearing row still owns it. */
function focusAfterCompletion(id: string) {
  const rows = [...document.querySelectorAll<HTMLElement>("main .task-row")];
  const index = rows.findIndex(
    (row) =>
      row.dataset.taskId === id &&
      row.classList.contains("is-completing") &&
      row.closest(".task-row-shell")?.classList.contains("is-retiring") &&
      row.contains(document.activeElement),
  );
  if (index < 0) return;
  const next = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()]
    .find(
      (row) =>
        row.dataset.taskId !== id && !row.classList.contains("is-completing"),
    )
    ?.querySelector<HTMLButtonElement>(".task-check");
  (
    next ??
    document.querySelector<HTMLInputElement>('[aria-label="New task title"]')
  )?.focus({ preventScroll: true });
}

/** This state only retains the visual receipt. Task persistence is immediate. */
export function useTaskCompletion() {
  const [completing, setCompleting] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<{ id: string; title: string } | null>(
    null,
  );
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  function celebrate(task: { id: string; title: string }) {
    // Called directly from the click/keyboard gesture so WebKit can unlock audio.
    playCompletionChime();
    clearTimeout(timers.current.get(task.id));
    setCompleting((previous) => new Set(previous).add(task.id));
    timers.current.set(
      task.id,
      setTimeout(
        () => {
          focusAfterCompletion(task.id);
          timers.current.delete(task.id);
          setCompleting((previous) => {
            const next = new Set(previous);
            next.delete(task.id);
            return next;
          });
        },
        reducedMotion() ? 120 : COMPLETION_DURATION,
      ),
    );
    setNotice({ id: task.id, title: task.title });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }
  function cancel(id: string) {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setCompleting((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setNotice((previous) => (previous?.id === id ? null : previous));
  }
  return { completing, notice, celebrate, cancel };
}

export function CompletionMark({
  checked,
  celebrating,
}: {
  checked: boolean;
  celebrating: boolean;
}) {
  if (!checked) return null;
  return (
    <span
      className={`completion-mark ${celebrating ? "is-drawing" : ""}`}
      aria-hidden="true"
    >
      <svg className="completion-checkmark" viewBox="0 0 24 24" fill="none">
        <path
          className="completion-tick"
          pathLength="1"
          d="M5.2 12.1C6.8 13.3 8.3 15 9.5 16.8C12.7 12.9 15.8 9.2 19.2 6.8"
        />
      </svg>
      {celebrating && (
        <svg className="completion-rays" viewBox="0 0 44 44" fill="none">
          <path d="M22 5V2" />
          <path d="M37 13L40 11" />
          <path d="M7 32L4 34" />
        </svg>
      )}
    </span>
  );
}
