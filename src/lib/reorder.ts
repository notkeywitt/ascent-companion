/**
 * Move `id` one step (`by` = -1 up, +1 down) among the items in `visible`,
 * skipping items that are hidden from this person. The full list keeps every id.
 */
export function moveAmong<T>(list: T[], visible: T[], id: T, by: -1 | 1): T[] {
  const shown = list.filter((x) => visible.includes(x));
  const i = shown.indexOf(id);
  const neighbour = shown[i + by];
  if (i < 0 || neighbour === undefined) return list;
  const out = [...list];
  const a = out.indexOf(id);
  const b = out.indexOf(neighbour);
  [out[a], out[b]] = [out[b], out[a]];
  return out;
}

/** A saved order → one that names every id once: unknown ids drop, new ones join at the end. */
export function completeOrder<T>(saved: unknown, all: readonly T[]): T[] {
  const out = Array.isArray(saved) ? [...new Set(saved.filter((x): x is T => all.includes(x as T)))] : [];
  for (const id of all) if (!out.includes(id)) out.push(id);
  return out;
}
