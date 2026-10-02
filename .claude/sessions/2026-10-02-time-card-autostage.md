---
slug: time-card-autostage
repo: ascent-companion
branch: claude/time-card-autostage
status: shipped
started: 2026-10-02T17:18:55Z
updated: 2026-10-02T19:43:29Z
goal: Tracking Sheets time card: stage edits as they are made (like bills), remove the Stage changes button
next: Open /trackingsheet with no job on a phone and an iPad: check the per-job ring cards read right. Then decide how /unbilled treats hand-built invoices (rebuild still uncommitted in the working tree)
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

## Notes
- 2026-10-02 18:56 — Home board donuts now read invoiced (approved+pending customerInvoice, pre-tax) against approved price, not spent vs budget. JT's Invoiced figure includes tax, so it reads higher.
- 2026-10-02 19:10 — Unbilled rebuild (uncommitted): per-document method reads Velorum at $12,985 because invoices #16/#38/#42 were built by hand with no links to the bills/time they cover. Waiting on owner before shipping.
- 2026-10-02 19:26 — Shipped Time Sync 'JobTread is right' (f209c7d) and stuck-vendor Forget button (0750cfc). Both need appscript ./deploy.sh (d8b5f2c finalizeTimeEntryLog times, 4eccbeb forgetStuckBill).
