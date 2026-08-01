"use client";

/**
 * BarChart — an on-brand, dependency-free bar-graph template.
 *
 * Two jobs, one component:
 *   • ONE series (default) → every bar is the brand accent (ochre/olive). Use
 *     this for a single measure across categories (e.g. spend by month).
 *   • DISTINCT categories → pass `categorical` to color each bar from the
 *     eight-slot data-viz palette. Use when the bars ARE the identities being
 *     compared, not one series.
 *
 * Follows the data-viz method: thin marks, 4px rounded data-ends on the
 * baseline, a recessive grid, a value label on every bar (the contrast-relief
 * rule), per-bar hover tooltips, and a table fallback. Renders at real pixels
 * via a ResizeObserver so labels stay crisp on any width.
 */

import { useState } from "react";

import { ACCENT_VAR, barPath, makeFormat, niceCeil, seriesVar, type ValueFormat } from "./palette";
import { ChartDataTable, ChartTooltip, useContainerWidth } from "./shared";

export type BarDatum = {
  label: string;
  value: number;
  /** Explicit fill (any CSS color). Overrides accent/categorical for this bar. */
  color?: string;
};

export type BarChartProps = {
  data: BarDatum[];
  /** Plot height in px (excludes the axis labels around it). Default 240. */
  height?: number;
  /** Format ticks, bar labels, and tooltips. Default: compact ($1.2k / 1,240). */
  format?: ValueFormat;
  /** Color each bar from the categorical palette (distinct categories, not one
   *  series). Default false → one accent fill. */
  categorical?: boolean;
  /** Horizontal bars — better for long category names. Default false. */
  horizontal?: boolean;
  /** Hide the value label on each bar. Default false (labels shown). */
  hideValueLabels?: boolean;
  /** Include the collapsible data table. Default true. */
  showTable?: boolean;
  /** Accessible summary; falls back to an auto description. */
  ariaLabel?: string;
  className?: string;
};

const AXIS_TEXT = "text-[11px] font-medium";
const AXIS_FILL = "text-neutral-500 dark:text-neutral-400";

