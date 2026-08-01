"use client";

/**
 * Shared React bits for the chart templates: a container-width hook (so the SVG
 * renders at real pixels and text stays crisp instead of being scaled by a
 * viewBox), a floating tooltip, and the accessible data-table fallback every
 * chart exposes (data-viz rule: identity is never color-alone — a table view
 * always exists).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

import { type ValueFormat } from "./palette";

/** Measure a container's inner width, updating on resize. Returns 0 until the
 *  element has mounted, so callers should render a placeholder while width===0. */
export function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A floating tooltip anchored to (x, y) in the wrapper's local coordinates.
 *  The wrapper must be `position: relative`. Renders nothing when `hidden`. */
export function ChartTooltip({
  x,
  y,
  hidden,
  children,
}: {
  x: number;
  y: number;
  hidden: boolean;
  children: ReactNode;
}) {
  if (hidden) return null;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-neutral-700 dark:bg-ink-overlay"
      style={{ left: x, top: y - 8 }}
      role="status"
    >
      {children}
    </div>
  );
}

export type TableRow = { label: string; value: number; color?: string; extra?: string };

/** Collapsible data table beneath a chart — the non-visual reading of the same
 *  numbers, and the relief for the low-contrast categorical hues. */
export function ChartDataTable({
  rows,
  format,
  valueHeader = "Value",
  extraHeader,
}: {
  rows: TableRow[];
  format: ValueFormat;
  valueHeader?: string;
  extraHeader?: string;
}) {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer select-none text-xs font-medium text-neutral-500 hover:text-accent">
        Show data table
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-200 text-[11px] uppercase tracking-wide text-neutral-500 dark:border-neutral-700">
              <th className="py-1.5 pr-3 font-semibold">Label</th>
              <th className="py-1.5 pr-3 text-right font-semibold">{valueHeader}</th>
              {extraHeader ? <th className="py-1.5 text-right font-semibold">{extraHeader}</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-neutral-100 dark:border-neutral-800">
                <td className="py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    {r.color ? (
                      <span
                        aria-hidden
                        className="inline-block h-2.5 w-2.5 rounded-[3px]"
                        style={{ background: r.color }}
                      />
                    ) : null}
                    {r.label}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{format(r.value)}</td>
                {extraHeader ? <td className="py-1.5 text-right tabular-nums">{r.extra ?? ""}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/** A legend row: swatch + label (+ optional trailing value), text in ink tokens
 *  (never the series color — that lives in the swatch). */
export function ChartLegend({
  items,
  className = "",
}: {
  items: { label: string; color: string; value?: string }[];
  className?: string;
}) {
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 ${className}`}>
      {items.map((it, i) => (
        <li key={i} className="inline-flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]"
            style={{ background: it.color }}
          />
          <span>{it.label}</span>
          {it.value ? <span className="tabular-nums text-neutral-400 dark:text-neutral-500">{it.value}</span> : null}
        </li>
      ))}
    </ul>
  );
}
