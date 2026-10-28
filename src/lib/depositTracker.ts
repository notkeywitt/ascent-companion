/**
 * The DEPOSIT TRACKER — the rules behind Home's "Deposit checks" button.
 *
 * The flow: photograph the checks → file the photos on the Office job's Files
 * tab, folder "Checks" → pick the open client invoices the checks pay → record
 * the payments in JobTread → draft an email to Sara and Casey with the photos
 * and what each check paid.
 *
 * Pure: no JobTread, Gmail or React. The routes under /api/deposit-tracker do
 * the reads and writes (src/lib/jobtread.ts `recordInvoicePayments`,
 * `uploadFileToJobFolder`), and Apps Script (`draftDepositEmail`) saves the
 * Gmail draft. The office reads and sends the draft by hand.
 */
import { money } from "./money";
import { SIGNATURE_HTML, SIGNATURE_TEXT } from "./emailSignature";

/** The Office job's Files folder the check photos go in — the office's existing "Checks" folder (owner, 2026-10-28). */
export const DEPOSIT_FOLDER = "Checks";

/** Sara (the bookkeeper) and Casey — the two the owner named. */
export const DEPOSIT_EMAIL_TO = ["booksbysara@hotmail.com", "casey@ascentbuildingco.com"];

/** One invoice the checks pay, and how much of it. */
export interface DepositLine {
  invoiceId: string;
  amount: number;
}

/** An invoice as the server re-reads it before it records a payment. */
export interface InvoiceForPayment {
  id: string;
  number: string;
  type: string;
  status: string;
  balance: number;
  jobId: string;
  jobName: string;
  jobNumber: string;
  customerName: string;
  /** The customer account. A JobTread payment belongs to an account, not a job. */
  accountId: string;
}

/** One payment to create: every selected invoice of one customer account. */
export interface PaymentGroup {
  accountId: string;
  customerName: string;
  total: number;
  lines: { invoice: InvoiceForPayment; amount: number }[];
}

const cents = (n: number) => Math.round(n * 100);

/**
 * Check the office's selection against the invoices as JobTread holds them now,
 * and group it into one payment per customer account. Returns every problem at
 * once, so the screen can show them all; `groups` is empty when there is one.
 */
export function planDepositPayments(
  lines: DepositLine[],
  invoices: Record<string, InvoiceForPayment | null>,
): { groups: PaymentGroup[]; errors: string[] } {
  const errors: string[] = [];
  if (!lines.length) errors.push("Select at least one invoice.");
  const seen = new Set<string>();
  const byAccount = new Map<string, PaymentGroup>();

  for (const l of lines) {
    const inv = invoices[l.invoiceId];
    if (!inv) {
      errors.push(`Invoice ${l.invoiceId} was not found in JobTread.`);
      continue;
    }
    const label = `Invoice #${inv.number} (${inv.jobName})`;
    if (seen.has(inv.id)) {
      errors.push(`${label} is selected twice.`);
      continue;
    }
    seen.add(inv.id);
    if (inv.type !== "customerInvoice") {
      errors.push(`${label} is not a client invoice.`);
      continue;
    }
    if (inv.status !== "pending" && inv.status !== "approved") {
      errors.push(`${label} is ${inv.status || "not open"}, so it cannot take a payment.`);
      continue;
    }
    if (!inv.accountId) {
      errors.push(`${label} has no customer account in JobTread.`);
      continue;
    }
    const amount = Number(l.amount);
    if (!Number.isFinite(amount) || cents(amount) <= 0) {
      errors.push(`${label}: enter an amount above $0.`);
      continue;
    }
    if (cents(amount) !== Math.round(amount * 100 * 1e6) / 1e6) {
      errors.push(`${label}: the amount has more than two decimal places.`);
      continue;
    }
    if (cents(amount) > cents(inv.balance)) {
      errors.push(`${label}: ${money(amount)} is more than the ${money(inv.balance)} still owed.`);
      continue;
    }
    const g = byAccount.get(inv.accountId) ?? {
      accountId: inv.accountId,
      customerName: inv.customerName,
      total: 0,
      lines: [],
    };
    g.lines.push({ invoice: inv, amount: cents(amount) / 100 });
    g.total = (cents(g.total) + cents(amount)) / 100;
    byAccount.set(inv.accountId, g);
  }

  if (errors.length) return { groups: [], errors };
  return {
    groups: [...byAccount.values()].sort((a, b) => a.customerName.localeCompare(b.customerName)),
    errors,
  };
}

