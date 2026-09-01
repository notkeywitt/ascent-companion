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
  /** A finalized bill for the month sits on no client invoice. */
  | "bill-uninvoiced"
  /** A job's whole month of bills was never invoiced at all. */
  | "job-not-invoiced"
  // ── The office mailbox: did every vendor invoice get captured? ────────────
  /** A vendor invoice arrived in the period and no JobTread bill matches it. */
  | "email-bill-missed"
  /** Invoice-looking mail from a sender that matches no JobTread vendor. */
  | "email-unknown-sender"
  /** The same vendor bill is carried by two different live invoices. */
  | "scope-duplicate-bill"
  // ── Margin: cost-plus means the markup IS the revenue ────────────────────
  /** A line reached the client invoice at cost — the markup was dropped. */
  | "markup-missing"
  /** A line is billed for less than it cost. */
  | "billed-below-cost"
  // ── Learned from history (norms.ts), not from this month's evidence ───────
  /** A vendor who bills nearly every month has no bill this month at all. */
  | "vendor-silent"
  /** An invoice's markup is off what this customer is normally billed. */
  | "markup-rate-drift";

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
  /**
   * How long this has been showing up, from the review's own memory. Attached
   * AFTER the checks run (see lifecycle.ts) — a check is pure and has no idea
   * what happened last month.
   *
   * Absent when there is no history yet, which is not the same as `isNew`:
   * absent means "we don't know", `isNew` means "we looked and this is the
   * first time". A month reviewed once has no history for anything.
   */
  history?: FindingHistoryNote;
}

/** What the review remembers about one finding. */
export interface FindingHistoryNote {
  /** ISO time of the earliest run that carried it. */
  firstSeenAt: string;
  /** How many runs have carried it, this one included. */
  runsSeen: number;
  /** True when no previous run had seen it — a genuinely new problem. */
  isNew: boolean;
}

/** Why a finding is not being shown as a problem. */
export interface SuppressionNote {
  /** What the office said when they overruled it. */
  reason: string;
  /** Who recorded the ruling. */
  by: string;
  /** ISO timestamp of the ruling. */
  at: string;
  /** How wide the ruling reaches — see `RulingScope`. */
  scope: RulingScope;
}

/**
 * How wide a standing ruling reaches.
 *
 *   "finding"       this exact finding on this exact subject. The default, and
 *                   the safe one.
 *   "job-kind"      every finding of this kind on this job, forever.
 *   "customer-kind" every finding of this kind on every job for this customer.
 *
 * `customer-kind` exists because some standing arrangements are a property of
 * the CLIENT, not of one job — "this customer's allowance draws never have
 * vendor backup" is true on all four of their jobs and on the fifth they
 * haven't started yet. Recording it once, at the level it is actually true at,
 * beats re-ruling it every time a job is opened.
 *
 * There is deliberately no vendor scope yet: a `Finding` carries no structured
 * vendor, only a name inside its title, and matching on that would silence by
 * string coincidence. It needs a `vendorName` on the finding first.
 */
export type RulingScope = "finding" | "job-kind" | "customer-kind";

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
  /**
   * What the line COST Ascent, as JobTread holds it — the basis the markup is
   * applied to. 0 when the line has no cost recorded, which is normal for a
   * flat-priced line and means every margin check must skip it rather than
   * read it as "billed at zero cost".
   */
  cost: number;
  unitCost: number;
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

/**
 * One vendor-invoice-looking email that arrived in the billing period, already
 * joined to JobTread by the evidence loader.
 *
 * The join is what makes the check possible: `matchedBillId` is the JobTread
 * vendor bill this email's invoice became, or "" when nothing matched. `checked`
 * says whether the lookup could even be attempted — an unmatched email whose
 * vendor bills could not be read proves nothing, and must not be flagged.
 */
export interface BillEmail {
  threadId: string;
  subject: string;
  from: string;
  fromAddress: string;
  fromName: string;
  fromDomain: string;
  /** ISO timestamp of the ORIGINAL message — the arrival that sets the period. */
  date: string;
  attachmentCount: number;
  /** Largest dollar figure printed in the SUBJECT, or null. A hint, not an
   *  extraction — many vendors print the total there, and it sharpens matching. */
  subjectAmount: number | null;
  threadUrl: string;
  /** Gmail labels, so "Processed" on an email with no bill is visible as the
   *  contradiction it is. */
  labels: string[];
  /** The JobTread vendor account resolved from the sender; "" when none matched. */
  vendorId: string;
  vendorName: string;
  /** The JobTread bill this invoice became; "" when none was found. */
  matchedBillId: string;
  /** False when the vendor's bills could not be read, so "no match" is unproven. */
  checked: boolean;
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
}

/** One job's slice of the month. */
export interface JobEvidence {
  jobId: string;
  jobName: string;
  customerName: string;
  /** Ascent's own overhead jobs (Office, Shop) — real cost lands on them and is
   *  NEVER billed to a customer, so every "this should have been invoiced"
   *  check skips them. See `isNeverInvoiced`. */
  neverInvoiced: boolean;
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
  /** Vendor-invoice mail that arrived in this period's 10th-to-10th window,
   *  joined to JobTread. Empty when `emailChecked` is false. */
  emails: BillEmail[];
  /** The mail-arrival window actually searched (YYYY-MM-DD), for the report. */
  mailWindow: { first: string; last: string } | null;
  /** Gmail returned more than the cap, so the sweep is not exhaustive. */
  mailTruncated: boolean;
  /** Non-fatal problems assembling the evidence (a Drive call that failed, a
   *  job whose reconciliation errored). Surfaced so a partial review is never
   *  mistaken for a clean one. */
  warnings: string[];
  /**
   * What the months BEFORE this one looked like (norms.ts), attached by the
   * runner before the checks run.
   *
   * It lives on the evidence rather than being read by a check directly for one
   * reason: checks are pure. A check that reached into the database would stop
   * being unit-testable, and the arithmetic in this review being testable is
   * the reason it can be trusted at all.
   *
   * Absent when there isn't enough history yet — which every check reading it
   * must treat as "say nothing", never as "nothing was unusual".
   */
  norms?: ReviewNorms;
}

