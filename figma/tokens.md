# Figma Variables spec — Ascent Assistant

This is the **contract** between Figma and the code. These Figma Variable
collections map 1:1 onto the tokens the app already renders
(`src/app/globals.css` + `tailwind.config.ts`). If a value here changes, change
it in `globals.css`/`tailwind.config.ts` in the same commit — this file is
documentation, not a build input, so it can only help if it stays in sync.

> **Built.** The library exists at
> **[figma.com/design/DMJeL5CTgIt4OusKOqoqfU](https://www.figma.com/design/DMJeL5CTgIt4OusKOqoqfU)**
> ("Ascent Assistant") — 5 collections, 80 variables, 5 styles, 8 components.
> This file is now a description of what's there, not a build list.

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

> **Scopes do the enforcing.** `accent/DEFAULT`, `accent/hover` and `brand` are
> scoped to fills and strokes only — they carry **no `TEXT_FILL` scope**, so
> Figma will not offer ochre when you are colouring text. The contrast rule is a
> property of the tool, not something you have to remember.

### Collection 1b — the rest of the `Theme` roles

The eight roles above are the brand ones. `ui.tsx` flips more than that — every
`dark:` variant in it needs a mode-aware token, or the Figma component freezes
at its light value. These live in the same `Theme` collection.

| Variable | Light | Dark | Code |
|---|---|---|---|
| `surface/card`        | `#FFFFFF` | `ink/raised` `#23231E` | `bg-white dark:bg-ink-raised` |
| `border/default`      | `neutral/300` | `neutral/600` | `border-neutral-300 dark:border-neutral-600` |
| `border/card`         | `neutral/200` | `neutral/700-tint` | `border-neutral-200 dark:border-neutral-700/60` |
| `border/dashed`       | `neutral/300` | `neutral/700` | `border-neutral-300 dark:border-neutral-700` |
| `text/secondary`      | `neutral/700` | `neutral/300` | `text-neutral-700 dark:text-neutral-300` |
| `danger/text`         | `red/600` | `red/400` | `text-red-600 dark:text-red-400` |
| `danger/border`       | `red/300` | `red/900` | `border-red-300 dark:border-red-900` |
| `danger/bg`           | `red/50` | `red/950-tint` | `bg-red-50 dark:bg-red-950/40` |
| `banner/error-text`   | `red/700` | `red/300` | |
| `banner/warning-bg`   | `amber/50` | `amber/950-tint` | |
| `banner/warning-text` | `amber/800` | `amber/300` | |
| `banner/success-bg`   | `emerald/50` | `emerald/950-tint` | |
| `banner/success-text` | `emerald/700` | `emerald/300` | |
| `banner/neutral-bg`   | `neutral/100` | `neutral/800` | |
| `banner/info-bg`      | `ochre-tint-10` | `olive-tint-15` | `bg-accent/10 dark:bg-accent/15` |
| `banner/info-text`    | `offblack` | `olive-soft` | `text-accent dark:text-accent-soft` |

**The `-tint` primitives.** Tailwind's dark tones are alpha tints (`red-950/40`,
`neutral-700/60`). A Figma variable holds one opaque colour, so these are the
tint **already resolved over the dark page** (`#1B1B17`) — the exact pixel the
app renders:

| Primitive | Value | Is |
|---|---|---|
| `red/950-tint`     | `#2C1412` | `red-950` at 40% over `#1B1B17` |
| `amber/950-tint`   | `#2C1B0F` | `amber-950` at 40% over `#1B1B17` |
| `emerald/950-tint` | `#11221B` | `emerald-950` at 40% over `#1B1B17` |
| `neutral/700-tint` | `#313130` | `neutral-700` at 60% over `#1B1B17` |
| `ochre-tint-10`    | `#F6EED7` | `ochre` at 10% over cream `#FAF7EE` |
| `olive-tint-15`    | `#2E2D22` | `olive-lifted` at 15% over `#1B1B17` |

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

## Collection 4 — `Spacing` (no modes)

Only the values `ui.tsx` actually uses — not a speculative scale. Bind padding
and gaps to these rather than typing numbers.

| Variable | px | Used by |
|----------|----|---------|
| `space/2`  | 2  | Toggle knob inset (`translate-x-0.5`) |
| `space/4`  | 4  | Label bottom margin (`mb-1`), PageHeader description gap (`mt-1`) |
| `space/6`  | 6  | Button content gap (`gap-1.5`), Button sm vertical padding |
| `space/8`  | 8  | Button md vertical padding, Toggle gap, PageHeader actions gap |
| `space/10` | 10 | Button lg vertical padding, EmptyState mark gap (`mb-2.5`) |
| `space/12` | 12 | Button sm horizontal, Input horizontal, Card padding, Banner vertical |
| `space/16` | 16 | Button md/lg horizontal, Banner horizontal |
| `space/20` | 20 | PageHeader bottom gap (`mb-5`) |
| `space/24` | 24 | EmptyState horizontal padding (`px-6`) |
| `space/32` | 32 | EmptyState vertical padding (`py-8`) |

---

## Collection 5 — `Palette` (no modes)

Tailwind's neutral and status scales, used directly for borders, placeholders
and banner tones. Not brand colours, so they don't flip: `neutral/100`–`800`,
`white`, `red/50`–`950`, `amber/50`–`950`, `emerald/50`–`950`, plus the `-tint`
values listed above.

**Banner tones** are no longer raw values here — they're the `banner/*` roles in
Collection 1b, so they flip with the theme like everything else.

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
