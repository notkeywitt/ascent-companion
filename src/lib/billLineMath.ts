/**
 * The money math behind editing a vendor bill's lines — shared by the bill page
 * and Tracking Sheets so the two can never disagree about what a save writes.
 *
 * THE MODEL (confirmed live 2026-07-30 by capturing JobTread's own save — stored
 * $59.54 displayed as $54.95; see the tax-nonrecoverable-intended memory, which
 * also records two WRONG models that were tried first):
 *
 *  - JobTread stores each line's cost TAX-INCLUSIVE.
 *  - A bill's total is ALWAYS the sum of its line costs. Nothing adds tax on top.
 *  - The fixed sales tax (`nonRecoverableTax`, a dollar amount) is carved OUT of
 *    that total to give the subtotal.
 *
 * So we mirror JobTread: read each line DE-TAXED (what JobTread shows), let the
 * office edit in pre-tax terms, and on save gross EVERY line back up. Every line
 * must move together — editing one line, or the tax, shifts the shared
 * subtotal/total factor, so re-sending only the touched lines would make the
 * untouched ones appear to drift.
 *
 * JobTread also LOCKS name/description/quantity/unitCost once a bill leaves
 * draft (pending = payable, approved = paid); writing them errors. Re-coding
 * (`jobCostItemId`) is allowed in any status. That's why almost everything here
 * is gated on `isDraft`.
 */

export interface MathLine {
  id: string;
  name?: string;
  quantity?: number;
  unitCost?: number;
  cost?: number;
  /** The budget leaf this line codes to. */
  jobCostItemId?: string | null;
}

/** In-flight text edits, keyed by line id. Strings because they come from inputs. */
export interface LineEdit {
  name?: string;
  quantity?: string;
  unitCost?: string;
}

/** A budget leaf, as the cost-code picker knows it. */
export interface CodeOption {
  id: string;
  number: string;
  name: string;
  detail?: string; // this leaf's own name, distinguishing splits under one code
  costType?: string; // Labor / Materials / … — a fallback disambiguator
}

/** One re-coding, in the human-readable terms the activity log stores. */
export interface RecodeEntry {
  line: string; // the bill line's name
  from: string; // prior cost-code label ("Uncoded" if it had none)
  to: string; // new cost-code label
}

