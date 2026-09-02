/**
 * DISMISSAL — "this one is handled, stop showing it to me."
 *
 * The To-Do and Follow-ups lists are the two the office WORKS THROUGH, and a
 * digest that reports the same answered email every morning trains people to
 * stop reading it. So each item in a `dismissible` category (settings.ts)
 * carries a Dismiss button, and this file is the identity + filtering half of
 * that: which item a dismissal refers to, and what a digest looks like once the
 * dismissed ones are taken out.
 *
 * PURE ON PURPOSE — no DB, no Node, no React. The browser computes the same key
 * the server stores (so the button knows what it is dismissing), the aggregator
 * filters a fresh run with it, and the GET route filters the already-stored
 * digest with it, all from this one implementation. The DB half lives in
 * `store.ts` with the rest of the digest's storage.
 *
 * DISMISSING IS NOT COMPLETING. Nothing here touches JobTread, Gmail or a
 * calendar — a dismissed JobTread to-do is still open in JobTread. The one
 * exception is the office's OWN reminders, which the dismiss route marks done
 * in `digest_todos`, because there the digest is the system of record.
 */
import type { DigestItem, StoredCheckResult } from "./types";

/** Whitespace-collapsed, lowercased, length-capped — a title used as identity. */
function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 160);
}

/**
 * The stored identity of one item: its check plus the item's own key.
 *
 * Namespaced by check id so two checks can't collide on a bare thread id. Falls
 * back to the title when a check sets no `key` — good enough for a check whose
 * titles are stable, and the reason `DigestItem.key` exists for the ones whose
 * aren't.
 */
export function dismissalKey(checkId: string, item: Pick<DigestItem, "title" | "key">): string {
  return `${checkId}::${item.key ? item.key.slice(0, 200) : `title:${normalizeTitle(item.title)}`}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Take the dismissed items out of a set of results.
 *
 * The check's own summary line was written over the un-filtered list, so it is
 * amended rather than trusted: a check emptied by dismissals reads as clear (and
 * drops to `ok`, so it stops painting the category amber), and one that lost
 * some of its items says how many. A check in no dismissible category is
 * untouched, because none of its keys can be in the set.
 */
export function applyDismissals(
  results: StoredCheckResult[],
  dismissed: ReadonlySet<string>,
): StoredCheckResult[] {
  if (dismissed.size === 0) return results;
  return results.map((r) => {
    const kept = r.items.filter((item) => !dismissed.has(dismissalKey(r.id, item)));
    const removed = r.items.length - kept.length;
    if (removed === 0) return r;
    return {
      ...r,
      items: kept,
      status: kept.length === 0 && r.status === "warning" ? "ok" : r.status,
      summary:
        kept.length === 0
          ? `All clear — ${plural(removed, "item")} dismissed.`
          : `${r.summary} (${plural(removed, "item")} dismissed)`,
    };
  });
}

/**
 * The digest-todos key for one of the office's own reminders. Used by the check
 * that emits the item and by the dismiss route that marks it done, so the two
 * agree on what "todo:12" means.
 */
export function todoItemKey(id: number): string {
  return `todo:${id}`;
}

/** The reminder id inside a digest-todos dismissal key, or null if it isn't one. */
export function todoIdFromKey(key: string): number | null {
  const m = /^digest-todos::todo:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}
