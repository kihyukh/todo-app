// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  detailLayoutForWidth,
  fitPaneWidths,
  PaneDivider,
  usePaneWidths,
} from "../src/PaneResize";
let root: ReturnType<typeof createRoot> | undefined;
const STORAGE_KEY = "daymark.panes.v1";
const originalWidth = window.innerWidth;
function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
}
async function resize(width: number) {
  await act(async () => {
    setWidth(width);
    window.dispatchEvent(new Event("resize"));
  });
}
function Harness({
  hasDetail = true,
  loaded = true,
}: {
  hasDetail?: boolean;
  loaded?: boolean;
}) {
  const layout = usePaneWidths(hasDetail);
  if (!loaded) return <div>Loading</div>;
  return (
    <div
      ref={layout.shell}
      style={layout.style}
      data-layout={layout.detailLayout}
    >
      <PaneDivider kind="sidebar" layout={layout} hasDetail={hasDetail} />
      <PaneDivider kind="detail" layout={layout} hasDetail={hasDetail} />
    </div>
  );
}
async function mount(props: Parameters<typeof Harness>[0] = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness {...props} />));
  return host;
}
function navigation(host: HTMLElement) {
  return host.querySelector<HTMLElement>(
    '[aria-label="Resize navigation pane"]',
  );
}
function detail(host: HTMLElement) {
  return host.querySelector<HTMLElement>(
    '[aria-label="Resize task detail pane"]',
  );
}
async function key(element: HTMLElement, value: string, shiftKey = false) {
  await act(async () =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: value, bubbles: true, shiftKey }),
    ),
  );
}
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => setWidth(1400));
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  setWidth(originalWidth);
  vi.unstubAllGlobals();
});
describe("resizable workspace panes", () => {
  it("docks only when navigation, task list, and detail all fit comfortably", () => {
    expect(detailLayoutForWidth(600)).toBe("fullscreen");
    expect(detailLayoutForWidth(601)).toBe("floating");
    expect(detailLayoutForWidth(983)).toBe("floating");
    expect(detailLayoutForWidth(984)).toBe("docked");
    expect(detailLayoutForWidth(1099, 340)).toBe("floating");
    expect(detailLayoutForWidth(1100, 340)).toBe("docked");
    expect(detailLayoutForWidth(943, 30)).toBe("floating");
    expect(detailLayoutForWidth(944, 30)).toBe("docked");
    expect(detailLayoutForWidth(1100, 900)).toBe("docked");
  });

  it("keeps both task panes usable while constraining saved preferences", () => {
    const sizes = fitPaneWidths({ sidebar: 900, detail: 1800 }, 1024, true);
    expect(sizes.sidebar).toBeLessThanOrEqual(340);
    expect(sizes.detail).toBeGreaterThanOrEqual(400);
    expect(1024 - sizes.sidebar - sizes.detail).toBeGreaterThanOrEqual(360);
    expect(fitPaneWidths({ sidebar: 30, detail: 10 }, 1200, true)).toEqual({
      sidebar: 184,
      detail: 400,
    });
  });

  it("retains saved widths while moving between docked, floating, and phone layouts", async () => {
    const saved = JSON.stringify({ sidebar: 300, detail: 720 });
    localStorage.setItem(STORAGE_KEY, saved);
    const host = await mount();
    const shell = host.firstElementChild as HTMLElement;
    expect(shell.dataset.layout).toBe("docked");
    expect(shell.style.getPropertyValue("--detail-width")).toBe("720px");
    await resize(800);
    expect(shell.dataset.layout).toBe("floating");
    expect(shell.style.getPropertyValue("--floating-detail-width")).toBe(
      "380px",
    );
    expect(navigation(host)).not.toBeNull();
    expect(detail(host)).toBeNull();
    await resize(600);
    expect(shell.dataset.layout).toBe("fullscreen");
    expect(host.querySelector('[role="separator"]')).toBeNull();
    await resize(1400);
    expect(shell.dataset.layout).toBe("docked");
    expect(shell.style.getPropertyValue("--sidebar-width")).toBe("300px");
    expect(shell.style.getPropertyValue("--detail-width")).toBe("720px");
    expect(localStorage.getItem(STORAGE_KEY)).toBe(saved);
  });

  it("chooses the same responsive mode before and after selecting a task", async () => {
    setWidth(1000);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sidebar: 300, detail: 600 }),
    );
    const host = await mount({ hasDetail: false });
    expect((host.firstElementChild as HTMLElement).dataset.layout).toBe(
      "floating",
    );
    await act(async () => root!.render(<Harness hasDetail />));
    expect((host.firstElementChild as HTMLElement).dataset.layout).toBe(
      "floating",
    );
    expect(detail(host)).toBeNull();
    expect(navigation(host)!.getAttribute("aria-valuenow")).toBe("300");
  });

  it("shows only the navigation divider without a selected task", async () => {
    const host = await mount({ hasDetail: false });
    expect(navigation(host)).not.toBeNull();
    expect(detail(host)).toBeNull();
    expect(navigation(host)!.getAttribute("aria-valuemax")).toBe("340");
  });

  it("resizes with keyboard controls, persists on this device, and restores defaults", async () => {
    const host = await mount();
    const navigationDivider = navigation(host)!;
    const detailDivider = detail(host)!;
    await key(navigationDivider, "ArrowRight");
    expect(navigationDivider.getAttribute("aria-valuenow")).toBe("240");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sidebar).toBe(240);
    const before = Number(detailDivider.getAttribute("aria-valuenow"));
    await key(detailDivider, "ArrowLeft", true);
    expect(Number(detailDivider.getAttribute("aria-valuenow"))).toBe(
      before + 64,
    );
    await key(navigationDivider, "Home");
    expect(navigationDivider.getAttribute("aria-valuenow")).toBe("224");
  });

  it("does not overwrite a preferred detail width when resizing floating navigation", async () => {
    setWidth(900);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sidebar: 224, detail: 800 }),
    );
    const host = await mount();
    await key(navigation(host)!, "ArrowRight");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      sidebar: 240,
      detail: 800,
    });
    await resize(1800);
    expect(detail(host)!.getAttribute("aria-valuenow")).toBe("800");
  });

  it("constrains keyboard resizing to the space available for each pane", async () => {
    setWidth(984);
    const host = await mount();
    expect(navigation(host)!.getAttribute("aria-valuemax")).toBe("224");
    expect(detail(host)!.getAttribute("aria-valuemin")).toBe("400");
    expect(detail(host)!.getAttribute("aria-valuemax")).toBe("400");
    await key(navigation(host)!, "ArrowRight", true);
    expect(navigation(host)!.getAttribute("aria-valuenow")).toBe("224");
    await key(detail(host)!, "ArrowLeft", true);
    expect(detail(host)!.getAttribute("aria-valuenow")).toBe("400");
  });

  it("keeps floating detail between 360 and 560 pixels while leaving list context", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ sidebar: 224, detail: 900 }),
    );
    const host = await mount();
    const shell = host.firstElementChild as HTMLElement;
    expect(shell.style.getPropertyValue("--floating-detail-width")).toBe(
      "560px",
    );
    await resize(700);
    expect(shell.style.getPropertyValue("--floating-detail-width")).toBe(
      "360px",
    );
  });

  it("ends an active divider drag when a narrower layout removes the divider", async () => {
    const host = await mount();
    const shell = host.firstElementChild as HTMLElement;
    const divider = detail(host)!;
    divider.setPointerCapture = vi.fn();
    await act(async () =>
      divider.dispatchEvent(
        Object.assign(
          new MouseEvent("pointerdown", {
            button: 0,
            clientX: 800,
            bubbles: true,
          }),
          { pointerId: 1 },
        ),
      ),
    );
    expect(shell.classList.contains("is-resizing-panes")).toBe(true);
    await resize(800);
    expect(detail(host)).toBeNull();
    expect(shell.classList.contains("is-resizing-panes")).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      sidebar: 224,
      detail: 588,
    });
  });

  it("observes the shell after loading and keeps that observer during resize renders", async () => {
    const callbacks: ResizeObserverCallback[] = [];
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          callbacks.push(callback);
        }
        observe = observe;
        disconnect = disconnect;
      },
    );
    const host = await mount({ loaded: false });
    expect(observe).not.toHaveBeenCalled();
    await act(async () => root!.render(<Harness loaded />));
    const shell = host.firstElementChild as HTMLElement;
    expect(observe).toHaveBeenCalledExactlyOnceWith(shell);
    Object.defineProperty(shell, "clientWidth", {
      configurable: true,
      value: 850,
    });
    await act(async () => callbacks[0]([], {} as ResizeObserver));
    expect(shell.dataset.layout).toBe("floating");
    expect(observe).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount());
    root = undefined;
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
