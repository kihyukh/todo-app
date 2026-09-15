import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  FileWarning,
  LoaderCircle,
} from "lucide-react";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  RenderTask,
  TextLayer,
} from "pdfjs-dist";
import "./pdf-preview.css";

// PDF resources stay inside the app, including the CMaps needed by Korean PDFs.
// Vite emits the URLs; the viewer only fetches resources requested by a document.
const resources = import.meta.glob<string>(
  [
    "../node_modules/pdfjs-dist/cmaps/*.bcmap",
    "../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    "../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg,qcms_bg}.wasm",
    "../node_modules/pdfjs-dist/wasm/*_nowasm_fallback.js",
  ],
  { eager: true, query: "?url", import: "default" },
);

class LocalPdfResources {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory = {
      cMapUrl: "cmaps",
      standardFontDataUrl: "standard_fonts",
      wasmUrl: "wasm",
    }[kind];
    const url =
      directory &&
      resources[`../node_modules/pdfjs-dist/${directory}/${filename}`];
    if (!url) throw new Error("This PDF resource is unavailable.");
    const response = await fetch(url);
    if (!response.ok) throw new Error("This PDF resource could not be loaded.");
    return new Uint8Array(await response.arrayBuffer());
  }
}

type PdfEngine = typeof import("pdfjs-dist");
type LoadedPdf = { url: string; document: PDFDocumentProxy; engine: PdfEngine };

export default function PdfPreview({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [width, setWidth] = useState(720);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [pageError, setPageError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setPageNumber(1);
    setLoading(true);
    setError("");
    setPageError("");
    async function load() {
      try {
        const [engine, worker] = await Promise.all([
          import("pdfjs-dist"),
          import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
        ]);
        if (cancelled) return;
        engine.GlobalWorkerOptions.workerSrc = worker.default;
        task = engine.getDocument({
          url,
          BinaryDataFactory: LocalPdfResources,
          useWorkerFetch: false,
        });
        const document = await task.promise;
        if (!cancelled) setPdf({ url, document, engine });
      } catch (reason) {
        if (!cancelled) {
          setError(
            reason instanceof Error && reason.name === "PasswordException"
              ? "This PDF needs a password. Open it in your PDF viewer to unlock it."
              : "This PDF could not be previewed. You can still download it or open it in your PDF viewer.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
      // This also releases the document and its dedicated worker.
      void task?.destroy().catch(() => {});
    };
  }, [url]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth)
        setWidth(Math.max(160, element.clientWidth - 40));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const container = pageRef.current;
    if (!container || !pdf || pdf.url !== url) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    let textLayer: TextLayer | undefined;
    setRendering(true);
    setPageError("");
    container.replaceChildren();
    scrollRef.current?.scrollTo?.({ top: 0 });
    async function render() {
      try {
        const page = await pdf!.document.getPage(pageNumber);
        if (cancelled) return;
        const unscaled = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: width / unscaled.width });
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas is unavailable.");
        canvas.width = Math.ceil(viewport.width * pixelRatio);
        canvas.height = Math.ceil(viewport.height * pixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        canvas.setAttribute("aria-hidden", "true");
        const text = document.createElement("div");
        text.className = "pdf-preview-text";
        text.setAttribute("role", "document");
        text.setAttribute("aria-label", `${name}, page ${pageNumber}`);
        text.style.setProperty(
          "--total-scale-factor",
          `${viewport.scale * page.userUnit}`,
        );
        text.style.setProperty("--scale-round-x", "1px");
        text.style.setProperty("--scale-round-y", "1px");
        container!.style.width = `${viewport.width}px`;
        container!.style.height = `${viewport.height}px`;
        container!.append(canvas, text);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform:
            pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        setRendering(false);
        // Text selection is supplementary; a damaged text layer must not hide a
        // successfully rendered scanned page or prevent page navigation.
        try {
          const content = await page.getTextContent();
          if (cancelled) return;
          textLayer = new pdf!.engine.TextLayer({
            textContentSource: content,
            container: text,
            viewport,
          });
          await textLayer.render();
        } catch {
          if (!cancelled) text.replaceChildren();
        }
      } catch {
        if (!cancelled) {
          setPageError(
            "This page could not be displayed. Try another page, or open the PDF in your viewer.",
          );
          setRendering(false);
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      container.replaceChildren();
    };
  }, [pdf, url, pageNumber, width, name]);

  const loadedDocument = pdf?.url === url ? pdf.document : null;
  const busy = loading || rendering;
  return (
    <div className="pdf-preview" aria-label="PDF preview" aria-busy={busy}>
      <div className="pdf-preview-controls" role="group" aria-label="PDF pages">
        <button
          type="button"
          aria-label="Previous PDF page"
          disabled={!loadedDocument || pageNumber <= 1}
          onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
        >
          <ChevronLeft size={17} />
        </button>
        <span aria-live="polite">
          {loadedDocument
            ? `Page ${pageNumber} of ${loadedDocument.numPages}`
            : "PDF preview"}
        </span>
        <button
          type="button"
          aria-label="Next PDF page"
          disabled={!loadedDocument || pageNumber >= loadedDocument.numPages}
          onClick={() =>
            setPageNumber((value) =>
              Math.min(loadedDocument?.numPages ?? 1, value + 1),
            )
          }
        >
          <ChevronRight size={17} />
        </button>
      </div>
      <div className="pdf-preview-scroll" ref={scrollRef}>
        {busy && !error && (
          <div className="pdf-preview-message" role="status">
            <LoaderCircle size={20} className="pdf-preview-spinner" />
            <span>{loading ? "Opening PDF…" : "Loading page…"}</span>
          </div>
        )}
        {(error || pageError) && (
          <div className="pdf-preview-message is-error" role="alert">
            <FileWarning size={24} />
            <p>{error || pageError}</p>
          </div>
        )}
        <div
          className="pdf-preview-page"
          ref={pageRef}
          hidden={busy || !!error || !!pageError}
        />
      </div>
    </div>
  );
}
