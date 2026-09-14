import { useEffect, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";

export type PaneWidths = { sidebar: number; detail: number };
const STORAGE_KEY = "daymark.panes.v1";
export const defaultPaneWidths = (width: number): PaneWidths => ({
  sidebar: 224,
  detail: Math.round(width * 0.42),
});
export function fitPaneWidths(
  preferred: PaneWidths,
  width: number,
  hasDetail: boolean,
): PaneWidths {
  const sidebar = Math.round(
    Math.max(
      184,
      Math.min(340, preferred.sidebar, width - (hasDetail ? 620 : 300)),
    ),
  );
  const detail = Math.round(
    Math.max(340, Math.min(1000, preferred.detail, width - sidebar - 280)),
  );
  return { sidebar, detail };
}
function readWidths(width: number): PaneWidths {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (
      saved &&
      Number.isFinite(saved.sidebar) &&
      Number.isFinite(saved.detail)
    )
      return saved;
  } catch {
    /* A unavailable preference does not prevent opening the workspace. */
  }
  return defaultPaneWidths(width);
}

export function usePaneWidths(hasDetail: boolean) {
  const shell = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(window.innerWidth);
  const [preferred, setPreferred] = useState(() =>
    readWidths(window.innerWidth),
  );
  const current = useRef(preferred);
  current.current = preferred;
  const fitted = fitPaneWidths(preferred, width, hasDetail);
  useEffect(() => {
    const measure = () =>
      setWidth(shell.current?.clientWidth || window.innerWidth);
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (shell.current) observer?.observe(shell.current);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const change = (next: PaneWidths, persist = false) => {
    current.current = next;
    setPreferred(next);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* Optional device preference. */
      }
    }
  };
  return {
    shell,
    width,
    fitted,
    style: {
      "--sidebar-width": `${fitted.sidebar}px`,
      "--detail-width": `${fitted.detail}px`,
    } as CSSProperties,
    change,
    persist: () => change(current.current, true),
  };
}

export function PaneDivider({
  kind,
  layout,
  hasDetail,
}: {
  kind: "sidebar" | "detail";
  layout: {
    shell: RefObject<HTMLDivElement | null>;
    fitted: PaneWidths;
    width: number;
    change: (next: PaneWidths, persist?: boolean) => void;
    persist: () => void;
  };
  hasDetail: boolean;
}) {
  const drag = useRef<{
    x: number;
    widths: PaneWidths;
    pointer: number;
  } | null>(null);
  useEffect(() => {
    const shell = layout.shell.current;
    return () => shell?.classList.remove("is-resizing-panes");
  }, [layout.shell]);
  if (layout.width <= 920 || (kind === "detail" && !hasDetail)) return null;
  const label =
    kind === "sidebar" ? "Resize navigation pane" : "Resize task detail pane";
  const apply = (value: number, persist = false) =>
    layout.change(
      fitPaneWidths(
        { ...layout.fitted, [kind]: value },
        layout.width,
        hasDetail,
      ),
      persist,
    );
  const finish = () => {
    drag.current = null;
    layout.persist();
    layout.shell.current?.classList.remove("is-resizing-panes");
  };
  return (
    <div
      className={`pane-divider pane-divider-${kind}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={kind === "sidebar" ? 184 : 340}
      aria-valuemax={
        kind === "sidebar"
          ? Math.min(340, layout.width - (hasDetail ? 620 : 300))
          : Math.min(1000, layout.width - layout.fitted.sidebar - 280)
      }
      aria-valuenow={layout.fitted[kind]}
      aria-valuetext={`${layout.fitted[kind]} pixels`}
      title={`${label} · Drag or use arrow keys · Double-click to reset`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          widths: layout.fitted,
          pointer: event.pointerId,
        };
        layout.shell.current?.classList.add("is-resizing-panes");
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointer !== event.pointerId) return;
        const delta = event.clientX - drag.current.x;
        layout.change(
          fitPaneWidths(
            {
              ...drag.current.widths,
              [kind]:
                drag.current.widths[kind] +
                (kind === "sidebar" ? delta : -delta),
            },
            layout.width,
            hasDetail,
          ),
        );
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={() => {
        if (drag.current) finish();
      }}
      onDoubleClick={() => apply(defaultPaneWidths(layout.width)[kind], true)}
      onKeyDown={(event) => {
        if (event.key === "Home") {
          event.preventDefault();
          apply(defaultPaneWidths(layout.width)[kind], true);
        }
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        apply(
          layout.fitted[kind] +
            direction *
              (kind === "detail" ? -1 : 1) *
              (event.shiftKey ? 64 : 16),
          true,
        );
      }}
    />
  );
}
