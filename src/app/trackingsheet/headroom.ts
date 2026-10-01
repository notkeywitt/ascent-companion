/**
 * The Tracking Sheets board's budget math — what each cost code has, what is
 * charged against it, and what is left — as plain functions.
 *
 * Moved out of Board.tsx on 2026-09-29 (SIMPLICITY_AUDIT.md finding 01): that
 * file was one 4,600-line function with no tests, and this is the part of it
 * that decides the money on the rail, the rings and every "budget left" chip.
 * `headroom.test.ts` pins it before the rest of the board is split.
 *
 * Pure: no React, no fetch. Board.tsx passes in the loaded month and its
 * staged-aware readers (`codeOf`, `timeCodeOf`), so a staged recode moves the
 * figures the moment a line is dropped.
 */

import type { CostDonutRow } from "./CostDonuts";

export interface Headroom {
  code: string;
  name: string;
  division: string;
  budget: number;
  spent: number; // committed: approved + pending bills (all time), ± staged moves
  drafts: number; // this month's draft-bill cost coded here (not yet committed)
  labor: number; // time entries coded here — billed to the customer like a bill
  droppable: boolean; // has at least one budget leaf to code to
}

/** Draft bills are coded but not yet committed spend — JobTread's own budget math excludes them. */
export const isCommitted = (status: string) => status === "pending" || status === "approved";

/**
 * Everything that will have been charged against this code, so `remaining` is
 * the room actually left.
 *
 * Labor is in here because a customer invoice bills time entries alongside
 * vendor bills — leaving it out overstated headroom on any code carrying hours
 * (e.g. 01 31 20 read $0 left when it was $976 over). It does NOT move when a
 * bill is recoded: a time entry is coded independently of any bill, so it's a
 * fixed per-code baseline that the staged bill moves add to.
 */
export const usedOf = (h: Headroom) => h.spent + h.drafts + h.labor;
export const remainingOf = (h: Headroom) => h.budget - usedOf(h);

/* The shapes these functions read. Board.tsx's own types carry more fields;
   only these are needed, so a test can build them by hand. */
export interface DivisionIn {
  name: string;
  codes: { number: string; name: string; budget: number; bills: number; labor: number }[];
}
export interface LeafIn {
  name: string;
  cost?: number;
  division?: string;
}
export interface LineIn {
  code: string;
  codeName: string;
  cost: number;
  billStatus: string;
}
export interface TimeIn {
  code: string;
  codeName: string;
  cost: number;
}

/**
 * Cost code → its headroom, JOB-TO-DATE. Starts from JobTread's cost detail
 * (which counts committed bills and all labor under their ORIGINAL codes), adds
 * a row for every budget leaf that has no spend yet, then applies the month:
 * a staged move of a committed line or a time entry is a transfer (off the old
 * code, onto the new); a draft line is added whole under wherever it sits now.
 */
