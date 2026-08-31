/**
 * The checks themselves — pure functions from evidence to findings.
 *
 * NOTHING here fetches, writes, or reads a clock. Every input arrives in the
 * `MonthEvidence` bundle and every output is a `Finding`. That is what makes
 * the money arithmetic unit-testable (see checks.test.ts) and what keeps the
 * reviewer honest: a check can only report what the evidence actually says.
 *
 * THE HOUSE RULE, inherited from the Gemini extraction prompt in the Apps
 * Script repo: AMOUNTS ARE READ, NEVER COMPUTED. A check recomputes a figure
 * only in order to COMPARE it with the one JobTread holds, and reports the
 * disagreement. It never decides which of the two is right, and it never
 * "corrects" anything.
 *
 * FALSE POSITIVES ARE THE FAILURE MODE. A monthly review that cries wolf gets
 * skimmed and then ignored, which is worse than no review. So every check here
 * either has a guard that suppresses it when the evidence is incomplete (see
 * the cost-basis check) or is filed as `warning`/`info` rather than `error`.
 * When in doubt, say less.
 */
import {
  cents,
  compareFindings,
  findingKey,
  money,
  type BackupFile,
  type BillRef,
  type Finding,
  type InvoiceEvidence,
  type JobEvidence,
  type MonthEvidence,
} from "./types";

/** A cent. Floating-point money drifts below this; a real error never hides under it. */
const TOL = 0.01;

/** Below this, an "unbilled remainder" is rounding, not a missed charge. */
const REMAINDER_FLOOR = 0.5;

/** Words that carry no identity in a vendor name, so they must not create a match. */
const NOISE_TOKENS = new Set([
  "llc", "inc", "co", "corp", "ltd", "the", "and", "of", "company", "supply",
  "services", "service", "pushed", "to", "jt", "pdf",
]);

/** Comparable tokens from a name — lowercase, punctuation dropped, noise removed. */
function tokens(s: string): Set<string> {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length >= 3 && !NOISE_TOKENS.has(t)),
  );
}

/** How many identity tokens two names share. */
function overlap(a: string, b: string): number {
  const ta = tokens(a);
  let n = 0;
  for (const t of tokens(b)) if (ta.has(t)) n++;
  return n;
}

