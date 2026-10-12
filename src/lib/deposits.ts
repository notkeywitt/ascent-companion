/**
 * JOB DEPOSITS — one balance per job. The rules and nothing else: no fetch, no
 * database, no React, so `deposits.test.ts` can pin every rule.
 *
 * The office's model (2026-10-11):
 *
 *   Deposit            what the client paid up front. Either
 *                        - read from JobTread: the paid part of the job's
 *                          deposit invoices (a positive CD line — Gormley
 *                          Studio #8), linked to the payments that paid them; or
 *                        - entered by hand, for a deposit taken before JobTread
 *                          (Berger, $128,842). Linked to nothing.
 *                      A hand-entered deposit replaces the JobTread figure.
 *   Previously applied entered by hand: what was drawn before JobTread
 *                      ($92,000 for Berger). Not in JobTread, so not read.
 *   Draws              negative CD ("Contract Deposit") lines on the job's
 *                      client invoices. A draft's draw is shown, not counted.
 *   Left               Deposit − Previously applied − Draws.
 *
 * A deposit drawn by applying a payment to an invoice (JobTread's own method)
 * is not read. Enter such a deposit by hand, with what it already paid as
 * Previously applied.
 */

/** The org's Contract Deposit cost code number. */
export const DEPOSIT_CSI = "CD";

/** Half a cent: below this, two dollar figures are the same figure. */
const CENT = 0.005;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── inputs ───────────────────────────────────────────────────────────────────

/** The customer invoice a deposit line sits on. */
export interface DepositInvoice {
  id: string;
  number: number | null;
  name: string;
  /** draft | pending | approved | denied. `denied` is the void. */
  status: string;
  /** YYYY-MM-DD. */
  issueDate: string | null;
  priceWithTax: number;
  amountPaid: number;
  jobId: string | null;
}

/** A CD-coded line on a customer invoice. */
export interface DepositLine {
  id: string;
  price: number;
  isTaxable: boolean;
  invoice: DepositInvoice;
}

/** The deposit the office entered by hand, from the companion's `deposit_links` row. */
export interface EnteredDeposit {
  amount: number;
  previouslyApplied: number;
}

export interface DepositInputs {
  /** CD lines on the job's customer invoices, every status. */
  lines: DepositLine[];
  entered: EnteredDeposit | null;
}

// ── the ledger ───────────────────────────────────────────────────────────────

export type EntryKind =
  /** A deposit invoice: its paid part is the deposit. */
  | "deposit"
  /** A draw on an invoice that has gone out. */
  | "drawn"
  /** A draw on a draft invoice. Shown, not counted. */
  | "draft";

export interface DepositEntry {
  key: string;
  kind: EntryKind;
  /** YYYY-MM-DD. */
  date: string | null;
  /** Always positive. For a deposit invoice, the part paid. */
  amount: number;
  /** Deposit invoices only: the part billed and not yet paid. */
  unpaid?: number;
  invoiceId: string;
  invoiceNumber: number | null;
  invoiceName: string;
  invoiceStatus: string;
}

export type DepositFlag =
  | { kind: "taxable-line"; invoiceNumber: number | null }
  | { kind: "overdrawn"; by: number };

export interface DepositLedger {
  /** Where the deposit figure comes from. Null: none recorded yet. */
  source: "entered" | "jobtread" | null;
  deposit: number;
  previouslyApplied: number;
  drawn: number;
  onDraft: number;
  /** Deposit − Previously applied − Drawn. Null when no deposit is recorded. */
  left: number | null;
  entries: DepositEntry[];
  flags: DepositFlag[];
  /** False on a job with nothing deposit-shaped — the card hides. */
  hasDeposit: boolean;
}

/** The job's deposit balance and the invoice lines behind it. */
export function buildDepositLedger(input: DepositInputs): DepositLedger {
  const entries: DepositEntry[] = [];
  const flags: DepositFlag[] = [];

  for (const l of input.lines) {
    const inv = l.invoice;
    if (inv.status === "denied" || Math.abs(l.price) < CENT) continue;
    if (l.isTaxable) flags.push({ kind: "taxable-line", invoiceNumber: inv.number });
    const fields = {
      key: `line:${l.id}`,
      date: inv.issueDate,
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      invoiceName: inv.name,
      invoiceStatus: inv.status,
    };
    if (l.price > 0) {
      // A deposit invoice pays down in proportion: the share of its total paid
      // is the share of the deposit line received. A draft has paid nothing.
      const share =
        inv.status !== "draft" && inv.priceWithTax > CENT
          ? Math.min(1, Math.max(0, inv.amountPaid / inv.priceWithTax))
          : 0;
      const paid = round2(l.price * share);
      entries.push({ ...fields, kind: "deposit", amount: paid, unpaid: round2(l.price - paid) });
    } else {
      entries.push({ ...fields, kind: inv.status === "draft" ? "draft" : "drawn", amount: round2(-l.price) });
    }
  }

  const sum = (kind: EntryKind) => round2(entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0));
  const fromJobTread = sum("deposit");
  const hasDepositInvoice = entries.some((e) => e.kind === "deposit");
  const entered = input.entered;
  const source = entered ? "entered" : hasDepositInvoice ? "jobtread" : null;
  const deposit = entered ? round2(entered.amount) : fromJobTread;
  const previouslyApplied = entered ? round2(entered.previouslyApplied) : 0;
  const drawn = sum("drawn");
  const onDraft = sum("draft");
  const left = source ? round2(deposit - previouslyApplied - drawn) : null;
  if (left != null && left < -CENT) flags.push({ kind: "overdrawn", by: round2(-left) });

  entries.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key));

  return {
    source,
    deposit,
    previouslyApplied,
    drawn,
    onDraft,
    left,
    entries,
    flags,
    hasDeposit: source != null || entries.length > 0,
  };
}

