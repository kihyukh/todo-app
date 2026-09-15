import { useEffect, useRef, useState } from "react";
import type {
  Dispatch,
  DragEvent,
  HTMLAttributes,
  SetStateAction,
} from "react";
import { Check, GripVertical } from "lucide-react";
import type { AppState, Task } from "./model";
import { uid } from "./model";
import { usesTouchInterface } from "./platform";
import {
  TASK_DRAG_MIME,
  acceptsTaskTransfer,
  applyTaskDrop,
  canReorderTasks,
  compareManualTasks,
  isActiveTask,
  planTaskDrop,
  planResetTaskOrder,
  readDraggedTask,
  taskInManualView,
} from "./task-drag";
import type {
  TaskDragSession,
  TaskDropChange,
  TaskDropDestination,
} from "./task-drag";
import "./task-drag.css";

type Options = {
  state: AppState;
  setState: Dispatch<SetStateAction<AppState>>;
  view: string;
  mode: string;
  query: string;
  onCommit?: () => void;
};
type PointerDrag = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
  transport: "pointer" | "mouse";
  row: HTMLDivElement;
  nativeDragStyle: string;
};
function restoreNativeDrag(drag: PointerDrag | null, state: AppState) {
  if (!drag) return;
  drag.row.draggable = isActiveTask(
    state.tasks.find((task) => task.id === drag.id),
  );
  if (drag.nativeDragStyle)
    drag.row.style.setProperty("-webkit-user-drag", drag.nativeDragStyle);
  else drag.row.style.removeProperty("-webkit-user-drag");
}
function sensitiveControl(target: EventTarget) {
  const control =
    target instanceof Element &&
    target.closest(
      "button, a, input, textarea, select, [contenteditable='true']",
    );
  return !!control && !control.matches(".task-content, .task-drag-handle");
}
const destinationKey = (destination: TaskDropDestination) =>
  JSON.stringify(destination);
