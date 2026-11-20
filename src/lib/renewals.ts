/** Company renewals — pure date and status logic. Stored as JSON under the "renewals" key of company_details. */
export interface Renewal {
  id: string;
  name: string;
  due: string; // YYYY-MM-DD, or "" for no date
  warnDays: number;
  notes: string;
  link: string;
}

export type RenewalStatus = "overdue" | "soon" | "ok" | "none";

export const SEED_NAMES = [
  "Bond",
  "General liability",
  "Progressive auto",
  "Reseller permit",
  "Business licence",
  "Contractor registration",
  "AWB",
  "APP review",
];

export const seedRenewals = (): Renewal[] =>
  SEED_NAMES.map((name, i) => ({ id: `seed-${i}`, name, due: "", warnDays: 30, notes: "", link: "" }));

const DAY = 86_400_000;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Whole days from `today` (YYYY-MM-DD) to `due`. Negative = overdue. */
export function daysUntil(due: string, today: string): number {
  return Math.round((Date.parse(due) - Date.parse(today)) / DAY);
}

export function renewalStatus(r: Pick<Renewal, "due" | "warnDays">, today: string): RenewalStatus {
  if (!isDay(r.due)) return "none";
  const d = daysUntil(r.due, today);
  return d < 0 ? "overdue" : d <= r.warnDays ? "soon" : "ok";
}

/** The same date one year on. Feb 29 becomes Feb 28. */
export function rollYear(due: string): string {
  if (!isDay(due)) return due;
  const [y, m, d] = due.split("-").map(Number);
  const dt = new Date(Date.UTC(y + 1, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0);
  return dt.toISOString().slice(0, 10);
}

/** Dated first (soonest first), undated last. */
export function sortRenewals(list: Renewal[]): Renewal[] {
  const key = (r: Renewal) => (isDay(r.due) ? r.due : "9999");
  return [...list].sort((a, b) => key(a).localeCompare(key(b)) || a.name.localeCompare(b.name));
}

export function attentionCount(list: Renewal[], today: string): number {
  return list.filter((r) => ["overdue", "soon"].includes(renewalStatus(r, today))).length;
}

/** Clean a saved list from the browser. Returns null when it is not a list. */
export function cleanRenewals(input: unknown): Renewal[] | null {
  if (!Array.isArray(input) || input.length > 200) return null;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return input.map((x: Record<string, unknown>, i) => {
    const due = s(x?.due, 10);
    const w = Number(x?.warnDays);
    return {
      id: s(x?.id, 40) || `r-${i}`,
      name: s(x?.name, 120) || "Untitled",
      due: isDay(due) ? due : "",
      warnDays: Number.isFinite(w) && w >= 0 && w <= 365 ? Math.round(w) : 30,
      notes: s(x?.notes, 500),
      link: s(x?.link, 500),
    };
  });
}
