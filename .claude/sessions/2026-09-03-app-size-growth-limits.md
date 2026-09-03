---
slug: app-size-growth-limits
repo: ascent-companion
branch: claude/app-size-growth-limits-kgigcc
status: in-progress
started: 2026-09-03T16:01:54Z
updated: 2026-09-03T16:02:09Z
goal: Answer the app-growth-limits question, then close the CODEBASE_MAP drift and gate it in CI
next: Nothing open. If bill volume grows: make reindexFromJobTread incremental (issueDate window + stored cursor) before ~5,000 bills.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-03 16:01 · `56da625` companion: close the codebase-map drift and gate it in CI
  .github/workflows/ci.yml, CODEBASE_MAP.md

## Notes
- 2026-09-03 16:02 — check:map existed but was wired into nothing — no hook, no CI. 20 items had drifted. Added the rows, plus digest/instructions.ts and digest/summary.ts, which the checker misses because it matches basenames only (invoiceReview namesakes satisfy it).
- 2026-09-03 16:02 — Growth review: the closest hard wall is reindexFromJobTread (src/lib/billSearch.ts) — a full hourly re-sweep of every vendorBill at 25/page inside maxDuration=300, so it dies around ~7k bills and then never refreshes. The Apps Script mirror degrades instead (rotating 800-row window), and the daily trigger-runtime quota is the quieter ceiling.
