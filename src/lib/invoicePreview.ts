import type { Csi, Detail, Line } from "@/components/BillingSummary";
import { issueDateFor } from "@/lib/billingMonths";
import { money } from "@/lib/money";

/**
 * Roll a job's bills + time up into one row per CSI cost code (code asc). A
 * residual bucket absorbs document tax (rides outside line costs) plus any
 * uncoded amount so the CSI-grouped total always equals the panel total.
 */
export function groupCsi(lines: Line[], total: number): Csi[] {
  const map = new Map<string, { name: string; amount: number }>();
  let coded = 0;
  const add = (code: string, name: string, amount: number) => {
    if (!code) return;
    const prev = map.get(code);
    map.set(code, { name: name || prev?.name || "", amount: (prev?.amount ?? 0) + amount });
    coded += amount;
  };
  for (const l of lines) {
    for (const b of l.bills ?? []) for (const c of b.csi ?? []) add(c.code, c.name, c.amount);
    for (const t of l.timeEntries ?? []) add(t.code ?? "", t.codeName ?? "", t.cost);
  }
  const rows = Array.from(map.entries())
    .map(([code, v]) => ({ code, name: v.name, amount: v.amount }))
    // Sort by CSI code ascending (numeric-aware so "06 10 10" < "26 00 00").
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" }));
  const residual = total - coded;
  if (Math.abs(residual) > 0.005) rows.push({ code: "", name: "Uncoded / tax", amount: residual });
  return rows;
}

/** Washington sales tax on the client invoice: flat, on the whole subtotal. */
export const INVOICE_TAX_RATE = 0.0835;

/**
 * The month as JobTread's "Monthly Invoice" lays it out, BEFORE the
 * draft bills are approved and the invoice exists: CSI divisions with their
 * codes at cost, then Total Cost, Total Fee (the job's markup), Subtotal, Tax
 * and Total. Same data as printJob, so the office can review the client's
 * number while the bills are still drafts.
 *
 * It is a preview, never the invoice. No payments are shown: a draft has none,
 * so Balance Due is the Total.
 */
