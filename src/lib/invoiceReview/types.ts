/**
 * The monthly client-invoice review's contract — the evidence the reviewer is
 * given, and the findings it produces.
 *
 * Pure types + small pure helpers. No DB, Node, or React imports, so the
 * evidence loader (server), the check functions (pure, unit-tested), the API
 * route, and the page can all import this one file.
 *
 * VOCABULARY. "Invoice" here always means a CLIENT invoice — a JobTread
 * `customerInvoice` document billed to a customer. The things it is checked
 * against are vendor BILLS (`vendorBill`) and the backup PDFs filed for them in
 * the Drive invoicing tree. Getting those two words mixed up is the single
 * easiest way to misread this feature.
 */

/** How serious a finding is. `error` = the invoice is probably wrong as it
 *  stands; `warning` = worth a human look; `info` = context, never a problem. */
export type FindingSeverity = "error" | "warning" | "info";

/**
 * What kind of discrepancy was found. A stable string id per check, because it
 * is half of a finding's identity — a ruling recorded against
 * `backup-unmatched` on a given invoice must still suppress the same finding
 * next month, and renaming one silently un-suppresses everything.
 */
export type FindingKind =
  // ── Invoice vs. backup PDFs ──────────────────────────────────────────────
  /** The job has invoices this month but no billing folder in Drive at all. */
  | "backup-folder-missing"
  /** A vendor bill on the invoice has no backup PDF filed for it. */
  | "backup-missing"
  /** A backup PDF is filed but no bill on the invoice matches its amount. */
  | "backup-unmatched"
  /** Two backup PDFs parse to the same vendor and amount — a probable re-file. */
  | "backup-duplicate"
  // ── Math & totals ────────────────────────────────────────────────────────
  /** A line's quantity × unit price doesn't equal its extended price. */
  | "math-line"
  /** The invoice's lines don't sum to its pre-tax price. */
  | "math-total"
  /** priceWithTax − price doesn't equal the stated tax. */
  | "math-tax"
  /** priceWithTax − amountPaid doesn't equal the stated balance. */
  | "math-balance"
  /** The invoice's cost basis doesn't match the bills it pulled. */
  | "math-cost-basis"
  // ── Billing period & scope ───────────────────────────────────────────────
  /** The invoice's issue date falls outside the billing month being reviewed. */
  | "period-issue-date"
  /** Finalized bills or time for the month are on no live invoice. */
  | "scope-uninvoiced"
  /** Bills for the month are still in draft, so they can't be invoiced yet. */
  | "scope-drafts"
  // ── The office mailbox ───────────────────────────────────────────────────
  /** No invoice in the whole month left a trace in the mailbox — context, not
   *  a fault. Almost certainly means JobTread sends without copying the office. */
  | "email-no-trace"
  /** Other invoices this month were traceable in the mailbox; this one was not. */
  | "email-not-sent"
  /** The last word in the invoice's email thread came from the client. */
  | "email-client-replied"
  /** The same vendor bill is carried by two different live invoices. */
  | "scope-duplicate-bill";

/** One thing the review wants a human to look at. */
export interface Finding {
  /**
   * The finding's stable identity, and the key a ruling suppresses it by.
   * Built by `findingKey` — deliberately NOT including the dollar amount, so a
   * ruling survives the invoice being edited, but including the job and the
   * subject (a bill id, a file name) so it doesn't blanket-suppress a whole
   * class of finding across the org.
   */
  key: string;
  kind: FindingKind;
  severity: FindingSeverity;
  /** One scannable line. A name and a number, not a sentence. */
  title: string;
  /** The full explanation, including the arithmetic that failed. */
  detail: string;
  jobId: string;
  jobName: string;
  customerName: string;
  /** The client invoice this is about; "" for job-level findings. */
  invoiceId: string;
  invoiceNumber: string;
  /** Dollars at stake, when the finding has a figure. Drives ordering. */
  amount?: number;
  sourceLink?: string;
  sourceLabel?: string;
  /** Set when a standing ruling suppresses this finding — see rulings.ts. */
  suppressedBy?: SuppressionNote;
}

/** Why a finding is not being shown as a problem. */
export interface SuppressionNote {
  /** What the office said when they overruled it. */
  reason: string;
  /** Who recorded the ruling. */
  by: string;
  /** ISO timestamp of the ruling. */
  at: string;
  /** True when the ruling covers this KIND on this job, not just this one key. */
  scope: "finding" | "job-kind";
}

// ---------------------------------------------------------------------------
// EVIDENCE — what the reviewer is shown. Assembled by evidence.ts; every field
// is read from JobTread or Drive, never computed by the reviewer.
// ---------------------------------------------------------------------------

/** One line item on a client invoice. */
export interface InvoiceLine {
  id: string;
  name: string;
  description: string;
  /** CSI cost-code number, when the line is coded. */
  code: string;
  codeName: string;
  quantity: number;
  unitPrice: number;
  /** The extended price JobTread holds for the line — READ, never recomputed. */
  price: number;
  isTaxable: boolean;
}

/** A vendor bill, as seen from the invoice review. */
export interface BillRef {
  id: string;
  /** Vendor name where known, else the bill's own label (invoice # / externalId). */
  label: string;
  vendor: string;
  /** Pre-tax cost — the figure a backup PDF's filename total should equal. */
  cost: number;
  status: string;
  /** Ids of the client invoices this bill sits on (any status). */
  invoiceIds: string[];
  /** True when the bill is on a LIVE (non-denied, or re-issued) invoice. */
  invoiced: boolean;
}

