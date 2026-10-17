/**
 * PTO and Sick Time go to the bottom of a job's Work list on the time clock.
 * They sit on the Office job beside the codes people clock into every day, and
 * a leave line is the wrong pick for a shift.
 */

/** True for a PTO or Sick Time line: its id is a configured leave line, or its
 *  name says PTO or Sick. */
export function isLeaveLine(
  item: { id: string; name?: string; detail?: string | null },
  leaveIds: readonly string[],
): boolean {
  if (leaveIds.includes(item.id)) return true;
  return /\b(pto|sick)\b/i.test(`${item.name ?? ""} ${item.detail ?? ""}`);
}

/** The list with every leave line moved to the end. The order inside each
 *  group stays as it was. */
export function leaveLast<T extends { id: string; name?: string; detail?: string | null }>(
  items: readonly T[],
  leaveIds: readonly string[],
): T[] {
  const work = items.filter((i) => !isLeaveLine(i, leaveIds));
  const leave = items.filter((i) => isLeaveLine(i, leaveIds));
  return [...work, ...leave];
}
