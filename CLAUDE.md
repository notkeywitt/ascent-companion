Do NOT read HANDOFF.md automatically. Only check it when I explicitly ask you to.

# CLAUDE.md — Ascent Assistant (companion)

The human-facing app for Ascent Building Co. — a **Next.js (App Router) app on
Vercel** that is the UI over **JobTread** (its "Pave" API) plus a small companion
database (Drizzle + libSQL). It replaces the retired AppSheet UI and progressively
absorbs those functions. The sibling repo `ascent-appscript` runs the automated
back end (Gmail→Gemini invoice ingestion, the hourly JobTread↔Sheet↔Drive mirror).

The owner is a **knowledgeable novice** — understands the business logic deeply,
but is not a professional developer. Explanations should be clear and concrete;
don't assume dev-tooling fluency.

## The mobile build loop (read this first)

You may be invoked from a **phone**. The owner will describe a feature or page in
plain language; your job is to build it, get it onto a **Vercel preview**, and let
them test it from their phone before it goes to production. The loop:

1. **Work on a branch, never straight on `main`.** Claude Code already puts your
   work on a `claude/*` branch — keep it there. `main` = production; a branch = a
   preview.
2. **Build the page** following "How to build a new page" below.
3. **Verify before you commit** — both must pass:
   ```
   npm run typecheck
   npm run build
   ```
   Files must be valid UTF-8 text (a stray control/NUL byte makes git treat a
   source file as binary and can still compile — if `git` shows a `.tsx` as
   `Bin`, find and remove the byte).
4. **Push the branch.** Vercel builds a **preview deployment** for every branch —
   its URL appears on the GitHub PR (Vercel bot comment) and in the Vercel
   dashboard. Give the owner that preview URL to test on their phone.
5. **Promote when approved.** Merging the branch into `main` ships it to
   production. Only merge when the owner says so.

Keep new pages **read-only** unless the owner explicitly asks for writes (see the
gateway rules) — a preview that only reads JobTread is safe to hand to a phone.

## How code reaches production

- Edits → a `claude/*` branch → `git push` → **Vercel preview**. Merge to `main`
  → **Vercel production**.
- Git + the private GitHub repo (`notkeywitt/ascent-companion`) is the source of
  truth. Assume pull-before-edit, push-after.
- **Claude writes the commit message.** Style: short, lowercase, imperative,
  prefixed `companion:` — e.g. `companion: add jobs budget view`. End commits with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Only run
  `git commit`/`git push` when asked, but always propose the message.

## Stack & where things live

- **Pages / routes:** `src/app/**` (App Router). A page is `src/app/<route>/page.tsx`.
- **Server API routes:** `src/app/api/**/route.ts` (the only place the JobTread
  grant key is used).
- **Shared logic:** `src/lib/**` — `jobtread.ts` (the typed Pave client + cache),
  `config.ts` (env + gates), `views.ts` (roles + gating), `auth.ts` (session).
- **UI design system:** `src/components/ui.tsx` — **build every UI on these
  primitives**, never hand-rolled styles (`PageHeader`, `Card`, `Input`, `Select`,
  `Textarea`, `Button`, `Banner`, `Loading`, `EmptyState`, `SectionLabel`, `Toggle`).
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
   `src/app/page.tsx` `AREAS` so it's reachable (the home launcher is the only nav).
4. **Build the UI on `ui.tsx` primitives.** Mobile-first (`max-w-2xl`, thumb-sized
   targets), theme-aware. Match the look of existing pages (`src/app/jobs`,
   `src/app/unbilled`, `src/app/stage`).
5. **Verify** (`npm run typecheck` && `npm run build`) before committing.

For the bigger picture of why the gateway exists and where views should go, see
**`FRONTEND_ARCHITECTURE.md`** (in this repo).

## The Pave gateway — data access & write safety

`POST /api/pave { query }` (`src/app/api/pave/route.ts`) runs any Pave query the
browser composes. Rules baked in:

- **Reads** (no mutation at the query root) → allowed for any signed-in role.
- **Writes** (`create*`/`update*`/`delete*`/… root fields) → **triple-gated**:
  `writesEnabled()` **and** `gatewayWritesEnabled()` (env `COMPANION_GATEWAY_WRITES_ENABLED`,
  **off by default**) **and** the mutation is on the caller's per-role allowlist in
  `src/lib/paveGateway.ts`. New pages are **read-first**; don't add writes or touch
  the allowlist without the owner's ok.
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
write paths that race that mirror — which is exactly why gateway writes are gated
off by default. When in doubt, **read from JobTread and let the owner drive writes**
through the existing, purpose-built routes.

## Don't touch without asking

- `HANDOFF.md` — don't read automatically.
- Auth/session (`src/auth.ts`, `src/middleware.ts`) and the write gates
  (`src/lib/config.ts`, `src/lib/paveGateway.ts`) — changing these changes who can
  do what; get the owner's ok.
