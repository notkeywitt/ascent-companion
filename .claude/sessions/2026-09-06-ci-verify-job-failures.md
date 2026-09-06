---
slug: ci-verify-job-failures
repo: ascent-companion
branch: claude/ci-verify-job-failures-wcfpyk
status: in-progress
started: 2026-09-06T19:51:56Z
updated: 2026-09-06T19:52:44Z
goal: fix the red CI verify job
next: push this branch to remote main — main is still red until the Link fix lands there
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-06 19:51 · `4dc2c03` companion: link, not anchor, on the theme editor's back button
  src/app/theme/page.tsx

## Notes
- 2026-09-06 19:52 — the verify job died on lint only: <a href="/"> in src/app/theme/page.tsx is @next/next/no-html-link-for-pages, an error. typecheck, tests and build were green throughout. lint does not gate the Vercel deploy (next.config.mjs ignoreDuringBuilds).
