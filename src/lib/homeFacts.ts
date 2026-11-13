/**
 * Small facts the app reads more than once per tab — the "Needs attention"
 * rows (TodayQueue), the LSWDD statement the pay pop-up checks — and the
 * company-time date helpers they compare against. CLIENT module, though the
 * date helpers are pure and the server reads them too (lib/homeAttention).
 *
 * Every fact goes through `cached`: one request per fact, shared, and kept for
 * its TTL in this tab. Some are slow (Apps Script runs), and Home is opened
 * many times a day.
 */
import { companyDateParts } from "@/lib/billing";
import type { LswddStatementBills } from "@/lib/jobtread";

const MIN = 60_000;
const held = new Map<string, { at: number; p: Promise<unknown> }>();

/** One shared, TTL-bounded load per key — in memory, and in sessionStorage across reloads. */
export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = held.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p as Promise<T>;
  const storeKey = `home.fact.${key}`;
  try {
    const raw = sessionStorage.getItem(storeKey);
    if (raw) {
      const { at, v } = JSON.parse(raw) as { at: number; v: T };
      if (now - at < ttlMs) {
        const p = Promise.resolve(v);
        held.set(key, { at, p });
        return p;
      }
    }
  } catch {
    /* storage blocked — load it */
  }
  const p = load().then((v) => {
    try {
      sessionStorage.setItem(storeKey, JSON.stringify({ at: Date.now(), v }));
    } catch {
      /* the in-memory copy still serves this visit */
    }
    return v;
  });
  // A failure is not remembered: the next caller tries again.
  p.catch(() => held.delete(key));
  held.set(key, { at: now, p });
  return p;
}

/** Drop one fact, so the next read loads it fresh — after a write that changes it. */
export function forgetFact(key: string): void {
  held.delete(key);
  try {
    sessionStorage.removeItem(`home.fact.${key}`);
  } catch {
    /* storage blocked — the in-memory copy is gone already */
  }
}

/** "YYYY-MM-DD" today, in the company timezone. */
export function companyToday(now = new Date()): string {
  const { year, month, day } = companyDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "YYYY-MM" of the month before today, in the company timezone. */
export function previousMonth(now = new Date()): string {
  const { year, month } = companyDateParts(now);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

/**
 * The newest LSWDD statement's bills and due date (`/api/lswdd/bills`). Read by
 * the pay reminder pop-up and the Home reminder line. /lswdd forgets it after
 * Approve All, so the reminder follows.
 */
export function lswddStatementBills(): Promise<LswddStatementBills> {
  return cached("lswdd-bills", 10 * MIN, async () => {
    const r = await fetch("/api/lswdd/bills");
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as LswddStatementBills;
  });
}
