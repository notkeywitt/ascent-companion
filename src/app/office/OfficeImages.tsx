"use client";

import { useState } from "react";

import { InvoiceLightbox } from "@/components/InvoiceViewer";
import type { JobFile } from "@/lib/jobtread";

/**
 * The open folder's images as a grid of thumbnails. A tap opens the same
 * full-screen viewer the bill scans use (InvoiceLightbox), which links out to
 * the original. Tiles load JobTread's ~512px resize, not the original photo.
 */
export function OfficeImages({ files }: { files: JobFile[] }) {
  const [open, setOpen] = useState<JobFile | null>(null);
  return (
    <>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {files.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setOpen(f)}
            title={f.name}
            className="min-w-0 text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.thumbUrl || f.imageUrl || f.url || ""}
              alt={f.name}
              loading="lazy"
              className="aspect-square w-full cursor-zoom-in rounded-lg border border-line object-cover"
            />
            <span className="mt-1 block truncate text-[11.5px] text-neutral-500 dark:text-neutral-400">
              {f.name}
            </span>
          </button>
        ))}
      </div>
      {open && (
        <InvoiceLightbox
          file={{ ...open, url: open.url ?? undefined }}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
