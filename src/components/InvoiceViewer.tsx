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
 * MULTI-PAGE. `?page=N` on the rasteriser URL renders page N, 1-based, and
 * answers HTTP 400 past the last page (probed live 2026-09-07 against a 3-page
 * bill: pages 1-3 are JPEG, page 4 is a 400). Nothing in the Pave schema says
 * how many pages a file has, so `usePageCount` asks for the next one until the
 * CDN says no. The pages then sit in a horizontal snap strip — swipe or scroll
 * sideways for page 2 — and the lightbox opens on whichever page you tapped.
 *
 * The original PDF is still one click away, for printing and for anything the
 * rasteriser will not render.
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

/**
 * The same rasteriser URL, for page `n` (1-based). `imageUrl` already carries
 * `?size=`, so this is always an extra parameter. An actual image has one page
 * and ignores this.
 */
export const pageSrc = (f: InvoiceFile, n: number) => {
  const base = flatImageSrc(f);
  if (!base || n <= 1 || isImageFile(f)) return base;
  return `${base}${base.includes("?") ? "&" : "?"}page=${n}`;
};

// ponytail: a scan longer than this stops at 20 pages rather than probing on
// forever. Raise it if a real vendor ever sends a longer bill.
const MAX_PAGES = 20;

/**
 * How many pages the rasteriser will give us for this file.
 *
 * There is no page count in the Pave schema, and `?page=N` past the end is a
 * 400 — so ask for the next page and believe the answer. Each probe is the very
 * image the strip then shows, so the browser cache makes the second request
 * free.
 */
function usePageCount(file: InvoiceFile) {
  const src = flatImageSrc(file);
  const isPdf = !isImageFile(file);
  const [count, setCount] = useState(1);

  useEffect(() => {
    setCount(1);
    if (!src || !isPdf) return;
    let alive = true;
    const probe = (n: number) => {
      if (!alive || n > MAX_PAGES) return;
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        setCount(n);
        probe(n + 1);
      };
      // A 400 is the expected end of the document, not a failure to report.
      img.onerror = () => {};
      img.src = pageSrc(file, n);
    };
    probe(2);
    return () => {
      alive = false;
    };
    // `file` is re-created each render by its caller; the URL is the identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, isPdf]);

  return count;
}

/* ------------------------------------------------------------------ lightbox */

/**
 * The scan, full screen. Fit-to-screen by default; click to jump to actual size
 * and scroll around it. Escape or the backdrop closes it, and the page behind is
 * frozen while it is open so dismissing it puts you back where you were.
 *
 * `page` is which page of a multi-page PDF to open on — the one that was tapped
 * in the strip. ← and → walk the rest.
 */
export function InvoiceLightbox({
  file,
  page = 1,
  onClose,
}: {
  file: InvoiceFile;
  page?: number;
  onClose: () => void;
}) {
  const [actual, setActual] = useState(false);
  const [n, setN] = useState(page);
  const pages = usePageCount(file);
  const src = pageSrc(file, n);
  const isPdf = !isImageFile(file);

  // A page change re-fits: actual size on page 1 says nothing about page 2.
  useEffect(() => setActual(false), [n]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setN((v) => Math.min(v + 1, pages));
      if (e.key === "ArrowLeft") setN((v) => Math.max(v - 1, 1));
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
  }, [onClose, pages]);

  const stepBtn =
    "shrink-0 rounded-lg px-2 py-1 text-sm leading-none text-white/80 hover:text-white disabled:opacity-30 disabled:hover:text-white/80";

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
        </span>
        {/* Page stepping, only when there IS another page. ← and → do the same
            thing, so a keyboard never needs the buttons. */}
        {pages > 1 && (
          <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-white/80">
            <button
              type="button"
              className={stepBtn}
              onClick={() => setN((v) => Math.max(v - 1, 1))}
              disabled={n <= 1}
              aria-label="Previous page"
            >
              ‹
            </button>
            page {n} / {pages}
            <button
              type="button"
              className={stepBtn}
              onClick={() => setN((v) => Math.min(v + 1, pages))}
              disabled={n >= pages}
              aria-label="Next page"
            >
              ›
            </button>
          </span>
        )}
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
            key={n}
            src={src}
            alt={pages > 1 ? `${file.name ?? "invoice"} page ${n}` : (file.name ?? "invoice")}
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
  /** The page the lightbox opens on, or 0 for closed — pages are 1-based. */
  const [open, setOpen] = useState(0);
  const close = useCallback(() => setOpen(0), []);
  const src = flatImageSrc(file);
  const isPdf = !isImageFile(file);
  const pages = usePageCount(file);

  // Nothing to show and nowhere to send them: just name the file.
  if (!file.url) {
    return <span className="text-xs text-neutral-500 dark:text-neutral-400">{file.name}</span>;
  }

  return (
    <div>
      {src ? (
        <>
          {/* ONE PAGE PER SCREENFUL, scrolled sideways. Each page is `w-full
              shrink-0`, so a single-page bill is exactly what it was before —
              no scrollbar, no snap to fight — and a three-page one swipes.
              Horizontal only: the vertical wheel still belongs to the panel,
              which is the whole point of this file. */}
          <div
            className={`flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain ${
              pages > 1 ? "gap-2" : ""
            }`}
          >
            {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setOpen(n)}
                title={pages > 1 ? `View page ${n} full screen` : "View full screen"}
                className="block w-full shrink-0 snap-start"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pageSrc(file, n)}
                  alt={pages > 1 ? `${file.name ?? "invoice"} page ${n}` : (file.name ?? "invoice")}
                  className={`${maxHClass} ${radiusClass} w-full cursor-zoom-in border border-line object-contain dark:border-neutral-800`}
                />
              </button>
            ))}
          </div>
          {pages > 1 && (
            <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
              {pages} pages · scroll sideways
            </p>
          )}
        </>
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
      {open > 0 && <InvoiceLightbox file={file} page={open} onClose={close} />}
    </div>
  );
}
