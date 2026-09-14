// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WorkDatesField from "../src/WorkDatesField";

let root: Root | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete window.__DAYMARK_PLATFORM__;
});
async function mount(
  initial: string[] = [],
  deadline: string | null = "2026-10-15",
  today = "2026-09-14",
) {
  let selected = initial;
  const onChange = vi.fn();
  function Harness() {
    const [dates, setDates] = useState(initial);
    selected = dates;
    return (
      <WorkDatesField
        dates={dates}
        deadline={deadline}
        today={today}
        onChange={(next) => {
          onChange(next);
          setDates(next);
        }}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Harness />));
  const trigger = container.querySelector<HTMLButtonElement>(
    ".work-dates-trigger",
  )!;
  return { trigger, onChange, selected: () => selected };
}
const panel = () => document.querySelector('[role="dialog"]');
const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) =>
      node.getAttribute("aria-label") === name ||
      node.textContent?.trim() === name,
  )!;
const day = (date: string) =>
  document.querySelector<HTMLButtonElement>(`[data-work-day="${date}"]`)!;
async function click(element: HTMLElement) {
  expect(element).not.toBeNull();
  await act(async () => element.click());
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

describe("discrete work days", () => {
  it("selects noncontiguous dates across months without filling the days between them", async () => {
    const harness = await mount();
    await click(harness.trigger);
    await click(day("2026-09-16"));
    await click(day("2026-09-21"));
    expect(panel()).not.toBeNull();
    expect(day("2026-09-17").getAttribute("aria-pressed")).toBe("false");
    await click(button("Next month"));
    await click(day("2026-10-08"));
    expect(harness.selected()).toEqual([
      "2026-09-16",
      "2026-09-21",
      "2026-10-08",
    ]);
    expect(button("Next month")).not.toBeNull();
    await click(button("Previous month"));
    expect(day("2026-09-16").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-21").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-20").getAttribute("aria-pressed")).toBe("false");
    await click(button("Done"));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
    expect(harness.trigger.textContent).toContain("Sep 16");
    expect(harness.trigger.textContent).toContain("+2");
    expect(harness.trigger.title).toContain("October 8, 2026");
  });

  it("adds and toggles Today/Tomorrow without replacing other selected dates", async () => {
    const harness = await mount(["2026-10-08"]);
    await click(harness.trigger);
    await click(button("Today"));
    expect(harness.selected()).toEqual(["2026-09-14", "2026-10-08"]);
    expect(button("Today").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(day("2026-09-14"));
    await click(button("Tomorrow"));
    expect(harness.selected()).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-10-08",
    ]);
    await click(button("Today"));
    expect(harness.selected()).toEqual(["2026-09-15", "2026-10-08"]);
    expect(panel()).not.toBeNull();
  });

  it("removes exactly one selected date and clears the complete selection without closing", async () => {
    const harness = await mount(["2026-09-16", "2026-09-21", "2026-10-08"]);
    await click(harness.trigger);
    const chip = document.querySelector<HTMLButtonElement>(
      '[aria-label="Selected work days"] button[title*="September 21"]',
    )!;
    await act(async () => chip.focus());
    await click(chip);
    expect(harness.selected()).toEqual(["2026-09-16", "2026-10-08"]);
    expect(day("2026-09-21").getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(day("2026-09-16"));
    await click(button("Clear all"));
    expect(harness.selected()).toEqual([]);
    expect(panel()).not.toBeNull();
    expect(button("Clear all").disabled).toBe(true);
    expect(
      document.querySelector('[aria-label="Selected work days"]'),
    ).toBeNull();
    expect(harness.trigger.textContent).toContain("Choose days");
  });

  it("marks a separate deadline and allows later work days with an informative warning", async () => {
    const harness = await mount([], "2026-09-20");
    await click(harness.trigger);
    expect(day("2026-09-20").getAttribute("aria-label")).toContain("deadline");
    expect(day("2026-09-20").classList.contains("is-deadline")).toBe(true);
    expect(day("2026-09-20").getAttribute("aria-pressed")).toBe("false");
    await click(day("2026-09-21"));
    await click(day("2026-09-23"));
    expect(document.querySelector(".work-dates-warning")?.textContent).toBe(
      "2 work days fall after the deadline.",
    );
    expect(harness.selected()).toEqual(["2026-09-21", "2026-09-23"]);
    expect(document.querySelector(".work-dates-deadline")?.textContent).toBe(
      "Deadline: Sep 20",
    );
    await click(day("2026-09-20"));
    expect(day("2026-09-20").getAttribute("aria-pressed")).toBe("true");
    expect(day("2026-09-20").classList.contains("is-deadline")).toBe(true);
    await click(button("Clear all"));
    expect(document.querySelector(".work-dates-warning")).toBeNull();
    expect(document.querySelector(".work-dates-deadline")?.textContent).toBe(
      "Deadline: Sep 20",
    );
    expect(
      harness.onChange.mock.calls.every(([value]) => Array.isArray(value)),
    ).toBe(true);
  });

  it("shows the next upcoming work date while preserving past dates in its full accessible summary", async () => {
    const { trigger } = await mount(["2026-09-01", "2026-10-08", "2027-01-03"]);
    expect(trigger.textContent).toContain("Oct 8");
    expect(trigger.textContent).toContain("+2");
    expect(trigger.getAttribute("aria-label")).toContain("September 1, 2026");
    expect(trigger.title).toContain("January 3, 2027");
    await click(trigger);
    expect(
      document
        .querySelector('[role="grid"]')
        ?.getAttribute("aria-multiselectable"),
    ).toBe("true");
    expect(document.activeElement).toBe(day("2026-10-08"));
  });
});

describe("work-day calendar focus", () => {
  it("moves across a month boundary with arrows and toggles dates with Enter and Space", async () => {
    const harness = await mount([], null, "2026-09-30");
    await click(harness.trigger);
    expect(document.activeElement).toBe(day("2026-09-30"));
    await key("Enter");
    await key("ArrowRight");
    expect(document.activeElement).toBe(day("2026-10-01"));
    await key(" ");
    await key("ArrowDown");
    expect(document.activeElement).toBe(day("2026-10-08"));
    expect(harness.selected()).toEqual(["2026-09-30", "2026-10-01"]);
    await key("ArrowUp");
    await key(" ");
    expect(harness.selected()).toEqual(["2026-09-30"]);
    await key("Escape");
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(harness.trigger);
  });

  it("clamps month navigation to valid local calendar days, including leap February", async () => {
    const harness = await mount([], null, "2028-01-31");
    await click(harness.trigger);
    await key("PageDown");
    expect(document.activeElement).toBe(day("2028-02-29"));
    await key("Enter");
    await key("ArrowRight");
    expect(document.activeElement).toBe(day("2028-03-01"));
    await key("Enter");
    expect(harness.selected()).toEqual(["2028-02-29", "2028-03-01"]);
  });

  it("restores focus on outside dismissal and cycles Tab within the open popover", async () => {
    const { trigger } = await mount();
    await click(trigger);
    await act(async () => button("Done").focus());
    await key("Tab");
    expect(document.activeElement).toBe(button("Close work days"));
    await key("Tab", true);
    expect(document.activeElement).toBe(button("Done"));
    await act(async () =>
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses the touch calendar surface in native iOS without changing discrete selection behavior", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    const { trigger, selected } = await mount();
    await click(trigger);
    expect(panel()?.classList.contains("is-touch")).toBe(true);
    await click(day("2026-09-14"));
    await click(day("2026-09-18"));
    expect(selected()).toEqual(["2026-09-14", "2026-09-18"]);
    expect(panel()).not.toBeNull();
  });
});
