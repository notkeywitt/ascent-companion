---
slug: billing-month
repo: ascent-companion
branch: ship/billing-month
status: shipped
started: 2026-09-10T15:22:41Z
updated: 2026-09-11T13:15:27Z
goal: 
next: verify on desktop /trackingsheet: hover a donut slice for its top-5 bills, and check the closing actions appear in the commit bar only near the lower-right corner
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-10 08:41 · `a030aad` companion: point the invoicing package at the billing month on home
  src/app/api/invoicing-summary/route.ts, src/lib/invoiceReview/types.ts
- 2026-09-10 08:42 · `7efeba3` companion: log the invoicing package session
  SESSIONS.md, src/lib/sessionLog.generated.json
- 2026-09-10 09:18 · `c651631` companion: give the invoicing package build five minutes
  src/app/api/invoicing-summary/route.ts, src/app/invoicing-summary/page.tsx
- 2026-09-10 09:56 · `d02214a` companion: open the invoicing package on cached figures
  src/app/api/invoicing-summary/route.ts, src/app/invoicing-summary/page.tsx
- 2026-09-10 10:14 · `5b81e7b` companion: stop asking Apps Script for longer than it will answer
  src/app/api/invoicing-summary/route.ts, src/app/invoicing-summary/page.tsx, src/lib/appsScript.test.ts, src/lib/appsScript.ts
- 2026-09-10 10:38 · `95146c4` companion: sink Ascent's own jobs to the bottom of the invoicing package
  src/app/invoicing-summary/page.tsx
- 2026-09-10 10:56 · `a112d77` companion: brand the cost rings olive and ochre, and fold the small slices
  CLAUDE.md, THEME.md, src/app/globals.css, src/app/trackingsheet/CostDonuts.tsx
- 2026-09-10 11:12 · `51b0199` companion: swap the chart palette for Tableau 10, muted
  CLAUDE.md, THEME.md, src/app/globals.css, src/app/trackingsheet/CostDonuts.tsx
- 2026-09-10 11:30 · `b86def5` companion: catch a stray isTaxable flag on a vendor bill
  CODEBASE_MAP.md, src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/taxableFlag.ts, src/lib/invoiceReview/duplicateDraft.test.ts, src/lib/invoiceReview/evidence.ts, src/lib/invoiceReview/investigate.test.ts, +8 more
- 2026-09-10 11:50 · `85af182` companion: write bill lines taxable, so the client invoice taxes them
  src/lib/billing.ts, src/lib/jobtread.test.ts, src/lib/jobtread.ts
- 2026-09-10 12:03 · `7ad81a7` companion: list the bill lines a client invoice will not tax
  CODEBASE_MAP.md, src/app/api/taxable-lines/route.ts, src/app/taxable-lines/TaxableLinesBrowser.tsx, src/app/taxable-lines/page.tsx, src/lib/jobtread.ts, src/lib/nav.ts, +3 more
- 2026-09-10 12:24 · `82f5cb6` companion: split the taxable-flag worklist by which document carries it
  CODEBASE_MAP.md, src/app/api/taxable-lines/route.ts, src/app/taxable-lines/TaxableLinesBrowser.tsx, src/lib/jobtread.ts, src/lib/taxableLines.test.ts, src/lib/taxableLines.ts
- 2026-09-10 21:40 · `35a5443` companion: pick a clock time from a list instead of typing it
  src/app/employee-time/EmployeeTimeClient.tsx
- 2026-09-11 05:57 · `e185c8e` companion: quiet the budget rail and open the cost rings
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/CostDonuts.tsx, src/components/Donut.tsx, src/components/StickyActionBar.tsx
- 2026-09-11 06:03 · `b87ce24` companion: name the codes behind a ring's "Other" slice
  src/app/trackingsheet/CostDonuts.tsx, src/components/Donut.tsx
- 2026-09-11 06:04 · `2aebe36` companion: open the commit bar on hover, not on approach
  src/app/trackingsheet/Board.tsx
- 2026-09-11 06:08 · `487b19b` companion: open a time entry on its job's time page
  src/app/api/employee-time/history/route.ts, src/app/labor-review/LaborReview.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/TimeCodingCard.tsx, src/components/TimeEntryList.tsx, src/lib/jtLinks.test.ts, +1 more
- 2026-09-11 06:11 · `6b7442c` companion: queue time-entry edits onto the board's one Save
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/TimeCodingCard.tsx, src/lib/codingDraft.test.ts, src/lib/codingDraft.ts
- 2026-09-11 06:13 · `420352f` companion: re-rate a whole selection of time entries
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/TimeCodingCard.tsx, src/components/TimeEntryList.tsx
- 2026-09-11 06:15 · `f784c6b` companion: float the ring's breakdown, and close the budget column
  src/app/trackingsheet/Board.tsx, src/components/Donut.tsx, src/components/SplitGrid.tsx

## Notes