/**
 * The payment's externalId: one per deposit (the key the screen mints) and
 * account. The record route looks it up before it creates a payment, so a
 * second press — or a retry after a half-finished run — finds the first
 * payment instead of making another. JobTread caps the field at 128.
 */
export function paymentExternalId(key: string, accountId: string): string {
  return `deposit:${key}:${accountId}`.slice(0, 128);
}

/** "Check deposit · Oct 26, 2026 · #1042, #1043" — the payment's description in JobTread. */
export function paymentDescription(date: string, reference: string): string {
  const ref = reference.trim();
  return `Check deposit · ${longDate(date)}${ref ? ` · ${ref}` : ""}`.slice(0, 500);
}

/** "Deposit 2026-10-26 check 2.jpg" — the photo's name on the Office job. */
export function checkPhotoName(date: string, index: number, total: number): string {
  return total > 1 ? `Deposit ${date} check ${index + 1}.jpg` : `Deposit ${date} check.jpg`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-26" → "Oct 26, 2026". */
export function longDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : ymd;
}

/** One row of the email: what one check paid on one invoice. */
export interface DepositEmailLine {
  customerName: string;
  jobName: string;
  jobNumber: string;
  invoiceNumber: string;
  amount: number;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The email to Sara and Casey: one row per invoice paid (customer, job,
 * invoice, amount), the total, and the check photos attached.
 */
export function composeDepositEmail({
  date,
  lines,
  reference,
  photos,
}: {
  date: string;
  lines: DepositEmailLine[];
  reference: string;
  photos: number;
}): { subject: string; html: string; text: string } {
  const total = lines.reduce((s, l) => s + cents(l.amount), 0) / 100;
  const subject = `Deposit ${longDate(date)} — ${money(total)}`;
  const job = (l: DepositEmailLine) => (l.jobNumber ? `${l.jobName} (${l.jobNumber})` : l.jobName);
  const ref = reference.trim();
  const intro =
    `${photos === 1 ? "The check" : `The ${photos} checks`} for today's deposit ${photos === 1 ? "is" : "are"} attached. ` +
    "They are recorded as paid in JobTread, so please do not enter them in QuickBooks:";

  const cell = "padding:4px 12px 4px 0;text-align:left";
  const num = "padding:4px 0 4px 12px;text-align:right";
  const rows = lines
    .map(
      (l) =>
        `<tr><td style="${cell}">${esc(l.customerName)}</td><td style="${cell}">${esc(job(l))}</td>` +
        `<td style="${cell}">#${esc(l.invoiceNumber)}</td><td style="${num}">${money(l.amount)}</td></tr>`,
    )
    .join("");
  const html =
    `<div dir="auto">Hi Sara and Casey,</div><div dir="auto"><br></div>` +
    `<div dir="auto">${esc(intro)}</div><div dir="auto"><br></div>` +
    `<table style="border-collapse:collapse">` +
    `<tr><th style="${cell}">Customer</th><th style="${cell}">Job</th><th style="${cell}">Invoice</th><th style="${num}">Amount</th></tr>` +
    rows +
    `<tr><td colspan="3" style="${cell}"><b>Total</b></td><td style="${num}"><b>${money(total)}</b></td></tr>` +
    `</table>` +
    (ref ? `<div dir="auto"><br></div><div dir="auto">Check numbers: ${esc(ref)}</div>` : "") +
    `<div dir="auto"><br></div><div dir="auto">Thanks!<br clear="all"><br clear="all">` +
    `<div dir="auto">${SIGNATURE_HTML}</div></div>`;

  const text =
    `Hi Sara and Casey,\n\n${intro}\n\n` +
    lines.map((l) => `${l.customerName} — ${job(l)} — invoice #${l.invoiceNumber} — ${money(l.amount)}`).join("\n") +
    `\nTotal: ${money(total)}\n` +
    (ref ? `\nCheck numbers: ${ref}\n` : "") +
    `\nThanks!\n\n${SIGNATURE_TEXT}`;

  return { subject, html, text };
}
