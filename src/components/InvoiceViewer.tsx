"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * THE INVOICE VIEWER — how a bill's attached scan is shown, everywhere.
 *
 * ONE RULE: never put the scan in an `<iframe>` on a page. An iframed PDF hands
 * the browser's own viewer a scrollbox inside the page, and the wheel belongs to
 * whatever the pointer happens to be over. Scroll down the /bill page or the
 * recode panel, cross the invoice, and the page stops moving while the PDF
 * scrolls instead. That is the whole reason this file exists.
 *
 * So a scan renders as a flat `<img>`, in the page flow, capped so it cannot set
 * the height of the thing around it. JobTread rasterises the PDF for us — see
 * `flatImageSrc`. Tapping it opens the lightbox: the same image, full screen,
 * with a fit/actual-size toggle. The lightbox is a dialog with nothing behind it
 * to scroll, so scrolling a zoomed image there is the point rather than a trap.
 *
 * The original PDF is always one click away, and is the ONLY way to page 2 —
 * JobTread's render is page 1. Both surfaces say so out loud rather than
 * quietly showing a first page as if it were the document.
 */

/** A file attached to a bill. Structurally the `BillFile` both callers already
 *  hold — see src/lib/jobtread.ts, which is where `imageUrl` is selected. */
export interface InvoiceFile {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  imageUrl?: string | null;
}

export const isImageFile = (f: InvoiceFile) =>
  /^image\//i.test(f.type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");

/**
 * The src that shows an attachment as a FLAT IMAGE — no viewer, no scrollbox.
 *
 * A scan is already an image, so it is its own answer. A PDF gets JobTread's
 * own rasterised page 1: `file.url({size})` answers `image/jpeg` off the same
 * CDN, `access-control-allow-origin: *` (probe-confirmed 2026-09-03). "" for
 * anything JobTread will not rasterise and that is not an image — that gets a
 * link, not a viewer.
 */
export const flatImageSrc = (f: InvoiceFile) => f.imageUrl || (isImageFile(f) ? f.url : "") || "";

/* ------------------------------------------------------------------ lightbox */

/**
 * The scan, full screen. Fit-to-screen by default; click to jump to actual size
 * and scroll around it. Escape or the backdrop closes it, and the page behind is
 * frozen while it is open so dismissing it puts you back where you were.
 */
export function InvoiceLightbox({ file, onClose }: { file: InvoiceFile; onClose: () => void }) {
  const [actual, setActual] = useState(false);
  const src = flatImageSrc(file);
  const isPdf = !isImageFile(file);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Freeze the page underneath: without this the wheel falls through to the
    // page once a fit-to-screen image has no scroll of its own to consume.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black/85"
      role="dialog"
      aria-modal="true"
      aria-label={file.name ?? "Invoice"}
      onClick={onClose}
    >
      {/* The bar carries the two things the image cannot: which file this is,
          and the way to the rest of a multi-page PDF. */}
      <div
        className="flex shrink-0 items-center gap-3 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="min-w-0 flex-1 truncate text-xs" title={file.name}>
          {file.name || "Invoice"}
          {isPdf && <span className="ml-2 text-white/50">page 1</span>}
        </span>
        {file.url && (
          <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-white/90 underline underline-offset-2 hover:text-white"
          >
            {isPdf ? "Open the full PDF ↗" : "Open the original ↗"}
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-white/80 hover:text-white"
        >
          ✕
        </button>
      </div>

      {/* `items-start` once zoomed, so a tall image starts at its top edge
          instead of being centred with its head off screen. */}
      <div
        className={`flex min-h-0 flex-1 justify-center overflow-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] ${
          actual ? "items-start" : "items-center"
        }`}
      >
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={file.name ?? "invoice"}
            onClick={(e) => {
              e.stopPropagation();
              setActual((a) => !a);
            }}
            className={
              actual
                ? "h-auto w-auto max-w-none cursor-zoom-out"
                : "max-h-full max-w-full cursor-zoom-in object-contain"
            }
          />
        ) : (
          <p className="self-center text-sm text-white/70">
            This attachment can&rsquo;t be shown as an image.
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- attachment */

/**
 * One attachment, in the page flow: the flat image, the lightbox behind a tap,
 * and the link out. `maxHClass` is the caller's cap — the scan must never be
 * what decides how tall the surrounding card is.
 */
export function InvoiceAttachment({
  file,
  maxHClass = "max-h-[32rem]",
  radiusClass = "rounded-lg",
}: {
  file: InvoiceFile;
  maxHClass?: string;
  radiusClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const src = flatImageSrc(file);
  const isPdf = !isImageFile(file);

  // Nothing to show and nowhere to send them: just name the file.
  if (!file.url) {
    return <span className="text-xs text-neutral-500 dark:text-neutral-400">{file.name}</span>;
  }

  return (
    <div>
      {src ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="View full screen"
          className="block w-full"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={file.name ?? "invoice"}
            className={`${maxHClass} ${radiusClass} w-full cursor-zoom-in border border-line object-contain dark:border-neutral-800`}
          />
        </button>
      ) : null}
      {isPdf && (
        <a
          href={file.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-xs font-semibold text-accent dark:text-accent-soft"
        >
          Open {file.name || "the PDF"} ↗
        </a>
      )}
      {open && <InvoiceLightbox file={file} onClose={close} />}
    </div>
  );
}
