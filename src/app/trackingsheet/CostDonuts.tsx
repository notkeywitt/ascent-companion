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
 * THE TWO RINGS ARE DIFFERENT HUES, and that is the point: olive for bills,
 * ochre for labor (the office's call, 2026-09-10). Each ring's own ramp is
 * SEQUENTIAL — one brand hue stepped by lightness, handed out by rank, so the
 * biggest slice is the deepest step and the ring reads as a size order.
 *
 * It used to be one categorical color map shared across the pair, so a code
 * kept its hue in both. That is gone, and it cannot come back while the rings
 * are branded by kind. Identity therefore lives in the LEGEND, where every
 * slice is named, and never in the colour alone.
 *
 * ANYTHING UNDER A TENTH OF ITS RING folds into one grey "Other", because a
 * ring is read at a glance and a 2% sliver is noise at that size. The top
 * three survive that rule whatever their share: a month spread evenly over
 * twelve codes would otherwise draw one grey circle.
 *
 * TWO SCOPES, and the caption is the switch. The selected MONTH leads, because
 * that is what this page is for — you are coding one month, and "what is this
 * month made of" is the question in front of you. Tapping the caption widens to
 * the whole job, which is the same cut the /jobs rings draw.
 *
 * Either way the figures come off the caller's own maps, so the rings, the
 * budget rail and the drill-downs cannot disagree — and staged recoding moves a
 * slice the moment you drop a line, before Sync.
 */

export interface CostDonutRow {
  code: string;
  name: string;
  /** Committed bill cost plus still-open drafts — what the rail counts as spent. */
  bills: number;
  labor: number;
}

/** One brand hue per ring, stepped by lightness (globals.css). Handed out by
 *  RANK — index 0 is the largest slice. */
const BILLS_RAMP = [
  "var(--ramp-bills-1)",
  "var(--ramp-bills-2)",
  "var(--ramp-bills-3)",
  "var(--ramp-bills-4)",
  "var(--ramp-bills-5)",
  "var(--ramp-bills-6)",
] as const;
const LABOR_RAMP = [
  "var(--ramp-labor-1)",
  "var(--ramp-labor-2)",
  "var(--ramp-labor-3)",
  "var(--ramp-labor-4)",
  "var(--ramp-labor-5)",
  "var(--ramp-labor-6)",
] as const;
const VIZ_OTHER = "var(--viz-other)";

/** A slice worth less than this much of its own ring folds into "Other". */
const SLICE_FLOOR = 0.1;
/** ...unless it is one of the top few, so a flat month still draws something. */
const SLICE_KEEP_MIN = 3;

/**
 * One ring's slices: biggest first, coloured by rank, with the small ones
 * folded together. Shared by nothing — the two rings are cut independently
 * now, which is what lets each carry its own hue.
 *
 * A staged recode can drive a code negative before its new home is saved. A
 * ring cannot draw a negative arc, so those sit out rather than distort the
 * shares around them.
 */
function buildSlices(
  rows: CostDonutRow[],
  field: "bills" | "labor",
  ramp: readonly string[],
): DonutSlice[] {
  const ranked = rows
    .filter((r) => r[field] > 0)
    .sort((a, b) => b[field] - a[field]);
  const total = ranked.reduce((n, r) => n + r[field], 0);
  if (total <= 0) return [];

  const out: DonutSlice[] = [];
  let other = 0;
  ranked.forEach((r, i) => {
    const big = r[field] / total >= SLICE_FLOOR;
    if (out.length < ramp.length && (big || i < SLICE_KEEP_MIN)) {
      out.push({
        key: r.code,
        label: r.name ? `${r.code} · ${r.name}` : r.code,
        value: r[field],
        color: ramp[out.length],
      });
    } else {
      other += r[field];
    }
  });
  if (other > 0)
    out.push({ key: "__other", label: "Other cost codes", value: other, color: VIZ_OTHER });
  return out;
}

const sum = (s: DonutSlice[]) => s.reduce((n, x) => n + x.value, 0);
const hasCost = (rows: CostDonutRow[]) => rows.some((r) => r.bills > 0 || r.labor > 0);

export function CostDonuts({
  month,
  jobToDate,
  monthLabel,
  className = "",
}: {
  /** The selected month's cost by code — the scope the rings open on. */
  month: CostDonutRow[];
  /** The whole job's cost by code. */
  jobToDate: CostDonutRow[];
  /** e.g. "July '26", for the caption. */
  monthLabel: string;
  className?: string;
}) {
  // Folded on a phone, exactly as the budget rail beside it is, and for the
  // same reason: two rings and their legends are a screenful, and the bill list
  // under them is the work. Always open from lg, where the column has the room.
  const [collapsed, setCollapsed] = useState(true);
  const [scope, setScope] = useState<"month" | "job">("month");

  const rows = scope === "month" ? month : jobToDate;

  const bills = useMemo(() => buildSlices(rows, "bills", BILLS_RAMP), [rows]);
  const labor = useMemo(() => buildSlices(rows, "labor", LABOR_RAMP), [rows]);

  const billsTotal = sum(bills);
  const laborTotal = sum(labor);

  // Nothing coded on the job at all — two empty rings say less than no rings.
  // An empty MONTH still renders: the caption is the only way back to the job,
  // so hiding the block on a quiet month would strand the switch.
  if (!hasCost(month) && !hasCost(jobToDate)) return null;

  const scopeLabel = scope === "month" ? monthLabel : "job to date";
  const emptySuffix = scope === "month" ? "this month" : "yet";

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
        {/* The scope switch, in the shape the rail's headroom flip already uses
            on this page: the caption says which scope you are in, and tapping
            it swaps. Hidden while the block is folded on a phone — a switch for
            charts you cannot see is a trap. */}
        <button
          type="button"
          onClick={() => setScope((s) => (s === "month" ? "job" : "month"))}
          title={
            scope === "month"
              ? "Showing the selected month — tap for the whole job"
              : "Showing the whole job — tap for the selected month"
          }
          className={`-my-2 -mr-1 inline-flex min-h-11 shrink-0 items-center gap-1 px-1 text-[11px] text-neutral-500 transition hover:text-accent dark:text-neutral-400 lg:my-0 lg:mr-0 lg:min-h-0 lg:px-0 ${
            collapsed ? "hidden lg:inline-flex" : ""
          }`}
        >
          {scopeLabel}
          <span aria-hidden className="text-[9px]">
            ⇅
          </span>
        </button>
      </div>

      <div
        className={`mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 ${collapsed ? "hidden lg:grid" : ""}`}
      >
        <Donut
          title={`Bills · ${money(billsTotal)}`}
          slices={bills}
          size={120}
          centerLabel="bills"
          emptyLabel={`No vendor bills ${emptySuffix}`}
        />
        <Donut
          title={`Labor · ${money(laborTotal)}`}
          slices={labor}
          size={120}
          centerLabel="labor"
          emptyLabel={`No labor logged ${emptySuffix}`}
        />
      </div>
    </section>
  );
}
