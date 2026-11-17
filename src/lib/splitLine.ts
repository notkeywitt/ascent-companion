/**
 * Split ONE bill line into two whose dollars always add up to the original.
 * Works in whole cents so the halves cannot drift by a rounding cent.
 * `firstCents` is the first line's share. The second is the rest.
 * Null when either share would be zero or negative.
 */
export function splitCents(
  totalCents: number,
  firstCents: number,
): { first: number; second: number } | null {
  if (!Number.isInteger(totalCents) || !Number.isInteger(firstCents)) return null;
  if (firstCents <= 0 || firstCents >= totalCents) return null;
  return { first: firstCents, second: totalCents - firstCents };
}

/** Dollars typed in a box → whole cents. NaN when the text is not a number. */
export function toCents(text: string): number {
  const n = Number(text);
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
}
