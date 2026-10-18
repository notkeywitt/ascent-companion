---
slug: page-consolidation-audit
repo: ascent-companion
branch: claude/page-consolidation-audit
status: shipped
started: 2026-10-18T17:20:28Z
updated: 2026-10-18T22:17:05Z
goal: audit admin and office pages, recommend merges
next: stage 2 rest: email button onto Package, Check all Jobs into Checks, Labor Review + Finalize into the workbench, shared month default
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

## Notes
- 2026-10-18 17:21 — audit: 6 readers over every admin/office page; usage = Vercel server renders 30d (Web Analytics off). Report https://claude.ai/artifact/9i159BFud4dbuvjwVcgTbj
