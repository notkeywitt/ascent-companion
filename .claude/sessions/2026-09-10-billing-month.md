---
slug: billing-month
repo: ascent-companion
branch: ship/billing-month
status: in-progress
started: 2026-09-10T15:22:41Z
updated: 2026-09-10T15:42:32Z
goal: 
next: owner: deploy the appscript side (./deploy.sh) — the corrected totals and the Office/Shop/Electrical exclusion only appear once that lands; then open /invoicing-summary and confirm Ferron reads $117,979
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-10 08:41 · `a030aad` companion: point the invoicing package at the billing month on home
  src/app/api/invoicing-summary/route.ts, src/lib/invoiceReview/types.ts
- 2026-09-10 08:42 · `7efeba3` companion: log the invoicing package session
  SESSIONS.md, src/lib/sessionLog.generated.json

## Notes
