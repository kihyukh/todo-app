import { lazy, Suspense } from "react";
import { openNoteLink } from "./note-links";

// Native apps open PDFs with Quick Look / the system viewer. Keep the browser
// renderer and its font/worker resources entirely out of native distributions.
const BrowserPdfPreview =
  import.meta.env.VITE_NATIVE_APP === "1"
    ? null
    : lazy(() => import("./BrowserPdfPreview"));

export default function PdfPreview({
  url,
  name,
}: {
  url: string;
  name: string;
}) {
  if (!BrowserPdfPreview) {
    return (
      <button type="button" onClick={() => openNoteLink(url)}>
        Open {name}
      </button>
    );
  }
  return (
    <Suspense fallback={<p role="status">Opening PDF…</p>}>
      <BrowserPdfPreview url={url} name={name} />
    </Suspense>
  );
}
