# THEME.md — the app's colour palettes

A record of each named palette, its exact values, and the reasoning that fixed
them. Add a palette here when you add one; change a value here in the same
commit that changes it in the code.

The values live in two files and nowhere else:

| What | Where |
|---|---|
| Brand constants + the `neutral` ramp | `tailwind.config.ts` |
| Theme roles (`accent`, `brand`, `line`, surfaces) | `src/app/globals.css` |

## Palette vs. theme

They are two independent choices, both **per device** (localStorage, never the
account — the office desktop and a phone in the field can differ).

| | What it picks | How it is set | Where the user changes it |
|---|---|---|---|
| **Palette** | which set of colours | `data-palette` on `<html>` | Appearance, on the home page |
| **Theme** | light or dark within it | `.dark` on `<html>` | the same card, or tap the header logo |

Every palette defines BOTH themes, so all four combinations are real. The
default palette (Guidelines) carries no attribute — its tokens are the bare
`:root` block, so nothing has to be set for the app to look right.

`src/lib/palette.ts` owns the key, the attribute and the storage. The inline
script in `src/app/layout.tsx` applies both before the first paint; a React
effect would run one frame late and flash the wrong ground.

**To add a palette:** write a `[data-palette="<id>"]` block (and its `.dark`
sibling) in `globals.css`, add the id to `PALETTES` in `src/lib/palette.ts`,
match it in the layout.tsx script, and record it here. No component changes.

## Editing a palette — `/theme`

**Tune it with the editor, then paste the result into `globals.css`.** The
editor is admin-only and reachable from Appearance on the home page.

Why it works: every value above is a CSS variable on `<html>`, so the editor
writes them as INLINE styles, which beat any stylesheet rule. One change
repaints the whole app on the next frame. There is no preview pane because the
app itself is the preview — open a draft, navigate to Tracking Sheets, and the
draft is still on.

| It gives you | |
|---|---|
| A row per token | native colour picker, hex field, and H/S/L sliders |
| Live WCAG ratios | the eight pairs that actually decide a palette, recomputed as you drag |
| A sampler | every `ui.tsx` primitive on one card |
| **Copy CSS** | the token block to paste into `globals.css`, listing only what changed |

A draft is **per device and never committed** — it is localStorage, like the
palette and theme choices beside it. Shipping means pasting the Copy CSS output
into the matching block here and in `globals.css`, in one commit.

Two files back it: `src/lib/paletteDraft.ts` (the token list, the hex/HSL and
contrast maths, the draft store) and `src/app/theme/page.tsx` (the UI). The
token list in that lib IS the editor's rows, so a new token in `globals.css`
needs a line there too.

---

## Marks are monochrome — every palette, every theme

No colour emoji anywhere in the app (owner, 2026-09-06). A mark paints in
`currentColor` and takes its colour from the text around it, so it is a text
glyph (`→ ↗ ✓ ✕ ⚠ ⚑ ★`) or an inline SVG — never an emoji.

Two traps, both silent:

- A **U+FE0F variation selector** after a dual-presentation glyph (`⚠️` rather
  than `⚠`) forces the colour form. Leave it off.
- An **emoji-only codepoint** (📎 📷 🎉 👤 🌐 ➕ ❗ ✅ ❌) has no text form at all
  and renders in colour whatever the CSS says. `font-variant-emoji: text` on
  `body` covers the first case and cannot save this one.

Where the neighbouring words already say it, the mark is dropped rather than
replaced — which is also what the site does, using no icons at all.

---

## Palette 1 — "Guidelines" (shipped 2026-09-05, the default)

Built from **ASCENT - Brand Guidelines - 2024** (Claiborne Colombo, May 2024),
Drive id `1c4QiE61j9-K-7d7JdfSz7JtVeKekifpH9-WGSeNEFNk`.

Recoverable at commit `cab6303`, or by restoring the two files above. It is
the default palette, so it carries no `data-palette` attribute.

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
| Page | `#FAF7EE` (`--page`) | `#1B1B17` (`--page`, `ink`) |
| Raised card | `#FFFFFF` (`bg-white`) | `#23231E` (`ink-raised`) |
| Overlay | `#FFFFFF` | `#2B2B25` (`ink-overlay`) |
| Body text | `#1B1B17` (`--page-fg`) | `#ECE8DB` (`--page-fg`) |

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

## Palette 2 — "Website" (shipped 2026-09-06)

Built from **www.ascentbuildingco.com** itself, read on 2026-09-06. Earlier
sessions could not reach the site; this one could, so the guesses the stub here
carried are replaced by the site's own values.

### What the site actually is

A Squarespace 7.1 build running ONE section theme (`light-bold`) on every
section of every page. Its palette resolves to:

| Squarespace slot | Value | Painted as |
|---|---|---|
| `lightAccent` | `#FAF7EE` | the ground, every section |
| `accent` | `#1B1B1B` | body copy, nav links |
| `safeDarkAccent` | `#1B1B1B` | headings, every button fill |
| `white` | `#FFFFFF` | a block on the cream ground |
| `black` slot | `#CF9803` | ochre — the logo, and nothing else |
| `darkAccent` | `#878054` | olive — defined, painted nowhere |

Two things the stub predicted are wrong. There is **no olive band** — olive is
in the palette and unused, the same as in the app. And the site's off-black is
`#1B1B1B`, a **neutral** grey, not the print guide's warm `#1B1B17`.

