/**
 * Server side of editable page copy — the DB half of src/lib/copy.ts.
 *
 * Kept SEPARATE from copy.ts so that module stays pure and importable from
 * client components; everything here touches the DB and is server-only.
 *
 * Failure model matches the registry's promise: if the DB is empty, missing, or
 * throws, `loadCopyOverrides` returns {} and every page renders its shipped
 * English. Copy is never a reason for a page to fail to render, so the read is
 * deliberately swallowed rather than propagated.
 */
import { db } from "@/db";
import { pageCopy } from "@/db/schema";
import { pruneOverrides } from "@/lib/copy";

/**
 * Every override row as a plain map, with unknown keys pruned.
 *
 * NOT cached: this is one small indexed table read per request, and skipping the
 * cache is what makes Save publish INSTANTLY (the whole point of the feature —
 * no rebuild, no revalidate window). If page loads ever get heavy enough to care,
 * cache here and bust it in the POST handler, not the other way round.
 */
export async function loadCopyOverrides(): Promise<Record<string, string>> {
  try {
    const rows = await db.select().from(pageCopy);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return pruneOverrides(map);
  } catch {
    // An unreachable DB must not blank the UI — fall back to shipped copy.
    return {};
  }
}
