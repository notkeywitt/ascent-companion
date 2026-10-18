---
slug: page-consolidation-audit
repo: ascent-companion
branch: claude/page-consolidation-audit
status: shipped
started: 2026-10-18T17:20:28Z
updated: 2026-10-18T23:12:05Z
goal: audit admin and office pages, recommend merges
next: stage 4 rest: Customers (Leads + Directory customers), search finds jobs/customers; then stage 5 (Employees + Payroll)
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

## Notes
- 2026-10-18 17:21 — audit: 6 readers over every admin/office page; usage = Vercel server renders 30d (Web Analytics off). Report https://claude.ai/artifact/9i159BFud4dbuvjwVcgTbj
