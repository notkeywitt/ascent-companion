"use client";

import { useState } from "react";

/**
 * Donut chart — a small, dependency-free SVG ring for part-to-whole money
 * splits (the CSI-division cost breakdowns on the Jobs view). No chart library
 * is installed and none is wanted; this is a single <svg> plus a legend.
 *
 * Design rules (data-viz skill): categorical hues assigned in fixed order via
 * the --viz-N CSS variables (globals.css), which flip per theme so a ring reads
 * in light and dark alike; a 2px surface gap between segments; identity is never
 * color-alone — every slice is named in the legend and (upstream) in the table,
 * so the ring is decorative reinforcement, not the sole encoding. Each segment
 * carries a <title> for a native hover tooltip.
 *
 * Callers pass slices already colored and already folded to a sensible count
 * (top-N + "Other") so the SAME division keeps the SAME color across sibling
 * donuts (bills vs. labor) — comparability is the whole point.
 */

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  color: string; // any CSS color, typically "var(--viz-N)"
}

/** One line of a slice's hover card — e.g. a vendor bill behind a cost code. */
export interface DonutDetailRow {
  key: string;
  label: string;
  value: number;
}

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

export function Donut({
  slices,
  title,
  centerValue,
  centerLabel,
  emptyLabel = "No data yet",
  size = 132,
  detail,
  onDetailWanted,
  onSelect,
  selectedKey = null,
}: {
  slices: DonutSlice[];
  title?: string;
  /** Big number in the hole; defaults to the summed slice value as money. */
  centerValue?: string;
  /** Small caption under the center value. */
  centerLabel?: string;
  emptyLabel?: string;
  size?: number;
  /**
   * What a slice is MADE of. Hovering (or tapping) a segment lifts it and opens
   * a card listing these, biggest first. Return null while the answer is not in
   * hand yet; the card then says so rather than reading as an empty slice.
   */
  detail?: (sliceKey: string) => DonutDetailRow[] | null;
  /** Fired the first time a slice is hovered, so a caller can start the fetch `detail` needs. */
  onDetailWanted?: () => void;
  /**
   * Clicking a slice, or its legend row, picks it — the ring becomes a filter
   * control for whatever list it heads. Called with the same key a second time
   * when the picked slice is clicked again, so the caller can toggle it off.
   */
  onSelect?: (sliceKey: string) => void;
  /** Which slice is picked, so the ring can mark it. */
  selectedKey?: string | null;
}) {
  // Which arc is lifted. Hover on a pointer; a tap toggles it, since the rings
  // are read on a phone too and there is no hover there.
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((s, x) => s + x.value, 0);
  const positive = slices.filter((s) => s.value > 0);

  // Geometry: a viewBox-100 ring. r is chosen so the stroke sits comfortably
  // inside the box; C is its circumference (the dash budget for one full turn).
  const r = 42;
  const stroke = 15;
  /** How much a hovered arc thickens. See the note on the segment below. */
  const LIFT = 4;
  /**
   * The box has to hold the LIFTED ring, not the resting one. At rest the
   * stroke reaches r + stroke/2 = 49.5, a hair inside a 0–100 box; lifted it
   * reaches 51.5 and the browser clipped the outer edge of whichever arc the
   * pointer was on — the one arc you were looking at. The viewBox grows by the
   * overflow instead of the radius shrinking, so the ring is the same size on
   * screen as it always was.
   */
  const PAD = Math.ceil(LIFT / 2) + 1;
  const C = 2 * Math.PI * r;
  // A 2px surface gap between segments, expressed in circumference units, only
  // applied when there is more than one visible slice.
  const gap = positive.length > 1 ? (2 / size) * C : 0;

  // The lifted slice and its breakdown, read once per render.
  const hoverSlice = hover ? (positive.find((s) => s.key === hover) ?? null) : null;
  const hoverRows = hoverSlice && detail ? detail(hoverSlice.key) : [];

  let offset = 0;

  return (
    <figure className="m-0 flex flex-col items-center">
      {title && (
        <figcaption className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </figcaption>
      )}

      {total <= 0 ? (
        <div
          className="flex items-center justify-center rounded-full border border-dashed border-neutral-300 text-center text-[11px] text-neutral-400 dark:border-neutral-700"
          style={{ width: size, height: size }}
        >
          {emptyLabel}
        </div>
      ) : (
        <div className="relative" style={{ width: size, height: size }}>
          <svg
            viewBox={`${-PAD} ${-PAD} ${100 + PAD * 2} ${100 + PAD * 2}`}
            width={size}
            height={size}
            role="img"
            aria-label={title ?? "Donut chart"}
          >
            {/* Recessive full-circle track under the segments. */}
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              className="text-neutral-200 dark:text-neutral-800"
            />
            {/* One arc per slice, drawn clockwise from 12 o'clock. */}
            <g transform="rotate(-90 50 50)">
              {positive.map((s) => {
                const frac = s.value / total;
                const dash = Math.max(frac * C - gap, 0.5);
                const lifted = hover === s.key || selectedKey === s.key;
                const seg = (
                  <circle
                    key={s.key}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke={s.color}
                    // A lifted arc thickens rather than moving: a radial nudge
                    // would open a seam in the ring and shift every neighbour's
                    // apparent size. Thicker reads as "this one" and leaves the
                    // shares honest. The viewBox carries the extra — see PAD.
                    strokeWidth={lifted ? stroke + LIFT : stroke}
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={-offset}
                    style={{
                      transition: "stroke-width 120ms ease",
                      cursor: detail || onSelect ? "pointer" : undefined,
                    }}
                    onMouseEnter={detail ? () => { setHover(s.key); onDetailWanted?.(); } : undefined}
                    onMouseLeave={detail ? () => setHover((h) => (h === s.key ? null : h)) : undefined}
                    // A click PICKS the slice where the caller wants that. It
                    // also toggles the card, because touch has no hover and the
                    // tap is the only way in to the breakdown there.
                    onClick={
                      detail || onSelect
                        ? () => {
                            setHover((h) => (h === s.key ? null : s.key));
                            onDetailWanted?.();
                            onSelect?.(s.key);
                          }
                        : undefined
                    }
                  >
                    <title>{`${s.label} — ${money(s.value)} (${pct(s.value, total)}%)`}</title>
                  </circle>
                );
                offset += frac * C;
                return seg;
              })}
            </g>
          </svg>
          {/* WHAT THE LIFTED SLICE IS MADE OF — a card floating over the page,
              not a block in it. Absolute inside the ring's own box, so nothing
              around it moves when a slice is hovered and the legend below stays
              exactly where the eye left it. `pointer-events-none` is what keeps
              it honest: the card can never sit between the pointer and the arc
              that opened it, so it cannot flicker itself shut. */}
          {detail && hoverSlice && (
            <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-72 max-w-[85vw] -translate-x-1/2 overflow-hidden rounded-xl border border-line bg-white p-3 text-sm shadow-xl dark:bg-ink-raised">
              <div className="mb-1.5 flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-semibold">{hoverSlice.label}</span>
                <span className="shrink-0 tabular-nums text-neutral-500">
                  {money(hoverSlice.value)}
                </span>
              </div>
              {hoverRows === null ? (
                <p className="text-neutral-500">Loading…</p>
              ) : hoverRows.length === 0 ? (
                <p className="text-neutral-500">Nothing to break out.</p>
              ) : (
                // Everything, biggest first. No scroll — the card cannot take
                // the pointer, so a scrollbar in it would be decoration.
                <ul className="max-h-[70vh] space-y-1 overflow-hidden">
                  {hoverRows.map((d) => (
                    <li key={d.key} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
                        {d.label}
                      </span>
                      <span className="shrink-0 tabular-nums text-neutral-500">
                        {money(d.value)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Center readout sits in the hole. */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-semibold tabular-nums">{centerValue ?? money(total)}</span>
            {centerLabel && (
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-neutral-400">
                {centerLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Legend — identity is never color-alone. Sorted by value desc. */}
      {positive.length > 0 && (
        <ul className="mt-3 w-full space-y-1">
          {positive
            .slice()
            .sort((a, b) => b.value - a.value)
            .map((s) => (
              <li
                key={s.key}
                // The legend row is the bigger target of the two, so it opens
                // the same card the arc does.
                onMouseEnter={detail ? () => { setHover(s.key); onDetailWanted?.(); } : undefined}
                onMouseLeave={detail ? () => setHover((h) => (h === s.key ? null : h)) : undefined}
                onClick={onSelect ? () => onSelect(s.key) : undefined}
                className={`flex items-center gap-2 text-xs ${
                  hover === s.key || selectedKey === s.key ? "font-semibold" : ""
                } ${onSelect ? "cursor-pointer" : ""} ${
                  selectedKey === s.key ? "text-accent" : ""
                }`}
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: s.color }}
                />
                <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300">
                  {s.label}
                </span>
                <span className="shrink-0 tabular-nums text-neutral-500">{money(s.value)}</span>
                <span className="w-9 shrink-0 text-right tabular-nums text-neutral-400">
                  {pct(s.value, total)}%
                </span>
              </li>
            ))}
        </ul>
      )}
    </figure>
  );
}
