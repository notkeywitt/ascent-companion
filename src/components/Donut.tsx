"use client";

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
}: {
  slices: DonutSlice[];
  title?: string;
  /** Big number in the hole; defaults to the summed slice value as money. */
  centerValue?: string;
  /** Small caption under the center value. */
  centerLabel?: string;
  emptyLabel?: string;
  size?: number;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const positive = slices.filter((s) => s.value > 0);

  // Geometry: a viewBox-100 ring. r is chosen so the stroke sits comfortably
  // inside the box; C is its circumference (the dash budget for one full turn).
  const r = 42;
  const stroke = 15;
  const C = 2 * Math.PI * r;
  // A 2px surface gap between segments, expressed in circumference units, only
  // applied when there is more than one visible slice.
  const gap = positive.length > 1 ? (2 / size) * C : 0;

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
          <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={title ?? "Donut chart"}>
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
                const seg = (
                  <circle
                    key={s.key}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={stroke}
                    strokeDasharray={`${dash} ${C - dash}`}
                    strokeDashoffset={-offset}
                  >
                    <title>{`${s.label} — ${money(s.value)} (${pct(s.value, total)}%)`}</title>
                  </circle>
                );
                offset += frac * C;
                return seg;
              })}
            </g>
          </svg>
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
              <li key={s.key} className="flex items-center gap-2 text-xs">
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
