---
slug: page-consolidation-audit
repo: ascent-companion
branch: claude/page-consolidation-audit
status: shipped
started: 2026-10-18T17:20:28Z
updated: 2026-10-19T03:12:07Z
goal: audit admin and office pages, recommend merges
next: desktop polish stage 2: Page widths + header + one Tabs + sidebar active + names (show screenshots before shipping)
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-18 17:21 · `4771107` companion: add page consolidation plan from the admin and office page audit
  CODEBASE_MAP.md, CONSOLIDATION_PLAN.md, NAVIGATION_PLAN.md
- 2026-10-18 17:32 · `f7686fc` companion: record the owner's answers on the page consolidation plan
  CONSOLIDATION_PLAN.md
- 2026-10-18 17:50 · `d9260b2` companion: give the office phone a pages list in the account menu
  src/components/AppHeader.tsx, src/components/AppMenu.tsx, src/lib/help.ts
- 2026-10-18 17:59 · `48e603e` companion: stage 0 fixes — gate eight routes, void wording, touch closing actions, admin tab colour
  CONSOLIDATION_PLAN.md, src/app/admin/page.tsx, src/app/amazon-import/page.tsx, src/app/bill/[docId]/page.tsx, src/app/historical-cost/page.tsx, src/app/requisitions/page.tsx, +8 more
- 2026-10-18 21:48 · `90f8a27` companion: open bills in place below xl and from add bill, with paging and a full page link
  CONSOLIDATION_PLAN.md, src/app/add-bill/page.tsx, src/app/trackingsheet/AllBills.tsx, src/app/trackingsheet/BillPopup.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/CodeLanesView.tsx
- 2026-10-18 21:58 · `6b9906c` companion: approve, void and review flag in the bill popup; summary mode opens bills in place
  CONSOLIDATION_PLAN.md, src/app/trackingsheet/BillPopup.tsx, src/app/trackingsheet/BillingSummaryView.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DraftWorkbench.tsx, src/components/BillingSummary.tsx
- 2026-10-18 22:03 · `9c09644` companion: invoicing tab row; fold bill corrections and taxable flags into checks
  CODEBASE_MAP.md, CONSOLIDATION_PLAN.md, next.config.mjs, src/app/invoice-review/InvoiceReview.tsx, src/app/invoicing-summary/page.tsx, src/app/needs-review/FlaggedBills.tsx, +10 more
- 2026-10-18 22:07 · `93b97ae` companion: move the invoicing email button onto the package tab
  CONSOLIDATION_PLAN.md, src/app/invoicing-summary/page.tsx, src/app/trackingsheet/AllJobs.tsx, src/components/PackageEmail.tsx
- 2026-10-18 22:17 · `6a3b328` companion: finalize a job's sheet from its workbench; sheet sync settings move to company tools
  CONSOLIDATION_PLAN.md, src/app/tracking-sheet/page.tsx, src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/Board.tsx, src/lib/workspaces.ts
- 2026-10-18 22:20 · `80403af` companion: invoicing tabs carry the month on screen; tracking sheets honours the set billing month
  CONSOLIDATION_PLAN.md, src/app/invoice-review/InvoiceReview.tsx, src/app/invoicing-summary/page.tsx, src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/Board.tsx, src/components/InvoicingTabs.tsx
- 2026-10-18 22:55 · `c1c4b2f` companion: fold labor review into the tracking sheets labor panel
  CODEBASE_MAP.md, CONSOLIDATION_PLAN.md, next.config.mjs, src/app/labor-review/LaborReview.tsx, src/app/labor-review/page.tsx, src/app/trackingsheet/Board.tsx, +3 more
- 2026-10-18 23:00 · `8e66be9` companion: one incoming bills inbox — to log, stuck and check mail as sections
  CONSOLIDATION_PLAN.md, next.config.mjs, src/app/email/EmailInvoices.tsx, src/app/email/Inbox.tsx, src/app/email/page.tsx, src/app/needs-project/NotInJobTread.tsx, +7 more
- 2026-10-18 23:03 · `921af53` companion: add an invoices to log row to home
  src/components/TodayQueue.tsx
- 2026-10-18 23:04 · `d3378e3` companion: record stage 3 status
  CONSOLIDATION_PLAN.md
- 2026-10-18 23:08 · `eab0077` companion: check all jobs opens checks; drop the second findings list from tracking sheets
  src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/CheckAllJobs.tsx
- 2026-10-18 23:12 · `aae85a2` companion: job tab row across a job's pages; clients workspace becomes jobs
  CONSOLIDATION_PLAN.md, src/app/budget-import/page.tsx, src/app/clients/ClientsBrowser.tsx, src/app/job-board/JobBoardPage.tsx, src/app/jobs/JobsBrowser.tsx, src/app/specs/page.tsx, +5 more
