// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PdfPreview from "../src/PdfPreview";

const engine = vi.hoisted(() => ({
  getDocument: vi.fn(),
  workerOptions: { workerSrc: "" },
  textLayers: [] as { cancel: ReturnType<typeof vi.fn> }[],
}));
vi.mock("pdfjs-dist", () => ({
  getDocument: engine.getDocument,
  GlobalWorkerOptions: engine.workerOptions,
  TextLayer: class {
    cancel = vi.fn();
    container: HTMLElement;
    constructor({ container }: { container: HTMLElement }) {
      this.container = container;
      engine.textLayers.push(this);
    }
    async render() {
      const text = document.createElement("span");
      text.textContent = "Selectable document text";
      this.container.append(text);
    }
  },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: "/local-pdf.worker.mjs",
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function pdfFixture(numPages = 3) {
  const renders: {
    cancel: ReturnType<typeof vi.fn>;
    promise: Promise<void>;
  }[] = [];
  const page = {
    userUnit: 1,
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
    })),
    getTextContent: vi.fn(async () => ({
      items: [{ str: "Selectable document text" }],
    })),
    render: vi.fn(() => {
      const render = { promise: Promise.resolve(), cancel: vi.fn() };
      renders.push(render);
      return render;
    }),
  };
  const document = { numPages, getPage: vi.fn(async () => page) };
  const loading = {
    promise: Promise.resolve(document),
    destroy: vi.fn(async () => {}),
  };
  return { page, document, loading, renders };
}

let root: Root | undefined;
let observer: ResizeObserverCallback;
let disconnect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  engine.getDocument.mockReset();
  engine.textLayers = [];
  disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        observer = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function settle() {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}
async function mount(url = "blob:first") {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(<PdfPreview url={url} name="Paper.pdf" />),
  );
  await settle();
}
function button(label: string) {
  return document.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )!;
}
async function click(label: string) {
  await act(async () => button(label).click());
}

describe("PDF preview", () => {
  it("renders pages with selectable text using a local worker and useful navigation boundaries", async () => {
    const fixture = pdfFixture();
    engine.getDocument.mockReturnValue(fixture.loading);
    await mount();
    expect(engine.workerOptions.workerSrc).toBe("/local-pdf.worker.mjs");
    expect(engine.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "blob:first",
        useWorkerFetch: false,
        BinaryDataFactory: expect.any(Function),
      }),
    );
    expect(document.querySelector("canvas")).toBeTruthy();
    expect(document.querySelector('[role="document"]')?.textContent).toBe(
      "Selectable document text",
    );
    expect(document.body.textContent).toContain("Page 1 of 3");
    expect(button("Previous PDF page").disabled).toBe(true);
    await click("Next PDF page");
    expect(document.body.textContent).toContain("Page 2 of 3");
    expect(fixture.document.getPage).toHaveBeenLastCalledWith(2);
    expect(fixture.renders[0].cancel).toHaveBeenCalledOnce();
    expect(engine.textLayers[0].cancel).toHaveBeenCalledOnce();
    await click("Next PDF page");
    expect(button("Next PDF page").disabled).toBe(true);
    await click("Previous PDF page");
    expect(document.body.textContent).toContain("Page 2 of 3");
  });

  it("cancels unfinished page rendering during navigation and ignores late failures", async () => {
    const fixture = pdfFixture();
    const firstRender = deferred<void>();
    const cancel = vi.fn();
    fixture.page.render.mockReturnValueOnce({
      promise: firstRender.promise,
      cancel,
    });
    engine.getDocument.mockReturnValue(fixture.loading);
    await mount();
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "Loading page",
    );
    await click("Next PDF page");
    expect(cancel).toHaveBeenCalledOnce();
    await act(async () => firstRender.reject(new Error("Rendering cancelled")));
    expect(document.body.textContent).toContain("Page 2 of 3");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(
      document.querySelector<HTMLElement>(".pdf-preview-page")?.hidden,
    ).toBe(false);
  });

  it("does not render a stale document after switching attachment URLs", async () => {
    const first = deferred<ReturnType<typeof pdfFixture>["document"]>();
    const destroy = vi.fn(async () => {});
    const second = pdfFixture(1);
    engine.getDocument
      .mockReturnValueOnce({ promise: first.promise, destroy })
      .mockReturnValueOnce(second.loading);
    await mount();
    expect(document.body.textContent).toContain("Opening PDF");
    await act(async () =>
      root!.render(<PdfPreview url="blob:second" name="Second.pdf" />),
    );
    await settle();
    const stale = pdfFixture(15);
    await act(async () => first.resolve(stale.document));
    expect(destroy).toHaveBeenCalledOnce();
    expect(stale.document.getPage).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Page 1 of 1");
    expect(
      document.querySelector('[role="document"]')?.getAttribute("aria-label"),
    ).toBe("Second.pdf, page 1");
  });

  it("cancels loading and prevents rendering after preview closes", async () => {
    const pending = deferred<ReturnType<typeof pdfFixture>["document"]>();
    const destroy = vi.fn(async () => {});
    engine.getDocument.mockReturnValue({ promise: pending.promise, destroy });
    await mount();
    await act(async () => root!.unmount());
    root = undefined;
    const fixture = pdfFixture();
    await act(async () => pending.resolve(fixture.document));
    expect(destroy).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(fixture.document.getPage).not.toHaveBeenCalled();
  });

  it("refits the page when the preview width changes", async () => {
    const fixture = pdfFixture();
    engine.getDocument.mockReturnValue(fixture.loading);
    await mount();
    const scroller = document.querySelector(".pdf-preview-scroll")!;
    Object.defineProperty(scroller, "clientWidth", {
      configurable: true,
      value: 340,
    });
    await act(async () => observer([], {} as ResizeObserver));
    expect(document.querySelector("canvas")?.style.width).toBe("300px");
    expect(fixture.renders[0].cancel).toHaveBeenCalledOnce();
  });

  it("keeps a successfully rendered page visible if text extraction fails", async () => {
    const fixture = pdfFixture();
    fixture.page.getTextContent.mockRejectedValueOnce(new Error("No text"));
    engine.getDocument.mockReturnValue(fixture.loading);
    await mount();
    expect(document.querySelector("canvas")).toBeTruthy();
    expect(
      document.querySelector<HTMLElement>(".pdf-preview-page")?.hidden,
    ).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    [new Error("Invalid PDF"), "This PDF could not be previewed"],
    [
      Object.assign(new Error("Password required"), {
        name: "PasswordException",
      }),
      "This PDF needs a password",
    ],
  ])(
    "explains loading failures while leaving external viewer/download available",
    async (reason, message) => {
      const pending = deferred<never>();
      engine.getDocument.mockReturnValue({
        promise: pending.promise,
        destroy: vi.fn(async () => {}),
      });
      await mount();
      await act(async () => pending.reject(reason));
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        message,
      );
      expect(button("Next PDF page").disabled).toBe(true);
      expect(
        document
          .querySelector('[aria-label="PDF preview"]')
          ?.getAttribute("aria-busy"),
      ).toBe("false");
    },
  );
});
