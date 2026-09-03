# CLAUDE.md — Ascent Assistant (companion)

The human-facing app for Ascent Building Co. — a **Next.js (App Router) app on
Vercel** that is the UI over **JobTread** (its "Pave" API) plus a small companion
database (Drizzle + libSQL). It replaces the retired AppSheet UI and progressively
absorbs those functions. The sibling repo `ascent-appscript` runs the automated
back end (Gmail→Gemini invoice ingestion, the hourly JobTread↔Sheet↔Drive mirror).

**Read `CODEBASE_MAP.md` before you touch `src/`.** It is the orientation index:
which doc answers what, a task-to-file table, and a directory map of `src/`. It is
too large to auto-import, so open it. Do not guess where a file lives.

## Write like this

Simplified Technical English, relaxed. These rules apply to every response.

- One idea per sentence. Keep sentences under 25 words.
- Active voice. Present tense. Say who does what.
- Use one word for one thing. Do not vary wording for style.
- Answer first. Add a reason only when it changes a decision.
- Prefer lists and tables to paragraphs. Six sentences per paragraph, maximum.
- Cut: "essentially", "basically", "it's worth noting", "I should mention",
  "let me", "great question", and any clause that restates the clause before it.
- State a risk once, in one sentence. Do not soften it. Do not repeat it.
- Do not narrate your process. Report the result.
- Do not summarize a change the user can read in the diff.
- Define a dev-tooling term the first time you use it, in eight words or fewer,
  in parentheses. The owner knows this system's logic well but not dev jargon.
  That is the only reason to add words.

## Shipping (read this first)

**`main` is production.** A push to `main` deploys to Vercel at once. The owner
does not use branch previews, so there is no review step between your push and
the live app that field staff use.

Work on `main`. If a session put you on a `claude/*` branch, push it directly to
remote main when the change is done:
`git push origin <branch>:main`. Do not merge into local `main` — in ephemeral
environments (CCR) the local `main` ref is often stale or unrelated to
`origin/main`. Pushing branch-to-remote-main avoids that entirely.

**Commit and push to `main` when a change is done.** Do not wait to be asked.
Every one of these must hold first:

1. `npm run typecheck` and `npm run build` both pass. A failure blocks the push.
   The `.githooks/pre-push` hook enforces this. Never bypass it with
   `--no-verify`. Check the hook is armed with `git config core.hooksPath` — it
   must print `.githooks`. On a fresh clone it is empty; run
   `git config core.hooksPath .githooks` once to arm it.
2. Every file is valid UTF-8 text. A stray control or NUL byte makes git treat a
   source file as binary, and it still compiles. If `git` shows a `.tsx` as
   `Bin`, find the byte and remove it.
3. Stage only the files this change touched, by name. Never `git add -A`, never
   `git commit -a`. If the tree holds edits you did not make, leave them alone
   and name the files you left.
4. Say in one line what is about to reach production. Then push.

**Stop and ask instead of pushing** when the change touches `src/auth.ts`,
`src/middleware.ts`, `src/lib/config.ts`, `src/lib/paveGateway.ts`, or any
JobTread write path. Writes are armed in production, so those changes reach live
data on deploy.

If the push is rejected, pull and rebase. Never force-push. Never rewrite history
that is already on `origin`.

- Git + the private GitHub repo (`notkeywitt/ascent-companion`) is the source of
  truth. Pull before you edit.
- **Claude writes the commit message.** Style: short, lowercase, imperative,
  prefixed `companion:` — e.g. `companion: add jobs budget view`. End it with a
  `Co-Authored-By:` trailer naming the model in use.

## Stack & where things live

- **Pages / routes:** `src/app/**` (App Router). A page is `src/app/<route>/page.tsx`.
- **Server API routes:** `src/app/api/**/route.ts` (the only place the JobTread
  grant key is used).
- **Shared logic:** `src/lib/**` — `jobtread.ts` (the typed Pave client + cache),
  `config.ts` (env + gates), `views.ts` (roles + gating), `auth.ts` (session).
