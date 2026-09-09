---
slug: ipad-vertical-admin-home
repo: ascent-companion
branch: claude/ipad-vertical-admin-home-onkrkj
status: in-progress
started: 2026-09-09T06:11:27Z
updated: 2026-09-09T06:11:43Z
goal: A vertical iPad layout for the admin and office home screen.
next: Watch the office iPad home in use: the three quick tiles are pad:h-36 with the whole /more menu open under them, and the guess is that 144px is still taller than a button needs to be.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->

## Notes
- 2026-09-09 06:11 — pad = 744px, declared in a full sorted screens object in tailwind.config.ts. Appending it through theme.extend puts the variant AFTER xl in the stylesheet, so pad:grid-cols-2 would beat xl:grid-cols-3.
- 2026-09-09 06:11 — The launcher shows every row at pad by CLASS (hidden pad:flex), not by a JS media query — a media-query hook renders the phone fold first and swaps it a frame later, which is a visible jump on the app's first screen.
- 2026-09-09 06:11 — Newspaper columns, not a grid, for the menus: a grid locks a 5-row menu to the height of a 14-row one and left a 500px hole under My Work. Two columns is the ceiling on an iPad — three at 1024px gives each row less width than a phone and truncates the descriptions.
