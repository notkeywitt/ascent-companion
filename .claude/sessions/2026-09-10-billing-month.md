---
slug: billing-month
repo: ascent-companion
branch: ship/billing-month
status: in-progress
started: 2026-09-10T15:22:41Z
updated: 2026-09-10T16:56:56Z
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

## Notes
