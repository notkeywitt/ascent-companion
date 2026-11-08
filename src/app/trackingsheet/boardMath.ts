/**
 * The Tracking Sheets board's own money math — the sums, tax figures and
 * budget roll-ups `Board.tsx` used to compute inline — as plain functions.
 *
 * Moved out of Board.tsx VERBATIM (SIMPLICITY_AUDIT.md finding 01, Option B:
 * "write a test for each money calculation in the file" before the board is
 * split further). Same arithmetic, same rounding, same order, same edge
 * behaviour; `boardMath.test.ts` pins it. A change here changes a figure the
 * office reads before it codes live JobTread money, so change it on purpose.
 *
 * Pure: no React, no fetch. The per-code budget math (headroom, used,
 * remaining, the rings) lives in ./headroom.ts; the open bill's line math in
 * src/lib/billLineMath.ts.
 */

import { round2 } from "@/lib/billLineMath";
import { isSalesTaxLine } from "@/lib/salesTax";
import type { CostDonutRow } from "./CostDonuts";
import { remainingOf, usedOf, type Headroom } from "./headroom";
import type { BillRef, JobBillLine } from "./Board";

/**
 * Is this cost code the DIVISION itself ("04 00 00", "26 00 00")? Everything
 * after the first two digits is zero. JobTread leaves these without a
 * parentCostCode — they ARE the parent — so their own name names the division.
 * (Mirrors `isDivisionLevelCode` in lib/jobtread.ts; Board.tsx is a client
 * component and can't import that server module.)
 */
export function isDivisionLevelCode(number: string): boolean {
  const digits = String(number ?? "").replace(/\D/g, "");
  return digits.length >= 4 && /^0+$/.test(digits.slice(2));
}

/**
 * Hours as a headline figure: "350 hrs", "349.8 hrs". One decimal, but only
 * when there is one — a month's total reading "350.0 hrs" is noise, and
 * rounding it away entirely would hide a part-hour.
 */
