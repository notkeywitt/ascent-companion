/**
 * Combining bill lines — the request, built once, APPLIED AT SAVE.
 *
 * Two lines of one bill that share a cost code are often one thing the vendor
 * split in two. Combining them keeps the first line, deletes the rest, and
 * writes back the summed cost under a joined description.
 *
 * IT USED TO WRITE THE MOMENT YOU PRESSED THE BUTTON, on all three surfaces,
 * from three near-identical copies of the same fetch. That made it the only
 * edit in the card that could not be undone with Revert: a recode, a
 * description, a quantity and the sales tax all stage and wait for Save, and
 * this one went straight to JobTread. Now it stages like the others, and the
 * host applies it at Save — BEFORE the line writes, because it deletes the very
 * lines those writes would target.
 *
 * `buildCombine` is pure, so the three hosts agree on what a merge means; only
 * where the result is held differs.
 */

export interface CombineRequest {
  docId: string;
  keepId: string;
  deleteIds: string[];
  name: string;
  extendedCost: number;
  jobCostItemId?: string;
  description?: string;
}

/** The minimum a line has to expose to take part in a merge. */
export interface CombinableLine {
  id: string;
  name?: string;
  cost?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The merge these lines describe, or null when they cannot merge — fewer than
 * two, or not all on one budget leaf. The caller supplies `leafOf` so each host
 * keeps its own idea of the CURRENT leaf (staged recodes included).
 *
 * The kept line is the first in the list. Costs are summed as STORED, so the
 * bill total does not move.
 */
export function buildCombine<T extends CombinableLine>(
  docId: string,
  selected: T[],
  leafOf: (l: T) => string,
  descriptionFor: (leafId: string) => string | undefined,
): CombineRequest | null {
  if (selected.length < 2) return null;
  const jobCostItemId = leafOf(selected[0]);
  if (!jobCostItemId || !selected.every((l) => leafOf(l) === jobCostItemId)) return null;
  const [keep, ...rest] = selected;
  return {
    docId,
    keepId: keep.id,
    deleteIds: rest.map((l) => l.id),
    name:
      selected
        .map((l) => (l.name || "").trim())
        .filter(Boolean)
        .join(" + ")
        .substring(0, 250) || "Line item",
    extendedCost: round2(selected.reduce((s, l) => s + (l.cost ?? 0), 0)),
    jobCostItemId,
    description: descriptionFor(jobCostItemId),
  };
}

/** Every line id the merge touches — the kept one and the ones it absorbs. */
export function combineTouches(req: CombineRequest): string[] {
  return [req.keepId, ...req.deleteIds];
}

/**
 * Send the merge. Returns an error string, or "" on success. `previewed` is a
 * successful no-op: the deploy has writes off, and nothing reached JobTread.
 */
export async function postCombine(req: CombineRequest): Promise<string> {
  try {
    const res = await fetch("/api/combine-lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    const json = await res.json();
    if (!res.ok) return json.error ?? "Combine failed";
    if (json.previewed) return "Preview only — writes are OFF. Nothing was combined in JobTread.";
    return "";
  } catch (e) {
    return e instanceof Error ? e.message : "Network error";
  }
}
