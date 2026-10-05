/**
 * JOB DEPOSITS — one balance per job, from what JobTread already holds.
 *
 * `DEPOSITS_PLAN.md` is the why. This file is the rules and nothing else: no
 * fetch, no database, no React, so `deposits.test.ts` can pin every rule to the
 * real jobs it was written from.
 *
 * A deposit shows up in JobTread in three places:
 *   1. CD ("Contract Deposit") lines on customer invoices. A positive line is
 *      a deposit BILLED — a deposit invoice (Thomas #22). A negative line is a
 *      DRAW against the deposit (Berger #320, Ferron #386).
 *   2. Deposit payments: a customer payment described "deposit" or "retainer",
 *      or one the office assigned to the job. Applying it to an invoice is a
 *      draw (Velorum #16, #38, #42).
 *   3. CD budget leaves: the deposit AGREED. Shown, never counted.
 * Plus one fact JobTread cannot hold: the deposit LEFT when a job moved into
 * JobTread (the opening balance), entered once by the office.
 *
 * A payment belongs to a customer account, not a job. Which job a deposit
 * payment belongs to is decided by `paymentOwner`.
 */

/** The org's Contract Deposit cost code number. */
export const DEPOSIT_CSI = "CD";

/** Description words that mark a customer payment as a deposit. */
const DEPOSIT_WORDS = /deposit|retainer/i;

/** Half a cent: below this, two dollar figures are the same figure. */
const CENT = 0.005;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── inputs ───────────────────────────────────────────────────────────────────

/** The customer invoice a deposit line or payment application sits on. */
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

/** One application of a payment to one invoice (a JobTread documentPayment). */
export interface PaymentApplication {
  id: string;
  amount: number;
  isLinkedToQbo: boolean;
  /** ISO datetime. */
  createdAt: string;
  invoice: DepositInvoice;
}

/** A `credit` payment on the job's customer account. */
export interface CustomerPayment {
  id: string;
  amount: number;
  /** ISO datetime. */
  paidAt: string;
  description: string | null;
  source: string | null;
  qboId: string | null;
  applications: PaymentApplication[];
}

/** How the office wants a deposit drawn down. Only sets the suggested amount. */
export type DrawRule = { kind: "whole" } | { kind: "fixed"; amount: number };

/** The facts JobTread cannot hold, from the companion's `deposit_links` table. */
export interface DepositLinks {
  /** Payments the office assigned to THIS job. */
  paymentIds: string[];
  /** Payments the office assigned to another job. Never counted here. */
  elsewherePaymentIds: string[];
  /** Deposit left when the job moved into JobTread. */
  opening: { amount: number; asOf: string } | null;
  drawRule: DrawRule | null;
}

export const NO_LINKS: DepositLinks = {
  paymentIds: [],
  elsewherePaymentIds: [],
  opening: null,
  drawRule: null,
};

export interface DepositInputs {
  jobId: string;
  /** The job's CD budget leaves (cost items with no document). */
  leaves: { id: string; name: string; price: number }[];
  /** CD lines on the job's customer invoices, every status. */
  lines: DepositLine[];
  /** The account's `credit` payments that could be deposits, with applications. */
  payments: CustomerPayment[];
  /** Open jobs on the same customer account, this one included. */
  accountOpenJobIds: string[];
  links: DepositLinks;
}

// ── which payments are deposits, and whose ──────────────────────────────────

/** Does a payment's description call it a deposit or a retainer? */
export function describesDeposit(description: string | null | undefined): boolean {
  return DEPOSIT_WORDS.test(description ?? "");
}

/** A deposit payment: described as one, or assigned to a job by the office. */
export function isDepositPayment(p: CustomerPayment, links: DepositLinks): boolean {
  if (links.paymentIds.includes(p.id) || links.elsewherePaymentIds.includes(p.id)) return true;
  return describesDeposit(p.description);
}

export type PaymentOwner = "mine" | "other" | "unassigned";

/**
 * Whose deposit this payment is. In order: the office's assignment; else the
 * job of the invoices it paid; else the one open job on the account. Berger's
 * account holds two open jobs and its deposit paid nothing yet, so it stays
 * unassigned until the office picks one.
 */
