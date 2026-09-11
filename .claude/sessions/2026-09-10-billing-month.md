---
slug: billing-month
repo: ascent-companion
branch: ship/billing-month
status: shipped
started: 2026-09-10T15:22:41Z
updated: 2026-09-11T16:42:19Z
goal: 
next: open the ? overlay on a desktop page: check the scaled page lines up in the stage, then Edit > Add element > tap a control and confirm the arrow lands on it after Save
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
- 2026-09-11 06:19 · `1f8fb8b` companion: put a time entry's cost beside its hours
  src/components/TimeEntryList.tsx
- 2026-09-11 06:21 · `0a3482e` companion: fold the bills list, and call the block Labor
  src/app/trackingsheet/Board.tsx
- 2026-09-11 06:23 · `39d6901` companion: line the commit bar up with the tab bar
  src/app/globals.css, src/components/StickyActionBar.tsx
- 2026-09-11 06:25 · `4640b06` companion: give the budget reopen tab a column of its own
  src/app/trackingsheet/Board.tsx, src/components/SplitGrid.tsx
- 2026-09-11 06:27 · `51c3085` companion: click a ring slice to filter the bills to that code
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/CostDonuts.tsx, src/components/Donut.tsx
- 2026-09-11 06:31 · `5ab3926` companion: log a bill that arrived with no invoice
  src/app/add-bill/page.tsx, src/app/api/add-bill/route.ts
- 2026-09-11 06:32 · `006d583` companion: reach the bills cost-code filter from the list itself
  src/app/trackingsheet/Board.tsx
- 2026-09-11 06:33 · `9efe0fa` companion: put the bills filter chip inside the list it narrows
  src/app/trackingsheet/Board.tsx
- 2026-09-11 06:41 · `3e8ba06` companion: let the budget tab breathe, and follow the scroll
  src/app/trackingsheet/Board.tsx
- 2026-09-11 06:44 · `7592c98` companion: say what the bills are filtered to, and cut what said nothing
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/CostDonuts.tsx
- 2026-09-11 07:46 · `a6e6416` companion: labor ring filters the labor list, and a way to the package
  src/app/trackingsheet/Board.tsx, src/app/trackingsheet/CostDonuts.tsx
- 2026-09-11 07:55 · `8ffa66a` companion: per-element help overlay, editable in app
  CODEBASE_MAP.md, src/app/api/page-guide/route.ts, src/app/layout.tsx, src/components/PageGuide.tsx, src/db/index.ts, src/db/schema.ts, +2 more
- 2026-09-11 08:03 · `6511307` companion: fix Pick element — the backdrop was eating the tap
  src/components/PageGuide.tsx
- 2026-09-11 08:20 · `94d899f` companion: stop the budget tab spilling into the bills column
  src/app/trackingsheet/Board.tsx, src/components/SplitGrid.tsx
- 2026-09-11 09:42 · `722fad7` companion: add a desktop slide-out pages menu
  CODEBASE_MAP.md, src/app/globals.css, src/components/AppHeader.tsx, src/components/SideNav.tsx

## Notes