/** A backup filename with Drive's collision suffix stripped: "x (2)" → "x". */
function dedupeName(tail: string): string {
  return String(tail ?? "").replace(/\s*\(\d+\)\s*$/, "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// INVOICE vs. BACKUP PDFs
// ---------------------------------------------------------------------------

export interface BackupMatch {
  /** Bills on a live invoice with no backup PDF filed. */
  unmatchedBills: BillRef[];
  /** Coded backup PDFs that no bill on the invoice accounts for. */
  unmatchedFiles: BackupFile[];
  /** bill id → the file matched to it. */
  matched: Map<string, BackupFile>;
}

/**
 * Pair each invoiced vendor bill with the backup PDF filed for it.
 *
 * The pairing key is the AMOUNT, because that is the one field both sides state
 * exactly: the Drive filename carries the summed coded amounts
 * ("06 42 00 - $316.80 _ 01 71 13 - $10.00 - …"), which the ingestion pipeline
 * builds from the same line items that became the bill's cost. Vendor name only
 * breaks ties — it is spelled differently on the two sides often enough that
 * matching on it first would strand real pairs.
 *
 * Matching is one-to-one and consuming, so the month's two separate $7.99
 * Sunset tickets pair with the two separate $7.99 PDFs instead of both latching
 * onto the first one. Bills are taken largest-first so the pairs that matter
 * most are resolved before the small change.
 *
 * Only PDFs the Apps Script half could PARSE take part. A Sunset statement or a
 * dropped photo has no coded amount, so it is neither a candidate nor reported
 * as unaccounted-for — it simply is not bill backup.
 */
export function matchBackup(bills: BillRef[], files: BackupFile[]): BackupMatch {
  const parsed = files.filter((f) => f.parsed);
  const taken = new Set<string>();
  const matched = new Map<string, BackupFile>();
  const unmatchedBills: BillRef[] = [];

  const byCost = [...bills].sort((a, b) => Math.abs(b.cost) - Math.abs(a.cost));
  for (const bill of byCost) {
    const want = cents(bill.cost);
    let best: BackupFile | null = null;
    let bestScore = -1;
    for (const f of parsed) {
      if (taken.has(f.id)) continue;
      if (Math.abs(cents(f.amount) - want) > TOL) continue;
      const score = overlap(f.tail, bill.vendor || bill.label);
      if (score > bestScore) {
        best = f;
        bestScore = score;
      }
    }
    if (best) {
      taken.add(best.id);
      matched.set(bill.id, best);
    } else {
      unmatchedBills.push(bill);
    }
  }

  return {
    unmatchedBills,
    unmatchedFiles: parsed.filter((f) => !taken.has(f.id)),
    matched,
  };
}

function backupFindings(job: JobEvidence, monthLabel: string): Finding[] {
  const out: Finding[] = [];
  const base = { jobId: job.jobId, jobName: job.jobName, customerName: job.customerName };

  // Nothing was invoiced for this job, so there is nothing to back up.
  if (!job.invoices.length) return out;

  if (!job.folder || !job.folder.found) {
    out.push({
      ...base,
      key: findingKey("backup-folder-missing", job.jobId, monthLabel),
      kind: "backup-folder-missing",
      severity: "error",
      invoiceId: "",
      invoiceNumber: "",
      title: `No billing folder for ${job.jobName || job.customerName}`,
      detail:
        `${job.invoices.length} client invoice${job.invoices.length > 1 ? "s were" : " was"} ` +
        `issued for ${monthLabel}, but ${job.folder?.path ?? "the billing folder"} does not exist` +
        (job.folder?.missingAt ? ` (the tree stops at ${job.folder.missingAt})` : "") +
        `. There is no backup on file for anything billed.`,
      amount: job.invoices.reduce((s, i) => s + i.priceWithTax, 0),
    });
    return out; // No folder ⇒ every per-file check below is noise.
  }

  // Only bills that were actually BILLED to the client need backup on file.
  const invoicedBills = job.bills.filter((b) => b.invoiced);
  const { unmatchedBills, unmatchedFiles } = matchBackup(invoicedBills, job.folder.files);

  for (const bill of unmatchedBills) {
    out.push({
      ...base,
      key: findingKey("backup-missing", job.jobId, bill.id),
      kind: "backup-missing",
      severity: "error",
      invoiceId: "",
      invoiceNumber: "",
      title: `No backup filed — ${bill.vendor || bill.label} ${money(bill.cost)}`,
      detail:
        `${bill.vendor || bill.label} (${money(bill.cost)}) is billed to the client on this ` +
        `month's invoice, but no PDF in ${job.folder.path} totals ${money(bill.cost)}. ` +
        `Either the backup was never filed or it is filed under the wrong job.`,
      amount: bill.cost,
      sourceLink: `/bill/${encodeURIComponent(bill.id)}`,
      sourceLabel: "Open the bill",
    });
  }

  for (const f of unmatchedFiles) {
    out.push({
      ...base,
      key: findingKey("backup-unmatched", job.jobId, f.name),
      kind: "backup-unmatched",
      severity: "warning",
      invoiceId: "",
      invoiceNumber: "",
      title: `Filed but not billed — ${money(f.amount)}`,
      detail:
        `${f.name} is filed in ${job.folder.path} for ${money(f.amount)}, but no bill on this ` +
        `month's client invoice matches that amount. It may belong to another month, ` +
        `another job, or be a charge that was never billed on.`,
      amount: f.amount,
      sourceLink: f.url,
      sourceLabel: "Open the PDF",
    });
  }

  // Two files with the same name and amount are a re-file, not two charges —
  // and if both were billed, the client paid twice. Drive's own " (2)" suffix
  // is stripped first, since that is exactly how the second copy gets named.
  const seen = new Map<string, BackupFile[]>();
  for (const f of job.folder.files) {
    if (!f.parsed) continue;
    const k = `${cents(f.amount)}|${dedupeName(f.tail)}`;
    seen.set(k, [...(seen.get(k) ?? []), f]);
  }
  for (const group of seen.values()) {
    if (group.length < 2) continue;
    out.push({
      ...base,
      key: findingKey("backup-duplicate", job.jobId, dedupeName(group[0].tail)),
      kind: "backup-duplicate",
      severity: "warning",
      invoiceId: "",
      invoiceNumber: "",
      title: `${group.length} copies filed — ${money(group[0].amount)}`,
      detail:
        `${group.length} PDFs in ${job.folder.path} carry the same vendor and the same ` +
        `${money(group[0].amount)}: ${group.map((g) => g.name).join(", ")}. If both were ` +
        `pushed as separate bills, the charge is on the invoice twice.`,
      amount: group[0].amount,
      sourceLink: group[0].url,
      sourceLabel: "Open the first copy",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// MATH & TOTALS
// ---------------------------------------------------------------------------

function mathFindings(job: JobEvidence, inv: InvoiceEvidence): Finding[] {
  const out: Finding[] = [];
  const base = {
    jobId: job.jobId,
    jobName: job.jobName,
    customerName: job.customerName,
    invoiceId: inv.id,
    invoiceNumber: inv.number,
  };
  const label = `Invoice #${inv.number || inv.id}`;

  // ── Per line: quantity × unit price vs. the extended price JobTread holds.
  // Skipped when either factor is zero: a flat-price line (qty 0, or a price
  // typed directly) is normal in JobTread and its "product" is meaningless.
  for (const line of inv.lines) {
    if (!line.quantity || !line.unitPrice) continue;
    const expect = cents(line.quantity * line.unitPrice);
    if (Math.abs(expect - cents(line.price)) <= TOL) continue;
    out.push({
      ...base,
      key: findingKey("math-line", job.jobId, `${inv.id}:${line.id}`),
      kind: "math-line",
      severity: "error",
      title: `${label} — line doesn't multiply out`,
      detail:
        `"${line.name}": ${line.quantity} × ${money(line.unitPrice)} = ${money(expect)}, ` +
        `but the line is billed at ${money(line.price)} — a difference of ` +
        `${money(cents(line.price) - expect)}.`,
      amount: cents(line.price) - expect,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
  }

  // ── Lines vs. the invoice's pre-tax price.
  if (inv.lines.length) {
    const sum = cents(inv.lines.reduce((s, l) => s + l.price, 0));
    if (Math.abs(sum - cents(inv.price)) > TOL) {
      out.push({
        ...base,
        key: findingKey("math-total", job.jobId, inv.id),
        kind: "math-total",
        severity: "error",
        title: `${label} — lines don't sum to the total`,
        detail:
          `The ${inv.lines.length} line items add to ${money(sum)}, but the invoice's ` +
          `pre-tax total is ${money(inv.price)} — off by ${money(cents(inv.price) - sum)}.`,
        amount: cents(inv.price) - sum,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }
  }

  // ── Tax: the with-tax total minus the pre-tax total must be the stated tax.
  const taxGap = cents(cents(inv.priceWithTax) - cents(inv.price) - cents(inv.tax));
  if (Math.abs(taxGap) > TOL) {
    out.push({
      ...base,
      key: findingKey("math-tax", job.jobId, inv.id),
      kind: "math-tax",
      severity: "error",
      title: `${label} — tax doesn't reconcile`,
      detail:
        `${money(inv.priceWithTax)} with tax − ${money(inv.price)} pre-tax = ` +
        `${money(cents(inv.priceWithTax) - cents(inv.price))}, but the invoice states ` +
        `${money(inv.tax)} of tax — off by ${money(taxGap)}.`,
      amount: taxGap,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
  }

  // ── Balance: what's still owed must be the total less what's been paid.
  const balGap = cents(cents(inv.priceWithTax) - cents(inv.amountPaid) - cents(inv.balance));
  if (Math.abs(balGap) > TOL) {
    out.push({
      ...base,
      key: findingKey("math-balance", job.jobId, inv.id),
      kind: "math-balance",
      severity: "warning",
      title: `${label} — balance doesn't reconcile`,
      detail:
        `${money(inv.priceWithTax)} billed − ${money(inv.amountPaid)} paid = ` +
        `${money(cents(inv.priceWithTax) - cents(inv.amountPaid))}, but the invoice's ` +
        `balance reads ${money(inv.balance)} — off by ${money(balGap)}.`,
      amount: balGap,
      sourceLink: inv.jtUrl,
      sourceLabel: "Open in JobTread",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// BILLING PERIOD & SCOPE
// ---------------------------------------------------------------------------

function periodFindings(job: JobEvidence, month: MonthEvidence): Finding[] {
  const out: Finding[] = [];
  const base = { jobId: job.jobId, jobName: job.jobName, customerName: job.customerName };
  const mm = String(month.month).padStart(2, "0");
  const first = `${month.year}-${mm}-01`;
  const lastDay = new Date(month.year, month.month, 0).getDate();
  const last = `${month.year}-${mm}-${String(lastDay).padStart(2, "0")}`;

  const monthBillCost = new Map(job.bills.map((b) => [b.id, b.cost]));

  for (const inv of job.invoices) {
    const invBase = { ...base, invoiceId: inv.id, invoiceNumber: inv.number };
    const label = `Invoice #${inv.number || inv.id}`;

    // The issue date IS the billing period (JobTread convention: the month and
    // year of issueDate are the period). An invoice carrying this month's bills
    // but dated into another month bills the client for the wrong period, and
    // the Apps Script mirror will re-file its backup to the wrong Drive month.
    const issued = String(inv.issueDate ?? "").slice(0, 10);
    if (issued && (issued < first || issued > last)) {
      out.push({
        ...invBase,
        key: findingKey("period-issue-date", job.jobId, inv.id),
        kind: "period-issue-date",
        severity: "warning",
        title: `${label} — dated outside ${month.monthLabel}`,
        detail:
          `This invoice carries ${month.monthLabel} bills but is issued ${issued}, outside ` +
          `${first}…${last}. In JobTread the issue date is the billing period, so this bills ` +
          `the client for the wrong month.`,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }

    // Cost basis. JobTread sets an invoice's `cost` from the bills it pulled, so
    // comparing it against the bills we can SEE for this month tells us whether
    // the invoice reached outside the month. Only flagged when the invoice's
    // cost EXCEEDS the month's bills on it — the other direction just means the
    // invoice covers part of the month, which is normal for a split invoice.
    const onThisInvoice = job.bills.filter((b) => b.invoiceIds.includes(inv.id));
    const seenCost = cents(onThisInvoice.reduce((s, b) => s + (monthBillCost.get(b.id) ?? 0), 0));
    const outside = cents(cents(inv.cost) - seenCost);
    if (onThisInvoice.length && outside > TOL) {
      out.push({
        ...invBase,
        key: findingKey("math-cost-basis", job.jobId, inv.id),
        kind: "math-cost-basis",
        severity: "warning",
        title: `${label} — ${money(outside)} of cost from outside ${month.monthLabel}`,
        detail:
          `The invoice's cost basis is ${money(inv.cost)}, but the ${onThisInvoice.length} ` +
          `${month.monthLabel} bill${onThisInvoice.length > 1 ? "s" : ""} on it total ` +
          `${money(seenCost)}. The remaining ${money(outside)} came from bills issued in ` +
          `another month — check that it was meant to be billed now.`,
        amount: outside,
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }
  }

  // A bill carried by two live invoices is billed to the client twice.
  for (const bill of job.bills) {
    if (bill.invoiceIds.length < 2) continue;
    out.push({
      ...base,
      key: findingKey("scope-duplicate-bill", job.jobId, bill.id),
      kind: "scope-duplicate-bill",
      severity: "error",
      invoiceId: "",
      invoiceNumber: "",
      title: `Billed twice — ${bill.vendor || bill.label} ${money(bill.cost)}`,
      detail:
        `${bill.vendor || bill.label} (${money(bill.cost)}) sits on ${bill.invoiceIds.length} ` +
        `live client invoices at once. Unless one is a credit, the client has been billed ` +
        `for it more than once.`,
      amount: bill.cost,
      sourceLink: `/bill/${encodeURIComponent(bill.id)}`,
      sourceLabel: "Open the bill",
    });
  }

  // Anything finalized and left off every invoice is revenue not billed. This
  // is the reconciliation JobTread itself computes (getInvoiceReconciliation),
  // including its denied-and-re-issued invoice chain, so it is trustworthy.
  const remainder = cents(job.uninvoicedBillsCost + job.uninvoicedTimeCost);
  if (job.invoices.length && remainder > REMAINDER_FLOOR) {
    const parts: string[] = [];
    if (job.uninvoicedBillsCost > REMAINDER_FLOOR) {
      parts.push(`${money(job.uninvoicedBillsCost)} of bills`);
    }
    if (job.uninvoicedTimeCost > REMAINDER_FLOOR) {
      parts.push(`${money(job.uninvoicedTimeCost)} of time`);
    }
    out.push({
      ...base,
      key: findingKey("scope-uninvoiced", job.jobId, month.ym),
      kind: "scope-uninvoiced",
      severity: "error",
      invoiceId: "",
      invoiceNumber: "",
      title: `${money(remainder)} of ${month.monthLabel} never billed`,
      detail:
        `${parts.join(" and ")} for ${month.monthLabel} sit on no live client invoice, ` +
        `even though this job WAS invoiced this month. That cost has been absorbed unless ` +
        `it was deliberately held back.`,
      amount: remainder,
      sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}&ym=${month.ym}`,
      sourceLabel: "Open the tracking sheet",
    });
  }

  // Draft bills can't be pulled onto an invoice at all, so a month closed with
  // drafts outstanding was closed early. Not an error — it is often deliberate.
  if (job.draftBillCount > 0) {
    out.push({
      ...base,
      key: findingKey("scope-drafts", job.jobId, month.ym),
      kind: "scope-drafts",
      severity: "warning",
      invoiceId: "",
      invoiceNumber: "",
      title: `${job.draftBillCount} bill${job.draftBillCount > 1 ? "s" : ""} still in draft — ${money(job.draftBillsCost)}`,
      detail:
        `${money(job.draftBillsCost)} across ${job.draftBillCount} draft bill` +
        `${job.draftBillCount > 1 ? "s" : ""} is still in the coding queue for ` +
        `${month.monthLabel}. JobTread cannot pull a draft onto an invoice, so none of it ` +
        `was billed.`,
      amount: job.draftBillsCost,
      sourceLink: `/trackingsheet?jobId=${encodeURIComponent(job.jobId)}&ym=${month.ym}`,
      sourceLabel: "Open the tracking sheet",
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// THE RUN
// ---------------------------------------------------------------------------

/**
 * Every finding in a month, worst first.
 *
 * Suppression is NOT applied here — that is `applyRulings` in rulings.ts, kept
 * separate so the raw findings stay inspectable and a ruling can be lifted
 * without re-running the checks.
 */
export function runChecks(month: MonthEvidence): Finding[] {
  const out: Finding[] = [];
  for (const job of month.jobs) {
    out.push(...backupFindings(job, month.monthLabel));
    for (const inv of job.invoices) out.push(...mathFindings(job, inv));
    out.push(...periodFindings(job, month));
  }
  return out.sort(compareFindings);
}

/** One line of plain English over a set of findings — the fallback summary when
 *  Claude isn't configured or didn't answer. Deliberately dull and countable. */
export function fallbackSummary(month: MonthEvidence, findings: Finding[]): string {
  const live = findings.filter((f) => !f.suppressedBy);
  const errors = live.filter((f) => f.severity === "error");
  const warnings = live.filter((f) => f.severity === "warning");
  const invoices = month.jobs.reduce((s, j) => s + j.invoices.length, 0);
  const head =
    `${invoices} client invoice${invoices === 1 ? "" : "s"} across ` +
    `${month.jobs.length} job${month.jobs.length === 1 ? "" : "s"} for ${month.monthLabel}`;
  if (!live.length) return `${head}: nothing to flag.`;
  const at = live.reduce((s, f) => s + Math.abs(f.amount ?? 0), 0);
  const parts = [
    errors.length ? `${errors.length} to fix` : "",
    warnings.length ? `${warnings.length} to look at` : "",
  ].filter(Boolean);
  return `${head}: ${parts.join(", ")}, ${money(at)} in question.`;
}