export function paymentOwner(
  p: CustomerPayment,
  jobId: string,
  accountOpenJobIds: string[],
  links: DepositLinks,
): PaymentOwner {
  if (links.paymentIds.includes(p.id)) return "mine";
  if (links.elsewherePaymentIds.includes(p.id)) return "other";
  const jobs = new Set(
    p.applications
      .filter((a) => a.invoice.status !== "denied")
      .map((a) => a.invoice.jobId)
      .filter((j): j is string => !!j),
  );
  if (jobs.size > 0) return jobs.has(jobId) ? "mine" : "other";
  if (accountOpenJobIds.length === 1) return accountOpenJobIds[0] === jobId ? "mine" : "other";
  return "unassigned";
}

// ── the ledger ───────────────────────────────────────────────────────────────

export type EntryKind =
  /** Money the client paid toward the deposit. */
  | "received"
  /** A deposit invoice sent and not yet paid. */
  | "billed"
  /** A deposit invoice still in draft. */
  | "billed-draft"
  /** Deposit applied to an invoice that has gone out. */
  | "drawn"
  /** Deposit applied on a draft invoice. Shown, not counted. */
  | "draft";

export interface DepositEntry {
  key: string;
  kind: EntryKind;
  /** How JobTread holds it: a CD line on an invoice, or a payment. */
  method: "invoice" | "payment";
  /** YYYY-MM-DD. */
  date: string | null;
  /** Always positive; `kind` says which way it moves the balance. */
  amount: number;
  invoiceId?: string;
  invoiceNumber?: number | null;
  invoiceName?: string;
  invoiceStatus?: string;
  paymentId?: string;
  /** Payment applications only: did JobTread link this one to QuickBooks? */
  linkedToQbo?: boolean;
  /** Dated on or before the opening balance, which already covers it. */
  beforeOpening?: boolean;
}

export type DepositFlag =
  | { kind: "taxable-line"; invoiceNumber: number | null }
  | { kind: "unlinked-application"; invoiceNumber: number | null; amount: number }
  | { kind: "double-draw" }
  | { kind: "no-receipt"; drawn: number }
  | { kind: "overdrawn"; by: number }
  | { kind: "unassigned-payment"; paymentId: string; amount: number };

export interface UnassignedDeposit {
  id: string;
  amount: number;
  paidAt: string;
  description: string | null;
}

export interface DepositLedger {
  /** Σ CD budget leaves. */
  agreed: number;
  opening: number | null;
  openingAsOf: string | null;
  received: number;
  billedUnpaid: number;
  drawn: number;
  onDraft: number;
  /** Opening + received − drawn. Null when money was drawn with nothing recorded to draw from. */
  left: number | null;
  entries: DepositEntry[];
  flags: DepositFlag[];
  /** Deposit payments on the account that no rule could give a job. */
  unassigned: UnassignedDeposit[];
  drawRule: DrawRule | null;
  /** False on a job with nothing deposit-shaped — the card hides. */
  hasDeposit: boolean;
}

const dayOf = (iso: string | null | undefined): string | null =>
  iso ? String(iso).slice(0, 10) : null;

function invoiceFields(inv: DepositInvoice) {
  return {
    invoiceId: inv.id,
    invoiceNumber: inv.number,
    invoiceName: inv.name,
    invoiceStatus: inv.status,
  };
}