export function invoicePreviewHtml(
  detail: Detail,
  ym: string,
  { logoUrl = "", autoPrint = false }: { logoUrl?: string; autoPrint?: boolean } = {},
): string {
  const esc = (s: string) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const r2 = (n: number) => Math.round(n * 100 + 1e-6) / 100;
  const { customer, job, lines, total } = detail;
  const inv = detail.invoice;
  const divName = (code: string) => inv?.divisions[code] ?? "";
  const longDate = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const issue = issueDateFor(ym);
  const due = new Date(`${issue}T12:00:00`);
  due.setDate(due.getDate() + 28);

  // Codes into their divisions ("06 20 23" → "06 00 00"). A division with only
  // its own code prints as one plain row, the way JobTread prints Masonry.
  const divisions = new Map<string, Csi[]>();
  const uncoded: Csi[] = [];
  for (const c of groupCsi(lines, total)) {
    if (!c.code) uncoded.push(c);
    else {
      const d = `${c.code.slice(0, 2)} 00 00`;
      divisions.set(d, [...(divisions.get(d) ?? []), c]);
    }
  }
  const row = (cls: string, label: string, amount: number) =>
    `<tr class="${cls}"><td>${esc(label)}</td><td class="num">${money(amount)}</td></tr>`;
  const body = [...divisions.entries()]
    .map(([d, codes]) => {
      const sum = codes.reduce((s, c) => s + c.amount, 0);
      if (codes.length === 1 && codes[0].code === d) return row("solo", `${d} ${codes[0].name || divName(d)}`, sum);
      return (
        row("div", `${d} ${divName(d)}`, sum) +
        codes.map((c) => row("code", `${c.code} ${c.name}`, c.amount)).join("")
      );
    })
    .concat(uncoded.map((c) => row("solo flag", "Uncoded — code before invoicing", c.amount)))
    .join("");

  const fee = inv?.fee ?? 0;
  const subtotal = r2(total + fee);
  const tax = r2(subtotal * INVOICE_TAX_RATE);
  const grand = r2(subtotal + tax);
  const pct = inv ? `${r2((inv.markup - 1) * 100)}%` : "";
  const tot = (label: string, amount: number, cls = "") =>
    `<tr class="tot ${cls}"><td>${label}</td><td class="num">${money(amount)}</td></tr>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(["Invoice preview", customer?.name, job?.name].filter(Boolean).join(" - "))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1f2937; margin: 0; font-size: 13px; }
  .olive { color: #8a7f4e; }
  table.top, table.parties { margin: 0; border-bottom: 2px solid #f6f3e4; }
  table.top td, table.parties td { border: 0; padding: 8px 0; vertical-align: top; }
  table.parties td { width: 50%; line-height: 1.45; }
  .logo { width: 64px; height: 64px; }
  td.title { text-align: right; }
  .title h1 { font-size: 17px; margin: 0 0 4px; }
  .title div { font-size: 11px; line-height: 1.6; }
  .status { color: #b45309; font-weight: 700; font-size: 15px; margin-top: 2px; }
  .lbl { font-size: 12px; font-weight: 700; text-transform: uppercase; color: #8a7f4e; }
  .details { padding: 10px 0; border-bottom: 2px solid #f6f3e4; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { font-size: 12px; text-align: left; color: #8a7f4e; padding: 6px 8px; border-bottom: 2px solid #e5e7eb; }
  td { padding: 8px; border-bottom: 1px solid #e5e7eb; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tr.div td { background: #f3f4f6; font-weight: 700; }
  tr.div td.num { font-weight: 400; }
  tr.code td:first-child { padding-left: 16px; border-left: 3px solid #d1d5db; }
  tr.code td.num { border-right: 3px solid #d1d5db; }
  tr.flag td { color: #b91c1c; font-weight: 600; }
  tr.tot td { font-weight: 700; border-bottom: 1px solid #f6f3e4; }
  tr.tot td:first-child { text-align: right; text-transform: uppercase; font-size: 12px; color: #8a7f4e; padding-right: 40px; }
  .note { margin-top: 18px; font-size: 11px; color: #6b7280; }
  @page { margin: 0.6in; }
</style>
</head>
<body${autoPrint ? ' onload="window.focus(); window.print();"' : ""}>
  <table class="top"><tr>
    <td>${logoUrl ? `<img class="logo" src="${logoUrl}" alt="Ascent" />` : ""}</td>
    <td class="title">
      <h1>Monthly Invoice ${esc(inv?.jobNumber ? `${inv.jobNumber}-___` : "")}</h1>
      <div>Invoice Date ${longDate(issue)}</div>
      <div>Payment Due ${longDate(due.toISOString().slice(0, 10))}</div>
      <div class="status">DRAFT PREVIEW</div>
    </td>
  </tr></table>
  <table class="parties"><tr>
    <td>
      <div class="lbl">Prepared by</div>
      <b>Ascent Building Co.</b><br />(360) 209-4033<br />office@ascentbuildingco.com<br />4223 Center Rd, Lopez Island, WA 98261, USA
    </td>
    <td>
      <div class="lbl">Prepared for</div>
      <b>${esc(inv?.contactName || customer?.name || "")}</b><br />
      ${inv?.accountName ? `${esc(inv.accountName)}<br />` : ""}
      ${inv?.email ? `${esc(inv.email)}<br />` : ""}
      ${inv?.address ? esc(inv.address) : ""}
    </td>
  </tr></table>
  <div class="details">
    <div class="lbl">Monthly invoice details</div>
    <b>${esc(inv?.address || job?.name || "")}</b>
  </div>
  <table>
    <thead><tr><th>DESCRIPTION</th><th class="num">TOTAL</th></tr></thead>
    <tbody>
      ${body}
      ${tot("Total cost", total)}
      ${tot(`Total fee${pct ? ` (${pct})` : ""}`, fee)}
      ${tot("Subtotal", subtotal)}
      ${tot(`Tax (${r2(INVOICE_TAX_RATE * 100)}%)`, tax)}
      ${tot("Total", grand)}
      ${tot("Balance due", grand)}
    </tbody>
  </table>
  <div class="note">
    Preview built from ${esc(job?.name ?? "the job")}'s bills and time for ${esc(ym)}, drafts included.
    JobTread assigns the invoice number when the invoice is created.${inv ? "" : " No markup found: Total Fee is $0."}
  </div>
</body>
</html>`;
}
