/**
 * Sales tax Ascent pays a vendor — where it lives and what it means.
 *
 * THE MODEL (2026-09-05 on). Tax on a vendor bill is its own cost item, named
 * "Sales Tax" and coded to 88 80 00. The document's `nonRecoverableTax` field is
 * always 0.
 *
 * WHY NOT THE FIELD. `nonRecoverableTax` spreads its amount across the bill's
 * cost items, so QuickBooks received lines that already carried the tax and no
 * sales-tax figure of its own — the number the WA excise return needs was
 * invisible. QBO US cannot take tax on a purchase either: every tax code on the
 * org's QBO connection has an empty `purchaseTaxRateList` (checked live
 * 2026-09-05). A line coded to its own cost code is the only shape that reaches
 * QuickBooks intact, because a cost code carries a `qboId` that maps it to a
 * QuickBooks item, and so to an account.
 *
 * WHAT WENT WITH IT. The tax-inclusive ↔ pre-tax gross-up is gone. It existed
 * only because JobTread de-taxes a line for display while that field is set;
 * with the field at 0, a line's stored cost IS the face value on the receipt.
 * `billLineMath.ts` still carries the de-tax, for bills pushed before the
 * change — on those it is a real factor, on everything else it is 1.
 *
 * KEEP IN SYNC with CONFIG.JOBTREAD.SALES_TAX_* in ascent-appscript/Config.js
 * and the 6B block in ascent-appscript/JobTread.js. The two repos cannot share a
 * runtime, so this is the Companion's copy of the same three constants.
 */

/** The cost code every sales-tax line is coded to (JT cost code 22PdxG48WsyV). */
export const SALES_TAX_CSI = "88 80 00";

/** The cost item's name — what shows on the bill, and in QuickBooks. */
export const SALES_TAX_LINE_NAME = "Sales Tax";

/**
 * The synthetic tax line this replaced. Matched on READ so a bill pushed before
 * 2026-09-05 is still recognised; nothing writes it.
 */
export const SALES_TAX_LEGACY_LINE_NAME = "Sales Tax (paid)";

/** A job whose Phase reads this is Ascent's own overhead, not client work. */
export const OVERHEAD_JOB_PHASE = "Ascent";

/**
 * The shape any caller's line has to expose to be classified. Two line types
 * reach here — `BillLine` nests its cost code, `JobBillLine` flattens it to
 * `code` — so both spellings are read.
 */
export interface TaxLineLike {
  name?: string | null;
  description?: string | null;
  costCode?: { number?: string | null } | null;
  code?: string | null;
}

/**
 * Is this cost item the bill's sales-tax line?
 *
 * The CSI is checked first: what a line is CODED to survives a rename. Names are
 * the fallback, for a line that landed uncoded because the job budget had no
 * 88 80 00 leaf, and for the legacy name.
 */
export function isSalesTaxLine(line: TaxLineLike | null | undefined): boolean {
  if (!line) return false;
  const code = (line.costCode?.number ?? line.code ?? "").trim();
  if (code) return code === SALES_TAX_CSI;
  if ((line.description ?? "").trim() === SALES_TAX_CSI) return true;
  const name = (line.name ?? "").trim();
  return name === SALES_TAX_LINE_NAME || name === SALES_TAX_LEGACY_LINE_NAME;
}

/**
 * Split a bill's cost items into the lines the office codes and the sales tax.
 *
 * `legacyField` is the document's `nonRecoverableTax`. It is ADDED, not
 * preferred: a bill halfway through the migration would otherwise under-report
 * its tax, and summing cannot lose money either way. In practice exactly one of
 * the two is non-zero.
 */
export function splitSalesTax<T extends TaxLineLike & { cost?: number | null }>(
  lines: readonly T[],
  legacyField = 0,
): { lines: T[]; taxAmount: number; taxLine: T | null } {
  let taxAmount = Number(legacyField) || 0;
  let taxLine: T | null = null;
  const rest: T[] = [];
  for (const l of lines) {
    if (isSalesTaxLine(l)) {
      taxAmount += Number(l.cost) || 0;
      taxLine ??= l;
      continue;
    }
    rest.push(l);
  }
  return { lines: rest, taxAmount: Math.round(taxAmount * 100) / 100, taxLine };
}

/**
 * Is sales tax paid on this job's purchases recoverable?
 *
 * THE FLAG — derived from the job every time, never stored, so moving a bill
 * between jobs re-classifies its tax with no field to update.
 *
 * Washington gives the tax back through the "taxable amount for tax paid at
 * source" deduction, but only on goods RESOLD to a customer. A job whose Phase
 * is `Ascent` (Office, Shop, Electrical) is overhead: those goods are consumed,
 * so the tax stays a cost. Every other job is client work.
 *
 * An unknown phase reads as recoverable — client work is the common case, and a
 * report that flags what it could not classify beats one that drops it.
 */
export function isTaxRecoverable(jobPhase: string | null | undefined): boolean {
  return (jobPhase ?? "").trim().toLowerCase() !== OVERHEAD_JOB_PHASE.toLowerCase();
}

/** How a taxed bill's classification reads on screen. */
export function taxRecoverabilityLabel(jobPhase: string | null | undefined): string {
  return isTaxRecoverable(jobPhase) ? "Recoverable" : "Not recoverable";
}
