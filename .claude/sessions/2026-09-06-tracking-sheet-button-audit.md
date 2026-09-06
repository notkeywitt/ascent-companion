---
slug: tracking-sheet-button-audit
repo: ascent-companion
branch: claude/tracking-sheet-button-audit-ufg3yl
status: shipped
started: 2026-09-06T15:59:56Z
updated: 2026-09-06T19:08:21Z
goal: audit the tracking sheet page's buttons and re-lay them out for desktop workflow
next: Combine now stages and Save applies it, on all three surfaces. NOT on main — write-path change. Test: stage a merge, check the lines lock, Revert takes it back, Save merges them, and a merge saved alongside a qty edit on a DIFFERENT line lands both
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
- 2026-09-06 18:03 · `9216ad4` companion: put Recode All Lines and Combine above the line list
  src/app/trackingsheet/BillCodingCard.tsx
- 2026-09-06 18:55 · `c49ce1e` companion: reorder the line row, and make Combine stage like every other edit
  src/app/bill/[docId]/page.tsx, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx, src/app/trackingsheet/DraftWorkbench.tsx, src/lib/combineLines.ts

## Notes
- 2026-09-06 17:05 — Held the bill-panel merge off main: CLAUDE.md says stop and ask before pushing a JobTread write path. Branch claude/tracking-sheet-button-audit-ufg3yl, commit 6b88fce.
- 2026-09-06 17:21 — Owner authorised the push to main after the write-path hold (2026-09-06).
