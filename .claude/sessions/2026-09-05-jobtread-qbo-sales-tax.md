---
slug: jobtread-qbo-sales-tax
repo: ascent-companion
branch: claude/jobtread-qbo-sales-tax-lfqctd
status: shipped
started: 2026-09-05T05:30:35Z
updated: 2026-09-10T05:06:02Z
goal: bill move: background + Drive re-file + real error; buyback picker dialog; approve advances; cost-code names on the bills list
next: verify on Ferron in /trackingsheet: Sheet vs JobTread panel — 08 50 00 should read matched under Spend, and Estimate should compare REVISED TOTAL (col AU) to the rail budget
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
- 2026-09-08 11:30 · `5e776c5` companion: run bill moves in the background, and rework buyback into a picker
  src/app/bill/[docId]/page.tsx, src/app/layout.tsx, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DraftWorkbench.tsx, src/components/BillMove.tsx
- 2026-09-08 11:43 · `374389f` companion: stop the coding card ending below the viewport, and buy back a whole bill
  src/app/api/shop-job/route.ts, src/app/globals.css, src/app/trackingsheet/BillCodingCard.tsx
- 2026-09-08 11:56 · `601d3f8` companion: cap the coding column by measurement, not by guess
  src/app/globals.css, src/app/trackingsheet/BillCodingCard.tsx, src/components/StickyActionBar.tsx, src/components/ui.tsx
- 2026-09-08 12:24 · `70ea62c` companion: link time entries to jobtread and edit their labor rate
  scripts/probe-time-entry-type.mjs, src/app/api/time-entry/route.ts, src/app/trackingsheet/TimeCodingCard.tsx, src/components/TimeEntryList.tsx, src/lib/jobtread.ts, src/lib/jtLinks.test.ts, +1 more
- 2026-09-09 11:09 · `dc2c047` companion: say why an add-bill upload failed
  src/app/add-bill/page.tsx, src/app/api/add-bill/route.ts, src/lib/claudeExtract.ts
- 2026-09-09 12:24 · `9858d46` companion: compare a re-sent invoice against the bill on file
  src/app/add-bill/page.tsx, src/app/api/add-bill/route.ts, src/lib/billing.test.ts, src/lib/billing.ts, src/lib/jobtread.ts
- 2026-09-09 12:51 · `c7214b9` companion: warn before leaving a running invoice upload
  src/app/add-bill/page.tsx
- 2026-09-09 12:54 · `744aa7c` companion: dock the tracking sheet commit bar in the lower right
  src/app/trackingsheet/Board.tsx, src/components/StickyActionBar.tsx
- 2026-09-09 13:29 · `26b2ffa` companion: code buybacks to 99 20 00 on the Shop job
  src/lib/jobtread.ts
- 2026-09-09 13:29 · `ef00694` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-09 13:33 · `8ae8e49` companion: refuse a bill replace it cannot do completely
  src/app/api/add-bill/route.ts, src/lib/jobtread.ts
- 2026-09-09 13:40 · `2debcca` companion: the billing month is a dropdown, and home leads with what the month invoices
  CODEBASE_MAP.md, src/app/api/add-bill/route.ts, src/app/api/billing-month/route.ts, src/app/api/invoice-review/run/route.ts, src/app/api/jobs/to-be-invoiced/route.ts, src/components/HomeJobBoard.tsx, +6 more
- 2026-09-09 13:44 · `c7dc974` companion: bill editing is office+admin, and quickbooks freezes a bill
  src/app/api/add-line/route.ts, src/app/api/bill-duedate/route.ts, src/app/api/bill-fields/route.ts, src/app/api/bill-issuedate/route.ts, src/app/api/bill-number/route.ts, src/app/api/bill-status/route.ts, +12 more
- 2026-09-09 13:47 · `9cf75ab` companion: round a half-cent the way JobTread does
  src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/invoiceMath.ts, src/lib/invoiceReview/types.ts
- 2026-09-09 14:03 · `b8d99f9` companion: lift the tracking sheet's closing actions to the top on desktop
  src/app/trackingsheet/Board.tsx
- 2026-09-09 14:04 · `ff77a53` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-09 14:15 · `574010e` companion: keep sales tax out of what the client is billed
  CODEBASE_MAP.md, src/app/trackingsheet/AllBills.tsx, src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/salesTaxLine.ts, src/lib/invoiceReview/registry.ts, src/lib/invoiceReview/settings.ts, +2 more
- 2026-09-09 18:38 · `3d64b2c` companion: replace a bill's invoice instead of stacking a second one
  src/app/api/add-bill/route.ts, src/lib/jobtread.ts
- 2026-09-09 18:38 · `1e9e921` companion: add sync-all-tracking-sheets button when no job selected
  src/app/trackingsheet/AllJobs.tsx, src/components/TrackingSheetSync.tsx
- 2026-09-09 19:49 · `47230b7` companion: show the tracking-sheet vs JobTread gap in the budget rail
  src/app/historical-cost/page.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/SheetGap.tsx
- 2026-09-09 20:51 · `2fa3076` companion: count the historical bill, and compare estimates, in the sheet gap panel
  src/app/historical-cost/page.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/SheetGap.tsx
- 2026-09-09 21:53 · `116db7b` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-09 21:56 · `0e360d8` companion: create a record PDF for a bill with no invoice file
  src/app/api/bill/create-file/route.ts, src/app/trackingsheet/BillCodingCard.tsx, src/lib/billPdf.test.ts, src/lib/billPdf.ts