/** The whole answer: the evidence, what it turned up, and the narrative. */
/**
 * What one vendor's billing normally looks like, learned from run history.
 * See norms.ts — a norm is a reason to ASK, never a verdict.
 */
export interface VendorNorm {
  /** The normalized comparison key (see `vendorKey`). */
  key: string;
  /** The vendor as most recently spelled, for showing a human. */
  name: string;
  /** In how many months of the window they billed at least once. */
  monthsSeen: number;
  /** How many months of history the baseline is built on. */
  monthsOfHistory: number;
  /** Median monthly cost across the months they appeared in. */
  typicalMonthlyCost: number;
  lastSeenYm: string;
}

/**
 * What one customer is normally billed, learned from run history.
 *
 * Ascent charges DIFFERENT MARKUPS TO DIFFERENT CUSTOMERS, so there is no such
 * thing as a house markup to measure an invoice against. The only meaningful
 * baseline is this customer's own recent history, which is exactly what a
 * learned norm is for — and why the drift check could not have been written
 * before the run history existed.
 */
export interface CustomerNorm {
  /** Normalized comparison key (see `customerKey`). */
  key: string;
  /** The customer as most recently spelled, for showing a human. */
  name: string;
  /** How many months of the window they were invoiced in. */
  monthsSeen: number;
  monthsOfHistory: number;
  /**
   * Median of the monthly blended markup RATIO (invoice price ÷ invoice cost).
   * 1.22 means "cost plus 22%". Median, not mean, so one odd month can't move
   * what "normal" is for a client billed steadily for years.
   */
  typicalMarkup: number;
  /** Median monthly billed price. Used only to judge whether a drift is
   *  material enough to be worth saying. */
  typicalMonthlyPrice: number;
}

/** The baselines a month is judged against. Absent when there isn't enough
 *  history — which every check that reads them must treat as "say nothing". */
export interface ReviewNorms {
  ym: string;
  windowMonths: number;
  monthsOfHistory: number;
  vendors: VendorNorm[];
  customers: CustomerNorm[];
}

export interface ReviewPayload {
  evidence: MonthEvidence;
  findings: Finding[];
  /** Plain-English summary. Written by Claude when configured, else built
   *  locally from the findings — `summarySource` says which. */
  summary: string;
  summarySource: "claude" | "fallback";
  /**
   * Why the summary fell back, when it did. Empty on the Claude path.
   *
   * The fallback used to be silent, which meant a missing key, an expired key,
   * a bad model id and a timeout all looked identical to "Claude wrote
   * something dull" — so a real outage could run for weeks unnoticed. Surfacing
   * the reason is the whole point; see narrate.ts.
   */
  summaryNote?: string;
  generatedAt: string;
  durationMs: number;
  /**
   * Set when this payload came out of the run history rather than being
   * computed just now — the ISO time of the run it was stored from. The page
   * shows it so a stored review can never be mistaken for a fresh one.
   */
  storedAt?: string;
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
 * Ascent's own overhead jobs, which never reach a customer invoice.
 *
 * Cost lands on Office and Shop the same way it lands on a real job — a bill is
 * coded, approved and mirrored — but none of it is ever billed on, so every
 * "this was never invoiced" check would fire on them every single month. They
 * are matched by NAME rather than id because the ids differ between the two
 * repos' configs and a rename is easier to spot than a stale id; the Office job
 * id is listed too, belt and braces, since it is the one hard-coded elsewhere
 * (CONFIG.JOBTREAD.DEFAULT_JOB_ID in ascent-appscript).
 *
 * Matching is EXACT on the job name, not a substring: "Office Remodel" for a
 * real customer is a real job whose bills really must be invoiced.
 */
export const NEVER_INVOICED_JOB_NAMES = ["office", "shop"];
export const NEVER_INVOICED_JOB_IDS = ["22PXevQbM9FQ"]; // "Office"

export function isNeverInvoiced(jobId: string, jobName: string): boolean {
  if (NEVER_INVOICED_JOB_IDS.includes(String(jobId ?? "").trim())) return true;
  return NEVER_INVOICED_JOB_NAMES.includes(String(jobName ?? "").trim().toLowerCase());
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

/**
 * The suppression key for a whole KIND for a customer, across every job.
 *
 * Keyed on the customer NAME rather than an id because a finding carries the
 * name and not the id, and because a rename is easier to spot than a stale id
 * (the same reasoning as `NEVER_INVOICED_JOB_NAMES`). Normalized so casing and
 * spacing can't quietly create a second, non-matching ruling.
 */
export function customerKindKey(kind: FindingKind, customerName: string): string {
  return findingKey(kind, "customer", `${String(customerName ?? "").trim().toLowerCase()}|*`);
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