/** One line's payload for /api/code. */
export interface LineChange {
  costItemId: string;
  name?: string;
  jobCostItemId?: string;
  quantity?: number;
  unitCost?: number;
  description?: string;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** A line's description mirrors its cost code: "06 10 00 - Rough Carpentry". */
export function descriptionForCode(
  codeId: string,
  budget: readonly CodeOption[],
): string | undefined {
  const o = budget.find((b) => b.id === codeId);
  if (!o) return undefined;
  return o.name ? `${o.number} - ${o.name}` : o.number;
}

/**
 * A cost-code label for the activity log — "06 10 00 - Rough Carpentry", with the
 * leaf's own detail appended ("… · Labor") when a code is split into several
 * budget rows, so a move between two splits of one code doesn't read as a no-op.
 */
function codeLabel(codeId: string, budget: readonly CodeOption[]): string {
  if (!codeId) return "Uncoded";
  const o = budget.find((b) => b.id === codeId);
  if (!o) return "(unknown code)";
  const base = o.name ? `${o.number} - ${o.name}` : o.number;
  const extra = o.detail && o.detail !== o.name ? o.detail : o.costType;
  return extra ? `${base} · ${extra}` : base;
}

/**
 * The subset of `picked` that actually RE-CODES a line (its budget leaf changed),
 * resolved to readable labels — the audit detail /api/code logs. Cost-code only;
 * quantity / unit-cost / name edits are deliberately ignored.
 */
export function recodeLog(
  lines: readonly MathLine[],
  picked: Record<string, string | undefined>,
  budget: readonly CodeOption[],
): RecodeEntry[] {
  const out: RecodeEntry[] = [];
  for (const line of lines) {
    const sel = picked[line.id];
    const cur = line.jobCostItemId ?? "";
    if (sel === undefined || sel === cur) continue; // untouched or unchanged
    out.push({
      line: line.name || "(unnamed line)",
      from: codeLabel(cur, budget),
      to: codeLabel(sel, budget),
    });
  }
  return out;
}

export interface BillMathInput {
  lines: readonly MathLine[];
  /** The bill's stored nonRecoverableTax. */
  storedTax: number;
  /** Tax being previewed while the office edits it; defaults to storedTax. */
  taxView?: number;
  /** JobTread document status — draft unlocks the editable fields. */
  status: string | undefined;
  edits: Record<string, LineEdit | undefined>;
  /** costItemId → chosen budget-leaf id. */
  picked: Record<string, string | undefined>;
  budget: readonly CodeOption[];
}

export interface BillMath {
  isDraft: boolean;
  /** Stored (tax-inclusive) → displayed (pre-tax). */
  deTax: (stored: number) => number;
  /** Per line: the target quantity and PRE-TAX unit cost. */
  targets: { line: MathLine; qty: number; preTaxUnit: number; curPreTaxUnit: number }[];
  subtotal: number;
  total: number;
  /** Pre-tax → stored gross-up factor for the bill's edited state. */
  reTax: number;
  /**
   * How many LINES differ from what JobTread holds — the "N unsaved changes"
   * count. A line counts once no matter how many of its fields moved.
   */
  pendingCount: number;
  /** True if anything differs from what JobTread currently holds. */
  dirty: boolean;
  /**
   * EVERY line's currently-editable fields, re-grossed against the current tax.
   * This is the whole-bill payload a save sends — see the note above on why it's
   * all lines and not just the touched ones. On a tax-free, unedited bill this is
   * simply the lines' current values, so it's idempotent; /api/code drops any
   * line with nothing to write.
   */
  wholeBillChanges: LineChange[];
}

export function billLineMath({
  lines,
  storedTax,
  taxView,
  status,
  edits,
  picked,
  budget,
}: BillMathInput): BillMath {
  const isDraft = status === "draft";
  const storedTotal = lines.reduce((s, l) => s + (l.cost ?? 0), 0);
  // Per-line de-tax uses the STORED tax, not an in-progress tax edit, so typing a
  // new tax never makes the line amounts drift — only the total moves.
  const deTax = (stored: number) =>
    storedTotal > 0 ? stored * ((storedTotal - storedTax) / storedTotal) : stored;
  const tax = taxView ?? storedTax;

  const targets = lines.map((line) => {
    const curPreTaxUnit = deTax(line.unitCost ?? 0);
    const qStr = edits[line.id]?.quantity;
    const uStr = edits[line.id]?.unitCost;
    const qty = isDraft && qStr !== undefined && qStr !== "" ? Number(qStr) : (line.quantity ?? 0);
    const preTaxUnit =
      isDraft && uStr !== undefined && uStr !== "" ? Number(uStr) : curPreTaxUnit;
    return { line, qty, preTaxUnit, curPreTaxUnit };
  });

  const sumPreTax = targets.reduce((s, t) => s + t.preTaxUnit * t.qty, 0);
  const reTax = sumPreTax > 0 ? (sumPreTax + tax) / sumPreTax : 1;

  let pendingCount = 0;
  const wholeBillChanges = targets.map(({ line, qty, preTaxUnit, curPreTaxUnit }) => {
    const change: LineChange = { costItemId: line.id };
    const effCode = picked[line.id] ?? line.jobCostItemId ?? "";
    // Re-coding works in any status; send the effective code for every coded
    // line, but never write an empty code onto an untouched uncoded line.
    if (effCode || picked[line.id] !== undefined) change.jobCostItemId = effCode;
    if (isDraft) {
      change.name = edits[line.id]?.name ?? (line.name ?? "");
      change.quantity = qty;
      change.unitCost = round2(preTaxUnit * reTax); // pre-tax → stored
      const d = descriptionForCode(effCode, budget);
      if (d !== undefined) change.description = d;
    }

    // Does THIS line differ from JobTread? One line counts once.
    const sel = picked[line.id];
    let changed = sel !== undefined && sel !== (line.jobCostItemId ?? "");
    if (isDraft) {
      const nameStr = edits[line.id]?.name;
      if (nameStr !== undefined && nameStr !== (line.name ?? "")) changed = true;
      const qtyChanged = qty !== (line.quantity ?? 0);
      const unitChanged = Math.abs(preTaxUnit - curPreTaxUnit) > 0.005;
      if (qtyChanged || unitChanged) changed = true;
    }
    if (changed) pendingCount++;
    return change;
  });

  return {
    isDraft,
    deTax,
    targets,
    subtotal: round2(sumPreTax),
    total: round2(sumPreTax + tax),
    reTax,
    pendingCount,
    dirty: pendingCount > 0,
    wholeBillChanges,
  };
}
