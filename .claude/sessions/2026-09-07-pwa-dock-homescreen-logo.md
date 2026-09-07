---
slug: pwa-dock-homescreen-logo
repo: ascent-companion
branch: claude/pwa-dock-homescreen-logo-88g8qu
status: shipped
started: 2026-09-07T15:08:26Z
updated: 2026-09-07T21:06:29Z
goal: 
next: none — icon change is complete
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-07 15:08 · `a124414` companion: use the reversed mark for the installed app icon
  public/icon-192.png, public/icon-512.png, src/app/apple-icon.png, src/app/icon.png, src/app/manifest.ts
- 2026-09-07 15:13 · `a074fd7` companion: rasterize the install icon from the brand asset
  ascent_logo_icon_bk.svg, public/icon-192.png, public/icon-512.png, src/app/apple-icon.png, src/app/icon.png, src/app/manifest.ts

## Notes
- 2026-09-07 15:08 — install icon is now the reversed mark: white peak on pure black. Recoloured from ascent_logo_icon_ochre@1x.png (ochre->black, cream->white, projected onto the two-colour axis so antialiased edges survive), resized to 512/192/180. The SVG polygon in AscentLogo.tsx is an approximation of the mark, not the real geometry, so the PNG asset is the source for icon art.
- 2026-09-07 15:08 — no per-theme install icon is possible: manifest icons carry no media query and iOS reads one apple-touch-icon. The reversed mark is the single art that reads on both a light and a dark home screen.
- 2026-09-07 15:13 — the icon art now comes from the brand asset ascent_logo_icon_bk.svg (Drive: 8) Ascent Marketing / 2024 Brand Refresh / Logos / 04_Icon / Full Color / SVG) — a #1B1B17 square with the mountain in #FFFFFF, committed at repo root and rasterized to 512/192/180. It replaces the recolour of the ochre PNG; the ground is now the same #1B1B17 as the manifest background_color.
- 2026-09-07 15:13 — the mountain polygon in AscentLogo.tsx does NOT match the brand geometry (asset: 271,710 439.919,418.811 472.75,442.506 582.362,373 809,710 on a 1080 grid). The in-app mark is a near-miss. Not fixed in this session.
- 2026-09-07 21:06 — AscentIcon now draws the brand asset's geometry on its own 1080 viewBox (points 439.919,418.811 271,710 809,710 582.362,373 472.75,442.506), replacing the hand-drawn 100-grid polygon. The real mark is smaller inside the square and its notch is tighter, so the header lockup, splash and login icon all shift slightly.
