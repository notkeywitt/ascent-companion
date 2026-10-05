---
slug: jobtread-deposits-payments
repo: ascent-companion
branch: claude/jobtread-deposits-payments-0tc6pf
status: parked
started: 2026-10-05T06:08:48Z
updated: 2026-10-05T12:29:43Z
goal: Deposits and client payments (DEPOSITS_PLAN.md): Stages 1, 2 and half of 1b shipped; next the rest of 1b, then the Stage 4 apply-deposit write after the owner's go
next: Stage 4 (apply a deposit to a draft invoice) is being built on branch claude/jobtread-deposits-payments-0tc6pf, NOT on main. It needs the owner's go to (a) run node scripts/probe-deposit-line.mjs --live on the Office job and (b) ship. Then Stage 3 (appscript Deposits tab; WebApp.js needs the owner's ok). Owner still to: assign Berger's $128,842 payment to Bunkhouse, enter Bunkhouse + Otis Perkins opening balances, answer DEPOSITS_PLAN.md §6.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-05 06:09 · `36ad69e` companion: add the deposits and client payments plan
  CODEBASE_MAP.md, DEPOSITS_PLAN.md
- 2026-10-05 06:26 · `599dac5` companion: show a job's deposit and client payments on the tracking sheets board
  CODEBASE_MAP.md, DEPOSITS_PLAN.md, src/app/api/deposits/route.ts, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DepositCard.tsx, src/db/index.ts, +6 more
- 2026-10-05 06:33 · `5a1a2ec` companion: keep deposit lines out of the invoice review's cost and markup figures
  CODEBASE_MAP.md, DEPOSITS_PLAN.md, scripts/probe-deposit-line.mjs, src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/costBasis.ts, src/lib/invoiceReview/checks/margin.ts, +4 more
- 2026-10-05 12:29 · `f7c794a` companion: keep deposit lines out of unbilled cost, the job board and the board rail
  CODEBASE_MAP.md, DEPOSITS_PLAN.md, src/lib/jobtread.test.ts, src/lib/jobtread.ts

## Notes
- 2026-10-05 06:09 — Plan only, no code. JobTread documents the payment-application draw (Option 1); the plan recommends the CD line because 5 of 7 deposit payment applications in the org never linked to QuickBooks. check:map shows 34 pre-existing drift items (routes, db tables), not from this session.
- 2026-10-05 06:33 — Block 1 shipped: Stage 1 (ledger + read + /api/deposits + deposit_links), Stage 2 (DepositCard on /trackingsheet), Stage 1b review checks. Not checked in a browser (no sign-in in the cloud session). Probe for Stage 4 written, dry-run only; needs owner ok to run live on the Office job.