Typography (custom CSS + theme vars): headings in LL Medium Regular at `.03em`,
body in LL Medium Book weight 500 at `.06em`, `h4` captions at `.175em`, list
titles uppercase at `.3em`, buttons uppercase at `.15em` with a 6.8px radius.

### The one rule this palette turns on

**Black and white, with no chroma at all.** Same two grounds as palette 1, and
nothing else. On the site the button is a solid off-black block with a cream
label; the accent follows it, and the MARK follows the accent.

It shipped on 2026-09-06 with ochre kept as `brand` — the logo square, the peak
and the heading rules — because that is the one place the site itself still
uses it. The owner removed it the same day. There is now no hue in this palette.

That costs the usual way of showing a link, so the accent sits a step **past**
the body copy rather than equal to it: pure black under `#1B1B1B` text in light,
pure white over `#FAF7EE` text in dark. A link separates by value, not by hue —
which is what the site itself does, where a link is simply the ink.

### Theme roles

| Var | Light | Dark | Note |
|---|---|---|---|
| `--accent` | `#000000` | `#FFFFFF` | fills, borders, rings, tints |
| `--accent-hover` | `#2B2B2B` | `#E8E4D8` | one step off the fill |
| `--accent-soft` | `#000000` | `#FFFFFF` | no lifted variant: b/w needs none |
| `--accent-fg` | `#FAF7EE` | `#1B1B1B` | the label ON a fill — inverted from palette 1 |
| `--brand` | `#000000` | `#FFFFFF` | the logo square, the peak mark, heading rules |
| `text-accent` | `#000000` | `#FFFFFF` | one step past the body copy — see below |
| `--line` | `#ECE7DB` | `#242424` | card edge |
| `--line-soft` | `#F4F0E7` | `#232323` | row divider inside a card |
| `--line-strong` | `#DBD3C2` | `#333333` | form controls |

Hairlines are lighter than palette 1's in light and much darker in dark. The
site draws none at all — it separates with space — and a phone app cannot go
that far, so this is as close as it gets while a dense list stays readable.

Two dark hairlines are **redirected**, not retokened. About 40 call sites spell
a dark border as Tailwind's warm `neutral-600` or `neutral-700` rather than
`border-line`. Both are lighter than this palette's whole surface scale and
warm, so on a neutral black they read as a grey stroke in the wrong colour
family. `globals.css` points them at `--line-strong` and `--line` under this
palette, the same way light mode redirects `text-accent`.

### Surfaces

| | Light | Dark |
|---|---|---|
| Page | `#FAF7EE` | `#0A0A0A` |
| Raised card | `#FFFFFF` | `#1B1B1B` — the site's own black |
| Overlay | `#FFFFFF` | `#262626` — menus and sheets only |
| Body text | `#1B1B1B` | `#FAF7EE` |

Light surfaces **do not move**: cream ground, white card. Both are the site's
own values, and its `light` theme puts a white block on the cream ground in
exactly this way.

Dark **inverts palette 1's arrangement**. There the page IS the brand off-black
and the card lifts off it. Here the site's black is the CARD and the ground goes
deeper than it, because the site uses no grey as a surface: a `#242424` card on
a `#1B1B1B` page read as one (owner, 2026-09-06). Cards cover most of a phone
screen, so putting `#1B1B1B` on them makes the black the thing you see, and the
grey that was the card demotes to the overlay. Cards still sit lighter than the
page — that direction never changes.

Palette 1's dark is untouched and still the guide's warm brown-black; this is
the neutral one.

### Dark is derived, not read

The site has no dark mode. This half inverts the rule the site does state:
there the ground is cream and the thing you click is the ink, so here the
ground is the ink and the thing you click is the light — a white button with an
off-black label.

**White, not the cream of the body copy.** With no hue to fall back on, the
accent earns its separation from the surrounding sentence by value alone, so it
sits one step brighter than the text — the mirror of light, where it is one step
darker.

### Type

Two hook classes carry the site's spacing without touching a page:

| Hook | On | Website palette does |
|---|---|---|
| `ui-caption` | every `Label` and `SectionLabel` | `letter-spacing: .18em` |
| `ui-btn` | every `Button` (`BTN_BASE`) | `letter-spacing: .06em`, weight 500 |

Buttons take the tracking and the lighter weight but **not** the site's caps.
The site sets three words per button; this app sets "Save coding and post to
JobTread", and upper-casing that wraps it on a phone.

### Measured contrast

| Pair | Ratio | |
|---|---|---|
| Black link on cream | 19.60:1 | AAA |
| Cream label on a black fill | 19.60:1 | AAA |
| Black on the white card | 21.00:1 | AAA |
| Cream body copy on the dark page | 18.48:1 | AAA |
| Cream body copy on a dark card | 16.08:1 | AAA |
| White link on the dark page | 19.80:1 | AAA |
| White link on a dark card | 17.22:1 | AAA |
| Off-black label on a white fill | 17.22:1 | AAA |

Nothing in this palette is near a limit — which is the point of dropping the
hue. Palette 1's tight pairings were all ochre's.

### The mark

The logo's square is `brand` and its knocked-out peak is `accent-fg` — the same
pair every filled accent in the app uses. `AscentLogo` names no colour of its
own, so the mark is right in any palette: an ochre square with an off-black
peak under palette 1, black-on-cream here, white-on-black in the dark. It used
to hardcode that peak as off-black, which painted a near-invisible peak the
moment the square went black.

### What is unpainted

Olive and **ochre**, both. Olive the site defines and never paints; ochre it
paints on the logo, and this palette does not. Palette 1 is where the brand hue
lives.
