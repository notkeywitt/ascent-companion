---
slug: tracking-sheet-button-audit
repo: ascent-companion
branch: claude/tracking-sheet-button-audit-ufg3yl
status: shipped
started: 2026-09-06T15:59:56Z
updated: 2026-09-06T17:06:13Z
goal: audit the tracking sheet page's buttons and re-lay them out for desktop workflow
next: MERGE IS ON THE BRANCH, NOT MAIN — awaiting owner ok (JobTread write path). /bill now hosts BillCodingCard; verify save, combine, delete, buyback, approve, move-to-job and the needs-review flag on a real bill before shipping
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-06 15:59 · `0916dda` companion: one commit bar for tracking sheets, at every width
  src/app/trackingsheet/AllJobs.tsx, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx
- 2026-09-06 16:10 · `f3daabf` companion: stop the search panel hanging off the left of the screen
  src/components/GlobalSearch.tsx
- 2026-09-06 16:16 · `0108295` companion: default every device to the Website palette
  CLAUDE.md, THEME.md, src/app/layout.tsx, src/app/theme/page.tsx, src/components/AppearanceCard.tsx, src/lib/palette.ts, +1 more
- 2026-09-06 17:05 · `6b88fce` companion: one bill coding panel, not two
  src/app/bill/[docId]/page.tsx, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DraftWorkbench.tsx, src/lib/billingMonths.ts
- 2026-09-06 17:06 · `258d2eb` companion: log session — bill panel merge held for review

## Notes
- 2026-09-06 17:05 — Held the bill-panel merge off main: CLAUDE.md says stop and ask before pushing a JobTread write path. Branch claude/tracking-sheet-button-audit-ufg3yl, commit 6b88fce.
