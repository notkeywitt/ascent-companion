// A one-bit signal that a bill was WRITTEN through the assistant, shared across
// pages for as long as the app stays loaded (module scope — a reload clears it).
//
// List pages that cache what they showed (see /payments) need to know whether
// their snapshot could still be true. Re-fetching on every return is what made
// the Sunset Statements page slow; never re-fetching would leave a card wrong
// after you fixed its bill. So the bill page records each write here, and a list
// page refreshes only when there is something to refresh.
//
// Deliberately coarse: doc ids, no payloads. It says "something changed", not
// "here is the new number" — the refresh it triggers is what establishes truth.

const touched = new Set<string>();

/** Record that this bill was written (coding saved, line added/deleted, …). */
export function markBillTouched(docId: string) {
  if (docId) touched.add(docId);
}

/** How many bills have been written since the last consumer cleared the set. */
export function touchedBillCount(): number {
  return touched.size;
}

/** The doc ids written since the last clear. */
export function touchedBills(): string[] {
  return Array.from(touched);
}

/** Called by whoever has just re-read the data those writes affected. */
export function clearTouchedBills() {
  touched.clear();
}
