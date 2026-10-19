/**
 * AN INVOICE LINE WHOSE TEXT NAMES A DIFFERENT COST CODE THAN ITS OWN.
 *
 * Built from Berger's invoices, where the line text and the line code disagree
 * often enough that the client asks about it:
 *   - "Shipping 01 71 23" billed under 01 71 13 (#002-221, #002-320).
 *   - "#8 Deck Screw … 06 10 20" billed under 07 46 23 — recoded on purpose in
 *     Casey's review, but the old code stayed in the text (#002-221).
 *   - "Trustile Slabs … 08 10 20" and "Delivery 01 71 23" under 08 10 30 (#002-379).
 *   - A $1,500 line described only "00 00 00" under 09 65 19 (#26-25).
 *
 * Each one is harmless arithmetic and an open question to a client who reads
 * the invoice beside the backup. A deliberate recode is fine — the text is what
 * is stale. One finding per invoice per pair of codes, so ten Sunset lines with
 * the same stale code are one thing to fix, not ten.
 */
import { defineInvoiceCheck } from "../checkTypes";
import { cents, findingKey, money, type Finding } from "../types";
import { isDepositLine } from "./shared";

export type LineCodeMismatchConfig = Record<string, never>;

/** "07 21 00S" and "07 21 00" are the same code family. */
const family = (code: string) => code.trim().toUpperCase().replace(/[A-Z]$/, "");

/** Every CSI-shaped code written in a piece of text: "06 10 20", "07 21 00S". */
export function codesInText(text: string): string[] {
  const out = new Set<string>();
  const re = /(?<![\d.])(\d{2}) (\d{2}) (\d{2})[A-Z]?(?![\d.])/g;
  for (const m of String(text ?? "").matchAll(re)) out.add(`${m[1]} ${m[2]} ${m[3]}`);
  return [...out];
}

export const lineCodeMismatchCheck = defineInvoiceCheck<LineCodeMismatchConfig>({
  id: "line-code-mismatch",
  title: "Line text names another cost code",
  description: "No invoice line's description names a different cost code than the one it is billed under.",
  kinds: ["invoice-line-code-mismatch"],
  scope: "invoice",
  run({ job, invoice: inv }) {
    const out: Finding[] = [];
    const groups = new Map<string, { said: string; billed: string; names: string[]; price: number }>();
    for (const l of inv.lines) {
      if (!l.code || isDepositLine(l)) continue;
      const billed = family(l.code);
      for (const said of codesInText(`${l.name} ${l.description}`)) {
        if (said === billed) continue;
        const k = `${said}>${billed}`;
        const g = groups.get(k) ?? { said, billed: l.code, names: [], price: 0 };
        g.names.push(l.name || l.description || "Unnamed line");
        g.price += l.price;
        groups.set(k, g);
      }
    }

    for (const [k, g] of groups) {
      const placeholder = g.said === "00 00 00";
      const n = g.names.length;
      out.push({
        jobId: job.jobId,
        jobName: job.jobName,
        customerName: job.customerName,
        invoiceId: inv.id,
        invoiceNumber: inv.number,
        key: findingKey("invoice-line-code-mismatch", job.jobId, `${inv.id}|${k}`),
        kind: "invoice-line-code-mismatch",
        severity: "warning",
        title: placeholder
          ? `Invoice #${inv.number || inv.id} — ${n} line${n === 1 ? " says" : "s say"} only "00 00 00"`
          : `Invoice #${inv.number || inv.id} — ${n} line${n === 1 ? " says" : "s say"} ${g.said}, billed under ${g.billed}`,
        detail:
          (placeholder
            ? `The text carries the placeholder code 00 00 00 and nothing a client can read. `
            : `The line text names ${g.said}, but the line is billed under ${g.billed}. `) +
          `Lines: ${g.names.slice(0, 6).join("; ")}${n > 6 ? `; and ${n - 6} more` : ""} ` +
          `(${money(cents(g.price))}). If the code was changed on purpose, update the text so ` +
          `it matches; if the text is right, the code is wrong.`,
        amount: Math.abs(cents(g.price)),
        sourceLink: inv.jtUrl,
        sourceLabel: "Open in JobTread",
      });
    }
    return out;
  },
});
