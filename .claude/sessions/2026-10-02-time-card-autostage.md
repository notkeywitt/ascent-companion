---
slug: time-card-autostage
repo: ascent-companion
branch: claude/time-card-autostage
status: done
started: 2026-10-02T17:18:55Z
updated: 2026-10-15T22:00:00Z
goal: Tracking Sheets time card: stage edits as they are made (like bills), remove the Stage changes button
next: Clean up the Seth 9/16 and Wyatt 9/14 duplicate time entries in JobTread (the overlap guard stops new ones; it does not remove these).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-02 10:19 · `04c7149` companion: time card stages edits as they are made
  src/app/trackingsheet/TimeCodingCard.tsx
- 2026-10-02 11:56 · `dae0b44` companion: home donuts show invoiced vs approved price
  src/components/HomeJobBoard.tsx, src/lib/jobBoard.ts, src/lib/jobtread.ts
- 2026-10-02 11:58 · `574c970` companion: price/cost switch on home donuts
  src/components/HomeJobBoard.tsx
- 2026-10-02 12:19 · `5b11555` companion: time sync can match a record to jobtread when jobtread is right
  src/app/api/time-sync/retry/route.ts, src/app/time-sync/page.tsx, src/lib/timeProblems.ts, src/lib/timeSync.ts
- 2026-10-02 12:25 · `0750cfc` companion: forget button on the stuck-vendor notice untags the email and removes the bill's rows
  src/app/api/stuck-vendors/route.ts, src/components/StuckVendors.tsx
- 2026-10-02 12:42 · `f90e68b` companion: tracking sheets all-jobs view shows each job's month bill and labor rings
  src/app/api/trackingsheet/month-donuts/route.ts, src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/CostDonuts.tsx, src/app/trackingsheet/MonthJobDonuts.tsx, src/lib/monthCostByJob.ts
- 2026-10-12 09:00 · `f16c581` companion: bill coding dropdown names a line coded to an uncategorized or labor leaf instead of saying uncoded
  src/app/trackingsheet/BillCodingCard.tsx, src/components/CostCodeSelect.tsx

## Notes
- 2026-10-02 18:56 — Home board donuts now read invoiced (approved+pending customerInvoice, pre-tax) against approved price, not spent vs budget. JT's Invoiced figure includes tax, so it reads higher.
- 2026-10-02 19:10 — Unbilled rebuild (uncommitted): per-document method reads Velorum at $12,985 because invoices #16/#38/#42 were built by hand with no links to the bills/time they cover. Waiting on owner before shipping.
- 2026-10-02 19:26 — Shipped Time Sync 'JobTread is right' (f209c7d) and stuck-vendor Forget button (0750cfc). Both need appscript ./deploy.sh (d8b5f2c finalizeTimeEntryLog times, 4eccbeb forgetStuckBill).
- 2026-10-13 10:40 — a08a32d (phase default) shipped to main as a390004 via cherry-pick.
- 2026-10-15 — Branch closed. Every commit is on main: f16c581 = b67ba8c, a08a32d = a390004, 46d0c91 (overlap guard) = d45f4e8. The uncommitted /unbilled rebuild shipped as 069e18d; the leftover working-tree copy was discarded.