- 2026-10-18 23:15 · `d639935` companion: customers page — leads and all customers as sections; directory off the menu
  CONSOLIDATION_PLAN.md, src/app/clients/ClientsBrowser.tsx, src/app/leads/Customers.tsx, src/app/leads/LeadsBoard.tsx, src/app/leads/page.tsx, src/lib/copy.ts, +2 more
- 2026-10-18 23:18 · `c5a6385` companion: header search finds jobs and opens their record
  CONSOLIDATION_PLAN.md, src/components/GlobalSearch.tsx
- 2026-10-18 23:37 · `072e734` companion: payroll page — time off, sync gaps and labor import as sections; people workspace dissolves
  CONSOLIDATION_PLAN.md, next.config.mjs, src/app/labor-import/LaborImport.tsx, src/app/payroll/Payroll.tsx, src/app/payroll/page.tsx, src/app/time-off/TimeOff.tsx, +10 more
- 2026-10-18 23:42 · `dc79e17` companion: retire actions, rfis and course; script buttons move beside what they update
  CONSOLIDATION_PLAN.md, next.config.mjs, src/app/course/CourseHome.tsx, src/app/course/[seg]/page.tsx, src/app/course/page.tsx, src/app/course/segments.tsx, +10 more
- 2026-10-18 23:46 · `9d6c906` companion: audit, look and text, and help as one menu row each, joined by tab rows
  CONSOLIDATION_PLAN.md, src/app/admin/copy/page.tsx, src/app/changelog/page.tsx, src/app/help/HelpBrowser.tsx, src/app/journal/page.tsx, src/app/logs/page.tsx, +4 more
- 2026-10-19 00:05 · `3adc369` companion: payroll pay period section — time entries email and miles pdf on one picker
  CONSOLIDATION_PLAN.md, src/app/payroll/PayPeriod.tsx, src/app/payroll/Payroll.tsx
- 2026-10-19 00:09 · `29c313a` companion: look pass — hairline lists and fewer pills on requisitions, feedback, logs, employees, tools
  CONSOLIDATION_PLAN.md, src/app/employees/page.tsx, src/app/logs/page.tsx, src/app/requests/page.tsx, src/app/requisitions/page.tsx, src/app/tools/page.tsx
- 2026-10-19 00:12 · `66891b2` companion: bill search as one hairline list; archive reads ?q
  CONSOLIDATION_PLAN.md, src/app/bill-search/BillSearch.tsx, src/app/expenditure-history/ExpenditureBrowser.tsx
- 2026-10-19 00:37 · `ac1754f` companion: employee pay types edit as one ordered list, saved like pay rates
  CONSOLIDATION_PLAN.md, src/app/employees/JobTreadSections.tsx
- 2026-10-19 00:40 · `0b76a03` companion: leads show quiet days as text until they cross the warning line
  src/app/leads/LeadsBoard.tsx
- 2026-10-19 01:20 · `afe7fec` companion: historical cost bill opens as a popup on the tracking sheets budget rail
  src/app/historical-cost/HistoricalCost.tsx, src/app/historical-cost/page.tsx, src/app/trackingsheet/SheetGap.tsx
- 2026-10-19 01:21 · `4c05ed5` companion: job overview tab — schedule, budget and cost by division for one job
  CONSOLIDATION_PLAN.md, src/app/job-board/JobBoardPage.tsx, src/app/job-board/[id]/page.tsx, src/components/GlobalSearch.tsx, src/components/HomeJobBoard.tsx, src/components/JobTabs.tsx
- 2026-10-19 01:24 · `cf207f3` companion: check mail counts processed and not-an-invoice mail as handled
  CONSOLIDATION_PLAN.md, src/app/api/vendor-mail/route.ts, src/app/vendor-mail/VendorMail.tsx
- 2026-10-19 03:12 · `0d04566` companion: polish foundation — no stretched buttons, readable quiet text in dark, visible spinner, bordered banners, outline disabled buttons
  CONSOLIDATION_PLAN.md, src/app/globals.css, src/app/time-off/TimeOff.tsx, src/app/trackingsheet/MonthJobDonuts.tsx, src/components/HomeJobBoard.tsx, src/components/Spinner.tsx, +1 more

## Notes
- 2026-10-18 17:21 — audit: 6 readers over every admin/office page; usage = Vercel server renders 30d (Web Analytics off). Report https://claude.ai/artifact/9i159BFud4dbuvjwVcgTbj
