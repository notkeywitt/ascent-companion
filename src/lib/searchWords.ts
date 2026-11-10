// Word search shared by pickers: pure and client-safe.

/** True when every word typed appears in `hay`, in any order. An empty query matches. */
export function matchesAllWords(hay: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const h = hay.toLowerCase();
  return words.every((w) => h.includes(w));
}