/** A backup PDF filed in the job's billing folder, as parsed by the Apps Script
 *  half from the `syncFilenameCsiAndFilePath` naming convention. */
export interface BackupFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  /** False for anything that isn't a coded bill backup — a Sunset statement, a
   *  photo, a change order. Those are listed but never treated as a bill. */
  parsed: boolean;
  /** Sum of the coded amounts in the filename; the bill-cost match key. */
  amount: number;
  csi: { code: string; amount: number }[];
  /** Everything after the coded block: "Vendor 695829 Ferron Pushed to JT". */
  tail: string;
}

/** One email thread the office mailbox holds about an invoice. Metadata only —
 *  no message body is ever fetched, so a subject line is as deep as this goes. */
export interface EmailThread {
  threadId: string;
  subject: string;
  url: string;
  messages: number;
  firstDate: string;
  lastDate: string;
  lastFrom: string;
  lastFromName: string;
  /** The last message came from OUTSIDE the company — i.e. the client wrote
   *  back and may still be waiting. Mechanical: sender is not an Ascent address
   *  or an ascentbuildingco.com domain. */
  lastInbound: boolean;
  /** Which search found it: "number" is JobTread's own "Invoice #186" subject
   *  (strong); "customer" is an invoice-ish subject naming the customer (weak). */
  matchedOn: "number" | "customer" | "";
  labels: string[];
}

/** What the office mailbox knows about one invoice. */
export interface EmailTrace {
  matchedOn: "number" | "customer" | "";
  threads: EmailThread[];
}

/** One client invoice, with everything needed to check it. */
export interface InvoiceEvidence {
  id: string;
  /** JobTread's document number, as text. */
  number: string;
  name: string;
  status: string;
  issueDate: string;
  dueDate: string;
  /** Ascent's cost basis for the invoice — the bills it pulled. */
  cost: number;
  /** Billed to the customer, pre-tax. */
  price: number;
  priceWithTax: number;
  tax: number;
  taxRate: number;
  amountPaid: number;
  balance: number;
  lines: InvoiceLine[];
  /** Bills this invoice references directly. */
  billIds: string[];
  jtUrl: string;
  /** The office mailbox's record of this invoice going out, or null when the
   *  mailbox wasn't searched (the action isn't deployed, or ?email=0). */
  email: EmailTrace | null;
}

/** One job's slice of the month. */
export interface JobEvidence {
  jobId: string;
  jobName: string;
  customerName: string;
  invoices: InvoiceEvidence[];
  /** Every finalized vendor bill issued in the billing month, invoiced or not. */
  bills: BillRef[];
  /** The Drive billing folder for this job + month. */
  folder: {
    path: string;
    found: boolean;
    folderId: string;
    files: BackupFile[];
    truncated: boolean;
    /** Where the folder walk stopped, when `found` is false. */
    missingAt?: string;
  } | null;
  /** From getInvoiceReconciliation — what the month still owes an invoice. */
  uninvoicedBillsCost: number;
  uninvoicedTimeCost: number;
  draftBillsCost: number;
  draftBillCount: number;
}

/** A whole month of client invoices, as reviewed. */
export interface MonthEvidence {
  /** YYYY-MM — the BILLING month, not the folder month. */
  ym: string;
  year: number;
  month: number;
  /** "July 2026" — the billing period. */
  monthLabel: string;
  /** "/2026 Invoicing/08 August 26 (July Billing)/" — where backup is filed. */
  folderRoot: string;
  jobs: JobEvidence[];
  /**
   * Whether the office mailbox was actually searched. False means the email
   * checks are SKIPPED, not that they passed — the difference matters, because
   * silently passing a check nobody ran is how a review starts lying.
   */
  emailChecked: boolean;
  /** Non-fatal problems assembling the evidence (a Drive call that failed, a
   *  job whose reconciliation errored). Surfaced so a partial review is never
   *  mistaken for a clean one. */
  warnings: string[];
}

/** The whole answer: the evidence, what it turned up, and the narrative. */
export interface ReviewPayload {
  evidence: MonthEvidence;
  findings: Finding[];
  /** Plain-English summary. Written by Claude when configured, else built
   *  locally from the findings — `summarySource` says which. */
  summary: string;
  summarySource: "claude" | "fallback";
  generatedAt: string;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Round to cents. Money arithmetic in floating point drifts by fractions of a
 *  cent; every comparison in the checks goes through this first. */
export function cents(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Dollars, for a finding's text. */
export function money(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(cents(n)).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * A finding's stable id.
 *
 * `subject` is whatever makes this finding one thing rather than a category — a
 * bill id, a Drive file name, an invoice line id. It is deliberately NOT the
 * amount: an office that ruled "this vendor's deposit is fine unbacked" should
 * not see the finding return because the deposit changed by a dollar.
 */
export function findingKey(kind: FindingKind, jobId: string, subject: string): string {
  return [kind, jobId, subject].map((p) => String(p ?? "").trim()).join("|");
}

/** The suppression key for a whole KIND on a job — the broader ruling scope. */
export function jobKindKey(kind: FindingKind, jobId: string): string {
  return findingKey(kind, jobId, "*");
}

/** Severity order for sorting: worst first, then by dollars at stake. */
const SEVERITY_RANK: Record<FindingSeverity, number> = { error: 0, warning: 1, info: 2 };

export function compareFindings(a: Finding, b: Finding): number {
  const s = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (s !== 0) return s;
  const amt = Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0);
  if (amt !== 0) return amt;
  return a.title.localeCompare(b.title);
}
