---
slug: billing-month
repo: ascent-companion
branch: ship/billing-month
status: in-progress
started: 2026-09-10T15:22:41Z
updated: 2026-09-10T19:24:09Z
goal: 
next: owner: deploy the appscript side (./deploy.sh) — the corrected totals and the Office/Shop/Electrical exclusion only appear once that lands; then open /invoicing-summary and confirm Ferron reads $117,979
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

## Notes
