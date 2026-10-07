---
slug: labor-import-code-rates
repo: ascent-companion
branch: claude/labor-import-code-rates
status: shipped
started: 2026-10-07T16:38:04Z
updated: 2026-10-07T16:40:01Z
goal: Labor Import: pick pay type per worker x job x cost code, with the time entries shown under each combination
next: Load a month's QuickBooks labor CSV on /labor-import: check each electrician's job splits into field / PM / office code rows, and the entry list under each row matches the QB report.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-07 12:39 · `83a1a4e` companion: labor import picks pay type per worker, job and cost code, with each combination's time entries listed
  src/app/labor-import/page.tsx

## Notes
- 2026-10-07 16:39 — Pay type picks re-keyed per worker x job x cost code (localStorage laborImport.typeMap.v2). v1 picks (per worker x job) deliberately not carried over: one pick would stamp one rate on every code.
