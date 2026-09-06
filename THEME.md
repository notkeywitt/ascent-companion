# THEME.md — the app's colour palettes

A record of each named palette, its exact values, and the reasoning that fixed
them. Add a palette here when you add one; change a value here in the same
commit that changes it in the code.

The values live in two files and nowhere else:

| What | Where |
|---|---|
| Brand constants + the `neutral` ramp | `tailwind.config.ts` |
| Theme roles (`accent`, `brand`, `line`) | `src/app/globals.css` |

---

## Palette 1 — "Guidelines" (shipped 2026-09-05, current)

Built from **ASCENT - Brand Guidelines - 2024** (Claiborne Colombo, May 2024),
Drive id `1c4QiE61j9-K-7d7JdfSz7JtVeKekifpH9-WGSeNEFNk`.

Recoverable at commit `cab6303`, or by restoring the two files above.

### The brand constants — fixed, never theme-dependent

| Token | Hex | Guide |
|---|---|---|
| `cream` | `#FAF7EE` | p.13 |
| `offblack` | `#1B1B17` | p.13 |
| `olive` | `#878054` | p.13 — **currently unpainted**, see below |
| `ochre` | `#CF9803` | p.13 |
| `webgrey` | `#8D8D8B` | p.13 |

### The one rule this palette turns on

**Ochre is the accent in BOTH themes. The theme swaps the ground, not the
colour you click.** p.15 passes "Ochre on Black" (6.70:1) and blocks ochre on
cream (2.41:1), so light mode redirects `text-accent` to black and uses ochre
for fills only. Dark mode uses ochre for both.

A filled accent always takes an **off-black** label — "Black on Ochre", p.15.
That includes the logo's knocked-out peak: p.17 pairs an ochre square with
black, never cream.

### Theme roles

| Var | Light | Dark | Note |
|---|---|---|---|
| `--accent` | `#CF9803` | `#CF9803` | same hue both themes |
| `--accent-hover` | `#B98803` | `#E5AC17` | deeper on cream, brighter on off-black |
| `--accent-soft` | `#CF9803` | `#E8B84A` | dark-only lift; a Chip's `bg-accent/15` tint eats contrast |
| `--accent-fg` | `#1B1B17` | `#1B1B17` | declared once — same in both |
| `--brand` | `#CF9803` | `#CF9803` | graphics only: logo square, peak mark, rules |
| `--line` | `#E7E1D1` | `#38352A` | card edge |
| `--line-soft` | `#F0EBDD` | `#2B2921` | row divider inside a card |
| `--line-strong` | `#D6CDB6` | `#4A4637` | form controls |

### Surfaces

| | Light | Dark |
|---|---|---|
| Page | `#FAF7EE` | `#1B1B17` (`ink`) |
| Raised card | `#FFFFFF` | `#23231E` (`ink-raised`) |
| Overlay | `#FFFFFF` | `#2B2B25` (`ink-overlay`) |
| Body text | `#1B1B17` | `#ECE8DB` |

Dark cards sit **lighter** than the page, never darker.

### The `neutral` ramp

Not Tailwind's. Tailwind's stock `neutral` is a pure grey (R=G=B) and reads
cold and blue on warm grounds. This is the same ramp on the brand's warm axis
(hue 48°, between ochre's 44° and olive's 52°) at saturation **0.035** — enough
to kill the blue cast, not enough to have a colour of its own.

| Step | Hex | Step | Hex |
|---|---|---|---|
| 50 | `#FAFAFA` | 500 | `#75736D` |
| 100 | `#F5F5F4` | 600 | `#53524E` |
| 200 | `#E5E5E4` | 700 | `#41403D` |
| 300 | `#C3C2BF` | 800 | `#272624` |
| 400 | `#94928C` | 900 | `#171716` |
| | | 950 | `#0A0A09` |

**Only 300 and 400 sit darker than the stock ramp** (−0.075 HSL). They are what
dark mode paints as quiet text, and they were bright enough to compete with the
body copy. Every other step holds the stock step's relative luminance, for
reasons that are load-bearing:

- **500** is written bare, with no `dark:` sibling, at ~390 sites, so it renders
  in dark mode too, where it is already only 3.64:1.
- **600/700/800** are dark mode's borders and fills, not its text. They must
  stay lighter than the page (`#1B1B17`) or a card sinks below its own
  background and ~70 borders stop being visible.
- **50–200** are light-mode surfaces.

### Measured contrast

| Pair | Ratio | |
|---|---|---|
| Ochre on off-black | 6.70:1 | AA |
| Off-black on ochre | 6.70:1 | AA |
| Cream on off-black | 16.12:1 | AA |
| `accent-soft` on a `bg-accent/15` chip | 6.65:1 | AA |
| `neutral-400` quiet text on the dark page | 5.55:1 | AA |
| `neutral-300` quiet text on the dark page | 9.70:1 | AA |
| `neutral-500` bare, on the dark page | 3.64:1 | large text only |
| Olive on off-black | 4.31:1 | graphics + large text only |
| Ochre on cream | 2.41:1 | **restricted, p.16** |

### Why olive is unpainted

Olive is a real brand colour and stays in the palette, but no surface uses it.
Dark mode's marks were olive until the owner asked for ochre (2026-09-05). If a
future view wants it back as a supporting band — p.14's website ratio gives it a
narrow one — it passes for **graphics and large text only** at 4.31:1 on
off-black. Never body copy.

---

## Palette 2 — from the website

Not built. Blocked on reading <https://www.ascentbuildingco.com>: this
environment's **Network access** level does not allow it, so neither the browser
nor a fetch can reach the site.

What the brand deck shows the site to be (p.24's website mockup, p.14's website
ratio), pending the real thing: a cream ground, off-black text, an **olive**
section band carrying cream text, off-black footer and buttons, and ochre
reduced to the thinnest sliver. That is close to an inversion of palette 1's
emphasis, so it is worth building as a genuine alternative rather than a tweak.

Switching is to be **per device**, alongside the existing light/dark toggle
(owner's call, 2026-09-05).
