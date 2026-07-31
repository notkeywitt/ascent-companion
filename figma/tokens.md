# Figma Variables spec — Ascent Assistant

This is the **contract** between Figma and the code. Build these Figma Variable
collections exactly as listed and your Figma designs will map 1:1 onto the
tokens the app already renders (`src/app/globals.css` + `tailwind.config.ts`).
If a value here changes, change it in `globals.css`/`tailwind.config.ts` in the
same commit — this file is documentation, not a build input, so it can only
help if it stays in sync.

Source of truth in code:
- `src/app/globals.css` — the theme role variables (`--accent`, `--brand`, …).
- `tailwind.config.ts` — the fixed brand hues + the role→variable wiring.

> **The one brand rule that trips people up:** each theme uses **one** brand
> pairing — **light = cream + ochre**, **dark = off-black + olive**. Pure ochre
> is only ~2.4:1 on cream, so in **light mode ochre may only be a FILL / border /
> ring / tint, never small text** (interactive text is black). Olive passes AA
> as text, so dark mode uses it for both. The Variables below encode that split;
> respect it when you design or you'll create something the code deliberately
> won't render.

---

## Collection 1 — `Theme` (modes: **Light**, **Dark**)

These are the roles that flip with the theme. Every `bg-accent` / `border-accent`
/ `text-accent` in the app resolves through them. This collection is the heart of
the system — design against these, not against raw hex.

| Variable            | Light               | Dark                | Notes |
|---------------------|---------------------|---------------------|-------|
| `accent/DEFAULT`    | `#CF9803` ochre     | `#9A9260` olive     | Fills, borders, rings, tints. |
| `accent/hover`      | `#B98803`           | `#B2AA76`           | Filled-accent hover. |
| `accent/soft`       | `#CF9803`           | `#CFC8A6`           | Dark-only lifted variant for small accent text. |
| `accent/fg`         | `#FAF7EE` cream     | `#1B1B17` off-black | Text/knockout **on** a filled accent. Short labels only. |
| `brand`             | `#CF9803` ochre     | `#878054` olive     | **Graphics only** (hairlines, peak mark, logo square). Never text. |
| `text/interactive`  | `#1B1B17` black     | `#9A9260` olive     | Interactive/link TEXT. Light redirects to black on purpose. |
| `bg/page`           | `#FAF7EE` cream     | `#1B1B17` off-black | Page background. |
| `text/body`         | `#1B1B17`           | `#ECE8DB`           | Default body text. |

Bind Figma component fills/strokes/text to these role variables. Switching the
Figma page mode Light↔Dark should then mirror exactly what `.dark` does in code.

---

## Collection 2 — `Brand` (no modes — fixed hues)

The raw brand palette (Brand Guidelines, May 2024) plus the dark surface scale.
Use these only where a value must NOT flip with the theme.

| Variable        | Hex       | Use |
|-----------------|-----------|-----|
| `cream`         | `#FAF7EE` | Light page / knockout on ochre. |
| `offblack`      | `#1B1B17` | Dark page / text on light. |
| `olive`         | `#878054` | Brand green (dark accent/graphics). |
| `ochre`         | `#CF9803` | Brand gold (light accent/graphics). |
| `webgrey`       | `#8D8D8B` | Muted marks (e.g. empty-state peak). |
| `ink/DEFAULT`   | `#1B1B17` | Dark page surface. |
| `ink/raised`    | `#23231E` | Dark cards — sit **lighter** than the page. |
| `ink/overlay`   | `#2B2B25` | Dark menus / modals. |

---

## Collection 3 — `Radius` (no modes)

Tailwind defaults, as used by the primitives.

| Variable | Value  | Used by |
|----------|--------|---------|
| `lg`     | `8px`  | Buttons, inputs, banners. |
| `xl`     | `12px` | Cards, empty state. |
| `full`   | `9999px` | Toggle pill, spinners. |

---

## Collection 4 — semantic banner tones (no modes)

`Banner` tones use the standard Tailwind scales, not brand hues (except `info`,
which uses `accent`). Encode these if you design status banners.

| Tone      | Light bg / text            | Dark bg / text                    |
|-----------|----------------------------|-----------------------------------|
| `error`   | `#FEF2F2` / `#B91C1C`       | `red-950/40` / `#FCA5A5`          |
| `warning` | `#FFFBEB` / `#92400E`       | `amber-950/40` / `#FCD34D`        |
| `success` | `#ECFDF5` / `#047857`       | `emerald-950/40` / `#6EE7B7`      |
| `info`    | `accent/10` / `text-accent` | `accent/15` / `accent-soft`       |
| `neutral` | `#F5F5F5` / `#404040`       | `#262626` / `#D4D4D4`             |

---

## Typography

One family, one interactive text size.

| Style      | Value |
|------------|-------|
| Family     | **Roboto** (brand web alternate to LL Medium). Var `--font-roboto`. |
| Body/UI    | `14px` (`text-sm`), weight 400–600. |
| Caption / field label | `11px`, uppercase, `tracking-wide`, weight 600, `text-neutral-500`. |
| Button     | `14px`, weight 600. |

---

## Spacing cheatsheet (for laying out frames to match the primitives)

| Primitive           | Padding |
|---------------------|---------|
| Button `sm`         | `12px × 6px` (`px-3 py-1.5`) |
| Button `md`         | `16px × 8px` (`px-4 py-2`) |
| Button `lg`         | `16px × 10px` (`px-4 py-2.5`) |
| Card                | `12px` (`p-3`) |
| Banner              | `16px × 12px` (`px-4 py-3`) |
| Empty state         | `24px × 32px` (`px-6 py-8`) |
