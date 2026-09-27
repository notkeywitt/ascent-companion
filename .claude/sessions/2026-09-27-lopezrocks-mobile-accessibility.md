---
slug: lopezrocks-mobile-accessibility
repo: ascent-companion
branch: claude/lopezrocks-mobile-accessibility-ipd2mx
status: shipped
started: 2026-09-27T16:23:00Z
updated: 2026-09-27T16:44:00Z
goal: LopezRocks, the island community board, as a phone reader page in the app
next: Watch /lopezrocks in production for 'did not answer' notices; if the firewall turns Vercel away often, ask SalishRocks to allowlist the app, or offer the Safari phone-layout script instead
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-27 16:23 · `d296423` companion: add a phone reader for lopezrocks, linked at the bottom of home
  CODEBASE_MAP.md, src/app/lopezrocks/LopezRocksViews.tsx, src/app/lopezrocks/page.tsx, src/app/page.tsx, src/components/ui.tsx, src/lib/lopezrocks.ts, +3 more
- 2026-09-27 16:43 · `9f3f7c1` companion: mark lopezrocks posts that have a photo with a camera icon
  src/app/lopezrocks/LopezRocksViews.tsx, src/lib/lopezrocks.ts, src/lib/lopezrocksParse.test.ts, src/lib/lopezrocksParse.ts

## Notes
- 2026-09-27 16:23 — LopezRocks' Sucuri firewall turned away 2 of 10 honest server requests in testing, and 4 in a row during a burst. The reader never retries past it: it caches good pages 15 min and shows Try again otherwise.
