---
slug: bookkeeping-record-keeping
repo: ascent-companion
branch: claude/bookkeeping-record-keeping-gn1dm7
status: in-progress
started: 2026-09-03T15:06:06Z
updated: 2026-09-03T15:17:25Z
goal: 
next: Owner review before this reaches production: it touches every JobTread write path, so CLAUDE.md's stop-and-ask rule applies. Then push branch:main and run /journal once to confirm financial_events created.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-03 15:06 · `9799b1d` companion: journal every write to a money record
  src/app/api/add-bill/route.ts, src/app/api/add-line/route.ts, src/app/api/bill-fields/route.ts, src/app/api/bill-issuedate/route.ts, src/app/api/bill-number/route.ts, src/app/api/bill-status/route.ts, +18 more
- 2026-09-03 15:10 · `d3bdd04` companion: check that a captured cost reached QuickBooks
  CODEBASE_MAP.md, src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/qboPush.ts, src/lib/invoiceReview/duplicateDraft.test.ts, src/lib/invoiceReview/evidence.ts, src/lib/invoiceReview/investigate.test.ts, +7 more
- 2026-09-03 15:17 · `117b87e` companion: show what clients owe, aged
  CODEBASE_MAP.md, src/app/api/ar-aging/route.ts, src/app/ar-aging/page.tsx, src/lib/arAging.test.ts, src/lib/arAging.ts, src/lib/jobtread.ts, +2 more

## Notes
- 2026-09-03 15:06 — Three bookkeeping gaps, from the record-keeping review: (1) an append-only financial journal over every JobTread write, (2) a check that the JobTread to QuickBooks handoff actually happened, (3) an AR aging view.
