---
slug: jobtread-qbo-sales-tax
repo: ascent-companion
branch: claude/jobtread-qbo-sales-tax-lfqctd
status: shipped
started: 2026-09-05T05:30:35Z
updated: 2026-09-07T06:05:09Z
goal: 
next: Look at the new Home board on the wide monitor: card width, the donut's legend at 288px, and whether 9 active cards in a scroll row reads right.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-05 05:31 · `c5ffbe3` companion: sales tax is an 88 80 00 bill line, not the document tax field
  CODEBASE_MAP.md, src/app/api/add-bill/route.ts, src/app/api/amazon-import/route.ts, src/app/api/bill-tax/route.ts, src/app/api/bill/route.ts, src/app/api/trackingsheet/route.ts, +22 more
- 2026-09-05 05:31 · `6d1914d` log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-06 22:10 · `54bfdef` companion: drag-resizable trackingsheet columns, dimmer dark budget bars
  src/app/trackingsheet/Board.tsx, src/components/ui.tsx
- 2026-09-06 22:27 · `90134a9` companion: shared SplitGrid resizer, static bill header, invoice first
  src/app/trackingsheet/AllBills.tsx, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DraftQueue.tsx, src/components/SplitGrid.tsx
- 2026-09-06 22:32 · `b934399` companion: home job board — budget donut + calendar position
  CODEBASE_MAP.md, src/app/api/home/board/route.ts, src/app/page.tsx, src/components/HomeJobBoard.tsx, src/lib/jobBoard.test.ts, src/lib/jobBoard.ts, +1 more
- 2026-09-06 22:38 · `5ce8c18` companion: touch session ledger timestamp
- 2026-09-06 22:42 · `3445e76` companion: save writes JobTread only, sheet push is its own button
  src/app/trackingsheet/Board.tsx
- 2026-09-06 22:48 · `5703f0f` companion: desaturate dark budget bars, one centred closing row
  src/app/trackingsheet/Board.tsx, src/components/ui.tsx
- 2026-09-06 22:50 · `a68a83b` companion: drill into a home board card, by CSI division
  src/components/HomeJobBoard.tsx
- 2026-09-06 22:50 · `7f1b21b` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-06 22:57 · `cb3e9b8` companion: page through multi-page bill scans in the coding panel
  src/components/InvoiceViewer.tsx
- 2026-09-06 22:59 · `92a2274` companion: menus per row, buttons outside menus, drilldown on its own line
  src/app/page.tsx, src/components/HomeJobBoard.tsx, src/components/HomeLayoutEditor.tsx, src/components/NavLayoutProvider.tsx, src/lib/navLayout.test.ts, src/lib/navLayout.ts
- 2026-09-06 22:59 · `223a884` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-06 23:05 · `a183d86` companion: fix the menus-per-row row collapsing to one word per line
  src/components/HomeLayoutEditor.tsx

## Notes
- 2026-09-05 05:30 — Companion half of the sales-tax move. src/lib/salesTax.ts is the single definition: the 88 80 00 constants, the line matcher, splitSalesTax, and the job-Phase-derived recoverable/consumed flag. createVendorBill appends the tax line and pins nonRecoverableTax to 0; setBillTax now creates/updates/deletes that LINE and clears any legacy field.
- 2026-09-05 05:30 — billLineMath's gross-up is gone (reTax is 1). Its de-tax stays but is driven by the new legacyTaxField input, so only a pre-2026-09-05 bill is de-taxed. Callers strip the tax line before calling it — leaving it in would let the office edit sales tax as a material line.
- 2026-09-05 05:30 — MIGRATION IS ATOMIC WITH ANY SAVE. A legacy bill's line write sends de-taxed costs, so the bill page, the workbench and the Board's Sync all call /api/bill-tax in the same save when nonRecoverableTax > 0 — otherwise the bill total would drop by the tax.
- 2026-09-05 05:30 — Probed live 2026-09-05: an aliased costItems connection with a where on costCode.number and a sum over cost rides inside the paged documents connection without a 413 (document 22Pd4uDiixE2 returned count 1, costSum 54.04). That is how invoiceReview/evidence.ts reads each bill's tax line.
