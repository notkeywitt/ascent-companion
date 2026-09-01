/**
 * BACKUP COVERAGE — is everything billed to the client backed by a PDF on file,
 * and is everything on file accounted for?
 *
 * Four ways this goes wrong, and they are one check because they are one pass
 * over one folder: no folder at all short-circuits the rest (with no folder,
 * every per-file finding below is noise), and the missing/unmatched pair are
 * the two sides of a single pairing.
 */
import { defineJobCheck } from "../checkTypes";
import { cents, findingKey, money, type BackupFile, type Finding } from "../types";
import { dedupeName, matchBackup } from "./shared";

export interface BackupConfig {
  /** Report PDFs on file that no billed bill accounts for. Off makes the check
   *  one-directional — "is everything billed backed up" only. */
  reportUnmatchedFiles: boolean;
  /** Report two files with the same vendor and amount as a probable re-file. */
  reportDuplicates: boolean;
}

export const backupCheck = defineJobCheck<BackupConfig>({
  id: "backup",
  title: "Backup coverage",
  description: "Every bill billed to the client has its PDF filed, and every filed PDF is accounted for.",
  kinds: ["backup-folder-missing", "backup-missing", "backup-unmatched", "backup-duplicate"],
  scope: "job",
  run({ config, global, job, month }) {
    const out: Finding[] = [];
    const monthLabel = month.monthLabel;
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
    const { unmatchedBills, unmatchedFiles } = matchBackup(
      invoicedBills,
      job.folder.files,
      global.tolerance,
    );

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

    if (config.reportUnmatchedFiles) {
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
    }

    // Two files with the same name and amount are a re-file, not two charges —
    // and if both were billed, the client paid twice. Drive's own " (2)" suffix
    // is stripped first, since that is exactly how the second copy gets named.
    if (config.reportDuplicates) {
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
    }

    return out;
  },
});
