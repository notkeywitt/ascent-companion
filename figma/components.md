# Figma component build checklist — Ascent Assistant

Build these in your Figma library **after** the Variables in `tokens.md`. Each
component below mirrors a primitive in `src/components/ui.tsx` exactly — same
variants, same padding, same token per part — so a design assembled from them
maps back to code cleanly (and Code Connect in `../src/components/ui.figma.tsx`
already expects these property names).

Order: **(0) Foundations → (1) Button → (2) inputs → (3) Toggle → (4) labels →
(5) Card → (6) Banner → (7) EmptyState → (8) PageHeader.** Do 0–1 first; that's
enough to start the MCP loop.

Radius tokens: `lg = 8px`, `xl = 12px`, `full = 9999px`.
Text: Roboto, `text-sm = 14px`, caption `= 11px`.

> **Theme rule baked into every component:** bind color parts to the **`Theme`**
> role variables (`accent`, `accent/hover`, `accent/fg`, `text/interactive`,
> `bg/page`, `text/body`), never raw hex — so switching the Figma mode Light↔Dark
> reproduces the app's `.dark`. Watch the one asymmetry: **`text/interactive` is
> black in Light, olive in Dark.** That's why `text-accent` on Outline/Ghost/
> Secondary buttons looks black in light mode — correct, not a mistake.

---

## 0. Foundations — extra palette collection

`tokens.md` covers brand + theme roles. The primitives also use Tailwind's
neutral/status scales for borders and the danger/banner tones. Add these as a
fixed (no-mode) `Palette` collection so the components can reference them:

| Variable        | Hex       | Variable         | Hex       |
|-----------------|-----------|------------------|-----------|
| `neutral/100`   | `#F5F5F5` | `red/50`         | `#FEF2F2` |
| `neutral/200`   | `#E5E5E5` | `red/300`        | `#FCA5A5` |
| `neutral/300`   | `#D4D4D4` | `red/400`        | `#F87171` |
| `neutral/400`   | `#A3A3A3` | `red/600`        | `#DC2626` |
| `neutral/500`   | `#737373` | `red/700`        | `#B91C1C` |
| `neutral/600`   | `#525252` | `red/900`        | `#7F1D1D` |
| `neutral/700`   | `#404040` | `amber/50`       | `#FFFBEB` |
| `neutral/800`   | `#262626` | `amber/300`      | `#FCD34D` |
| `white`         | `#FFFFFF` | `amber/800`      | `#92400E` |
| `emerald/50`    | `#ECFDF5` | `emerald/300`    | `#6EE7B7` |
| `emerald/700`   | `#047857` |                  |           |

> **Six of these were missing from earlier drafts of this table** even though the
> component tables below reference them — `neutral/100`, `red/400`, `red/900`,
> `amber/50`, `emerald/50`. If you rebuild by hand, don't skip them: `red/400` is
> the Danger button's dark text and `red/900` its dark border.

**Dark status tints.** `ui.tsx` uses alpha tints (`red-950/40`, `neutral-700/60`)
which a Figma variable can't express — a variable holds one opaque colour. The
library stores them **pre-resolved over the dark page** (`#1B1B17`), which is the
exact pixel the app renders: `red/950-tint #2C1412`, `amber/950-tint #2C1B0F`,
`emerald/950-tint #11221B`, `neutral/700-tint #313130`. See `tokens.md`.

---

## 1. Button  → `Button` in `ui.tsx`

**Component properties**
- `Variant`: Primary · Secondary · Outline · Ghost · Danger
- `Size`: Small · Medium · Large
- `State`: Default · Hover · Disabled
- `Label` (text property)
- optional leading-icon slot (base has `gap 6px` for it)

**Shared base (all variants):** corner `radius/lg` (8px) · `font-weight 600` ·
`text-sm` (14px) · content gap `6px` · Disabled state = `opacity 40%`.

**Padding by Size:** Small `12×6` · Medium `16×8` · Large `16×10` (px H × V).

**Color parts per Variant** (Default → Hover):

| Variant   | Fill              | Border            | Text                | Extra |
|-----------|-------------------|-------------------|---------------------|-------|
| Primary   | `accent` → `accent/hover` | none      | `accent/fg`         | shadow sm |
| Secondary | none              | `neutral/300` (D:`neutral/600`) → `accent` | `neutral/700` (D:`neutral/300`) → `text/interactive` | |
| Outline   | none → `accent` @10% | `accent`       | `text/interactive`  | |
| Ghost     | none              | none              | `neutral/500` → `text/interactive` (D hover:`accent/soft`) | |
| Danger    | none → `red/50` (D:`red-950/40`) | `red/300` (D:`red-900`) | `red/600` (D:`red/400`) | |

(D: = Dark mode value.)

---

