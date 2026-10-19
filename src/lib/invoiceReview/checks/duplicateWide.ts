/**
 * THE SAME VENDOR INVOICE, CAPTURED TWICE — ACROSS MONTHS, FINALIZED OR NOT.
 *
 * duplicate-draft only sees a pair where one copy is still a draft, on the same
 * issue date, at the same cents. duplicate-bill only sees ONE bill sitting on
 * two invoices. Neither sees the two Berger cases that reached the client:
 *
 *   - Dirt Doctors #1289, $11,162.80 — added late to the October invoice, then
 *     billed again in November. Two bills, two months, both finalized.
 *   - Naturally Sustained NS1866 — the vendor sent a revised invoice and it was
 *     entered as a new bill. Both landed on the August invoice; $436.80 credited.
 *
 * TWO TESTS, TWO SEVERITIES.
 *   number   both bills carry the same vendor invoice number, after a revision
 *            suffix is dropped (NS1866 = NS1866-R). Near-proof: error.
 *   amount   same vendor, same cost to the cent, within `amountWindowDays`.
 *            Often a duplicate, sometimes two genuine equal charges (a 50/50
 *            progress bill, a monthly rental): warning, and a ruling silences
 *            the real ones.
 *
 * A pair duplicate-draft already reports (one draft, same date, same cents) is
 * left to it, so the office never sees one problem twice.
 */
import { defineJobCheck } from "../checkTypes";
import { findingKey, money, type BillRef, type Finding } from "../types";
import { billLink } from "./shared";

export interface DuplicateWideConfig {
  /** How far apart two same-amount bills may be issued and still look like one. */
  amountWindowDays: number;
  /** Same-amount pairs below this are ordinary repeat purchases, not news. */
  minCost: number;
  /** Turn the softer, amount-only half off without losing the number half. */
  reportAmountMatches: boolean;
}

const vendorKey = (b: BillRef) => (b.vendor || "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A vendor invoice number reduced to what identifies the invoice: case,
 * spacing and punctuation dropped, and a revision suffix removed so a revised
 * invoice matches its original. "" when there is no usable number — including
 * the capture's own random id (`INV-` + 8 hex, AddonUI.js), which says nothing
 * about the vendor's invoice.
 */
export function invoiceNumberStem(raw: string | undefined): string {
  let s = String(raw ?? "").trim().toUpperCase();
  if (!s || /^INV-[0-9A-F]{8}$/.test(s)) return "";
  s = s.replace(/[\s_]+/g, "");
  s = s.replace(/[-./](R|REV|REVISED|V\d{1,2}|\d)$/, "").replace(/(REV|REVISED)$/, "");
  s = s.replace(/[^A-Z0-9]/g, "");
  return s.length >= 4 ? s : "";
}

const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** The pair duplicate-draft reports already. */
function draftCheckOwns(a: BillRef, b: BillRef): boolean {
  return (
    (a.status === "draft" || b.status === "draft") &&
    a.issueDate === b.issueDate &&
    a.cost.toFixed(2) === b.cost.toFixed(2)
  );
}

export const duplicateWideCheck = defineJobCheck<DuplicateWideConfig>({
  id: "duplicate-wide",
  title: "Duplicate bill across months",
  description:
    "No vendor invoice was captured twice — same invoice number, or same vendor and amount weeks apart.",
  kinds: ["bill-duplicate-number", "bill-duplicate-amount"],
  scope: "job",
  run({ job, config, global }) {
    const out: Finding[] = [];
    const current = [...job.bills, ...job.draftBills];
    const pool = [...current, ...(job.priorBills ?? [])];
    const seen = new Set<string>();

    for (const a of current) {
      if (!(a.cost > 0)) continue; // a credit is not a copy of anything
      for (const b of pool) {
        if (b.id === a.id || !(b.cost > 0)) continue;
        if (vendorKey(a) === "" || vendorKey(a) !== vendorKey(b)) continue;
        const pairKey = [a.id, b.id].sort().join("|");
        if (seen.has(pairKey)) continue;

        const stemA = invoiceNumberStem(a.externalId);
        const sameNumber = stemA !== "" && stemA === invoiceNumberStem(b.externalId);
        const gapDays = Math.abs(dayNumber(a.issueDate) - dayNumber(b.issueDate));
        const sameAmount =
          config.reportAmountMatches &&
          a.cost >= config.minCost &&
          Math.abs(a.cost - b.cost) <= global.tolerance &&
          gapDays <= config.amountWindowDays &&
          !draftCheckOwns(a, b);
        if (!sameNumber && !sameAmount) continue;
        seen.add(pairKey);

        // The later copy is the one to look at first.
        const [older, newer] = a.issueDate <= b.issueDate ? [b, a] : [a, b];
        const kind = sameNumber ? "bill-duplicate-number" : "bill-duplicate-amount";
        const onInvoice = (x: BillRef) =>
          x.sentInvoiceIds.length ? "on a sent invoice" : x.invoiceIds.length ? "on a draft invoice" : "not invoiced yet";
        const both =
          `${older.label} (${older.issueDate}, ${money(older.cost)}, ${older.status}, ${onInvoice(older)}) and ` +
          `${newer.label} (${newer.issueDate}, ${money(newer.cost)}, ${newer.status}, ${onInvoice(newer)})`;

        out.push({
          jobId: job.jobId,
          jobName: job.jobName,
          customerName: job.customerName,
          invoiceId: "",
          invoiceNumber: "",
          key: findingKey(kind, job.jobId, pairKey),
          kind,
          severity: sameNumber ? "error" : "warning",
          title: sameNumber
            ? `${a.vendor} invoice ${stemA} is on this job twice`
            : `${a.vendor} ${money(a.cost)} twice, ${Math.round(gapDays)} days apart`,
          detail:
            (sameNumber
              ? `Two bills carry the same ${a.vendor} invoice number: ${both}. A revised ` +
                `invoice replaces its original — void the superseded bill (deny it after ` +
                `removing its payments; never delete it).`
              : `Two ${a.vendor} bills for exactly ${money(a.cost)}: ${both}. That is often ` +
                `one invoice captured twice. If they are two real charges (a progress ` +
                `payment in halves, a monthly rental), record a ruling so this stays quiet.`) +
            (older.sentInvoiceIds.length && newer.sentInvoiceIds.length
              ? ` Both have reached the client: credit the duplicate on the next invoice.`
              : ""),
          amount: newer.cost,
          sourceLink: billLink(job.jobId, newer.id),
          target: { kind: "bill", billId: newer.id },
          sourceLabel: "Open the newer bill",
        });
      }
    }
    return out;
  },
});
