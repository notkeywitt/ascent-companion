/**
 * THE QUICKBOOKS LOCK — a bill or invoice that already exists in QuickBooks is
 * frozen. No role may edit it, and no role may delete it. Owner's rule,
 * 2026-09-09.
 *
 * ## What "already in QuickBooks" means
 *
 * `document.qboId` is the QBO mirror id — JobTread fills it in when the document
 * pushes, and it stays filled forever. Probed against the live org on
 * 2026-09-09: every `draft` vendor bill reads `qboId: null`, and every `pending`
 * or `approved` one carries an id (the push happens on approve-for-payment). So
 * `qboId != null` IS the question "does this exist in QuickBooks", answered by
 * JobTread itself rather than inferred from a status.
 *
 * A status test would have been the wrong test. `pending` and `approved` are
 * JobTread's own workflow, and a document can sit in either without a push —
 * the `qboIsIgnored` toggle (Push-to-QB = !qboIsIgnored) exists precisely so a
 * bill can be finalized and deliberately kept out of QuickBooks. Such a bill is
 * still editable here, and it should be: nothing downstream has seen it.
 *
 * ## Why this is a server guard and not a disabled button
 *
 * It used to be a disabled button. `linesEditable` in the bill page greys out
 * quantity/unitCost/description once a bill leaves draft, and that was the whole
 * defence — every write route accepted any docId and wrote. So the lock held
 * only for as long as a person used the UI as drawn.
 *
 * ## Fail CLOSED
 *
 * If the QBO id cannot be read, the write is refused. A JobTread hiccup then
 * blocks bill editing until it passes, which is the cheap failure; the expensive
 * one is editing a bill the accountant has already reconciled. Retry, don't
 * loosen this.
 */
import { NextResponse } from "next/server";

import { pave, type PaveConfig } from "@/lib/jobtread";

/** Name the document either directly, or by any ONE of its lines. */
export interface BillRef {
  docId?: string;
  /** A cost item on the bill — used by the line routes, which carry no docId. */
  costItemId?: string;
}

export interface QboState {
  /** The QuickBooks mirror id, or "" when the document has never pushed. */
  qboId: string;
  /** True when the id could not be read at all — callers must refuse. */
  unknown: boolean;
}

/** Read a document's QuickBooks mirror id, by docId or by one of its lines. */
export async function readQboState(cfg: PaveConfig, ref: BillRef): Promise<QboState> {
  const docId = (ref.docId ?? "").trim();
  const costItemId = (ref.costItemId ?? "").trim();
  if (!docId && !costItemId) return { qboId: "", unknown: true };
  const query = docId
    ? { document: { $: { id: docId }, id: {}, qboId: {} } }
    : { costItem: { $: { id: costItemId }, document: { id: {}, qboId: {} } } };
  try {
    const r: any = await pave(cfg, query);
    const doc = docId ? r?.document : r?.costItem?.document;
    // A document that does not resolve is not a document we may write to.
    if (!doc?.id) return { qboId: "", unknown: true };
    return { qboId: String(doc.qboId ?? ""), unknown: false };
  } catch {
    return { qboId: "", unknown: true };
  }
}

/**
 * The one line every bill/invoice write route runs before it writes:
 *
 *   const lock = await qboLock(cfg, { docId });
 *   if (lock) return lock;
 *
 * Returns a 409 when the document is already in QuickBooks, a 502 when its
 * state could not be read, and `null` when the write may proceed.
 */
export async function qboLock(cfg: PaveConfig, ref: BillRef): Promise<NextResponse | null> {
  const { qboId, unknown } = await readQboState(cfg, ref);
  if (unknown) {
    return NextResponse.json(
      {
        error:
          "Could not check whether this document is in QuickBooks, so the change was not made. Try again.",
        qboLocked: true,
      },
      { status: 502 },
    );
  }
  if (!qboId) return null;
  return NextResponse.json(
    {
      error:
        "This document is already in QuickBooks and can no longer be changed here. Flag it as Needs review so the office can correct it in QuickBooks.",
      qboLocked: true,
      qboId,
    },
    { status: 409 },
  );
}
