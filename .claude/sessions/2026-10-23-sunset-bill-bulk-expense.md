---
slug: sunset-bill-bulk-expense
repo: ascent-companion
branch: claude/sunset-bill-bulk-expense-n6i0bh
status: shipped
started: 2026-10-23T17:06:32Z
updated: 2026-10-23T20:45:30Z
goal: 
next: owner runs the Sunset Statements 'Draft bills to expenses' switch; spot-check one switched bill reads purchase / qboAccountId 56
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-23 17:06 · `94a271b` companion: file sunset bills as expenses paid from banner bank, add bulk switch for drafts
  CODEBASE_MAP.md, src/app/api/add-bill/route.ts, src/app/api/bill-fields/route.ts, src/app/api/bill-status/route.ts, src/app/api/sunset-expense/route.ts, src/app/payments/page.tsx, +4 more
- 2026-10-23 20:45 · `f50c790` companion: file sunset credits as jobtread credits, in add-bill and the bulk switch
  src/app/api/add-bill/route.ts, src/app/api/sunset-expense/route.ts, src/components/SunsetExpenseSwitch.tsx, src/lib/jobtread.test.ts, src/lib/jobtread.ts

## Notes