export function BarChart({
  data,
  height = 240,
  format = makeFormat({ currency: true }),
  categorical = false,
  horizontal = false,
  hideValueLabels = false,
  showTable = true,
  ariaLabel,
  className = "",
}: BarChartProps) {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const fillFor = (d: BarDatum, i: number) =>
    d.color ?? (categorical ? seriesVar(i) : ACCENT_VAR);

  const total = data.reduce((s, d) => s + d.value, 0);
  const desc =
    ariaLabel ??
    `Bar chart of ${data.length} ${categorical ? "categories" : "values"}, total ${format(total)}.`;

  return (
    <div className={className}>
      <div ref={ref} className="relative w-full">
        {width > 0 ? (
          horizontal ? (
            <HorizontalBars
              data={data}
              width={width}
              height={height}
              format={format}
              fillFor={fillFor}
              hideValueLabels={hideValueLabels}
              hover={hover}
              setHover={setHover}
              desc={desc}
            />
          ) : (
            <VerticalBars
              data={data}
              width={width}
              height={height}
              format={format}
              fillFor={fillFor}
              hideValueLabels={hideValueLabels}
              hover={hover}
              setHover={setHover}
              desc={desc}
            />
          )
        ) : (
          <div style={{ height }} />
        )}
      </div>
      {showTable ? <ChartDataTable rows={data} format={format} /> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- internals */

type RenderProps = {
  data: BarDatum[];
  width: number;
  height: number;
  format: ValueFormat;
  fillFor: (d: BarDatum, i: number) => string;
  hideValueLabels: boolean;
  hover: number | null;
  setHover: (i: number | null) => void;
  desc: string;
};

const TICKS = 4;

function VerticalBars({ data, width, height, format, fillFor, hideValueLabels, hover, setHover, desc }: RenderProps) {
  const padTop = 14;
  const padBottom = 26;
  const padLeft = 46;
  const padRight = 10;
  const plotW = Math.max(0, width - padLeft - padRight);
  const plotH = Math.max(0, height - padTop - padBottom);
  const max = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(56, Math.max(6, band * 0.62));
  const y = (v: number) => padTop + plotH * (1 - v / max);

  return (
    <>
      <svg width={width} height={height} role="img" aria-label={desc} className="block">
        {/* Gridlines + y ticks */}
        {Array.from({ length: TICKS + 1 }, (_, t) => {
          const v = (max / TICKS) * t;
          const gy = y(v);
          return (
            <g key={t}>
              <line x1={padLeft} x2={width - padRight} y1={gy} y2={gy} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
              <text x={padLeft - 8} y={gy} textAnchor="end" dominantBaseline="middle" fill="currentColor" className={`${AXIS_TEXT} ${AXIS_FILL} tabular-nums`}>
                {format(v)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const cx = padLeft + band * i + band / 2;
          const bx = cx - barW / 2;
          const top = y(Math.max(0, d.value));
          const h = padTop + plotH - top;
          const active = hover === i;
          return (
            <g key={i}>
              <path
                d={barPath(bx, top, barW, h, 4, "bottom")}
                fill={fillFor(d, i)}
                style={{ transition: "opacity 120ms" }}
                opacity={hover === null || active ? 1 : 0.55}
              />
              {!hideValueLabels && band > 26 ? (
                <text x={cx} y={top - 5} textAnchor="middle" fill="currentColor" className={`${AXIS_TEXT} text-neutral-600 dark:text-neutral-300 tabular-nums`}>
                  {format(d.value)}
                </text>
              ) : null}
              <text x={cx} y={height - 8} textAnchor="middle" fill="currentColor" className={`${AXIS_TEXT} ${AXIS_FILL}`}>
                {truncate(d.label, band)}
              </text>
              {/* Full-band hover target */}
              <rect
                x={padLeft + band * i}
                y={padTop}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <ChartTooltip x={padLeft + band * hover + band / 2} y={y(Math.max(0, data[hover].value))} hidden={false}>
          <div className="font-medium text-neutral-800 dark:text-neutral-100">{data[hover].label}</div>
          <div className="tabular-nums text-neutral-500 dark:text-neutral-400">{format(data[hover].value)}</div>
        </ChartTooltip>
      ) : null}
    </>
  );
}

function HorizontalBars({ data, width, height, format, fillFor, hideValueLabels, hover, setHover, desc }: RenderProps) {
  // Height grows with row count; the `height` prop is treated as a per-row hint.
  const rowH = 34;
  const padTop = 6;
  const padBottom = 22;
  const labelW = Math.min(140, Math.max(64, longestLabel(data) * 6.5));
  const padRight = 44;
  const h = padTop + padBottom + rowH * data.length;
  const plotW = Math.max(0, width - labelW - padRight);
  const max = niceCeil(Math.max(0, ...data.map((d) => d.value)));
  const x = (v: number) => labelW + plotW * (v / max);
  const barH = Math.min(22, rowH * 0.6);
  void height;

  return (
    <>
      <svg width={width} height={h} role="img" aria-label={desc} className="block">
        {/* Vertical gridlines + x ticks */}
        {Array.from({ length: TICKS + 1 }, (_, t) => {
          const v = (max / TICKS) * t;
          const gx = x(v);
          return (
            <g key={t}>
              <line x1={gx} x2={gx} y1={padTop} y2={h - padBottom} style={{ stroke: "var(--chart-grid)" }} strokeWidth={1} />
              <text x={gx} y={h - 6} textAnchor="middle" fill="currentColor" className={`${AXIS_TEXT} ${AXIS_FILL} tabular-nums`}>
                {format(v)}
              </text>
            </g>
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const cy = padTop + rowH * i + rowH / 2;
          const by = cy - barH / 2;
          const w = x(Math.max(0, d.value)) - labelW;
          const active = hover === i;
          return (
            <g key={i}>
              <text x={labelW - 8} y={cy} textAnchor="end" dominantBaseline="middle" fill="currentColor" className={`${AXIS_TEXT} ${AXIS_FILL}`}>
                {truncate(d.label, labelW + 24)}
              </text>
              <path
                d={barPath(labelW, by, Math.max(0, w), barH, 4, "left")}
                fill={fillFor(d, i)}
                style={{ transition: "opacity 120ms" }}
                opacity={hover === null || active ? 1 : 0.55}
              />
              {!hideValueLabels ? (
                <text x={labelW + w + 6} y={cy} dominantBaseline="middle" fill="currentColor" className={`${AXIS_TEXT} text-neutral-600 dark:text-neutral-300 tabular-nums`}>
                  {format(d.value)}
                </text>
              ) : null}
              <rect
                x={labelW}
                y={padTop + rowH * i}
                width={plotW}
                height={rowH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <ChartTooltip x={x(Math.max(0, data[hover].value))} y={padTop + rowH * hover + rowH / 2} hidden={false}>
          <div className="font-medium text-neutral-800 dark:text-neutral-100">{data[hover].label}</div>
          <div className="tabular-nums text-neutral-500 dark:text-neutral-400">{format(data[hover].value)}</div>
        </ChartTooltip>
      ) : null}
    </>
  );
}

function truncate(s: string, px: number): string {
  const max = Math.max(3, Math.floor(px / 7));
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function longestLabel(data: BarDatum[]): number {
  return data.reduce((m, d) => Math.max(m, d.label.length), 0);
}
