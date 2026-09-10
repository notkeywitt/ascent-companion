"use client";

import { useMemo, useState } from "react";
import { Donut, type DonutSlice } from "@/components/Donut";
import { SectionLabel } from "@/components/ui";
import { money } from "./BillCodingCard";

/**
 * The job workbench's two cost rings — vendor bills and labor, each broken out
 * by COST CODE. The same <Donut> the home board and /jobs draw, so a ring reads
 * the same everywhere; what differs is the cut. /jobs cuts by CSI division,
 * which is the right altitude for browsing jobs. This page IS the cost-code
 * page — the rail beside it, the drag targets, the drill-downs are all codes —
 * so cutting by division here would answer a question nobody is asking on it.
 *
 * Both rings share ONE code → color map, so a code keeps its color across them:
 * the point of a pair is comparing where the bill money went against where the
 * hours went, and that only works if 06 20 00 is the same hue in both.
 *
 * Job to date, not the selected month. The figures come off the same `headroom`
 * map the budget rail draws, so the rings, the rail and the drill-downs cannot
 * disagree — and staged recoding moves a slice the moment you drop a line,
 * before Sync.
 */

export interface CostDonutRow {
  code: string;
  name: string;
  /** Committed bill cost plus still-open drafts — what the rail counts as spent. */
  bills: number;
  labor: number;
}

/** Fixed-order categorical slots (globals.css); an 8th code folds to "Other". */
const VIZ_SLOTS = [
  "var(--viz-1)",
  "var(--viz-2)",
  "var(--viz-3)",
  "var(--viz-4)",
  "var(--viz-5)",
  "var(--viz-6)",
  "var(--viz-7)",
] as const;
const VIZ_OTHER = "var(--viz-other)";

/**
 * Stable cost code → color map shared by both rings. The codes with the most
 * total cost (bills + labor) claim the fixed slots; everything else folds into
 * one gray "Other". Slots are then handed out in CODE order rather than by
 * rank, so the mapping does not reshuffle when one ring outgrows the other.
 */
function buildColorMap(rows: CostDonutRow[]): Map<string, string> {
  const top = rows
    .map((r) => ({ code: r.code, v: Math.max(r.bills, 0) + Math.max(r.labor, 0) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, VIZ_SLOTS.length)
    .map((x) => x.code)
    .sort((a, b) => a.localeCompare(b));
  const map = new Map<string, string>();
  top.forEach((code, i) => map.set(code, VIZ_SLOTS[i]));
  return map;
}

/** Slices for one field, folding un-slotted codes into "Other". */
function buildSlices(
  rows: CostDonutRow[],
  colorMap: Map<string, string>,
  field: "bills" | "labor",
): DonutSlice[] {
  const out: DonutSlice[] = [];
  let other = 0;
  for (const r of rows) {
    const v = r[field];
    // A staged recode can drive a code negative before its new home is saved.
    // A ring cannot draw a negative arc, so those sit out rather than distort
    // the shares around them.
    if (v <= 0) continue;
    const color = colorMap.get(r.code);
    const label = r.name ? `${r.code} · ${r.name}` : r.code;
    if (color) out.push({ key: r.code, label, value: v, color });
    else other += v;
  }
  if (other > 0)
    out.push({ key: "__other", label: "Other cost codes", value: other, color: VIZ_OTHER });
  return out;
}

const sum = (s: DonutSlice[]) => s.reduce((n, x) => n + x.value, 0);

export function CostDonuts({ rows, className = "" }: { rows: CostDonutRow[]; className?: string }) {
  // Folded on a phone, exactly as the budget rail beside it is, and for the
  // same reason: two rings and their legends are a screenful, and the bill list
  // under them is the work. Always open from lg, where the column has the room.
  const [collapsed, setCollapsed] = useState(true);

  const colorMap = useMemo(() => buildColorMap(rows), [rows]);
  const bills = useMemo(() => buildSlices(rows, colorMap, "bills"), [rows, colorMap]);
  const labor = useMemo(() => buildSlices(rows, colorMap, "labor"), [rows, colorMap]);

  const billsTotal = sum(bills);
  const laborTotal = sum(labor);

  // Nothing coded on the job yet — two empty rings say less than no rings.
  if (billsTotal <= 0 && laborTotal <= 0) return null;

  return (
    <section className={className}>
      {/* The rail's heading gesture, repeated: the ochre dash plus the label,
          and the label itself is the tap. The hit area overhangs the row
          (`-my-2`) so a 44px target does not stand this heading taller than
          every other one on the page. */}
      <div
        className={`flex items-baseline justify-between gap-2 lg:mb-2 ${collapsed ? "mb-0" : "mb-2"}`}
      >
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          className="-ml-1 -my-2 flex min-h-11 min-w-0 items-center gap-2.5 px-1 text-left lg:pointer-events-none lg:my-0 lg:ml-0 lg:min-h-0 lg:px-0"
        >
          <span aria-hidden className="h-0.5 w-5 shrink-0 rounded-full bg-accent" />
          <SectionLabel>Cost by cost code</SectionLabel>
        </button>
        <span className="shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">
          job to date
        </span>
      </div>

      <div
        className={`mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 ${collapsed ? "hidden lg:grid" : ""}`}
      >
        <Donut
          title={`Bills · ${money(billsTotal)}`}
          slices={bills}
          size={120}
          centerLabel="bills"
          emptyLabel="No vendor bills yet"
        />
        <Donut
          title={`Labor · ${money(laborTotal)}`}
          slices={labor}
          size={120}
          centerLabel="labor"
          emptyLabel="No labor logged yet"
        />
      </div>
    </section>
  );
}
