---
slug: kevin-berger-invoice-review
repo: ascent-companion
branch: claude/kevin-berger-invoice-review-gktmtf
status: in-progress
started: 2026-10-19T10:34:29Z
updated: 2026-10-19T10:34:29Z
goal: Turn Kevin Berger's invoice disputes into review checks, and run the review on the 10th-to-15th timeline
next: 
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->

## Notes
- 2026-10-19 10:34 — Audit of Kevin Berger threads (Oct 2025-Oct 2026): 12 real errors (6 billing, 6 Drive backup), 13 process gaps. Checks built: tax-doubled, duplicate-wide, invoice-lines, line-code-mismatch. Schedule rides the digest's scheduler call (Hobby 2-cron cap).
- 2026-10-19 10:34 — Held, needs owner ok (JobTread write path): /api/bill-tax refusing a tax that makes taxLooksDoubled true. Its 3 callers (bill page, DraftWorkbench, saveCoding) would need a confirm path.
