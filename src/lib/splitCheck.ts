/**
 * Do a split bill's pieces still add up to the original? (App Feedback #6)
 *
 * Every "Split bill" records a row in `bill_splits` (/api/split-bill). A bill
 * split twice, or a piece split again, gives a family: the root bill plus every
 * bill split off it. The root's FIRST split holds the true original total and
 * line count. This only reports — editing a piece later is allowed and nothing
 * here blocks or rebalances it.
 */

export interface SplitLink {
  newDocId: string;
  originalDocId: string;
  originalTotal: number;
  originalLineCount: number;
  createdAt: string;
}

export interface SplitFamily {
  rootId: string;
  /** The root first, then every bill split off it, oldest first. */
  pieceIds: string[];
  originalTotal: number;
  originalLineCount: number;
}

/** The family `docId` belongs to, or null when it was never part of a split. */
export function splitFamily(links: SplitLink[], docId: string): SplitFamily | null {
  const sorted = [...links].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const parentOf = new Map(sorted.map((l) => [l.newDocId, l.originalDocId]));
  let rootId = docId;
  const seen = new Set<string>();
  while (parentOf.has(rootId) && !seen.has(rootId)) {
    seen.add(rootId);
    rootId = parentOf.get(rootId)!;
  }
  const first = sorted.find((l) => l.originalDocId === rootId);
  if (!first) return null;
  const pieceIds = [rootId];
  for (const l of sorted) {
    if (pieceIds.includes(l.originalDocId) && !pieceIds.includes(l.newDocId)) pieceIds.push(l.newDocId);
  }
  return { rootId, pieceIds, originalTotal: first.originalTotal, originalLineCount: first.originalLineCount };
}

export interface SplitCheck {
  total: number;
  lineCount: number;
  /** Pieces' total minus the original's, to the cent. 0 = matches. */
  totalDiff: number;
  lineDiff: number;
  matches: boolean;
}

/** Compare the pieces' current totals and line counts with the original. */
export function checkSplit(
  family: Pick<SplitFamily, "originalTotal" | "originalLineCount">,
  pieces: { total: number; lineCount: number }[],
): SplitCheck {
  const cents = (n: number) => Math.round(n * 100);
  const total = pieces.reduce((s, p) => s + cents(p.total), 0) / 100;
  const lineCount = pieces.reduce((s, p) => s + p.lineCount, 0);
  const totalDiff = (cents(total) - cents(family.originalTotal)) / 100;
  const lineDiff = lineCount - family.originalLineCount;
  return { total, lineCount, totalDiff, lineDiff, matches: totalDiff === 0 && lineDiff === 0 };
}
