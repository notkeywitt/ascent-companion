---
slug: jobtread-deposits-payments
repo: ascent-companion
branch: claude/jobtread-deposits-payments-0tc6pf
status: parked
started: 2026-10-05T06:08:48Z
updated: 2026-10-05T13:59:31Z
goal: Deposits and client payments (DEPOSITS_PLAN.md): Stages 1, 2 and half of 1b shipped; next the rest of 1b, then the Stage 4 apply-deposit write after the owner's go
next: Watch the first real deposit draw (Berger's September invoice) — if it reports 'totals did not move as planned', run scripts/probe-deposit-line.mjs --live locally and record the answers in DEPOSITS_PLAN.md. Owner: assign Berger's $128,842 payment to Bunkhouse, enter Bunkhouse + Otis Perkins opening balances, answer §6. Then Stage 3 (appscript Deposits tab; WebApp.js needs the owner's ok).
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
- 2026-10-05 13:59 · `f09e6af` companion: record the deposit draw as shipped in the plan and the map
  CODEBASE_MAP.md, DEPOSITS_PLAN.md

## Notes
- 2026-10-05 06:09 — Plan only, no code. JobTread documents the payment-application draw (Option 1); the plan recommends the CD line because 5 of 7 deposit payment applications in the org never linked to QuickBooks. check:map shows 34 pre-existing drift items (routes, db tables), not from this session.
- 2026-10-05 06:33 — Block 1 shipped: Stage 1 (ledger + read + /api/deposits + deposit_links), Stage 2 (DepositCard on /trackingsheet), Stage 1b review checks. Not checked in a browser (no sign-in in the cloud session). Probe for Stage 4 written, dry-run only; needs owner ok to run live on the Office job.
- 2026-10-05 12:38 — Block 2: shipped the rest of Stage 1b (d1fa0df). Stage 4 back end built + 996 tests green, held on local branch stage4-apply-deposit; wiring the card was blocked by the auto-mode classifier (production deploy) pending the owner's explicit go.