- **UI design system:** `src/components/ui.tsx` — **build every UI on these
  primitives**, never hand-rolled styles (`PageHeader`, `Card`, `Input`, `Select`,
  `Textarea`, `Button`, `Banner`, `Loading`, `EmptyState`, `SectionLabel`, `Toggle`),
  plus the "Ledger" set: `SectionHeading` (ochre rule + caption), `ListCard`/`ListRow`
  (hairline-divided rows), `StatementBlock` (the page's ONE display figure), `Chip`
  (status marks), `MetaLine` (dot-separated quiet state — the reason chips stay rare),
  `QuietInput`/`quietInputCls` (a field with no border until focus, for dense editing
  rows), `CountBadge`, `FilterChip`/`ChipScroller` (swipeable filter pills),
  `Meter` (spend vs budget), `StickyActionBar` (a page's commit action, docked).
- **Prefer a hairline to a box, and text to a pill.** A list of records is ONE
  `Card pad={false}` with `divide-y divide-line-soft` rows — never a bordered card
  per record. Ordinary state goes in a `MetaLine`; a `Chip` is spent only on the
  exception (flagged, over budget, unsaved). A dense editing row uses quiet fields,
  not a stroke around every input.
- **Two Tailwind utilities for the same property are resolved by STYLESHEET order,
  not attribute order.** `` `${quietInputCls} w-16` `` only works because the base
  carries no width — if a base class string and a caller's extra both set one, the
  one Tailwind emits later silently wins. Check the built CSS when overriding.
- **Hairlines are tokens, not Tailwind neutrals.** Use `border-line` (card edge),
  `border-line-soft` (divider between rows inside one card) and `border-line-strong`
  (form controls). They're theme variables, so they flip light/dark on their own —
  writing `border-neutral-200 dark:border-neutral-700/60` again re-introduces the
  cool grey the palette was swept off.
- **Nav:** the home launcher lists EVERY view, from `AREAS` in `src/lib/nav.ts`
  (a shared module, because the header's search reads the same list);
  `src/components/TabBar.tsx` is the
  bottom tab bar carrying Home plus the first three of `TAB_CANDIDATES` the signed-in
  role can reach. Reorder that array to change the tabs — nothing else needs touching.
  Its height is `--tabbar-h` (globals.css); anything docking to the bottom of the
  screen must offset by that variable rather than a hardcoded number.
- **Search:** one box for the whole app — `src/components/GlobalSearch.tsx`, in the
  header under the job picker. It searches pages (`lib/nav`), vendors
  (`/api/vendors`) and bills + line items (`/api/bill-search`), each self-hiding
  and view-gated. Don't add a second search field to a page; add a kind of answer
  here instead.
- **Auth:** Auth.js (Google) in `src/auth.ts` + `src/middleware.ts`. Session
  carries `user.role` (`admin`/`office`/`lead`/`field`) + per-user view overrides.
- **DB:** Drizzle + libSQL (`src/db`) — companion-only data (time-off, tool
  tracker, requisitions, etc.), NOT JobTread data.

## How to build a new page (the recipe)

1. **Get JobTread data through the guarded gateway — not directly.** From a client
   component call `gatewayQuery(query)` (`src/lib/paveGatewayClient.ts`), which
   POSTs to `/api/pave`. The server injects the grant key; the browser never sees
   it. Compose the `query` object from **`JT_API_REFERENCE.md`** (in this repo — the
   complete Pave schema). Worked example end-to-end: **`src/app/jobs/`**.
2. **Server page → client component.** The `page.tsx` is a server component that
   passes non-secret context (e.g. `orgId` from `getPaveConfig()`) to a
   `"use client"` component that runs `gatewayQuery`. (Pattern: `src/app/jobs/page.tsx`
   → `JobsBrowser.tsx`.)
3. **Gate it.** Add a `VIEW` entry in `src/lib/views.ts` (choose a group + which
   roles get it — a new id defaults to office+admin), and a launcher entry in
   `AREAS` (`src/lib/nav.ts`) so it's reachable — that list feeds both the home
   launcher and the header's global search.
4. **Build the UI on `ui.tsx` primitives.** Mobile-first (`max-w-2xl`, thumb-sized
   targets), theme-aware. Match the look of existing pages (`src/app/jobs`,
   `src/app/unbilled`, `src/app/stage`).
5. **Verify** (`npm run typecheck` && `npm run build`) before committing — see
   "Shipping"; the pre-push hook runs both again.

For the bigger picture of why the gateway exists and where views should go, see
**`FRONTEND_ARCHITECTURE.md`** (in this repo).

**`ARCHITECTURE_REVIEW.md`** (in this repo) is the standing structural review of both
repos — known weak points, decisions already made and closed (don't re-litigate the
stack), and a staged checklist of agreed cleanup work. **Read it before starting a
refactor or asking "should we rewrite X"** — and tick its checklist as stages land.

## The Pave gateway — data access & write safety

`POST /api/pave { query }` (`src/app/api/pave/route.ts`) runs any Pave query the
browser composes. Rules baked in:

- **Reads** (no mutation at the query root) → allowed for any signed-in role.
- **Writes** (`create*`/`update*`/`delete*`/… root fields) → **triple-gated**:
  `writesEnabled()` **and** `gatewayWritesEnabled()` (env `COMPANION_GATEWAY_WRITES_ENABLED`,
  ships default-off) **and** the mutation is on the caller's per-role allowlist in
  `src/lib/paveGateway.ts`. New pages are **read-first**; don't add writes or touch
  the allowlist without the owner's ok.

> ⚠️ **Two different flags — don't conflate them.**
> `COMPANION_WRITES_ENABLED` is the **master** switch and is **ARMED in production**:
> coding saves, bill creation, invoicing, time entries and leave posting are all
> real writes to the live JobTread org today. `COMPANION_GATEWAY_WRITES_ENABLED` is
> the separate, narrower gate above, covering only `/api/pave`.
>
> Neither runtime value is visible from this repo — they're Vercel env vars. The
> `false` in `.env.example` is a safe **local** default, not a statement about
> production. **Don't tell the owner writes are off; you can't see that from here.**
> If it matters, ask or check Vercel.
- The **grant key is server-only** (env `JT_GRANT_KEY`). Never send it to the
  browser; never call `https://api.jobtread.com/pave` from client code.

## JobTread / Pave gotchas (the expensive ones)

`JT_API_REFERENCE.md` is the full schema + query grammar. Key rules when composing
queries:

- **`where` is an expression tree, not tuples:**
  `{"and":[{"=":[{"field":"type"},{"value":"vendorBill"}]}]}` — a bare 2-element
  array is parsed as a field PATH and errors.
- **Page size cap is 100**, and pagination is a **cursor**: request `nextPage: {}`
  and feed the returned token back as `page`. `offset` 400s; `size: 250` silently
  returns 0.
- **413 rule:** do NOT nest a heavy connection (`customFieldValues`, `costItems`)
  inside another **paged** connection — it returns HTTP 413. Fetch it in a **second
  phase** and join by id (example: `loadStatusMap` in `src/app/jobs/JobsBrowser.tsx`).
- **Budget vs. actual:** a job's budget leaves are `costItems` with `document == null`
  (skip JT's `Uncategorized <code>` rollups); actual spend is the cost of lines on
  **approved** `vendorBill` documents. CSI **division** = first two digits of the
  cost-code number; `costCode.parentCostCode` is JobTread's own division name.
- **Mutations return** a `created<X>` node (creates) or bare `root` (updates/deletes,
  re-read by id). A **write** of an unfamiliar field should be probed against the
  live API first — trust the reference for shape, verify behavior for writes.

`JT_API_REFERENCE.md` here is a synced copy; the canonical lives in
`ascent-appscript` (regenerated by walking the live schema via the JobTread MCP
connector). If the connector is available in your session, introspect to confirm an
unfamiliar field; otherwise trust the reference.

## Source of truth — don't fight the mirror

**JobTread is THE source of truth.** The `ascent-appscript` hourly loop mirrors JT
bills → the Google Sheet and Drive tree automatically. The companion must not add
write paths that race that mirror — which is exactly why the *generic gateway*
ships default-off while the purpose-built routes carry the writes. When in doubt,
**read from JobTread and route writes through the existing, purpose-built paths**
rather than inventing a new one.

## Don't touch without asking

- `HANDOFF.md` — don't read automatically.
- Auth/session (`src/auth.ts`, `src/middleware.ts`) and the write gates
  (`src/lib/config.ts`, `src/lib/paveGateway.ts`) — changing these changes who can
  do what; get the owner's ok.