export const hoursLabel = (n: number) => {
  const v = Math.round(n * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} hrs`;
};

/**
 * Codeable lines per bill, with the 88 80 00 sales-tax line taken OUT — it is
 * not something the office codes, and leaving it in would let a tax amount be
 * edited as if it were a material line. `taxByDoc` keeps what each one carried.
 */
export function splitLinesByDoc(lines: JobBillLine[]): {
  linesByDoc: Map<string, JobBillLine[]>;
  taxByDoc: Map<string, number>;
} {
  const m = new Map<string, JobBillLine[]>();
  const tax = new Map<string, number>();
  for (const l of lines) {
    if (isSalesTaxLine(l)) {
      tax.set(l.docId, round2((tax.get(l.docId) ?? 0) + (Number(l.cost) || 0)));
      continue;
    }
    const arr = m.get(l.docId) ?? [];
    arr.push(l);
    m.set(l.docId, arr);
  }
  return { linesByDoc: m, taxByDoc: tax };
}

/**
 * A bill's sales tax: its 88 80 00 line plus any legacy `nonRecoverableTax`.
 * Summed, not preferred, so a bill halfway through the migration reports all
 * of its tax. Exactly one of the two is non-zero in practice.
 */
export const billTaxOf = (
  taxByDoc: Map<string, number>,
  b: { id: string; nonRecoverableTax?: number } | undefined | null,
) => (b ? round2((taxByDoc.get(b.id) ?? 0) + (Number(b.nonRecoverableTax) || 0)) : 0);

/** Does any staged sales-tax figure differ from the tax the bill already has? */
export function isTaxDirty(
  taxEdits: Record<string, string>,
  bills: { id: string; nonRecoverableTax?: number }[] | undefined,
  billTax: (b: { id: string; nonRecoverableTax?: number } | undefined | null) => number,
): boolean {
  return Object.entries(taxEdits).some(([docId, v]) => {
    if (v === "") return false;
    const bill = bills?.find((b) => b.id === docId);
    if (!bill) return false;
    return round2(Number(v) || 0) !== round2(billTax(bill));
  });
}

/** The open bill's tax as previewed: the staged text while there is some, else the stored tax. */
export const taxViewOf = (taxEdit: string | undefined, storedTax: number) =>
  taxEdit !== undefined && taxEdit !== "" ? Number(taxEdit) || 0 : storedTax;

/** The approve dialog's tax column: "on" only for a positive tax. */
export const approvalTaxOn = (tax: number) => tax > 0;

/** The month's to-be-invoiced headline: approved and invoiceable now, plus the drafts still coding. */
export const toBeInvoiced = (recon: { remaining: number; draftBillsCost: number }) =>
  recon.remaining + recon.draftBillsCost;

/** The face total of a list of bills — each bill's `cost`, summed, not rounded. */
export const billsCostTotal = (bills: { cost: number }[]) => bills.reduce((s, b) => s + b.cost, 0);

/**
 * The rail's rows: every code with anything on it, narrowed by the search
 * text, in code order. Labor-only codes count: a code with hours but no budget
 * and no bills is over budget by definition, and hiding it would hide that.
 */
export function railRowsOf(headroom: Map<string, Headroom>, codeQuery: string): Headroom[] {
  const q = codeQuery.trim().toLowerCase();
  const rows = [...headroom.values()].filter(
    (h) => h.budget !== 0 || h.spent !== 0 || h.drafts !== 0 || h.labor !== 0,
  );
  const matched = q ? rows.filter((h) => `${h.code} ${h.name}`.toLowerCase().includes(q)) : rows;
  return matched.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The rail, grouped into collapsible CSI divisions. A division's figures are
 * the sum of its codes', so a collapsed division still says whether there's
 * room in it — otherwise collapsing would hide the answer you came for.
 */
export function railGroupsOf(railRows: Headroom[]) {
  const g = new Map<string, { code: string; name: string; rows: Headroom[] }>();
  for (const h of railRows) {
    const dc = h.code.replace(/\D/g, "").slice(0, 2) || "—";
    const e = g.get(dc) ?? { code: dc, name: "", rows: [] };
    // A division is named by JobTread's parent cost code. A code that IS the
    // division ("04 00 00 Masonry") has no parent, so its own name names the
    // division — otherwise the header falls back to the number and reads
    // "04 04".
    if (!e.name) e.name = h.division || (isDivisionLevelCode(h.code) ? h.name : "");
    e.rows.push(h);
    g.set(dc, e);
  }
  return [...g.values()]
    .map((e) => ({
      ...e,
      budget: e.rows.reduce((s, r) => s + r.budget, 0),
      used: e.rows.reduce((s, r) => s + usedOf(r), 0),
      remaining: e.rows.reduce((s, r) => s + remainingOf(r), 0),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The phone's headroom rail: every code with a real budget, fewest DOLLARS
 * left first (or most left, reversed), eight of them.
 */
export function tightestCodesOf(railRows: Headroom[], headroomMostLeft: boolean): Headroom[] {
  return railRows
    .filter((h) => h.budget > 0)
    .sort((a, b) =>
      headroomMostLeft ? remainingOf(b) - remainingOf(a) : remainingOf(a) - remainingOf(b),
    )
    .slice(0, 8);
}

/** A time row's budget-left chip. Counts drafts and labor, through `usedOf`. */
export function timeHeadroomOf(
  headroom: Map<string, Headroom>,
  code: string,
): { name: string; remaining: number } | null {
  const h = headroom.get(code);
  return h ? { name: h.name, remaining: h.budget - usedOf(h) } : null;
}

/** The coding card's budget-left figure for a code, or null when the code has no row. */
export function remainingForCode(headroom: Map<string, Headroom>, code: string): number | null {
  const h = headroom.get(code);
  return h ? remainingOf(h) : null;
}

/**
 * The "by cost code" lanes. Within a lane, lines belonging to the SAME bill
 * collapse into one draggable stack — a bill that split three ways across a
 * code reads as one thing you can move, with a ×3 badge, not three identical
 * chips.
 */
export function laneRowsOf(
  lines: JobBillLine[],
  bills: BillRef[],
  codeOf: (l: JobBillLine) => string,
  headroom: Map<string, Headroom>,
) {
  const byCode = new Map<string, Map<string, JobBillLine[]>>();
  for (const l of lines) {
    const code = codeOf(l) || "(uncoded)";
    const lanes = byCode.get(code) ?? new Map<string, JobBillLine[]>();
    const arr = lanes.get(l.docId) ?? [];
    arr.push(l);
    lanes.set(l.docId, arr);
    byCode.set(code, lanes);
  }
  const billById = new Map(bills.map((b) => [b.id, b]));
  return [...byCode.entries()]
    .map(([code, lanes]) => {
      const all = [...lanes.entries()]
        .map(([docId, ls]) => ({
          key: `${code}/${docId}`,
          docId,
          lines: ls,
          cost: ls.reduce((s, l) => s + l.cost, 0),
          label: billById.get(docId)?.vendor ?? ls[0]?.name ?? "Bill",
          status: billById.get(docId)?.status ?? ls[0]?.billStatus ?? "",
          invoiced: billById.get(docId)?.invoiced ?? false,
        }))
        .sort((a, b) => b.cost - a.cost);
      const total = all.reduce((s, x) => s + x.cost, 0);
      return {
        code,
        h: headroom.get(code),
        stacks: all,
        total,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The Jobs page's All Time rings, from the whole-job contributors read.
 * Committed bills only, as that read is, under the code JobTread holds.
 */
export function allTimeRingRowsOf(
  contributors: { bills: { code: string; cost: number }[]; time: { code: string; cost: number }[] } | null,
  headroom: Map<string, Headroom>,
): CostDonutRow[] | null {
  if (!contributors) return null;
  const m = new Map<string, CostDonutRow>();
  const row = (code: string) => {
    let r = m.get(code);
    if (!r) m.set(code, (r = { code, name: headroom.get(code)?.name ?? "", bills: 0, labor: 0 }));
    return r;
  };
  for (const l of contributors.bills) if (l.code) row(l.code).bills += l.cost;
  for (const t of contributors.time) if (t.code) row(t.code).labor += t.cost;
  return [...m.values()].filter((r) => r.bills !== 0 || r.labor !== 0);
}

/** "Job to date": bills plus labor across every ring row. */
export const jobToDateTotal = (rows: CostDonutRow[]) => rows.reduce((s, r) => s + r.bills + r.labor, 0);

/**
 * One bill row's per-code amounts (staged recodes win, through `codeOf`) and
 * how many of its lines are staged to move.
 */
export function billCodeAmounts(
  lines: JobBillLine[],
  codeOf: (l: JobBillLine) => string,
  staged: Map<string, string>,
): { codes: Map<string, number>; movedHere: number } {
  const codes = new Map<string, number>();
  let movedHere = 0;
  for (const l of lines) {
    const c = codeOf(l);
    codes.set(c, (codes.get(c) ?? 0) + l.cost);
    if (staged.has(l.id)) movedHere++;
  }
  return { codes, movedHere };
}
