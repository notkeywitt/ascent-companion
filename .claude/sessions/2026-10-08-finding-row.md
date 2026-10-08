---
slug: finding-row
repo: ascent-companion
branch: claude/finding-row-actions
status: in-progress
started: 2026-10-08T02:48:11Z
updated: 2026-10-08T02:48:11Z
goal: Job check results (Check this job / Check all Jobs): each finding links to its bill (popup or the board's coding column) or the board's labor list narrowed and ticked, with per-item Re-check and Clear
next: On a phone and a desktop: run Check all Jobs for September, open a bill finding (popup), a labor-rate finding (board labor list narrowed + ticked), then Re-check and Clear a row and confirm the list survives the trip to the board and back
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->

## Notes
- 2026-10-08 02:48 — Clear is per device (localStorage, preSendMemory.ts), not a ruling: it hides nothing in the monthly invoice review. A ruling would key on the finding without the month and silence it in later months.
