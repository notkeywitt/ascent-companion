---
slug: jobtread-qbo-sales-tax
repo: ascent-companion
branch: claude/jobtread-qbo-sales-tax-lfqctd
status: in-progress
started: 2026-09-05T05:30:35Z
updated: 2026-09-05T05:30:36Z
goal: 
next: 
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->

## Notes
- 2026-09-05 05:30 — Companion half of the sales-tax move. src/lib/salesTax.ts is the single definition: the 88 80 00 constants, the line matcher, splitSalesTax, and the job-Phase-derived recoverable/consumed flag. createVendorBill appends the tax line and pins nonRecoverableTax to 0; setBillTax now creates/updates/deletes that LINE and clears any legacy field.
- 2026-09-05 05:30 — billLineMath's gross-up is gone (reTax is 1). Its de-tax stays but is driven by the new legacyTaxField input, so only a pre-2026-09-05 bill is de-taxed. Callers strip the tax line before calling it — leaving it in would let the office edit sales tax as a material line.
- 2026-09-05 05:30 — MIGRATION IS ATOMIC WITH ANY SAVE. A legacy bill's line write sends de-taxed costs, so the bill page, the workbench and the Board's Sync all call /api/bill-tax in the same save when nonRecoverableTax > 0 — otherwise the bill total would drop by the tax.
- 2026-09-05 05:30 — Probed live 2026-09-05: an aliased costItems connection with a where on costCode.number and a sum over cost rides inside the paged documents connection without a 413 (document 22Pd4uDiixE2 returned count 1, costSum 54.04). That is how invoiceReview/evidence.ts reads each bill's tax line.
