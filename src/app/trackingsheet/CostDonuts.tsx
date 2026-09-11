"use client";

import { useMemo, useState } from "react";
import { Donut, type DonutDetailRow, type DonutSlice } from "@/components/Donut";
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
 * BOTH RINGS SHARE ONE code → color map, so a code keeps its color across
 * them: the point of a pair is comparing where the bill money went against
 * where the hours went, and that only works if 06 20 00 is the same hue in
 * both. An olive/ochre split was tried on 2026-09-10 and gave that up for a
 * brand tint that read as decoration; the shared map came back the same day.
 *
 * ANYTHING UNDER A TENTH OF ITS RING folds into one grey "Other", because a
 * ring is read at a glance and a 2% sliver is noise at that size. A code that
 * clears the tenth in EITHER ring keeps its colour in both, so the floor
 * decides which codes are worth naming and never hides one from half the
 * comparison. The top three of a ring survive the rule whatever their share: a
 * month spread evenly over twelve codes would otherwise draw one grey circle.
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

/** A slice worth less than this much of its own ring folds into "Other". */
const SLICE_FLOOR = 0.1;
/** ...unless it is one of the top few, so a flat month still draws something. */
const SLICE_KEEP_MIN = 3;

/** The codes worth naming in one ring: everything over the floor, plus the top
 *  few whatever their share. A staged recode can drive a code negative before
 *  its new home is saved; a ring cannot draw a negative arc, so those sit out
 *  rather than distort the shares around them. */
function worthNaming(rows: CostDonutRow[], field: "bills" | "labor"): Set<string> {
  const ranked = rows.filter((r) => r[field] > 0).sort((a, b) => b[field] - a[field]);
  const total = ranked.reduce((n, r) => n + r[field], 0);
  const keep = new Set<string>();
  ranked.forEach((r, i) => {
    if (i < SLICE_KEEP_MIN || (total > 0 && r[field] / total >= SLICE_FLOOR)) keep.add(r.code);
  });
  return keep;
}

/**
 * Stable cost code → color map shared by both rings. A code worth naming in
 * EITHER ring claims a slot; where there are more of those than slots, the
 * biggest by combined cost win. Slots are then handed out in CODE order rather
 * than by rank, so the mapping does not reshuffle when one ring outgrows the
 * other.
 *
 * Built from whichever scope is on screen, not from the job: a code with a big
 * job-to-date total but nothing this month would otherwise hold a slot the
 * month's own codes need, and the month view is the one that leads.
 */
function buildColorMap(rows: CostDonutRow[]): Map<string, string> {
  const named = new Set([...worthNaming(rows, "bills"), ...worthNaming(rows, "labor")]);
  const top = rows
    .filter((r) => named.has(r.code))
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

/**
 * The codes behind the grey "Other" arc — every code the colour map had no slot
 * for, with what it spent in this ring. It is the one slice whose card is not a
 * list of bills: "Other" is the ring hiding names, so the card's job is to give
 * them back.
 */
function otherCodes(
  rows: CostDonutRow[],
  colorMap: Map<string, string>,
  field: "bills" | "labor",
): DonutDetailRow[] {
  return rows
    .filter((r) => !colorMap.has(r.code) && r[field] > 0)
    .map((r) => ({
      key: r.code,
      label: r.name ? `${r.code} · ${r.name}` : r.code,
      value: r[field],
    }))
    .sort((a, b) => b.value - a.value);
}

const sum = (s: DonutSlice[]) => s.reduce((n, x) => n + x.value, 0);
const hasCost = (rows: CostDonutRow[]) => rows.some((r) => r.bills > 0 || r.labor > 0);

export function CostDonuts({
  month,
  jobToDate,
  monthLabel,
  detail,
  onDetailWanted,
  className = "",
}: {
  /** The selected month's cost by code — the scope the rings open on. */
  month: CostDonutRow[];
  /** The whole job's cost by code. */
  jobToDate: CostDonutRow[];
  /** e.g. "July '26", for the caption. */
  monthLabel: string;
  /**
   * The bills or time entries behind one cost code, for a slice's hover card —
   * null while the answer is still being fetched. Scope-aware, because the
   * rings' own figures are: a card that listed the whole job under a month's
   * arc would contradict the arc it hangs off.
   */
  detail?: (
    code: string,
    field: "bills" | "labor",
    scope: "month" | "job",
  ) => DonutDetailRow[] | null;
  /** Fired on first hover, so the caller can start the fetch `detail` needs. */
  onDetailWanted?: (scope: "month" | "job") => void;
  className?: string;
}) {
  // Folded on a phone, exactly as the budget rail beside it is, and for the
  // same reason: two rings and their legends are a screenful, and the bill list
  // under them is the work. Always open from lg, where the column has the room.
  const [collapsed, setCollapsed] = useState(true);
  const [scope, setScope] = useState<"month" | "job">("month");

  const rows = scope === "month" ? month : jobToDate;

  const colorMap = useMemo(() => buildColorMap(rows), [rows]);
  const bills = useMemo(() => buildSlices(rows, colorMap, "bills"), [rows, colorMap]);
  const labor = useMemo(() => buildSlices(rows, colorMap, "labor"), [rows, colorMap]);

  const billsTotal = sum(bills);
  const laborTotal = sum(labor);

  /** One reader per ring: the folded codes for "Other", the caller's bills or
   *  time entries for everything else. */
  const ringDetail =
    detail &&
    ((field: "bills" | "labor") =>
      (key: string): DonutDetailRow[] | null =>
        key === "__other" ? otherCodes(rows, colorMap, field) : detail(key, field, scope));

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
          detail={ringDetail && ringDetail("bills")}
          onDetailWanted={onDetailWanted && (() => onDetailWanted(scope))}
        />
        <Donut
          title={`Labor · ${money(laborTotal)}`}
          slices={labor}
          size={120}
          centerLabel="labor"
          emptyLabel={`No labor logged ${emptySuffix}`}
          detail={ringDetail && ringDetail("labor")}
          onDetailWanted={onDetailWanted && (() => onDetailWanted(scope))}
        />
      </div>
    </section>
  );
}
