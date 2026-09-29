---
slug: navigation-stage-0
repo: ascent-companion
branch: claude/navigation-stage-0
status: shipped
started: 2026-09-29T17:52:54Z
updated: 2026-09-29T18:03:55Z
goal: NAVIGATION_PLAN.md Stage 0: gate /api/time-off/import and /api/labor-report, re-gate + Add bill on recode, hide lead dead ends, month control on phones, carry ym/jobId, fix ?tab=drafts, npm test in pre-push, delete dead components
next: Stage 1 of NAVIGATION_PLAN.md needs the owner's 10 decisions first. Optional: delete RefreshProvider + RefreshBoundary (no caller since RefreshButton went).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-29 10:52 · `f959d38` companion: gate time-off import and labor report routes
  src/components/LaborReportButton.tsx, src/lib/billEditAccess.test.ts, src/lib/views.ts
- 2026-09-29 11:03 · `6091ba8` companion: fix stage 0 navigation dead ends
  src/app/bill/[docId]/page.tsx, src/app/invoicing-summary/page.tsx, src/app/labor-review/LaborReview.tsx, src/app/needs-project/page.tsx, src/app/payments/page.tsx, src/app/stage/page.tsx, +7 more
- 2026-09-29 11:03 · `13faacf` companion: run tests in pre-push, delete dead navigation code
  .githooks/pre-push, CODEBASE_MAP.md, src/app/admin/DigestInstructionsPanel.tsx, src/app/admin/page.tsx, src/app/trackingsheet/AllBills.tsx, src/app/trackingsheet/AllJobs.tsx, +5 more

## Notes
- 2026-09-29 18:03 — Stage 0 gates shipped alone in f959d38. Lead dead ends hidden, not widened: Add bill, Sunset bill links, job board Tracking sheet link, /stage Tracking Sheets link. /coding bill links left: page is retired, removed in stage 2. RefreshProvider now has no caller (useRefresh unused); remove it with layout.tsx later.