- 2026-09-09 21:58 · `cac8c7c` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-09 21:59 · `8aa92e3` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-09 22:00 · `d4b8a74` companion: log session 2026-09-05-jobtread-qbo-sales-tax
- 2026-09-09 22:00 · `88b657b` companion: log session 2026-09-05-jobtread-qbo-sales-tax

## Notes
- 2026-09-05 05:30 — Companion half of the sales-tax move. src/lib/salesTax.ts is the single definition: the 88 80 00 constants, the line matcher, splitSalesTax, and the job-Phase-derived recoverable/consumed flag. createVendorBill appends the tax line and pins nonRecoverableTax to 0; setBillTax now creates/updates/deletes that LINE and clears any legacy field.
- 2026-09-05 05:30 — billLineMath's gross-up is gone (reTax is 1). Its de-tax stays but is driven by the new legacyTaxField input, so only a pre-2026-09-05 bill is de-taxed. Callers strip the tax line before calling it — leaving it in would let the office edit sales tax as a material line.
- 2026-09-05 05:30 — MIGRATION IS ATOMIC WITH ANY SAVE. A legacy bill's line write sends de-taxed costs, so the bill page, the workbench and the Board's Sync all call /api/bill-tax in the same save when nonRecoverableTax > 0 — otherwise the bill total would drop by the tax.
- 2026-09-05 05:30 — Probed live 2026-09-05: an aliased costItems connection with a where on costCode.number and a sum over cost rides inside the paged documents connection without a 413 (document 22Pd4uDiixE2 returned count 1, costSum 54.04). That is how invoiceReview/evidence.ts reads each bill's tax line.
- 2026-09-08 18:08 — Record Tax IS the document field nonRecoverableTaxName: a name means the row shows, null means off. Confirmed live 2026-09-08 by sampling 25 vendorBills — every bill created since the template default changed reads null, every older one reads "Tax". setBillTax now clears the name with the field, and needsTaxMigration on all three save surfaces widened to legacyTaxField > 0 || recordsTax so a toggle-on bill migrates even at 0.00.
- 2026-09-08 18:08 — Bill 240 (22Pd4uDiixE2) failed with 'You don't have permission to create a cost item' because the bill was marked paid, so JobTread would not accept a new cost item on it. Its two line updates went through; only the createCostItem for the tax line was refused. Not a grant-permission problem and not the missing 88 80 00 budget leaf.
- 2026-09-08 18:10 — Probed live 2026-09-08: updateDocument with nonRecoverableTax 0 + nonRecoverableTaxName null is accepted and leaves the document cost untouched (bill 115, 22PdwYuQV3VB: "Tax" -> null, cost 2485 -> 2485). scripts/probe-record-tax.mjs holds the probe and a --restore flag.
- 2026-09-08 18:24 — Move-bill failure 'Void+recreate did not complete' is a swallowed reason — every failure inside syncExpenditureUpdateToJobTread returns null and writes the cause to the Audit Log only. _companionReassignJob now reads back the row Status + the newest Audit Log line for that ExpID and returns it. Needs a clasp push to take effect; read /logs (listSystemLogs) meanwhile.
- 2026-09-08 18:24 — Drive folder on a move: verified. A bill's folder is a pure function of the Expenditure row (reconcileDriveFiling), so setting Project ID IS the re-file — there is no re-file flag despite three comments saying so. It only ran on the hourly pass, so the backup sat in the old job's folder for up to an hour. reconcileDriveFiling now takes { onlyExpId } and the reassign runs it for that one row before returning.
- 2026-09-08 19:07 — time & labor: per-entry JT link (timeEntryId param, owner-supplied) + labor-rate (pay type) edit on the coding panel. Probed live: updateTimeEntry type re-rates the entry (85->95/h, cost 170->190, minutes unchanged); an unknown type is 400. Rate field is office/admin only in /api/time-entry.
- 2026-09-09 20:40 — home: SPENT AGAINST BUDGET replaced by TO BE INVOICED for the current billing month (sum of /api/jobs/to-be-invoiced over the board's active jobs); each card carries its own amount in the top-right corner. Billing period is now a dropdown (office/admin) backed by billing_month_setting — it overrides the 10th cutoff for every non-Sunset bill via deriveBillingPeriod's new overrideYm, and goes red past the 10th while behind the calendar. NOT pushed: touches /api/add-bill, a JobTread write path.
- 2026-09-09 20:48 — invoice #382 math-line was a false positive: cents() rounded a negative half-cent toward +inf, and invoice-math compared in dollars instead of whole cents. Fixed in types.ts + checks/invoiceMath.ts, committed 9cf75ab, NOT pushed (push blocked).
- 2026-09-09 21:14 — Create File: a NO FILE bill can now generate its own Ascent-branded record PDF (src/lib/billPdf.ts, hand-rolled — no PDF dependency) and attach it in JobTread via POST /api/bill/create-file. New JobTread write path, so it is NOT pushed without the owner's ok.
- 2026-09-10 01:34 — add-bill replace now detaches the superseded scan(s) after attaching the revised one — two PDFs on a bill made the mirror rename the OLD one (first pdf = primary) and file both in Drive. Bill 22PdHU9CtwhE still carries both: old file id 22PdHU9FedEK needs deleting by hand.
