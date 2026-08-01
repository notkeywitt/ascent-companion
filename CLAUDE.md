# CLAUDE.md — Ascent Assistant (companion app)

Working rules for Claude in this repo. Read this before building. Fuller context
lives in `README.md` and `USER_MANUAL.md`; this file is the working playbook.

The owner is a knowledgeable novice — understands the system deeply but is not a
professional developer. Explanations should be clear and concrete. Lead with the
change, then the reasoning.

## What this is

The Ascent Assistant: a phone-first Next.js (App Router) PWA on Vercel, the UI
layer over **JobTread** (via its Pave API) and the sibling `../ascent-appscript`
engine. **JobTread is the source of truth for anything financial** — the app
reads/writes it live and holds no billing database of its own.

## Sketch → page workflow (the owner's primary way to add a screen)

The owner designs by **sketching a layout on an iPad** (Apple Notes, Freeform,
Excalidraw — anything that exports an image) and sending the picture to Claude
with a description. There is no Figma pipeline and none is needed. A sketch does
not need to be neat: boxes, labels, and arrows are enough.

**What a good request from the owner contains** (one chat message):
- the **sketch image** attached;
- **what the screen shows** and where each piece of **data comes from**
  (JobTread via the Pave gateway, the companion DB, time-off, etc.);
- **what interactions do** — on tap / on submit, and especially any **writes**
  (writes to JobTread are gated and probe-first — confirm the field live before
  shipping it);
- **who can see it** — which role (admin / office / lead / field).

If any of those four are missing, ask before building rather than guessing.

**How Claude turns a sketch into a real page** — the app's consistent 3-part
pattern (mirror an existing screen; `jobs/` is the clean reference):
1. `src/app/<name>/page.tsx` — the route. Often a thin server component that only
   supplies non-secret config and renders a client component.
2. a client component (e.g. `<Name>Browser.tsx`) for the interactive UI.
3. `src/app/api/<name>/route.ts` — a data endpoint **only if needed**. Many
   screens read JobTread through the shared `/api/pave` gateway and need no
   bespoke route.
4. add a **`VIEW` entry in `src/lib/views.ts`** (with its route paths) and place
   its `id` in the right role sets — this is what makes it appear in nav and
   gates it to the correct roles. Middleware enforces the same gate server-side,
   so list any API route the screen uses under the view too.

**Always build on the existing design system — never hand-roll UI.** Reuse the
primitives in `src/components/ui.tsx` (`Button`, `Toggle`, `Input`, `Select`,
`Card`, `Banner`, `PageHeader`, `SectionLabel`, …) and the brand tokens in
`tailwind.config.ts` / `globals.css` (`accent`, `brand`, `ink`, cream/off-black,
ochre/olive; light + dark). This is why a rough sketch is enough — Claude is
assembling existing parts, not inventing pixels. Match dark mode (cards sit
*lighter* than the page — `bg-ink-raised`).

**Motion:** use Tailwind CSS transitions (the app already does — buttons
`active:scale`, sliding toggles). Framer Motion is **not** installed; only add it
if the owner explicitly wants richer animation, and say so first.

## Ship it: preview first, then merge (default workflow)

`main` auto-deploys to **production** on Vercel (live to the whole team). So the
default is **not** a direct push to `main`:

1. Commit the change on a working branch and push the branch.
2. Open a PR — Vercel builds a **preview URL** the owner can open on their iPad
   and actually tap through **before** it is live.
3. On the owner's OK, merge to `main` (one tap; auto-merge is fine). Production
   deploys on merge.

Only push straight to `main` if the owner explicitly asks for it. Never push to
`main` without explicit go-ahead.

## Commit style

Claude writes the commit message — don't make the owner think one up. Short,
lowercase, imperative summary of *what changed and why* (matching history), a
brief body only when the reasoning isn't obvious. Only run `git commit`/`git
push` when asked, but always offer the message.

## Hard rules

- **Preserve unrelated code byte-for-byte.** When editing a file, don't drop
  existing helpers or refactor code unrelated to the change.
- **JobTread writes are gated + probe-first.** Never ship a new JobTread/Pave
  field or write path without confirming it against the live API first, and keep
  any DRY_RUN / confirmation guards intact.
- **Roles gate everything.** A new page or API route isn't done until it has a
  `views.ts` entry and the right role sets — an ungated route leaks data.
- Flag risks honestly (unverified API fields, anything that could clobber newer
  work) rather than glossing over them.
