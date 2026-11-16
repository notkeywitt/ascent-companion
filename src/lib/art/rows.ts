/**
 * The plain rows every piece on /art draws from, one shape per data set.
 * Pure types and helpers: the Pave reads live in src/lib/jobtread/artCloud.ts,
 * and pages fetch these rows from /api/art/rows?set=.
 */
import type { CloudRecord, CloudSetId } from "./cloud";

export interface ArtBillRow {
  name: string;
  cost: number;
  qty: number;
  unit: number;
  /** Bill issue date, "YYYY-MM-DD". */
  date: string;
  /** Cost-code number, "06 10 00". */
  code: string;
  type: string;
  vendor: string;
  /** The job's name; "No job" for a bill line not on one. */
  job: string;
}

export interface ArtTimeRow {
  /** Org-local start, "YYYY-MM-DDTHH:MM:SS". */
  start: string;
  hours: number;
  person: string;
  job: string;
  code: string;
  pay: string;
}

export interface ArtBudgetRow {
  name: string;
  cost: number;
  price: number;
  qty: number;
  code: string;
  type: string;
  job: string;
}

export interface ArtRows {
  bills: ArtBillRow[];
  labor: ArtTimeRow[];
  budget: ArtBudgetRow[];
}

/** The CSI division of a cost-code number: its first two digits. */
export const divisionOf = (code: string) => code.trim().slice(0, 2) || "none";

const monthIndex = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return y && m ? y * 12 + m : 0;
};
const dayIndex = (iso: string) => {
  const t = Date.parse(iso.slice(0, 10));
  return Number.isFinite(t) ? Math.floor(t / 86_400_000) : 0;
};

/** Rows → the Cost Cloud's records (features for PCA). */
export function cloudRecords<S extends CloudSetId>(set: S, rows: ArtRows[S]): CloudRecord[] {
  if (set === "bills") {
    return (rows as ArtBillRow[]).map((r) => ({
      title: r.name || "Bill line",
      value: r.cost,
      meta: [r.vendor, r.code, r.date].filter(Boolean).join(" · "),
      num: { cost: r.cost, qty: r.qty, unit: r.unit, month: monthIndex(r.date) },
      cat: { type: r.type, div: divisionOf(r.code), vendor: r.vendor },
      text: r.name,
    }));
  }
  if (set === "labor") {
    return (rows as ArtTimeRow[]).map((r) => {
      const dow = r.start ? new Date(`${r.start.slice(0, 10)}T12:00:00Z`).getUTCDay() : 0;
      const start = r.start ? Number(r.start.slice(11, 13)) + Number(r.start.slice(14, 16)) / 60 : 0;
      return {
        title: `${r.person} · ${r.job}`,
        value: r.hours,
        meta: [r.start.slice(0, 10), r.code, r.pay].filter(Boolean).join(" · "),
        num: {
          hours: r.hours,
          start,
          dowSin: Math.sin((2 * Math.PI * dow) / 7),
          dowCos: Math.cos((2 * Math.PI * dow) / 7),
          day: dayIndex(r.start),
        },
        cat: { person: r.person, div: divisionOf(r.code), job: r.job, pay: r.pay },
      };
    });
  }
  return (rows as ArtBudgetRow[]).map((r) => ({
    title: r.name || "Budget line",
    value: r.cost,
    meta: [r.job, r.code].filter(Boolean).join(" · "),
    num: {
      cost: r.cost,
      price: r.price,
      qty: r.qty,
      margin: r.price > 0 ? Math.max(-1, Math.min(1, (r.price - r.cost) / r.price)) : 0,
    },
    cat: { type: r.type, div: divisionOf(r.code), job: r.job },
    text: r.name,
  }));
}
