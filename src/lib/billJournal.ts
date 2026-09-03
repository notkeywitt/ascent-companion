/**
 * The FINANCIAL JOURNAL wrapper for a bill HEADER write — the six routes that
 * change one field on one vendor bill (tax, issue date, vendor bill number,
 * status, the Bill/Expense + QuickBooks flags).
 *
 * All six had the same shape before this existed: validate, write, return. The
 * journal adds the same four steps to each — read the prior value, write, record
 * the change, record the failure if it throws — and copying that block six times
 * is how five of them end up subtly different. This is the one copy.
 *
 * WHAT IT GUARANTEES
 * - The actor is resolved from the session BEFORE the write, so a write that
 *   throws is still attributed.
 * - The prior value is read live (one small document read, not `getBillDetail`),
 *   so `beforeSource` is "read" rather than a browser's claim. A failed read is
 *   recorded as "none" and never blocks the write.
 * - A rejected write writes an `outcome: "error"` row and then rethrows
 *   unchanged, so each route's own error response is untouched.
 */
import { getBillJournalSnapshot, type PaveConfig } from "@/lib/jobtread";
import { openJournal, type JournalEventInput } from "@/lib/financialJournal";

type BillSnapshot = NonNullable<Awaited<ReturnType<typeof getBillJournalSnapshot>>>;

/** The header fields a journalled write can name as its `before`. */
export type BillSnapshotField = Exclude<keyof BillSnapshot, "jobId">;

/**
 * Run one bill-header write, journalled.
 *
 * `field` is the JobTread field name as it goes in the journal row. `priorField`
 * is where to read the prior value from the snapshot — usually the same name,
 * but not always (the Bill/Expense toggle writes `name` and `qboDocumentType`).
 */
export async function journalBillWrite<T>(args: {
  route: string;
  /** Dotted verb for the journal — "bill.status.set". */
  action: string;
  cfg: PaveConfig;
  docId: string;
  field: string;
  priorField: BillSnapshotField;
  /** The value being written — recorded as `after` if the write throws. */
  attempted: unknown;
  /** Dollars at stake, when the field is a figure. */
  amount?: number | null;
  run: () => Promise<T>;
  /** The saved value, read back off the write's own result. */
  after: (result: T) => unknown;
}): Promise<T> {
  const j = await openJournal(args.route);
  const prior = await getBillJournalSnapshot(args.cfg, args.docId);
  const base: Omit<JournalEventInput, "after" | "outcome" | "error"> = {
    action: args.action,
    entity: "bill",
    entityId: args.docId,
    docId: args.docId,
    jobId: prior?.jobId ?? "",
    field: args.field,
    before: prior?.[args.priorField],
    beforeSource: prior ? "read" : "none",
    amount: args.amount ?? null,
  };
  try {
    const result = await args.run();
    await j.record([{ ...base, after: args.after(result) }]);
    return result;
  } catch (e) {
    await j.record([
      {
        ...base,
        after: args.attempted,
        outcome: "error",
        error: e instanceof Error ? e.message : "Unknown error",
      },
    ]);
    throw e;
  }
}
