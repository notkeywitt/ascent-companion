---
slug: jobtread-qbo-sales-tax
repo: ascent-companion
branch: claude/jobtread-qbo-sales-tax-lfqctd
status: shipped
started: 2026-09-05T05:30:35Z
updated: 2026-09-08T18:14:14Z
goal: 
next: Owner to confirm the Record Tax toggle reads OFF on bill 115 in JobTread, then push HEAD:main.
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
- 2026-09-06 23:05 · `71ad740` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-06 23:10 · `8fdb7cd` companion: a real Gantt chart in the home board drilldown
  CODEBASE_MAP.md, src/app/api/home/gantt/route.ts, src/components/HomeJobBoard.tsx, src/components/JobGantt.tsx, src/lib/jobBoard.test.ts, src/lib/jobBoard.ts, +1 more
- 2026-09-06 23:10 · `e91f96c` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-06 23:14 · `0bed60b` companion: collapsible time groups, code-grouped by default on the board
  src/app/trackingsheet/Board.tsx, src/components/TimeEntryList.tsx
- 2026-09-06 23:16 · `0f639c9` companion: bigger time notes, pay rate on the entry panel, no panel title
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/TimeCodingCard.tsx, src/components/TimeEntryList.tsx
- 2026-09-06 23:22 · `cd31c84` companion: match labor row type to the bill rows beside it
  src/components/TimeEntryList.tsx
- 2026-09-06 23:22 · `61f55d8` companion: link every Gantt row into JobTread's own schedule
  src/components/HomeJobBoard.tsx, src/components/JobGantt.tsx, src/lib/jtLinks.test.ts, src/lib/jtLinks.ts
- 2026-09-06 23:22 · `057a8b9` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-06 23:25 · `628bba4` companion: calendar view for the labor list
  src/components/TimeEntryList.tsx, src/lib/timeEntryDates.test.ts, src/lib/timeEntryDates.ts
- 2026-09-08 06:07 · `8ff7eb2` companion: autosave lead tracking, regroup the lead card
  src/app/leads/page.tsx
- 2026-09-08 06:27 · `5fa33cb` companion: move project scope into job details
  src/app/leads/page.tsx
- 2026-09-08 09:30 · `36b93fd` companion: put a job picker on the add bill page
  src/app/add-bill/page.tsx
- 2026-09-08 09:30 · `4e0c1b3` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-08 09:57 · `e9b692a` companion: give every job-scoped page its own job picker
  src/app/chat/page.tsx, src/app/coding/page.tsx, src/app/labor-review/LaborReview.tsx, src/app/rfis/page.tsx, src/app/unbilled/page.tsx, src/components/JobPicker.tsx
- 2026-09-08 10:50 · `7bde0a8` companion: keep the tracking sheet on screen while it reloads
  src/app/trackingsheet/Board.tsx
- 2026-09-08 10:56 · `2b6c71a` companion: make the blue bill stripe mean reviewed and approved
  src/app/trackingsheet/AllBills.tsx, src/app/trackingsheet/Board.tsx, src/lib/billInvoiceState.test.ts, src/lib/billInvoiceState.ts
- 2026-09-08 11:08 · `2d7ac0b` companion: a save turns JobTread's Record Tax toggle back off
  src/app/bill/[docId]/page.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DraftWorkbench.tsx, src/lib/jobtread.ts, src/lib/salesTax.ts
- 2026-09-08 11:10 · `5f089b7` companion: probe script for the Record Tax toggle write
  scripts/probe-record-tax.mjs

## Notes
- 2026-09-05 05:30 — Companion half of the sales-tax move. src/lib/salesTax.ts is the single definition: the 88 80 00 constants, the line matcher, splitSalesTax, and the job-Phase-derived recoverable/consumed flag. createVendorBill appends the tax line and pins nonRecoverableTax to 0; setBillTax now creates/updates/deletes that LINE and clears any legacy field.
- 2026-09-05 05:30 — billLineMath's gross-up is gone (reTax is 1). Its de-tax stays but is driven by the new legacyTaxField input, so only a pre-2026-09-05 bill is de-taxed. Callers strip the tax line before calling it — leaving it in would let the office edit sales tax as a material line.
- 2026-09-05 05:30 — MIGRATION IS ATOMIC WITH ANY SAVE. A legacy bill's line write sends de-taxed costs, so the bill page, the workbench and the Board's Sync all call /api/bill-tax in the same save when nonRecoverableTax > 0 — otherwise the bill total would drop by the tax.
- 2026-09-05 05:30 — Probed live 2026-09-05: an aliased costItems connection with a where on costCode.number and a sum over cost rides inside the paged documents connection without a 413 (document 22Pd4uDiixE2 returned count 1, costSum 54.04). That is how invoiceReview/evidence.ts reads each bill's tax line.
- 2026-09-08 18:08 — Record Tax IS the document field nonRecoverableTaxName: a name means the row shows, null means off. Confirmed live 2026-09-08 by sampling 25 vendorBills — every bill created since the template default changed reads null, every older one reads "Tax". setBillTax now clears the name with the field, and needsTaxMigration on all three save surfaces widened to legacyTaxField > 0 || recordsTax so a toggle-on bill migrates even at 0.00.
- 2026-09-08 18:08 — Bill 240 (22Pd4uDiixE2) failed with 'You don't have permission to create a cost item' because the bill was marked paid, so JobTread would not accept a new cost item on it. Its two line updates went through; only the createCostItem for the tax line was refused. Not a grant-permission problem and not the missing 88 80 00 budget leaf.
- 2026-09-08 18:10 — Probed live 2026-09-08: updateDocument with nonRecoverableTax 0 + nonRecoverableTaxName null is accepted and leaves the document cost untouched (bill 115, 22PdwYuQV3VB: "Tax" -> null, cost 2485 -> 2485). scripts/probe-record-tax.mjs holds the probe and a --restore flag.
