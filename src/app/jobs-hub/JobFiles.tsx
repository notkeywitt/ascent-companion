"use client";

import { useEffect, useState } from "react";

import { InvoiceLightbox, pageSrc, type InvoiceFile } from "@/components/InvoiceViewer";
import { Banner, EmptyState, Loading, SectionLabel } from "@/components/ui";
import type { JobFile, JobPlan } from "@/lib/jobtread";
import { orgDay } from "@/lib/orgTime";
import { shortDate } from "@/lib/jobBoard";

/**
 * The Jobs page's Plans and Photos tabs: the job's JobTread plan sheets and the
 * photos uploaded to it, as thumbnail grids. A tap opens the full-screen viewer
 * the bill scans use, on that sheet's page. Read-only (/api/jobs/files).
 */

interface Files {
  plans: JobPlan[];
  photos: JobFile[];
}

/** One read per job, shared by both tabs. */
export function useJobFiles(jobId: string | null) {
  const [state, setState] = useState<{ jobId: string; files?: Files; error?: string } | null>(null);
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setState({ jobId });
    fetch(`/api/jobs/files?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setState(
          d.error
            ? { jobId, error: d.error }
            : { jobId, files: { plans: d.plans, photos: d.photos } },
        );
      })
      .catch(() => !cancelled && setState({ jobId, error: "Could not read the job's files." }));
    return () => {
      cancelled = true;
    };
  }, [jobId]);
  return state?.jobId === jobId ? state : null;
}

interface Tile {
  key: string;
  file: InvoiceFile;
  page: number;
  label: string;
  /** A lighter image for the tile than the lightbox's; default the page itself. */
  thumb?: string | null;
}

/** A grid of thumbnails; a tap opens the lightbox on that tile's page. */
function TileGrid({ tiles, square }: { tiles: Tile[]; square?: boolean }) {
  const [open, setOpen] = useState<Tile | null>(null);
  return (
    <>
      <div
        className={`grid gap-3 ${square ? "grid-cols-3 sm:grid-cols-5 xl:grid-cols-8" : "grid-cols-2 sm:grid-cols-4 xl:grid-cols-6"}`}
      >
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setOpen(t)}
            title={t.label}
            className="min-w-0 text-left"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={t.thumb || pageSrc(t.file, t.page)}
              alt={t.label}
              loading="lazy"
              className={`w-full cursor-zoom-in rounded-lg border border-line bg-white ${square ? "aspect-square object-cover" : "aspect-[4/3] object-contain"}`}
            />
            <span className="mt-1 block truncate text-[12px] text-neutral-500 dark:text-neutral-400">
              {t.label}
            </span>
          </button>
        ))}
      </div>
      {open && <InvoiceLightbox file={open.file} page={open.page} onClose={() => setOpen(null)} />}
    </>
  );
}

function Status({ state }: { state: ReturnType<typeof useJobFiles> }) {
  if (!state || (!state.files && !state.error)) return <Loading />;
  if (state.error) return <Banner tone="error">{state.error}</Banner>;
  return null;
}

/** Plan sheets, one section per uploaded drawing set. */
export function JobPlans({ state }: { state: ReturnType<typeof useJobFiles> }) {
  const plans = state?.files?.plans;
  if (!plans) return <Status state={state} />;
  if (plans.length === 0) return <EmptyState>No plans on this job in JobTread.</EmptyState>;
  const sets = new Map<string, JobPlan[]>();
  for (const p of plans) sets.set(p.file.id, [...(sets.get(p.file.id) ?? []), p]);
  return (
    <div className="space-y-6">
      {[...sets.values()].map((sheets) => {
        const f = sheets[0].file;
        const file: InvoiceFile = { ...f, url: f.url ?? undefined };
        return (
          <section key={f.id} className="space-y-2">
            <SectionLabel>
              {f.name} · {sheets.length} sheet{sheets.length === 1 ? "" : "s"}
            </SectionLabel>
            <TileGrid
              tiles={sheets
                .sort((a, b) => a.page - b.page)
                .map((p) => ({ key: p.id, file, page: p.page, label: `Page ${p.page}` }))}
            />
          </section>
        );
      })}
    </div>
  );
}

/** Photos, newest first, one section per day. */
export function JobPhotos({ state }: { state: ReturnType<typeof useJobFiles> }) {
  const photos = state?.files?.photos;
  if (!photos) return <Status state={state} />;
  if (photos.length === 0) return <EmptyState>No photos on this job in JobTread.</EmptyState>;
  const days = new Map<string, JobFile[]>();
  for (const p of photos) {
    const d = orgDay(p.createdAt);
    days.set(d, [...(days.get(d) ?? []), p]);
  }
  return (
    <div className="space-y-6">
      {[...days].map(([day, list]) => (
        <section key={day} className="space-y-2">
          <SectionLabel>
            {shortDate(day)} · {list.length}
          </SectionLabel>
          <TileGrid
            square
            tiles={list.map((p) => ({
              key: p.id,
              // The tile loads JobTread's ~400px resize; the lightbox its ~2048px.
              file: {
                id: p.id,
                name: p.name,
                type: p.type,
                url: p.url ?? undefined,
                imageUrl: p.imageUrl,
              },
              thumb: p.thumbUrl,
              page: 1,
              label: p.name,
            }))}
          />
        </section>
      ))}
    </div>
  );
}
