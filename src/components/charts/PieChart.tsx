"use client";

/**
 * PieChart — an on-brand, dependency-free pie / donut template.
 *
 * Slices take the eight-slot categorical palette in fixed order; a ninth-plus
 * category folds into a single "Other" slice (the palette is never cycled).
 * Follows the data-viz method: a 2px surface-colored ring between slices so
 * neighbours read as separate, a legend with value + %, direct % labels on the
 * larger slices (small ones stay in the legend), hover highlight, and a table
 * fallback. Donut by default, with the total in the hole.
 */

import { useMemo, useState } from "react";

import { arcPath, makeFormat, polar, seriesVar, type ValueFormat } from "./palette";
import { ChartDataTable, ChartLegend, ChartTooltip, useContainerWidth } from "./shared";

export type PieDatum = {
  label: string;
  value: number;
  /** Explicit slice color (any CSS color). Overrides the categorical slot. */
  color?: string;
};

export type PieChartProps = {
  data: PieDatum[];
  /** SVG size (square) in px. Default 220. Scales down to the container width. */
  size?: number;
  /** Draw as a solid pie instead of a donut. Default false (donut). */
  solid?: boolean;
  /** Max distinct slices before the rest fold into "Other". Default 7. */
  maxSlices?: number;
  /** Format values for the legend, labels, and tooltips. Default compact $. */
  format?: ValueFormat;
  /** Legend position relative to the ring. Default "right" (stacks on mobile). */
  legend?: "right" | "bottom" | "none";
  /** Include the collapsible data table. Default true. */
  showTable?: boolean;
  /** Center caption under the total (donut only). Default "Total". */
  centerLabel?: string;
  ariaLabel?: string;
  className?: string;
};

type Slice = PieDatum & { color: string; pct: number; start: number; end: number };

export function PieChart({
  data,
  size = 220,
  solid = false,
  maxSlices = 7,
  format = makeFormat({ currency: true }),
  legend = "right",
  showTable = true,
  centerLabel = "Total",
  ariaLabel,
  className = "",
}: PieChartProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const { slices, total } = useMemo(() => {
    const rows = data.filter((d) => d.value > 0);
    // Largest first, then fold the tail into "Other".
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    const head = sorted.slice(0, Math.max(1, maxSlices - 1));
    const tail = sorted.slice(Math.max(1, maxSlices - 1));
    const merged: PieDatum[] =
      tail.length > 1
        ? [...head, { label: "Other", value: tail.reduce((s, d) => s + d.value, 0) }]
        : sorted;
    const sum = merged.reduce((s, d) => s + d.value, 0) || 1;
    let angle = 0;
    const out: Slice[] = merged.map((d, i) => {
      const pct = d.value / sum;
      const start = angle;
      const end = angle + pct * 360;
      angle = end;
      return { ...d, color: d.color ?? (d.label === "Other" ? "#8D8D8B" : seriesVar(i)), pct, start, end };
    });
    return { slices: out, total: sum };
  }, [data, maxSlices]);

  const dim = width > 0 ? Math.min(size, width) : size;
  const cx = dim / 2;
  const cy = dim / 2;
  const outerR = dim / 2 - 4; // room for the surface ring
  const innerR = solid ? 0 : outerR * 0.6;
  const gapRing = 2; // 2px surface stroke between slices

  const desc = ariaLabel ?? `Pie chart of ${slices.length} categories, total ${format(total)}.`;

  const legendItems = slices.map((s) => ({
    label: s.label,
    color: s.color,
    value: `${format(s.value)} · ${Math.round(s.pct * 100)}%`,
  }));

  const ring = (
    <div ref={ref} className="relative w-full" style={{ maxWidth: size }}>
      {width > 0 ? (
        <>
          <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={desc} className="block">
            {slices.map((s, i) => {
              const active = hover === i;
              const r = active ? outerR + 2 : outerR;
              return (
                <path
                  key={i}
                  d={arcPath(cx, cy, r, innerR, s.start, s.end)}
                  fill={s.color}
                  stroke="var(--chart-surface)"
                  strokeWidth={gapRing}
                  strokeLinejoin="round"
                  opacity={hover === null || active ? 1 : 0.55}
                  style={{ transition: "opacity 120ms" }}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
            {/* Direct % labels on slices big enough to hold one (≥ 8%). */}
            {slices.map((s, i) => {
              if (s.pct < 0.08) return null;
              const mid = (s.start + s.end) / 2;
              const lr = innerR > 0 ? (innerR + outerR) / 2 : outerR * 0.62;
              const p = polar(cx, cy, lr, mid);
              return (
                <text
                  key={`l${i}`}
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  className="text-[11px] font-semibold"
                  style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "rgb(0 0 0 / 0.28)", strokeWidth: 2 }}
                >
                  {Math.round(s.pct * 100)}%
                </text>
              );
            })}
            {/* Donut hole: total */}
            {innerR > 0 ? (
              <>
                <text x={cx} y={cy - 4} textAnchor="middle" fill="currentColor" className="text-[15px] font-semibold text-neutral-800 dark:text-neutral-100 tabular-nums">
                  {format(total)}
                </text>
                <text x={cx} y={cy + 13} textAnchor="middle" fill="currentColor" className="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  {centerLabel}
                </text>
              </>
            ) : null}
          </svg>
          {hover !== null ? (
            <ChartTooltip x={dim / 2} y={dim / 2} hidden={false}>
              <div className="font-medium text-neutral-800 dark:text-neutral-100">{slices[hover].label}</div>
              <div className="tabular-nums text-neutral-500 dark:text-neutral-400">
                {format(slices[hover].value)} · {Math.round(slices[hover].pct * 100)}%
              </div>
            </ChartTooltip>
          ) : null}
        </>
      ) : (
        <div style={{ height: size }} />
      )}
    </div>
  );

  return (
    <div className={className}>
      <div className={legend === "right" ? "flex flex-col items-center gap-4 sm:flex-row sm:items-center" : "flex flex-col items-center gap-3"}>
        {ring}
        {legend !== "none" ? <ChartLegend items={legendItems} className={legend === "right" ? "sm:flex-col sm:gap-2" : "justify-center"} /> : null}
      </div>
      {showTable ? (
        <ChartDataTable
          rows={slices.map((s) => ({ label: s.label, value: s.value, color: s.color, extra: `${Math.round(s.pct * 100)}%` }))}
          format={format}
          extraHeader="Share"
        />
      ) : null}
    </div>
  );
}
