/**
 * Turning a stored digest into the shape the screen draws — grouped by
 * category, each with a rolled-up status and item count.
 *
 * Pure, and deliberately in `lib/` rather than inside the component: this is
 * the logic that makes categories DATA rather than three hardcoded tabs, so it
 * is the part worth a test. The component only renders what comes back.
 */
import type { DigestCategory } from "./settings";
import type { CheckStatus, StoredCheckResult } from "./types";

/** One category as rendered: its checks, their items, and the worst status among them. */
export interface CategoryView {
  id: string;
  label: string;
  blurb?: string;
  results: StoredCheckResult[];
  itemCount: number;
  status: CheckStatus;
}

/** Worst-wins: an errored check outranks a warning, which outranks all-clear. */
export function worstStatus(results: StoredCheckResult[]): CheckStatus {
  if (results.some((r) => r.status === "error")) return "error";
  if (results.some((r) => r.status === "warning")) return "warning";
  return "ok";
}

/** "follow-up_notes" → "Follow Up Notes" — the label for an unregistered category. */
export function titleCase(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Group results into categories.
 *
 * Order comes from `categories` (settings.ts). A category with no results is
 * dropped; a category the results name that ISN'T registered is appended with a
 * title-cased label rather than discarded — so a check introducing a brand-new
 * category renders correctly before anyone gets round to registering it, which
 * is what keeps "add a category" from being a UI change.
 */
export function groupByCategory(
  results: StoredCheckResult[],
  categories: DigestCategory[],
): CategoryView[] {
  const byId = new Map<string, StoredCheckResult[]>();
  for (const r of results) {
    const list = byId.get(r.category) ?? [];
    list.push(r);
    byId.set(r.category, list);
  }
  const known: DigestCategory[] = categories.filter((c) => byId.has(c.id));
  const extra: DigestCategory[] = [...byId.keys()]
    .filter((id) => !categories.some((c) => c.id === id))
    .sort()
    .map((id) => ({ id, label: titleCase(id) }));

  return [...known, ...extra].map((c) => {
    const own = byId.get(c.id) ?? [];
    return {
      id: c.id,
      label: c.label,
      blurb: c.blurb,
      results: own,
      itemCount: own.reduce((n, r) => n + r.items.length, 0),
      status: worstStatus(own),
    };
  });
}

/**
 * How a category (or a single check) should be PRESENTED — which is not the same
 * question as what its status is.
 *
 * `status` answers "did this check find a problem". Presentation has to answer
 * "what should the reader see", and those diverge in one case that used to be
 * mis-drawn: a check that reports `ok` and still returns ITEMS. "On the
 * Calendar" is exactly that — a full calendar is information, not a problem, so
 * it deliberately returns `ok` (see checks/calendarEvents.ts) — and the card was
 * therefore painting a green ✅ "Clear" over a day holding twelve events, hiding
 * the count. That was tolerable while the digest led with billing; once the
 * digest became a schedule/to-do report (2026-08-31) Calendar is the FIRST
 * thing on the card, so "Clear" was the headline on a busy morning.
 *
 * `info` is the fix: same neutral, non-alarming reading as `ok` — it must NOT
 * borrow amber, which is reserved for work that is actually waiting — but it
 * shows the count and drops the tick. Derived from data, so no check and no
 * category is named here: any future check that reports items without alarm
 * gets the same treatment for free.
 */
export type CategoryTone = "clear" | "info" | "warning" | "error";

/** The tone for a rolled-up category or one check result: status first, then "ok but not empty". */
export function categoryTone(view: { status: CheckStatus; itemCount: number }): CategoryTone {
  if (view.status === "error") return "error";
  if (view.status === "warning") return "warning";
  return view.itemCount > 0 ? "info" : "clear";
}
