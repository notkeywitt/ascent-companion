---
slug: dark-mode-color-scheme
repo: ascent-companion
branch: claude/dark-mode-color-scheme-31ail8
status: shipped
started: 2026-09-05T18:18:55Z
updated: 2026-09-06T05:23:32Z
goal: Rebuild dark mode from the Ascent Brand Guidelines: replace the lifted-olive accent with brand ochre, and Tailwind's pure-grey neutrals with a luminance-matched warm ramp
next: Owner review of the ochre dark mode on device; if approved ship with: git push origin claude/dark-mode-color-scheme-31ail8:main
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-05 18:18 · `8fac80a` companion: rebuild dark mode on ochre + warm grey
  CLAUDE.md, src/app/globals.css, src/app/logs/page.tsx, src/app/requests/page.tsx, src/app/rfis/page.tsx, src/app/unbilled/page.tsx, +4 more
- 2026-09-05 18:19 · `9e86aa2` companion: log dark-mode color scheme session
- 2026-09-05 18:25 · `27a1b45` companion: fix light mode's cream-on-ochre knockout
  src/app/globals.css, src/components/AscentLogo.tsx
- 2026-09-05 18:35 · `aa9d04b` companion: make the brand mark ochre in dark too
  CLAUDE.md, src/app/globals.css, src/app/unbilled/page.tsx, src/components/AscentLogo.tsx, src/components/PageTitle.tsx
- 2026-09-05 18:57 · `cd69f74` companion: centre the header logo, and put the splash in the theme
  src/app/globals.css, src/app/manifest.ts, src/components/AppHeader.tsx, src/components/AscentLogo.tsx, src/components/LoadingScreen.tsx, src/components/SplashScreen.tsx
- 2026-09-05 19:20 · `97a41ad` companion: launch the installed app on off-black
  src/app/manifest.ts
- 2026-09-06 05:23 · `7acdea6` companion: cool and dim dark mode's grey
  tailwind.config.ts

## Notes
