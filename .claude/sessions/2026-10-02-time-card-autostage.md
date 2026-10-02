---
slug: time-card-autostage
repo: ascent-companion
branch: claude/time-card-autostage
status: shipped
started: 2026-10-02T17:18:55Z
updated: 2026-10-02T18:58:16Z
goal: Tracking Sheets time card: stage edits as they are made (like bills), remove the Stage changes button
next: Owner checks the home board: Price · Cost switch in the Active jobs heading flips every donut; VelorumVenture reads 98% invoiced on Price, 86% of budget on Cost; choice survives reload
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-02 10:19 · `04c7149` companion: time card stages edits as they are made
  src/app/trackingsheet/TimeCodingCard.tsx
- 2026-10-02 11:56 · `dae0b44` companion: home donuts show invoiced vs approved price
  src/components/HomeJobBoard.tsx, src/lib/jobBoard.ts, src/lib/jobtread.ts
- 2026-10-02 11:58 · `574c970` companion: price/cost switch on home donuts
  src/components/HomeJobBoard.tsx

## Notes
- 2026-10-02 18:56 — Home board donuts now read invoiced (approved+pending customerInvoice, pre-tax) against approved price, not spent vs budget. JT's Invoiced figure includes tax, so it reads higher.
