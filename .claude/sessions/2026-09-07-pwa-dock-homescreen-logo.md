---
slug: pwa-dock-homescreen-logo
repo: ascent-companion
branch: claude/pwa-dock-homescreen-logo-88g8qu
status: in-progress
started: 2026-09-07T15:08:26Z
updated: 2026-09-07T15:08:55Z
goal: 
next: none — icon change is complete
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-07 15:08 · `a124414` companion: use the reversed mark for the installed app icon
  public/icon-192.png, public/icon-512.png, src/app/apple-icon.png, src/app/icon.png, src/app/manifest.ts

## Notes
- 2026-09-07 15:08 — install icon is now the reversed mark: white peak on pure black. Recoloured from ascent_logo_icon_ochre@1x.png (ochre->black, cream->white, projected onto the two-colour axis so antialiased edges survive), resized to 512/192/180. The SVG polygon in AscentLogo.tsx is an approximation of the mark, not the real geometry, so the PNG asset is the source for icon art.
- 2026-09-07 15:08 — no per-theme install icon is possible: manifest icons carry no media query and iOS reads one apple-touch-icon. The reversed mark is the single art that reads on both a light and a dark home screen.
