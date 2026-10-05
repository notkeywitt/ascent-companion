---
slug: jobtread-deposits-payments
repo: ascent-companion
branch: claude/jobtread-deposits-payments-0tc6pf
status: parked
started: 2026-10-05T06:08:48Z
updated: 2026-10-05T06:37:02Z
goal: Deposits and client payments (DEPOSITS_PLAN.md): Stages 1, 2 and half of 1b shipped; next the rest of 1b, then the Stage 4 apply-deposit write after the owner's go
next: Follow DEPOSITS_PLAN.md 'Next block, in order': (1) owner assigns Berger's $128,842 payment to Bunkhouse and enters Bunkhouse + Otis Perkins opening balances on the live deposit card, answers §6 items 1,2,5,7; (2) Stage 1b rest: computeUnbilled, getJobBoard invoicedByJob/leafPriceByJob (or-null on costCode, verify live via MCP), board rail; (3) with the owner's go: node scripts/probe-deposit-line.mjs --live, record answers in the plan, build POST /api/deposits/apply + Apply button, stop and ask before shipping; (4) Stage 3 appscript Deposits tab.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-05 06:09 · `36ad69e` companion: add the deposits and client payments plan
  CODEBASE_MAP.md, DEPOSITS_PLAN.md
- 2026-10-05 06:26 · `599dac5` companion: show a job's deposit and client payments on the tracking sheets board
  CODEBASE_MAP.md, DEPOSITS_PLAN.md, src/app/api/deposits/route.ts, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DepositCard.tsx, src/db/index.ts, +6 more
- 2026-10-05 06:33 · `5a1a2ec` companion: keep deposit lines out of the invoice review's cost and markup figures
  CODEBASE_MAP.md, DEPOSITS_PLAN.md, scripts/probe-deposit-line.mjs, src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/costBasis.ts, src/lib/invoiceReview/checks/margin.ts, +4 more

## Notes
- 2026-10-05 06:09 — Plan only, no code. JobTread documents the payment-application draw (Option 1); the plan recommends the CD line because 5 of 7 deposit payment applications in the org never linked to QuickBooks. check:map shows 34 pre-existing drift items (routes, db tables), not from this session.
- 2026-10-05 06:33 — Block 1 shipped: Stage 1 (ledger + read + /api/deposits + deposit_links), Stage 2 (DepositCard on /trackingsheet), Stage 1b review checks. Not checked in a browser (no sign-in in the cloud session). Probe for Stage 4 written, dry-run only; needs owner ok to run live on the Office job.