export function useTaskDrag(options: Options) {
  const current = useRef(options);
  current.current = options;
  const session = useRef<TaskDragSession | null>(null);
  const blockedPointer = useRef<string | null>(null);
  const lastPointerKind = useRef<string | null>(null);
  const pointer = useRef<PointerDrag | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const autoScrollFrame = useRef(0);
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<TaskDropDestination | null>(null);
  const [notice, setNotice] = useState<TaskDropChange | null>(null);
  const reorderEnabled = canReorderTasks(
    options.view,
    options.mode,
    options.query,
  );
  const clearDrag = () => {
    if (pointer.current?.active) suppressClick.current = true;
    restoreNativeDrag(pointer.current, current.current.state);
    pointer.current = null;
    ghost.current?.remove();
    ghost.current = null;
    if (autoScrollFrame.current) cancelAnimationFrame(autoScrollFrame.current);
    autoScrollFrame.current = 0;
    document.documentElement.classList.remove("is-task-pointer-dragging");
    session.current = null;
    setDraggingId(null);
    setTarget(null);
  };
  useEffect(clearDrag, [options.view, options.mode, options.query]);
  useEffect(() => {
    if (
      (session.current || pointer.current) &&
      !isActiveTask(
        options.state.tasks.find(
          (task) => task.id === (session.current?.id ?? pointer.current?.id),
        ),
      )
    )
      clearDrag();
  }, [options.state.tasks]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const commit = (taskId: string, destination: TaskDropDestination) => {
    const latest = current.current;
    if (
      destination.kind === "reorder" &&
      (!canReorderTasks(latest.view, latest.mode, latest.query) ||
        destination.scope !== latest.view)
    )
      return;
    const change = planTaskDrop(latest.state, taskId, destination);
    if (!change) return;
    latest.setState((state) => applyTaskDrop(state, change));
    latest.onCommit?.();
    setNotice(change);
  };
  useEffect(() => {
    const destinationAt = (drag: PointerDrag): TaskDropDestination | null => {
      const latest = current.current;
      if (!isActiveTask(latest.state.tasks.find((task) => task.id === drag.id)))
        return null;
      const element = document.elementFromPoint(drag.x, drag.y);
      const row = element?.closest<HTMLElement>(".task-row[data-task-id]");
      let destination: TaskDropDestination | null = null;
      if (row && canReorderTasks(latest.view, latest.mode, latest.query)) {
        const rect = row.getBoundingClientRect();
        destination = {
          kind: "reorder",
          id: row.dataset.taskId!,
          scope: latest.view,
          edge: drag.y < rect.top + rect.height / 2 ? "before" : "after",
        };
      } else {
        const target = element?.closest<HTMLElement>("[data-task-drop-kind]");
        const kind = target?.dataset.taskDropKind;
        if (kind === "project" || kind === "tag" || kind === "column")
          destination = { kind, id: target!.dataset.taskDropId ?? "" };
      }
      return destination && planTaskDrop(latest.state, drag.id, destination)
        ? destination
        : null;
    };
    const showTarget = (drag: PointerDrag) => {
      const destination = destinationAt(drag);
      setTarget((before) =>
        before &&
        destination &&
        destinationKey(before) === destinationKey(destination)
          ? before
          : destination,
      );
      if (!ghost.current) {
        const element = document.createElement("div");
        element.className = "task-drag-ghost";
        element.setAttribute("aria-hidden", "true");
        element.append(
          document.createElement("strong"),
          document.createElement("span"),
        );
        document.body.append(element);
        ghost.current = element;
      }
      const task = current.current.state.tasks.find(
        (task) => task.id === drag.id,
      );
      ghost.current.children[0].textContent = task?.title ?? "Task";
      ghost.current.children[1].textContent = !destination
        ? "Drop on a task, list, or tag"
        : destination.kind === "reorder"
          ? `Place ${destination.edge} this task`
          : destination.kind === "tag"
            ? `Add ${current.current.state.tags?.find((tag) => tag.id === destination.id)?.name ?? "tag"}`
            : destination.kind === "project"
              ? `Move to ${current.current.state.projects.find((project) => project.id === destination.id)?.name ?? "Inbox"}`
              : `Move to ${current.current.state.columns.find((column) => column.id === destination.id)?.name ?? "column"}`;
      ghost.current.style.transform = `translate3d(${Math.max(8, Math.min(drag.x + 16, window.innerWidth - 260))}px, ${Math.max(8, Math.min(drag.y + 16, window.innerHeight - 76))}px, 0)`;
      return destination;
    };
    const scroll = () => {
      const drag = pointer.current;
      if (!drag?.active) return;
      const scrollArea = document
        .elementFromPoint(drag.x, drag.y)
        ?.closest<HTMLElement>(".task-scroll, .sidebar-collections");
      if (scrollArea) {
        const rect = scrollArea.getBoundingClientRect();
        const beforeTop = scrollArea.scrollTop;
        const beforeLeft = scrollArea.scrollLeft;
        const edge = Math.min(36, rect.height / 4);
        const delta =
          drag.y < rect.top + edge
            ? -Math.ceil((rect.top + edge - drag.y) / 3)
            : drag.y > rect.bottom - edge
              ? Math.ceil((drag.y - rect.bottom + edge) / 3)
              : 0;
        if (delta) scrollArea.scrollTop += Math.max(-12, Math.min(12, delta));
        if (
          current.current.mode === "board" &&
          scrollArea.classList.contains("task-scroll") &&
          scrollArea.scrollWidth > scrollArea.clientWidth
        ) {
          const edgeX = Math.min(36, rect.width / 4);
          const deltaX =
            drag.x < rect.left + edgeX
              ? -Math.ceil((rect.left + edgeX - drag.x) / 3)
              : drag.x > rect.right - edgeX
                ? Math.ceil((drag.x - rect.right + edgeX) / 3)
                : 0;
          if (deltaX)
            scrollArea.scrollLeft += Math.max(-12, Math.min(12, deltaX));
        }
        if (
          scrollArea.scrollTop !== beforeTop ||
          scrollArea.scrollLeft !== beforeLeft
        )
          showTarget(drag);
      }
      autoScrollFrame.current = requestAnimationFrame(scroll);
    };
    const belongsToGesture = (
      event: MouseEvent | PointerEvent,
      drag: PointerDrag,
      kind: "move" | "up",
    ) =>
      drag.transport === "mouse"
        ? event.type === `mouse${kind}`
        : "pointerId" in event && drag.pointerId === event.pointerId;
    const move = (event: MouseEvent | PointerEvent) => {
      const drag = pointer.current;
      if (!drag || !belongsToGesture(event, drag, "move")) return;
      if (drag.transport === "pointer" && !(event.buttons & 1)) {
        clearDrag();
        return;
      }
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (!drag.active) {
        if (Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
        drag.active = true;
        setDraggingId(drag.id);
        document.documentElement.classList.add("is-task-pointer-dragging");
        autoScrollFrame.current = requestAnimationFrame(scroll);
      }
      event.preventDefault();
      showTarget(drag);
    };
    const finish = (event: MouseEvent | PointerEvent) => {
      const drag = pointer.current;
      if (!drag || !belongsToGesture(event, drag, "up")) return;
      if (!drag.active) {
        clearDrag();
        return;
      }
      event.preventDefault();
      drag.x = event.clientX;
      drag.y = event.clientY;
      const destination = destinationAt(drag);
      suppressClick.current = true;
      clearDrag();
      if (destination) commit(drag.id, destination);
    };
    const cancel = () => {
      if (pointer.current?.active) suppressClick.current = true;
      clearDrag();
    };
    const leaveWindow = (event: MouseEvent) => {
      if (!event.relatedTarget) cancel();
    };
    const cancelPointer = (event: PointerEvent) => {
      if (pointer.current?.pointerId === event.pointerId) cancel();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pointer.current) {
        if (pointer.current.active) {
          event.preventDefault();
          event.stopPropagation();
        }
        cancel();
      }
    };
    const click = (event: MouseEvent) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const freshPointer = () => {
      suppressClick.current = false;
    };
    document.addEventListener("pointerdown", freshPointer, true);
    document.addEventListener("mousedown", freshPointer, true);
    document.addEventListener("mouseleave", leaveWindow);
    document.addEventListener("pointermove", move, {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointerup", finish, true);
    document.addEventListener("mousemove", move, {
      capture: true,
      passive: false,
    });
    document.addEventListener("mouseup", finish, true);
    document.addEventListener("pointercancel", cancelPointer, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      document.removeEventListener("pointerdown", freshPointer, true);
      document.removeEventListener("mousedown", freshPointer, true);
      document.removeEventListener("mouseleave", leaveWindow);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", finish, true);
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("mouseup", finish, true);
      document.removeEventListener("pointercancel", cancelPointer, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
      if (autoScrollFrame.current)
        cancelAnimationFrame(autoScrollFrame.current);
      restoreNativeDrag(pointer.current, current.current.state);
      pointer.current = null;
      ghost.current?.remove();
      document.documentElement.classList.remove("is-task-pointer-dragging");
    };
  }, []);
  const validTarget = (
    event: DragEvent<HTMLElement>,
    destination: TaskDropDestination,
  ) => {
    const latest = current.current;
    if (!acceptsTaskTransfer(event.dataTransfer, session.current, latest.state))
      return false;
    if (destination.kind === "reorder") {
      return (
        canReorderTasks(latest.view, latest.mode, latest.query) &&
        destination.scope === latest.view &&
        destination.id !== session.current!.id &&
        [session.current!.id, destination.id].every((id) =>
          latest.state.tasks.some(
            (task) => task.id === id && taskInManualView(task, latest.view),
          ),
        )
      );
    }
    return !!planTaskDrop(latest.state, session.current!.id, destination);
  };
  const over = (
    event: DragEvent<HTMLElement>,
    destination: TaskDropDestination,
  ) => {
    if (!validTarget(event, destination)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect =
      destination.kind === "tag" ? "copy" : "move";
    setTarget((before) =>
      before && destinationKey(before) === destinationKey(destination)
        ? before
        : destination,
    );
  };
  const drop = (
    event: DragEvent<HTMLElement>,
    destination: TaskDropDestination,
  ) => {
    const task = readDraggedTask(
      event.dataTransfer,
      session.current,
      current.current.state,
    );
    if (!task || !validTarget(event, destination)) return;
    event.preventDefault();
    event.stopPropagation();
    clearDrag();
    commit(task.id, destination);
  };
  const leave = (
    event: DragEvent<HTMLElement>,
    destination: TaskDropDestination,
  ) => {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    )
      return;
    setTarget((before) =>
      before && destinationKey(before) === destinationKey(destination)
        ? null
        : before,
    );
  };
  const edgeAt = (event: DragEvent<HTMLElement>): "before" | "after" => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  const claimMouseGesture = (
    task: Task,
    row: HTMLDivElement,
    x: number,
    y: number,
    pointerId: number,
    transport: "pointer" | "mouse",
  ) => {
    if (pointer.current?.id === task.id && transport === "mouse") {
      pointer.current.transport = "mouse";
      return;
    }
    clearDrag();
    suppressClick.current = false;
    pointer.current = {
      id: task.id,
      pointerId,
      startX: x,
      startY: y,
      x,
      y,
      active: false,
      transport,
      row,
      nativeDragStyle: row.style.getPropertyValue("-webkit-user-drag"),
    };
    // Claim the mouse gesture before WebKit evaluates its native drag threshold.
    row.draggable = false;
    row.style.setProperty("-webkit-user-drag", "none");
  };
  const rowProps = (
    task: Task,
    compact = false,
  ): HTMLAttributes<HTMLDivElement> & {
    "data-drop-edge"?: string;
    "data-task-dragging"?: boolean;
  } => ({
    draggable: isActiveTask(task) && pointer.current?.id !== task.id,
    "data-task-dragging": draggingId === task.id || undefined,
    "data-drop-edge":
      !compact && target?.kind === "reorder" && target.id === task.id
        ? target.edge
        : undefined,
    onPointerDownCapture: (event) => {
      lastPointerKind.current = event.pointerType;
      blockedPointer.current = sensitiveControl(event.target) ? task.id : null;
      if (
        event.pointerType === "mouse" &&
        event.button === 0 &&
        event.isPrimary !== false &&
        blockedPointer.current !== task.id &&
        isActiveTask(
          current.current.state.tasks.find((item) => item.id === task.id),
        )
      ) {
        claimMouseGesture(
          task,
          event.currentTarget,
          event.clientX,
          event.clientY,
          event.pointerId,
          "pointer",
        );
      }
    },
    onMouseDownCapture: (event) => {
      if (
        event.button !== 0 ||
        usesTouchInterface() ||
        lastPointerKind.current === "touch" ||
        lastPointerKind.current === "pen" ||
        sensitiveControl(event.target) ||
        !isActiveTask(
          current.current.state.tasks.find((item) => item.id === task.id),
        )
      )
        return;
      const capabilities = (
        event.nativeEvent as MouseEvent & {
          sourceCapabilities?: { firesTouchEvents?: boolean };
        }
      ).sourceCapabilities;
      if (capabilities?.firesTouchEvents) return;
      blockedPointer.current = null;
      claimMouseGesture(
        task,
        event.currentTarget,
        event.clientX,
        event.clientY,
        -1,
        "mouse",
      );
    },
    onDragStart: (event) => {
      const latest = current.current.state.tasks.find(
        (item) => item.id === task.id,
      );
      if (
        pointer.current ||
        !isActiveTask(latest) ||
        blockedPointer.current === task.id
      ) {
        event.preventDefault();
        return;
      }
      const payload = { id: task.id, token: uid() };
      event.dataTransfer.clearData();
      event.dataTransfer.setData(TASK_DRAG_MIME, JSON.stringify(payload));
      // A text representation lets native drag providers advertise a standard type.
      // Drop targets still authenticate only the private MIME and live session.
      event.dataTransfer.setData("text/plain", latest.title || "Task");
      event.dataTransfer.effectAllowed = "copyMove";
      session.current = payload;
      setDraggingId(task.id);
      setTarget(null);
    },
    onDragEnd: () => {
      if (!pointer.current) clearDrag();
    },
    onDragOver: compact
      ? undefined
      : (event) =>
          over(event, {
            kind: "reorder",
            id: task.id,
            scope: current.current.view,
            edge: edgeAt(event),
          }),
    onDrop: compact
      ? undefined
      : (event) =>
          drop(event, {
            kind: "reorder",
            id: task.id,
            scope: current.current.view,
            edge: edgeAt(event),
          }),
    onDragLeave: compact
      ? undefined
      : (event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return;
          setTarget((before) =>
            before?.kind === "reorder" && before.id === task.id ? null : before,
          );
        },
  });
  const destinationProps = (
    destination: TaskDropDestination,
  ): HTMLAttributes<HTMLElement> & {
    "data-task-drop"?: boolean;
    "data-drop-label": string;
    "data-task-drop-kind": string;
    "data-task-drop-id": string;
  } => ({
    "data-task-drop-kind": destination.kind,
    "data-task-drop-id": destination.id,
    "data-task-drop":
      (target && destinationKey(target) === destinationKey(destination)) ||
      undefined,
    "data-drop-label": destination.kind === "tag" ? "Add tag" : "Move here",
    onDragEnter: (event) => over(event, destination),
    onDragOver: (event) => over(event, destination),
    onDragLeave: (event) => leave(event, destination),
    onDrop: (event) => drop(event, destination),
  });
  return {
    reorderEnabled,
    draggingId,
    notice,
    rowProps,
    destinationProps,
    clearNotice: () => setNotice(null),
    resetOrder: () => {
      const latest = current.current;
      if (!canReorderTasks(latest.view, latest.mode, latest.query)) return;
      const change = planResetTaskOrder(latest.state, latest.view);
      if (!change) return;
      latest.setState((state) => applyTaskDrop(state, change));
      latest.onCommit?.();
      setNotice(change);
    },
    moveByKeyboard: (taskId: string, direction: -1 | 1) => {
      const latest = current.current;
      if (!canReorderTasks(latest.view, latest.mode, latest.query)) return;
      const tasks = latest.state.tasks
        .filter((task) => taskInManualView(task, latest.view))
        .sort((a, b) => compareManualTasks(a, b, latest.view));
      const index = tasks.findIndex((task) => task.id === taskId);
      const next = tasks[index + direction];
      if (index >= 0 && next)
        commit(taskId, {
          kind: "reorder",
          id: next.id,
          scope: latest.view,
          edge: direction < 0 ? "before" : "after",
        });
    },
    undo: () => {
      if (!notice) return;
      current.current.setState((state) => applyTaskDrop(state, notice, true));
      setNotice(null);
    },
  };
}
type TaskDrag = ReturnType<typeof useTaskDrag>;
export function TaskDragHandle({ task, drag }: { task: Task; drag: TaskDrag }) {
  return (
    <button
      type="button"
      className="task-drag-handle"
      aria-label={`Reorder ${task.title}`}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      title="Drag to reorder · Alt + ↑/↓ to move"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (
          !event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          !["ArrowUp", "ArrowDown"].includes(event.key)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        drag.moveByKeyboard(task.id, event.key === "ArrowUp" ? -1 : 1);
      }}
    >
      <GripVertical size={14} aria-hidden="true" />
    </button>
  );
}
export function TaskDragNotice({ drag }: { drag: TaskDrag }) {
  return drag.notice ? (
    <div className="toast task-drag-toast" role="status">
      <Check size={15} />
      <span>{drag.notice.message}</span>
      <button type="button" onClick={drag.undo} aria-label="Undo task move">
        Undo
      </button>
    </div>
  ) : null;
}
