---
slug: billing-month
repo: ascent-companion
branch: ship/billing-month
status: in-progress
started: 2026-09-10T15:22:41Z
updated: 2026-09-10T18:12:04Z
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

## Notes