## 2. Inputs — `Input`, `Select`, `Textarea` (all share `inputCls`)

Build **one** component, `Input`, with a `Type` property (Text · Select ·
Textarea) — they're byte-for-byte the same box in `ui.tsx`.

**Properties:** `Type` · `State` (Default · Focus · Disabled) · `Placeholder` (text).

| Part        | Value / token |
|-------------|---------------|
| Width       | fill container (`w-full`) |
| Corner      | `radius/lg` (8px) |
| Padding     | `12×8` (px-3 py-2) |
| Fill        | `white` (Dark: `ink/raised` `#23231E`) |
| Border      | `neutral/300` (Dark: `neutral/600`) |
| Text        | `text-sm` (14px), `text/body` |
| Placeholder | `neutral/400` |
| **Focus** state | border → `accent`, add ring: `accent` @25%, 2px |
| Disabled    | `opacity 50%` |

> On touch devices the app floats input font to 16px (iOS zoom fix) — cosmetic,
> ignore in Figma.

---

## 3. Toggle  → `Toggle`

**Properties:** `On` (boolean) · `Label` (text).

| Part  | Value / token |
|-------|---------------|
| Track | `36×20`, corner `full`. On = `accent`; Off = `neutral/300` (Dark: `neutral/600`) |
| Knob  | `16×16` circle, `full`, fill `white`, shadow sm. Off = 2px from left; On = flush right (+16px) |
| Label | `text-sm` (14px), `text/body`, 8px gap right of track |

---

## 4. Labels — `Label` and `SectionLabel`

Same caption style; one component with a `For` boolean (semantic only) is fine.

| Part | Value |
|------|-------|
| Text | `11px`, weight 600, **UPPERCASE**, `tracking-wide` (~+0.4px) |
| Color| `neutral/500` |
| Gap  | `Label` adds `4px` bottom margin (sits above a field) |

---

## 5. Card  → `Card`

**Properties:** `Padded` (boolean, default true).

| Part   | Value / token |
|--------|---------------|
| Corner | `radius/xl` (12px) |
| Fill   | `white` (Dark: `ink/raised` `#23231E` — **lighter** than the page, never darker) |
| Border | `neutral/200` (Dark: `neutral/700` @60%) |
| Padding| `12px` when `Padded = true`; `0` when false |

---

## 6. Banner  → `Banner`

**Properties:** `Tone` (Error · Warning · Success · Info · Neutral) · `Message` (text).

Base: corner `radius/lg` (8px) · padding `16×12` · `text-sm` (14px).

| Tone    | Light fill / text            | Dark fill / text                |
|---------|------------------------------|---------------------------------|
| Error   | `red/50` / `red/700`         | `red-950/40` / `red/300`        |
| Warning | `#FFFBEB` / `amber/800`      | `amber-950/40` / `amber/300`    |
| Success | `emerald/50 #ECFDF5` / `emerald/700` | `emerald-950/40` / `emerald/300` |
| Info    | `accent` @10% / `text/interactive` | `accent` @15% / `accent/soft` |
| Neutral | `neutral/100 #F5F5F5` / `neutral/700` | `neutral/800` / `neutral/300` |

---

## 7. EmptyState  → `EmptyState`

| Part   | Value / token |
|--------|---------------|
| Corner | `radius/xl` (12px) |
| Border | **dashed**, `neutral/300` (Dark: `neutral/700`) |
| Padding| `24×32` (px-6 py-8), centered |
| Mark   | peak mark, `26×16`, color `webgrey #8D8D8B`, `opacity 70%`, 10px below-none / above text |
| Text   | `text-sm` (14px), `neutral/500`, centered |

---

## 8. PageHeader  → `PageHeader`

Layout frame, not a styled box.

**Properties:** `Title` (text) · `Description` (text, optional) · `Actions` (slot, optional).

| Part        | Value |
|-------------|-------|
| Title       | peak-mark + title (the brand `PageTitle`); mark uses `brand` color |
| Description | `4px` below title, `text-sm` (14px), `neutral/500` |
| Actions     | top-right, stays pinned right at all widths; `8px` gap between items |
| Bottom gap  | `20px` (mb-5) before page content |

---

## Optional (loading states — build later if you design skeletons)

`Spinner` (14px ring, `neutral/300` track + `accent` top, spins), `Skeleton`
(rounded bar, `neutral/200` @70% / Dark `white` @10%, pulse), `CardSkeletonList`
(3 skeleton cards). Cosmetic; skip until you need loading mocks.

---

### When these exist

1. Publish the library.
2. Open `../src/components/ui.figma.tsx`, set `LIB` and each `node-id`, confirm
   the `figma.enum` values match the `Variant`/`Size`/`Tone` names you used above.
3. `npx figma connect publish`.
4. Select a frame → MCP loop from VS Code.
