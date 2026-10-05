---
slug: jobtread-deposits-payments
repo: ascent-companion
branch: claude/jobtread-deposits-payments-0tc6pf
status: shipped
started: 2026-10-05T06:08:48Z
updated: 2026-10-05T06:26:10Z
goal: Plan deposit and client-payment handling: what Pave offers, what each job does today, staged build plan
next: Stage 1b (DEPOSITS_PLAN.md): keep CD lines out of computeUnbilled, getJobBoard invoicedByJob/leafPriceByJob, the board rail, and the review's costBasis/margin/norms checks — one test per figure. Then open /trackingsheet on Bunkhouse and Otis Perkins to check the deposit card live (assign Berger's $128,842 payment, enter Ferron's opening balance once the owner gives it).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-05 06:09 · `36ad69e` companion: add the deposits and client payments plan
  CODEBASE_MAP.md, DEPOSITS_PLAN.md
- 2026-10-05 06:26 · `599dac5` companion: show a job's deposit and client payments on the tracking sheets board
  CODEBASE_MAP.md, DEPOSITS_PLAN.md, src/app/api/deposits/route.ts, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DepositCard.tsx, src/db/index.ts, +6 more

## Notes
- 2026-10-05 06:09 — Plan only, no code. JobTread documents the payment-application draw (Option 1); the plan recommends the CD line because 5 of 7 deposit payment applications in the org never linked to QuickBooks. check:map shows 34 pre-existing drift items (routes, db tables), not from this session.
