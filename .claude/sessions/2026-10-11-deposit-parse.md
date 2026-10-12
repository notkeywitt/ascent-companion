---
slug: deposit-parse
repo: ascent-companion-deposits
branch: claude/deposit-parse
status: shipped
started: 2026-10-12T02:38:43Z
updated: 2026-10-12T02:38:44Z
goal: Deposit form: accept typed dollar figures with commas and $
next: Owner saves Berger's deposit on Bunkhouse; if Save still fails, read the error banner under the form.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-11 22:38 · `9ac8129` companion: deposit form reads amounts typed with commas or a dollar sign
  src/app/api/deposits/route.ts, src/app/trackingsheet/DepositCard.tsx, src/lib/deposits.test.ts, src/lib/deposits.ts

## Notes
