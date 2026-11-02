"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  LOPEZ_COAST,
  LOPEZ_ROADS_MAJOR,
  LOPEZ_ROADS_MINOR,
  MAP_H,
  MAP_W,
  PHASE_COLORS,
  phaseColor,
  placeJobs,
  type MapJob,
} from "@/lib/lopezMap";

/**
 * A flat map of Lopez Island with each job as a dot, coloured by its Phase.
 * Jobs at one address share one dot. The selected job gets a light ring.
 *
 * Self-contained: pass the jobs (`/api/jobs?withPhase=1` returns this shape)
 * and the selection; the map draws nothing else. Clicking a dot calls
 * `onSelect` with the first job at that place.
 */
export function LopezMap({
  jobs,
  selectedId,
  onSelect,
  className = "",
  legend = true,
  pad = 30,
  color,
  label = "Map of Lopez Island with job locations",
  focusId = null,
  zoom = 3,
}: {
  /** The job to zoom in on, centred (the Jobs page's picked job). The dots,
   *  rings and roads keep their size on screen; only the island grows. */
  focusId?: string | null;
  /** How far `focusId` zooms in: 3 is three times the size (owner, 2026-11-02). */
  zoom?: number;
  /** One colour for every dot, in place of the phase colours. */
  color?: string;
  label?: string;
  /** Room around the island, in map units. The Jobs page draws it tighter. */
  pad?: number;
  jobs: MapJob[];
  selectedId?: string | null;
  onSelect?: (jobId: string) => void;
  className?: string;
  /** The phase swatches under the map. The © OpenStreetMap credit prints either
   *  way — the coastline is ODbL data and the licence asks for it. */
  legend?: boolean;
}) {
  const { places, offMap } = useMemo(() => placeJobs(jobs), [jobs]);
  const selected = places.find((p) => p.jobs.some((j) => j.id === selectedId));
  const focus = places.find((p) => p.jobs.some((j) => j.id === focusId));

  // The view: its centre and zoom, eased over 400ms when the focus changes.
  const home = { x: MAP_W / 2, y: MAP_H / 2, k: 1 };
  const target = focus ? { x: focus.x, y: focus.y, k: zoom } : home;
  const [view, setView] = useState(target);
  const from = useRef(view);
  from.current = view;
  useEffect(() => {
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 400);
      const e = 1 - (1 - t) ** 3;
      setView({ x: a.x + (target.x - a.x) * e, y: a.y + (target.y - a.y) * e, k: a.k + (target.k - a.k) * e });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on the target, not on each frame
  }, [target.x, target.y, target.k]);
  const vw = (MAP_W + 2 * pad) / view.k;
  const vh = (MAP_H + 2 * pad) / view.k;
  // Lengths in map units that should hold their size on screen.
  const s = 1 / view.k;
  const shownPhases = PHASE_COLORS.filter(
    (p, i) =>
      PHASE_COLORS.findIndex((q) => q.color === p.color) === i &&
      places.some((pl) => phaseColor(pl.phase) === p.color),
  );

  return (
    <figure className={`flex flex-col gap-2 ${className}`}>
      <svg
        viewBox={`${view.x - vw / 2} ${view.y - vh / 2} ${vw} ${vh}`}
        className="h-auto w-full"
        role="img"
        aria-label={label}
      >
        <path
          d={LOPEZ_COAST}
          className="fill-neutral-100 stroke-line-strong dark:fill-neutral-800"
          strokeWidth={2 * s}
          strokeLinejoin="round"
        />
        {/* Roads one step off the island's fill: there to orient, not to read. */}
        <g
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-neutral-200 dark:stroke-neutral-700"
          aria-hidden
        >
          <path d={LOPEZ_ROADS_MINOR} strokeWidth={1.25 * s} />
          <path d={LOPEZ_ROADS_MAJOR} strokeWidth={2.5 * s} />
        </g>
        {selected && (
          <circle
            cx={selected.x}
            cy={selected.y}
            r={26 * s}
            className="fill-neutral-900/10 stroke-neutral-900/40 dark:fill-white/15 dark:stroke-white/50"
            strokeWidth={2 * s}
          />
        )}
        {places.map((p) => {
          const counted = p.jobs.some((j) => j.count != null);
          const n = p.jobs.reduce((sum, j) => sum + (j.count ?? 0), 0);
          const title = p.jobs
            .map((j) => `${j.name}${j.phase ? ` — ${j.phase}` : ""}${j.count != null ? ` — ${j.count}` : ""}`)
            .join("\n");
          return (
            <g key={p.key}>
              <circle
                cx={p.x}
                cy={p.y}
                r={(counted ? 17 : 11) * s}
                fill={color ?? phaseColor(p.phase)}
                className={`stroke-white dark:stroke-ink-raised ${onSelect ? "cursor-pointer" : ""}`}
                strokeWidth={3 * s}
                tabIndex={onSelect ? 0 : undefined}
                role={onSelect ? "button" : undefined}
                aria-label={p.jobs.map((j) => j.name).join(", ")}
                onClick={() => onSelect?.(p.jobs[0].id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect?.(p.jobs[0].id);
                  }
                }}
              >
                <title>{title}</title>
              </circle>
              {counted && (
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={16 * s}
                  fontWeight={600}
                  fill="white"
                  pointerEvents="none"
                  aria-hidden
                >
                  {n}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        {legend && shownPhases.map((p) => (
          <span key={p.phase} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            {p.phase}
          </span>
        ))}
        {legend && places.some((pl) => phaseColor(pl.phase) === "var(--viz-other)") && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--viz-other)" }} />
            Other
          </span>
        )}
        {legend && offMap > 0 && <span>{offMap} not on the map</span>}
        <span className="ml-auto">© OpenStreetMap</span>
      </figcaption>
    </figure>
  );
}
