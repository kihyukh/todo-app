import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import "./list-actions.css";

export type ListMenuAnchor = {
  id: string;
  element: HTMLElement;
  point?: { x: number; y: number };
};

export function ListOptions({
  anchor,
  onEdit,
  onDelete,
  onClose,
}: {
  anchor: ListMenuAnchor;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const rect = anchor.element.getBoundingClientRect();
    const width = panel.current?.offsetWidth ?? 192;
    const height = panel.current?.offsetHeight ?? 94;
    setPosition({
      left: Math.max(
        12,
        Math.min(
          anchor.point?.x ?? rect.right - width,
          window.innerWidth - width - 12,
        ),
      ),
      top: Math.max(
        12,
        Math.min(
          anchor.point?.y ?? rect.bottom + 6,
          window.innerHeight - height - 12,
        ),
      ),
    });
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !panel.current?.contains(event.target) &&
        !anchor.element.contains(event.target)
      )
        onClose();
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", onClose);
      if (anchor.element.isConnected)
        anchor.element.focus({ preventScroll: true });
    };
  }, [anchor]);
  return (
    <div
      ref={panel}
      className="list-options-menu"
      role="menu"
      aria-label="List options"
      style={position}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          event.stopPropagation();
          if (event.key === "Escape") event.preventDefault();
          onClose();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(
            panel.current!.querySelectorAll<HTMLButtonElement>("button"),
          );
          const current = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const index =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (current +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[index]?.focus();
        }
      }}
    >
      <button role="menuitem" onClick={onEdit}>
        <Pencil size={15} />
        Edit list
      </button>
      <button role="menuitem" className="list-delete-action" onClick={onDelete}>
        <Trash2 size={15} />
        Delete list…
      </button>
    </div>
  );
}

export function DeleteListDialog({
  name,
  activeCount,
  completedCount,
  trashCount,
  onClose,
  onConfirm,
  returnFocus,
}: {
  name: string;
  activeCount: number;
  completedCount: number;
  trashCount: number;
  onClose: () => void;
  onConfirm: () => void;
  returnFocus?: HTMLElement;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="modal list-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-list-title"
        aria-describedby="delete-list-description"
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
          if (event.key === "Tab") {
            const buttons = Array.from(
              panel.current!.querySelectorAll<HTMLButtonElement>("button"),
            );
            if (event.shiftKey && document.activeElement === buttons[0]) {
              event.preventDefault();
              buttons.at(-1)?.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === buttons.at(-1)
            ) {
              event.preventDefault();
              buttons[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2 id="delete-list-title">Delete “{name}”?</h2>
          <button
            className="icon-button"
            aria-label="Close delete list"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div id="delete-list-description" className="list-delete-body">
          <p>
            {activeCount
              ? `${activeCount} ${activeCount === 1 ? "task will" : "tasks will"} move to Inbox.`
              : completedCount || trashCount
                ? "This list has no active tasks."
                : "This list is empty."}
          </p>
          {(completedCount > 0 || trashCount > 0) && (
            <p className="list-delete-secondary">
              {completedCount > 0 &&
                `${completedCount} completed ${completedCount === 1 ? "task stays" : "tasks stay"} in Completed. `}
              {trashCount > 0 &&
                `${trashCount} ${trashCount === 1 ? "task stays" : "tasks stay"} in Trash.`}
            </p>
          )}
          <p className="list-delete-secondary">
            Your tasks, notes, files, dates, and tags will be kept.
          </p>
        </div>
        <footer>
          <button ref={cancel} className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="list-delete-confirm" onClick={onConfirm}>
            Delete list
          </button>
        </footer>
      </div>
    </div>
  );
}