export function buildHeadroom<L extends LineIn, T extends TimeIn>(input: {
  divisions: DivisionIn[];
  leavesByCode: Map<string, LeafIn[]>;
  lines: L[];
  timeEntries: T[];
  codeOf: (l: L) => string;
  timeCodeOf: (t: T) => string;
}): Map<string, Headroom> {
  const { divisions, leavesByCode, lines, timeEntries, codeOf, timeCodeOf } = input;
  const map = new Map<string, Headroom>();
  const divisionOf = new Map<string, string>();

  for (const d of divisions) {
    for (const c of d.codes) {
      // The NAME only. Falling back to the number here put "04" in the name
      // slot, and the rail header renders number + name — hence "04 04".
      if (d.name) divisionOf.set(c.number, d.name);
      map.set(c.number, {
        code: c.number,
        name: c.name,
        division: d.name,
        budget: c.budget,
        spent: c.bills,
        drafts: 0,
        labor: c.labor,
        droppable: (leavesByCode.get(c.number)?.length ?? 0) > 0,
      });
    }
  }
  // A code that only exists as a budget leaf (never spent) still needs a row —
  // it's usually the one WITH headroom, which is exactly what we're hunting for.
  for (const [code, leaves] of leavesByCode) {
    if (map.has(code)) continue;
    map.set(code, {
      code,
      name: leaves[0]?.name ?? "",
      // A code with a budget leaf but no spend never reaches costDetail, so
      // divisionOf can't name it — the leaf carries its own division name.
      division: divisionOf.get(code) ?? leaves.find((l) => l.division)?.division ?? "",
      budget: leaves.reduce((s, l) => s + (l.cost ?? 0), 0),
      spent: 0,
      drafts: 0,
      labor: 0,
      droppable: true,
    });
  }

  const ensure = (code: string): Headroom => {
    let h = map.get(code);
    if (!h) {
      h = {
        code,
        name: "",
        division: divisionOf.get(code) ?? "",
        budget: 0,
        spent: 0,
        drafts: 0,
        labor: 0,
        droppable: (leavesByCode.get(code)?.length ?? 0) > 0,
      };
      map.set(code, h);
    }
    return h;
  };

  for (const l of lines) {
    const now = codeOf(l);
    const was = l.code;
    if (isCommitted(l.billStatus)) {
      // costDetail.bills already counts this line under its ORIGINAL code, so a
      // staged move is a transfer: take it off the old code, put it on the new.
      if (now !== was) {
        if (was) ensure(was).spent -= l.cost;
        if (now) ensure(now).spent += l.cost;
      }
    } else if (now) {
      // Drafts aren't in costDetail.bills at all, so they're added whole —
      // under wherever they currently sit.
      ensure(now).drafts += l.cost;
    }
  }

  // …and the same transfer for staged LABOR. costDetail.labor already counts
  // every entry under its ORIGINAL code, so a staged move subtracts there and
  // adds here. Without this the rail — and the budget-left chip on every time
  // row — would sit perfectly still while you recoded a week of hours, which
  // is the one moment those figures matter most.
  for (const t of timeEntries) {
    const now = timeCodeOf(t);
    const was = t.code;
    if (now === was) continue;
    if (was) ensure(was).labor -= t.cost;
    if (now) ensure(now).labor += t.cost;
  }
  return map;
}

/**
 * The rings' JOB-TO-DATE scope — the SAME headroom map the rail draws, so the
 * rings cannot disagree with the rail beside them. Bills folds drafts in,
 * matching `usedOf`. Codes with no cost at all sit out; a code a credit drove
 * negative stays, so the ring's centre can net it (CostDonuts).
 */
export function jobRingRows(headroom: Map<string, Headroom>): CostDonutRow[] {
  return [...headroom.values()]
    .map((h) => ({ code: h.code, name: h.name, bills: h.spent + h.drafts, labor: h.labor }))
    .filter((r) => r.bills !== 0 || r.labor !== 0);
}

/**
 * The rings' SELECTED-MONTH scope. Built from the month's own lines and time
 * entries (headroom is job-to-date by construction), through the same
 * staged-aware readers, so a drag moves a slice here too. Every line in the
 * month counts, draft and committed alike. Names come off `headroom` first so a
 * code reads the same in both scopes.
 */
export function monthRingRows<L extends LineIn, T extends TimeIn>(input: {
  lines: L[];
  timeEntries: T[];
  codeOf: (l: L) => string;
  timeCodeOf: (t: T) => string;
  headroom: Map<string, Headroom>;
}): CostDonutRow[] {
  const { lines, timeEntries, codeOf, timeCodeOf, headroom } = input;
  const map = new Map<string, CostDonutRow>();
  const ensure = (code: string, fallbackName: string) => {
    let r = map.get(code);
    if (!r) {
      r = { code, name: headroom.get(code)?.name || fallbackName || "", bills: 0, labor: 0 };
      map.set(code, r);
    }
    return r;
  };
  for (const l of lines) {
    const code = codeOf(l);
    if (code) ensure(code, l.codeName).bills += l.cost;
  }
  for (const t of timeEntries) {
    const code = timeCodeOf(t);
    if (code) ensure(code, t.codeName).labor += t.cost;
  }
  return [...map.values()].filter((r) => r.bills !== 0 || r.labor !== 0);
}
