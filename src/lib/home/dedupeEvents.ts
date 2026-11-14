/** Drops an event that shows on several calendars. Key: iCalUID, else id, else title + start + end. */
export function dedupeEvents<
  T extends { iCalUID?: string; id?: string; title?: string; start?: string; end?: string; startLabel?: string; endLabel?: string },
>(events: T[]): T[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = e.iCalUID
      ? `u:${e.iCalUID}`
      : e.id
        ? `i:${e.id}`
        : `t:${(e.title ?? "").trim().toLowerCase()}|${e.start ?? e.startLabel ?? ""}|${e.end ?? e.endLabel ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
