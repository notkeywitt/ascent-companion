// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

// ---------------------------------------------------------------------------
// UNBILLED EXPENSES  — per bill / time entry, by its invoice link. The /unbilled
// page, the chat tool and the digest check all read getUninvoicedBills.
// ---------------------------------------------------------------------------

/**
 * Is this vendor bill / time entry already invoiced to the client?
 *
 * A DRAFT customer invoice DOES NOT COUNT. A draft has not gone out, so the
 * work on it still needs invoicing — the money stays live in every
 * "to be invoiced" total until the invoice leaves draft (pending, approved,
 * paid). Staging a draft used to drop a job's monthly total straight to $0,
 * which read as "nothing left to bill" at exactly the moment there was.
 *
 * Every other status counts, `denied` included — a denied invoice is a
 * reconciliation question (see `getInvoiceReconciliation`, which follows the
 * denial/re-issue chain), not a reason to re-bill the same cost here.
 *
 * REQUIRES `status` in the `referencedDocuments` node selection. Without it
 * `n.status` is undefined, undefined !== "draft" is true, and the draft silently
 * counts as invoiced again — the exact bug this fixes. Confirmed 2026-09-03 that
 * `referencedDocuments { nodes { status } }` reads fine wherever `type` does.
 */
export function _isInvoicedToClient(node: any): boolean {
  return (node?.referencedDocuments?.nodes ?? []).some(
    (n: any) => n?.type === "customerInvoice" && n?.status !== "draft",
  );
}

/**
 * Is this bill/time entry ON a customer invoice AT ALL — draft included?
 *
 * The wider twin of `_isInvoicedToClient`, and a different question: that one
 * asks whether the client has been billed (a draft has not gone out, so it
 * says no), this one asks whether the document has been PICKED UP by an
 * invoice yet. Only `denied` is excluded, because a denied invoice is a void
 * (see the void rule in the Apps Script repo) and everything here already
 * treats it as though it never existed.
 *
 * Used for the bill row's invoicing-lifecycle stripe: a bill on no invoice at
 * all, in a month where an invoice exists, is the one that got left off.
 *
 * KNOWN BLIND SPOT, shared with `_isInvoicedToClient`: JobTread's re-issue
 * pattern leaves a bill pointing at the DENIED original while the live
 * re-issue references that original rather than the bill, so a re-issued
 * month reads as "on no invoice" here. `getInvoiceReconciliation` is the one
 * place that walks the replacement chain; it costs three paged queries, which
 * a list of rows cannot pay per bill.
 */
export function _isOnAnyInvoice(node: any): boolean {
  return (node?.referencedDocuments?.nodes ?? []).some(
    (n: any) => n?.type === "customerInvoice" && n?.status !== "denied",
  );
}
