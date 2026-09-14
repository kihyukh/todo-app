// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import TaskScheduleField from "../src/TaskScheduleField";
import type { TaskSchedule } from "../src/TaskScheduleField";

let root: Root | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete window.__DAYMARK_PLATFORM__;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount(
  dates: string[] = [],
  deadline: string | null = "2026-09-28",
  today = "2026-09-15",
) {
  const onChange = vi.fn();
  let saved: TaskSchedule = { dates, deadline };
  let receive!: (value: TaskSchedule) => void;
  function Harness() {
    const [value, setValue] = useState({ dates, deadline });
    saved = value;
    receive = setValue;
    return (
      <TaskScheduleField
        {...value}
        today={today}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  return {
    onChange,
    receive,
    saved: () => saved,
    work: container.querySelector<HTMLButtonElement>(
      ".task-schedule-trigger.is-work",
    )!,
    deadline: container.querySelector<HTMLButtonElement>(
      ".task-schedule-trigger.is-deadline",
    )!,
  };
}
const panel = () =>
  document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Task dates"]',
  );
const day = (date: string) =>
  panel()?.querySelector<HTMLButtonElement>(`[data-schedule-day="${date}"]`)!;
const button = (name: string) =>
  [...(panel()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (node) =>
      node.getAttribute("aria-label") === name ||
      node.textContent?.trim() === name,
  )!;
const tab = (name: string) =>
  [
    ...(panel()?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []),
  ].find((node) => node.textContent === name)!;
async function click(element: HTMLElement | null) {
  expect(element).toBeTruthy();
  await act(async () => element!.click());
}
async function key(value: string, shiftKey = false) {
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: value,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}

describe("a shared work-day and deadline draft", () => {
  it("retains a clear overdue deadline indicator without changing the saved schedule", async () => {
    const harness = await mount(["2026-09-15"], "2026-09-12");
    expect(harness.deadline.classList.contains("is-overdue")).toBe(true);
    expect(harness.deadline.getAttribute("aria-label")).toContain("overdue");
    expect(harness.deadline.title).toContain("September 12, 2026");
    expect(harness.deadline.textContent).toBe("Due Sep 12");
    expect(harness.onChange).not.toHaveBeenCalled();
  });
  it("shows compact saved summaries and exposes every selected date accessibly", async () => {
    const harness = await mount(["2026-09-01", "2026-09-15", "2027-01-03"]);
    expect(harness.work.textContent).toBe("Today+2");
    expect(harness.work.getAttribute("aria-label")).toContain(
      "September 1, 2026",
    );
    expect(harness.work.title).toContain("January 3, 2027");
    expect(harness.deadline.textContent).toBe("Due Sep 28");
    await click(harness.deadline);
    expect(tab("Deadline").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(day("2026-09-28"));
    expect(
      panel()
        ?.querySelector('[role="grid"]')
        ?.getAttribute("aria-multiselectable"),
    ).toBe("false");
    await key("Escape");
    expect(document.activeElement).toBe(harness.deadline);
  });

  it("drafts noncontiguous dates across months and commits once without filling a range", async () => {
    const harness = await mount();
    await click(harness.work);
    await click(day("2026-09-16"));
    await click(day("2026-09-21"));
    expect(day("2026-09-17").getAttribute("aria-pressed")).toBe("false");
    await click(button("Next month"));
    await click(day("2026-10-08"));
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(harness.work.textContent).toBe("Work days");
    expect(panel()).not.toBeNull();
    expect(panel()?.querySelector(".task-schedule-warning")?.textContent).toBe(
      "1 work day falls after the deadline.",
    );
    await click(button("Previous month"));
    expect(day("2026-09-16").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-21").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-28").classList.contains("has-deadline")).toBe(true);
    await click(button("Save"));
    expect(harness.onChange).toHaveBeenCalledExactlyOnceWith({
      dates: ["2026-09-16", "2026-09-21", "2026-10-08"],
      deadline: "2026-09-28",
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(harness.work);
    expect(harness.work.textContent).toBe("Tomorrow+2");
  });

  it("changes only one deadline while retaining the work draft across both tabs", async () => {
    const harness = await mount(["2026-09-15"]);
    await click(harness.work);
    await click(day("2026-09-18"));
    await click(tab("Deadline"));
    await click(day("2026-09-22"));
    await click(day("2026-09-25"));
    expect(day("2026-09-22").getAttribute("aria-pressed")).toBe("false");
    expect(day("2026-09-25").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-18").classList.contains("has-work")).toBe(true);
    await click(tab("Work days"));
    expect(day("2026-09-15").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-18").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-25").getAttribute("aria-pressed")).toBe("false");
    expect(harness.onChange).not.toHaveBeenCalled();
    await click(button("Save"));
    expect(harness.saved()).toEqual({
      dates: ["2026-09-15", "2026-09-18"],
      deadline: "2026-09-25",
    });
    expect(harness.onChange).toHaveBeenCalledTimes(1);
  });

  it("adds and toggles quick work dates without replacing existing dates", async () => {
    const harness = await mount(["2026-10-08"]);
    await click(harness.work);
    await click(button("Today"));
    await click(button("Tomorrow"));
    await click(button("Next week"));
    await click(button("Today"));
    expect(button("Today").getAttribute("aria-pressed")).toBe("false");
    expect(harness.onChange).not.toHaveBeenCalled();
    await click(button("Save"));
    expect(harness.saved()).toEqual({
      dates: ["2026-09-16", "2026-09-22", "2026-10-08"],
      deadline: "2026-09-28",
    });
  });

  it("removes one work chip and clears only the active tab", async () => {
    const harness = await mount(["2026-09-15", "2026-09-18", "2026-10-08"]);
    await click(harness.work);
    const chip = panel()?.querySelector<HTMLButtonElement>(
      '.task-schedule-chips button[title*="September 18"]',
    )!;
    await act(async () => chip.focus());
    await click(chip);
    expect(day("2026-09-18").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(day("2026-09-15"));
    await click(tab("Deadline"));
    await click(button("Clear deadline"));
    expect(button("Clear deadline").disabled).toBe(true);
    expect(
      panel()?.querySelector(".task-schedule-summary")?.textContent,
    ).toContain("2 work days");
    await click(button("Save"));
    expect(harness.saved()).toEqual({
      dates: ["2026-09-15", "2026-10-08"],
      deadline: null,
    });
    await click(harness.deadline);
    await click(day("2026-09-25"));
    await click(tab("Work days"));
    await click(button("Clear work days"));
    expect(button("Clear work days").disabled).toBe(true);
    expect(panel()?.querySelector(".task-schedule-chips")).toBeNull();
    expect(panel()?.querySelector(".task-schedule-deadline")?.textContent).toBe(
      "Due Sep 25",
    );
    await click(button("Save"));
    expect(harness.saved()).toEqual({ dates: [], deadline: "2026-09-25" });
  });

  it.each(["Cancel", "Close date picker", "Escape", "outside"])(
    "discards both draft fields on %s and restores trigger focus",
    async (dismiss) => {
      const harness = await mount(["2026-09-15"]);
      await click(harness.work);
      await click(day("2026-09-17"));
      await click(tab("Deadline"));
      await click(day("2026-09-23"));
      if (dismiss === "Escape") await key("Escape");
      else if (dismiss === "outside")
        await act(async () =>
          document.body.dispatchEvent(
            new Event("pointerdown", { bubbles: true }),
          ),
        );
      else await click(button(dismiss));
      expect(panel()).toBeNull();
      expect(document.activeElement).toBe(harness.work);
      expect(harness.onChange).not.toHaveBeenCalled();
      expect(harness.saved()).toEqual({
        dates: ["2026-09-15"],
        deadline: "2026-09-28",
      });
      await click(harness.work);
      expect(day("2026-09-17").getAttribute("aria-pressed")).toBe("false");
      expect(day("2026-09-28").classList.contains("has-deadline")).toBe(true);
    },
  );
});

describe("calendar keyboard, touch, and sync behavior", () => {
  it("shows date focus outlines for keyboard navigation and removes them after touch without losing focus", async () => {
    const harness = await mount();
    await act(async () =>
      harness.work.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    await click(harness.work);
    expect(panel()?.classList.contains("has-keyboard-focus")).toBe(false);
    expect(document.activeElement).toBe(day("2026-09-15"));
    await key("ArrowRight");
    expect(panel()?.classList.contains("has-keyboard-focus")).toBe(true);
    expect(document.activeElement).toBe(day("2026-09-16"));
    await act(async () =>
      day("2026-09-18").dispatchEvent(
        new Event("pointerdown", { bubbles: true }),
      ),
    );
    await click(day("2026-09-18"));
    expect(panel()?.classList.contains("has-keyboard-focus")).toBe(false);
    expect(document.activeElement).toBe(day("2026-09-18"));
    expect(day("2026-09-18").getAttribute("aria-pressed")).toBe("true");
  });
  it("reveals keyboard-focused dates inside a short scrolling body without scrolling the outer page", async () => {
    const harness = await mount();
    await click(harness.work);
    const body = panel()!.querySelector<HTMLElement>(".task-schedule-body")!;
    vi.spyOn(body, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 350, 120),
    );
    vi.spyOn(day("2026-09-22"), "getBoundingClientRect").mockImplementation(
      () => new DOMRect(0, 260 - body.scrollTop, 44, 44),
    );
    const outerTop = document.documentElement.scrollTop;
    await key("ArrowDown");
    expect(document.activeElement).toBe(day("2026-09-22"));
    expect(body.scrollTop).toBe(88);
    expect(document.documentElement.scrollTop).toBe(outerTop);
    const dateBounds = day("2026-09-22").getBoundingClientRect();
    expect(dateBounds.bottom).toBeLessThanOrEqual(
      body.getBoundingClientRect().bottom - 4,
    );
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  it("keeps global search/new-task shortcuts from escaping the modal, and discards before native New Task", async () => {
    const harness = await mount();
    await click(harness.work);
    await click(day("2026-09-18"));
    const listener = vi.fn();
    window.addEventListener("keydown", listener);
    try {
      for (const combination of [
        { key: "k", metaKey: true },
        { key: "n", ctrlKey: true },
      ]) {
        const event = new KeyboardEvent("keydown", {
          ...combination,
          bubbles: true,
          cancelable: true,
        });
        await act(async () => document.activeElement?.dispatchEvent(event));
        expect(event.defaultPrevented).toBe(true);
        expect(panel()?.contains(document.activeElement)).toBe(true);
      }
      expect(listener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", listener);
    }
    await act(async () =>
      window.dispatchEvent(new CustomEvent("daymark-new-task")),
    );
    expect(panel()).toBeNull();
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(harness.saved().dates).toEqual([]);
  });
  it("navigates leap-month boundaries and toggles individual dates with Enter and Space", async () => {
    const harness = await mount([], null, "2028-01-31");
    await click(harness.work);
    expect(document.activeElement).toBe(day("2028-01-31"));
    await key("PageDown");
    expect(document.activeElement).toBe(day("2028-02-29"));
    await key("Enter");
    await key("ArrowRight");
    expect(document.activeElement).toBe(day("2028-03-01"));
    await key(" ");
    await key("ArrowDown");
    expect(document.activeElement).toBe(day("2028-03-08"));
    await key("ArrowUp");
    expect(day("2028-02-29").classList.contains("is-adjoining")).toBe(true);
    expect(harness.onChange).not.toHaveBeenCalled();
    await click(button("Save"));
    expect(harness.saved()).toEqual({
      dates: ["2028-02-29", "2028-03-01"],
      deadline: null,
    });
  });

  it("traps Tab, navigates tabs with arrows, and uses the same popup from either trigger", async () => {
    const harness = await mount();
    await click(harness.work);
    const originalPanel = panel();
    await act(async () => button("Save").focus());
    await key("Tab");
    expect(document.activeElement).toBe(tab("Work days"));
    await key("Tab", true);
    expect(document.activeElement).toBe(button("Save"));
    await act(async () => tab("Work days").focus());
    await key("ArrowRight");
    expect(document.activeElement).toBe(tab("Deadline"));
    expect(tab("Deadline").getAttribute("aria-selected")).toBe("true");
    await key("ArrowLeft");
    await click(harness.deadline);
    expect(panel()).toBe(originalPanel);
    expect(document.activeElement).toBe(day("2026-09-28"));
    await key("Escape");
    expect(document.activeElement).toBe(harness.deadline);
    expect(harness.onChange).not.toHaveBeenCalled();
  });

  it("discards a stale draft when a changed schedule arrives and opens the fresh schedule", async () => {
    const harness = await mount(["2026-09-15"]);
    await click(harness.work);
    await click(day("2026-09-19"));
    const staleSave = button("Save");
    const incoming = { dates: ["2026-10-04"], deadline: "2026-11-12" };
    await act(async () => harness.receive(incoming));
    expect(panel()).toBeNull();
    await click(staleSave);
    expect(harness.onChange).not.toHaveBeenCalled();
    expect(harness.saved()).toEqual(incoming);
    await click(harness.work);
    expect(document.activeElement).toBe(day("2026-10-04"));
    expect(
      panel()?.querySelector(".task-schedule-summary")?.textContent,
    ).toContain("1 work day");
    await click(button("Save"));
    expect(harness.onChange).toHaveBeenCalledExactlyOnceWith(incoming);
  });

  it("retains the draft across equivalent incoming arrays instead of treating a rerender as a sync conflict", async () => {
    const harness = await mount(["2026-09-15", "2026-09-18"]);
    await click(harness.work);
    await click(day("2026-09-21"));
    await act(async () =>
      harness.receive({
        dates: ["2026-09-18", "2026-09-15", "2026-09-18"],
        deadline: "2026-09-28",
      }),
    );
    expect(panel()).not.toBeNull();
    expect(day("2026-09-21").getAttribute("aria-pressed")).toBe("true");
    await click(button("Save"));
    expect(harness.saved().dates).toEqual([
      "2026-09-15",
      "2026-09-18",
      "2026-09-21",
    ]);
  });

  it("keeps the touch sheet draft during viewport changes and fits above the keyboard", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    vi.stubGlobal("innerWidth", 390);
    const viewport = Object.assign(new EventTarget(), {
      width: 390,
      height: 844,
      offsetTop: 0,
      offsetLeft: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const harness = await mount();
    await click(harness.work);
    expect(panel()?.classList.contains("is-touch")).toBe(true);
    expect(panel()?.classList.contains("is-sheet")).toBe(true);
    expect(document.querySelector(".task-schedule-backdrop")).not.toBeNull();
    await click(day("2026-09-18"));
    await act(async () => {
      viewport.height = 420;
      viewport.offsetTop = 10;
      viewport.dispatchEvent(new Event("resize"));
      frame?.(0);
    });
    expect(panel()).not.toBeNull();
    expect(panel()?.style.maxHeight).toBe("404px");
    expect(Number.parseFloat(panel()!.style.top)).toBeGreaterThanOrEqual(10);
    expect(day("2026-09-18").getAttribute("aria-pressed")).toBe("true");
    expect(harness.onChange).not.toHaveBeenCalled();
    await act(async () =>
      document
        .querySelector(".task-schedule-backdrop")
        ?.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(panel()).toBeNull();
    expect(harness.onChange).not.toHaveBeenCalled();
  });
});
