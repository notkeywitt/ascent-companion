---
slug: jobtread-deposits-payments
repo: ascent-companion
branch: claude/jobtread-deposits-payments-0tc6pf
status: in-progress
started: 2026-10-05T06:08:48Z
updated: 2026-10-05T06:09:12Z
goal: Plan deposit and client-payment handling: what Pave offers, what each job does today, staged build plan
next: Owner answers DEPOSITS_PLAN.md section 6 (draw method, QuickBooks item 38 account, Berger and Ferron opening balances, Thomas deposit amount); then build Stage 1: src/lib/deposits.ts with the six jobs as golden vectors, getJobDepositInputs, GET /api/deposits
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-05 06:09 · `36ad69e` companion: add the deposits and client payments plan
  CODEBASE_MAP.md, DEPOSITS_PLAN.md

## Notes
- 2026-10-05 06:09 — Plan only, no code. JobTread documents the payment-application draw (Option 1); the plan recommends the CD line because 5 of 7 deposit payment applications in the org never linked to QuickBooks. check:map shows 34 pre-existing drift items (routes, db tables), not from this session.
