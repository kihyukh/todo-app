// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fitPaneWidths, PaneDivider, usePaneWidths } from "../src/PaneResize";
let root: ReturnType<typeof createRoot> | undefined;
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  localStorage.clear();
});
describe("resizable workspace panes", () => {
  it("keeps both task panes usable while constraining saved preferences", () => {
    const sizes = fitPaneWidths({ sidebar: 900, detail: 1800 }, 1024, true);
    expect(sizes.sidebar).toBeLessThanOrEqual(340);
    expect(sizes.detail).toBeGreaterThanOrEqual(340);
    expect(1024 - sizes.sidebar - sizes.detail).toBeGreaterThanOrEqual(280);
    const smaller = fitPaneWidths({ sidebar: 30, detail: 10 }, 1200, true);
    expect(smaller).toEqual({ sidebar: 184, detail: 340 });
  });
  it("resizes with keyboard controls, persists on this device, and restores defaults", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1400,
    });
    function Harness() {
      const layout = usePaneWidths(true);
      return (
        <div ref={layout.shell} style={layout.style}>
          <PaneDivider kind="sidebar" layout={layout} hasDetail />
          <PaneDivider kind="detail" layout={layout} hasDetail />
        </div>
      );
    }
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<Harness />));
    const navigation = host.querySelector<HTMLElement>(
      '[aria-label="Resize navigation pane"]',
    )!;
    const detail = host.querySelector<HTMLElement>(
      '[aria-label="Resize task detail pane"]',
    )!;
    await act(async () =>
      navigation.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(navigation.getAttribute("aria-valuenow")).toBe("240");
    expect(JSON.parse(localStorage.getItem("daymark.panes.v1")!).sidebar).toBe(
      240,
    );
    const before = Number(detail.getAttribute("aria-valuenow"));
    await act(async () =>
      detail.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
          shiftKey: true,
        }),
      ),
    );
    expect(Number(detail.getAttribute("aria-valuenow"))).toBe(before + 64);
    await act(async () =>
      navigation.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(navigation.getAttribute("aria-valuenow")).toBe("224");
  });
});