// ── drawing the deposit on a draft invoice ───────────────────────────────────

/** The draft invoice a draw is about to land on, as JobTread holds it now. */
export interface DrawInvoice {
  id: string;
  number: number | null;
  status: string;
  /** The invoice total as it stands, after any draw it already carries. */
  priceWithTax: number;
  /** Already pushed to QuickBooks (`qboId` set). */
  inQbo: boolean;
  /** The CD lines on THIS invoice. */
  depositLines: { id: string; price: number }[];
}

export type DrawPlan =
  | {
      ok: true;
      mode: "create" | "update" | "delete" | "noop";
      /** The existing draw line, for update and delete. */
      lineId: string | null;
      /** The draw before and after, as positive dollars. */
      from: number;
      to: number;
      /** The most this invoice could take. */
      max: number;
    }
  | { ok: false; error: string };

/** What the deposit can still give this invoice: Left, less other drafts' draws. */
function availableFor(ledger: DepositLedger, invoiceId: string): number | null {
  if (ledger.left == null) return null;
  const otherDrafts = ledger.entries
    .filter((e) => e.kind === "draft" && e.invoiceId !== invoiceId)
    .reduce((s, e) => s + e.amount, 0);
  return round2(ledger.left - otherDrafts);
}

/** The invoice's total before any draw it carries. */
function totalBeforeDraw(inv: DrawInvoice): number {
  const existing = inv.depositLines.filter((l) => l.price < 0).reduce((s, l) => s - l.price, 0);
  return round2(inv.priceWithTax + existing);
}

/**
 * Decide whether drawing `amount` from the deposit onto this invoice is
 * allowed, and how: add the one deposit line, change it, or remove it (amount
 * 0). Every refusal names the reason in the office's words. The route runs
 * this on a ledger it has JUST read, never on what the browser sent.
 */
export function planDepositDraw(ledger: DepositLedger, inv: DrawInvoice, amount: number): DrawPlan {
  const num = inv.number != null ? `#${inv.number}` : "This invoice";
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: "Enter the amount to draw as dollars." };
  const to = round2(amount);
  if (inv.status !== "draft") {
    return { ok: false, error: `${num} is ${inv.status}, not a draft. Change a sent invoice in JobTread.` };
  }
  if (inv.inQbo) return { ok: false, error: `${num} is already in QuickBooks. Change it in JobTread.` };
  if (inv.depositLines.some((l) => l.price > 0)) {
    return { ok: false, error: `${num} is a deposit invoice. A deposit is drawn on the invoices after it.` };
  }
  const draws = inv.depositLines.filter((l) => l.price < 0);
  if (draws.length > 1) {
    return { ok: false, error: `${num} carries ${draws.length} deposit lines. Leave one in JobTread, then try again.` };
  }
  const line = draws[0] ?? null;
  const from = line ? round2(-line.price) : 0;
  const available = availableFor(ledger, inv.id);
  const invoiceMax = totalBeforeDraw(inv);
  const max = Math.max(0, Math.min(available ?? 0, invoiceMax));
  if (to === from) return { ok: true, mode: "noop", lineId: line?.id ?? null, from, to, max };
  if (to > 0 && available == null) {
    return { ok: false, error: "No deposit is recorded for this job yet. Enter the deposit first." };
  }
  if (to > (available ?? 0) + CENT) {
    return { ok: false, error: `Only ${usd(available ?? 0)} of the deposit is left to draw.` };
  }
  if (to > invoiceMax + CENT) {
    return { ok: false, error: `That is more than ${num}'s total of ${usd(invoiceMax)}.` };
  }
  const mode = !line ? "create" : to === 0 ? "delete" : "update";
  return { ok: true, mode, lineId: line?.id ?? null, from, to, max };
}

/**
 * The amount the card suggests for a draft invoice: the job's last draw (Berger
 * draws $20,000 a month), or the whole invoice when it has none. Never above
 * what is left.
 */
export function suggestDraw(ledger: DepositLedger, inv: DrawInvoice): number {
  const available = availableFor(ledger, inv.id) ?? 0;
  const invoiceMax = totalBeforeDraw(inv);
  const last = ledger.entries.filter((e) => e.kind === "drawn").at(-1);
  const want = last ? last.amount : invoiceMax;
  return round2(Math.max(0, Math.min(want, available, invoiceMax)));
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
