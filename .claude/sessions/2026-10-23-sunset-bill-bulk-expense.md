---
slug: sunset-bill-bulk-expense
repo: ascent-companion
branch: claude/sunset-bill-bulk-expense-n6i0bh
status: shipped
started: 2026-10-23T17:06:32Z
updated: 2026-10-23T21:12:16Z
goal: 
next: owner runs the Sunset Statements switch on the ~5 mixed drafts (717076, 719582, 719377, …); confirm each gets a <inv>-CR Credit with the PDF and the reconcile reads the net
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-23 17:06 · `94a271b` companion: file sunset bills as expenses paid from banner bank, add bulk switch for drafts
  CODEBASE_MAP.md, src/app/api/add-bill/route.ts, src/app/api/bill-fields/route.ts, src/app/api/bill-status/route.ts, src/app/api/sunset-expense/route.ts, src/app/payments/page.tsx, +4 more
- 2026-10-23 20:45 · `f50c790` companion: file sunset credits as jobtread credits, in add-bill and the bulk switch
  src/app/api/add-bill/route.ts, src/app/api/sunset-expense/route.ts, src/components/SunsetExpenseSwitch.tsx, src/lib/jobtread.test.ts, src/lib/jobtread.ts
- 2026-10-23 21:12 · `c3f3454` companion: split sunset returns onto their own credit, in add-bill and the bulk switch
  src/app/api/add-bill/route.ts, src/app/api/sunset-expense/route.ts, src/components/SunsetExpenseSwitch.tsx, src/lib/jobtread.test.ts, src/lib/jobtread.ts

## Notes