/** The job's deposit balance and the entries behind it. */
export function buildDepositLedger(input: DepositInputs): DepositLedger {
  const { jobId, links } = input;
  const entries: DepositEntry[] = [];
  const flags: DepositFlag[] = [];

  const lines = input.lines.filter((l) => l.invoice.status !== "denied" && Math.abs(l.price) >= CENT);
  // A deposit invoice is one carrying a positive CD line. A deposit payment
  // that paid one is already counted through that invoice.
  const depositInvoiceIds = new Set(lines.filter((l) => l.price > 0).map((l) => l.invoice.id));

  for (const l of lines) {
    const inv = l.invoice;
    if (l.isTaxable) flags.push({ kind: "taxable-line", invoiceNumber: inv.number });
    if (l.price > 0) {
      if (inv.status === "draft") {
        entries.push({ key: `line:${l.id}`, kind: "billed-draft", method: "invoice", date: inv.issueDate, amount: round2(l.price), ...invoiceFields(inv) });
        continue;
      }
      // A deposit invoice pays down in proportion: the share of its total paid
      // is the share of the deposit line received.
      const share = inv.priceWithTax > CENT ? Math.min(1, Math.max(0, inv.amountPaid / inv.priceWithTax)) : 0;
      const received = round2(l.price * share);
      const unpaid = round2(l.price - received);
      if (received >= CENT) {
        entries.push({ key: `line:${l.id}`, kind: "received", method: "invoice", date: inv.issueDate, amount: received, ...invoiceFields(inv) });
      }
      if (unpaid >= CENT) {
        entries.push({ key: `line:${l.id}:unpaid`, kind: "billed", method: "invoice", date: inv.issueDate, amount: unpaid, ...invoiceFields(inv) });
      }
    } else {
      entries.push({
        key: `line:${l.id}`,
        kind: inv.status === "draft" ? "draft" : "drawn",
        method: "invoice",
        date: inv.issueDate,
        amount: round2(-l.price),
        ...invoiceFields(inv),
      });
    }
  }

  const unassigned: UnassignedDeposit[] = [];
  for (const p of input.payments) {
    if (!isDepositPayment(p, links)) continue;
    const owner = paymentOwner(p, jobId, input.accountOpenJobIds, links);
    if (owner === "other") continue;
    if (owner === "unassigned") {
      unassigned.push({ id: p.id, amount: round2(p.amount), paidAt: p.paidAt, description: p.description });
      flags.push({ kind: "unassigned-payment", paymentId: p.id, amount: round2(p.amount) });
      continue;
    }
    const apps = p.applications.filter((a) => a.invoice.status !== "denied");
    const paidDepositInvoices = apps
      .filter((a) => depositInvoiceIds.has(a.invoice.id))
      .reduce((s, a) => s + a.amount, 0);
    const received = round2(p.amount - paidDepositInvoices);
    if (received >= CENT) {
      entries.push({ key: `payment:${p.id}`, kind: "received", method: "payment", date: dayOf(p.paidAt), amount: received, paymentId: p.id });
    }
    for (const a of apps) {
      if (depositInvoiceIds.has(a.invoice.id)) continue;
      entries.push({
        key: `application:${a.id}`,
        kind: "drawn",
        method: "payment",
        date: a.invoice.issueDate ?? dayOf(a.createdAt),
        amount: round2(a.amount),
        paymentId: p.id,
        linkedToQbo: a.isLinkedToQbo,
        ...invoiceFields(a.invoice),
      });
      if (!a.isLinkedToQbo) {
        flags.push({ kind: "unlinked-application", invoiceNumber: a.invoice.number, amount: round2(a.amount) });
      }
    }
  }

  // The opening balance already covers everything dated on or before it.
  const opening = links.opening;
  if (opening) {
    for (const e of entries) if (e.date && e.date <= opening.asOf) e.beforeOpening = true;
  }

  const sum = (kind: EntryKind) =>
    round2(entries.filter((e) => e.kind === kind && !e.beforeOpening).reduce((s, e) => s + e.amount, 0));
  const received = sum("received");
  const billedUnpaid = sum("billed");
  const drawn = sum("drawn");
  const onDraft = sum("draft");

  const basis = (opening?.amount ?? 0) + received;
  const noBasis = !opening && received < CENT;
  const left = noBasis && drawn >= CENT ? null : round2(basis - drawn);

  const countedDraws = entries.filter((e) => e.kind === "drawn" && !e.beforeOpening);
  if (countedDraws.some((e) => e.method === "invoice") && countedDraws.some((e) => e.method === "payment")) {
    flags.push({ kind: "double-draw" });
  }
  if (noBasis && drawn >= CENT) flags.push({ kind: "no-receipt", drawn });
  else if (drawn > basis + CENT) flags.push({ kind: "overdrawn", by: round2(drawn - basis) });

  entries.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.key.localeCompare(b.key));

  const agreed = round2(input.leaves.reduce((s, l) => s + (Number(l.price) || 0), 0));
  const hasDeposit =
    Math.abs(agreed) >= CENT || entries.length > 0 || unassigned.length > 0 || opening != null;

  return {
    agreed,
    opening: opening ? round2(opening.amount) : null,
    openingAsOf: opening?.asOf ?? null,
    received,
    billedUnpaid,
    drawn,
    onDraft,
    left,
    entries,
    flags,
    unassigned,
    drawRule: links.drawRule,
    hasDeposit,
  };
}
