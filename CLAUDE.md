# CLAUDE.md — Ascent Assistant (companion)

The human-facing app for Ascent Building Co. — a **Next.js (App Router) app on
Vercel** that is the UI over **JobTread** (its "Pave" API) plus a small companion
database (Drizzle + libSQL). It replaces the retired AppSheet UI and progressively
absorbs those functions. The sibling repo `ascent-appscript` runs the automated
back end (Gmail→Claude invoice ingestion, the hourly JobTread↔Sheet↔Drive mirror).

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

1. `npm run typecheck`, `npm test` and `npm run build` all pass. A failure blocks
   the push. The `.githooks/pre-push` hook enforces this. Never bypass it with
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

**Use `npm run ship` to finish a session.** It commits the session ledger,
fetches, rebases onto `origin/main`, then pushes `HEAD:main` — the pre-push hook
still runs typecheck and build. Rebasing before the push is what stops a stale
branch turning into a push conflict; `main` moves dozens of commits a day.

## Where you left off — the session ledger

`.claude/sessions/<date>-<slug>.md` records this branch. `SESSIONS.md` indexes them all.

- The log writes itself (`.githooks/post-commit`). Never hand-write a row under `## Log`.
- Before you stop, set `next:` — `node scripts/session.mjs set next "the next concrete step"`.
- `SESSIONS.md` and `src/lib/sessionLog.generated.json` are generated. Do not hand-edit them.

## Stack & where things live

- **Pages / routes:** `src/app/**` (App Router). A page is `src/app/<route>/page.tsx`.
- **Server API routes:** `src/app/api/**/route.ts` (the only place the JobTread
  grant key is used).
- **Shared logic:** `src/lib/**` — `jobtread.ts` (the typed Pave client + cache),
  `config.ts` (env + gates), `views.ts` (roles + gating), `auth.ts` (session).
- **UI work: read `THEME.md` first.** Its "Rules for writing UI" section holds
  the `ui.tsx` primitives, the status and hairline tokens, the two palettes,
  the Tailwind ordering trap and the no-colour-emoji rule.
- **Nav:** ONE list — `WORKSPACES` in `src/lib/workspaces.ts` groups every page
  into a workspace named for a recurring job (Invoicing, Incoming Bills, …). It
  feeds the header's ☰ menu (`src/components/AppMenu.tsx`), the bottom bar
  (`src/components/TabBar.tsx`, slots per role in `BARS`) and the header search.
  A tab keeps its route and its view id. The bar's height is `--tabbar-h`
  (globals.css); anything docking to the bottom of the screen must offset by
  that variable rather than a hardcoded number. From `pad` up the bar is a left
  rail of width `--rail-w`: a `fixed inset-x-0` element must also set
  `left: var(--rail-w)` or it runs under the rail.
- **Search:** one box for the whole app — `src/components/GlobalSearch.tsx`, the
  widest item in the header row. It searches pages (`lib/workspaces`), vendors
  (`/api/vendors`) and bills + line items (`/api/bill-search`), each self-hiding
  and view-gated. Don't add a second search field to a page; add a kind of answer
  here instead.
- **Auth:** Auth.js (Google) in `src/auth.ts` + `src/middleware.ts`. Session
  carries `user.role` (`admin`/`office`/`lead`/`field`) + per-user view overrides.
- **DB:** Drizzle + libSQL (`src/db`) — companion-only data (time-off, tool
  tracker, requisitions, etc.), NOT JobTread data.

## How to build a new page (the recipe)

1. **Read JobTread through a purpose-built route.** Add the read to the
   matching part of the typed Pave client under `src/lib/jobtread/` (page with
   `pageAll`/`pageEach`), re-export it from `src/lib/jobtread.ts`, and add a
   `src/app/api/<name>/route.ts` that imports it from `@/lib/jobtread`. A value
   that two parts read at load time goes in `jobtread/core.ts`. The route runs on the
   server, so the grant key never reaches the browser. Compose the query from
   **`JT_API_REFERENCE.md`** (in this repo — the complete Pave schema). Worked
   example end-to-end: **`src/app/jobs/`**, which reads `/api/jobs/browser` and
   `/api/jobs/cost-detail` (those two routes are not yet on the `jobs` view's
   `paths` — step 3 — because a lead's job panel also reads cost-detail). There
   is no generic gateway: `/api/pave`, which ran any query the browser composed,
   was removed on 2026-11-08. Do not add one back.
2. **Server page → client component.** The `page.tsx` is a server component that
   renders a `"use client"` component, and that component fetches the route.
   (Pattern: `src/app/jobs/page.tsx` → `JobsBrowser.tsx`.)
3. **Gate it.** Add a `VIEW` entry in `src/lib/views.ts` (choose a group + which
   roles get it — a new id defaults to office+admin) and list every API route the
   page calls in that view's `paths`, or any signed-in role can call the route
   directly. Then add a tab in the right
   workspace in `src/lib/workspaces.ts` so it's reachable — that list feeds the
   menu, the bar and the header's global search. `workspaces.test.ts` fails on a
   page that is on no workspace.
4. **Build the UI on `ui.tsx` primitives** (rules in `THEME.md`). Mobile-first (`max-w-2xl`, thumb-sized
   targets), theme-aware. Match the look of existing pages (`src/app/jobs`,
   `src/app/unbilled`, `src/app/budget-import`).
5. **Verify** (`npm run typecheck`, `npm test`, `npm run build`) before
   committing — see "Shipping"; the pre-push hook runs all three again.

For the bigger picture of why the gateway exists and where views should go, see
**`FRONTEND_ARCHITECTURE.md`** (in this repo).

**`ARCHITECTURE_REVIEW.md`** (in this repo) is the standing structural review of both
repos — known weak points, decisions already made and closed (don't re-litigate the
stack), and a staged checklist of agreed cleanup work. **Read it before starting a
refactor or asking "should we rewrite X"** — and tick its checklist as stages land.

## JobTread data access & write safety

Every JobTread read and write goes through a purpose-built route in
`src/app/api/**` that calls `src/lib/jobtread.ts`. The browser never composes a
Pave query.

- **Writes** go through `writesEnabled()` (`src/lib/config.ts`). New pages are
  **read-first**. Don't add a write path without the owner's ok.
- `src/lib/paveGateway.ts` outlived the gateway. `findMutations` defines what
  counts as a write, and `pave()` never retries one. Its per-role mutation
  allowlist no longer gates any route.

> ⚠️ **`COMPANION_WRITES_ENABLED` is the master switch and is ARMED in production.**
> Coding saves, bill creation, invoicing, time entries and leave posting are all
> real writes to the live JobTread org today. `COMPANION_GATEWAY_WRITES_ENABLED`
> gated only the removed `/api/pave`, so it now gates nothing.
>
> Neither runtime value is visible from this repo — they're Vercel env vars. The
> `false` in `.env.example` is a safe **local** default, not a statement about
> production. **Don't tell the owner writes are off; you can't see that from here.**
> If it matters, ask or check Vercel.
- The **grant key is server-only** (env `JT_GRANT_KEY`). Never send it to the
  browser; never call `https://api.jobtread.com/pave` from client code.

## Never delete a bill. Void it.

Deleting a JobTread document destroys history that the void keeps. A bill that
must stop counting is **voided**: remove every applied payment, then set its
status to `denied`. Pave has no void mutation — `denied` IS the void, and every
report, cost roll-up, reconcile and invoice check in both repos already excludes
it. A voided bill keeps its `externalId` forever, which is what stops the
appscript mirror re-creating it as an unmatched row.

The reference implementation is `_jtVoidDocument` in `ascent-appscript/JobTread.js`
(it also quarantines the bill's Drive PDF). Route a void through the appscript side
rather than writing a second one here.

No route composes a document delete today. Only this rule keeps it that way. Do
not add `deleteDocument`, `deletePayment` or `deleteDocumentPayment` to a
purpose-built route.

A single bill **line** is different, and deleting one is allowed: `/api/delete-line`
does it deliberately, and `getLineJournalSnapshot` (`src/lib/jobtread.ts`) captures
the line's amount, code and bill immediately before it stops existing, so the delete
leaves a record instead of a disappearance. Keep that snapshot on any new path that
removes a line. The ban is on deleting a whole document.

## JobTread / Pave gotchas

Before you compose or change a Pave query, read `PAVE_GOTCHAS.md`. Two rules cost the most:

- Never hand-write a page loop. Use `pageAll` / `pageEach` (`src/lib/jobtread.ts`).
- Never nest a heavy connection (`customFieldValues`, `costItems`) in a paged one. Fetch it in a second phase.

## Source of truth — don't fight the mirror

**JobTread is THE source of truth.** The `ascent-appscript` hourly loop mirrors JT bills to the Google Sheet and Drive. Do not add a write path that races it. Read from JobTread. Route writes through the existing purpose-built paths.

## When a task needs the Apps Script repo

Only this repo is attached by default. These tasks also need `ascent-appscript`:

| The task involves | Lives in `ascent-appscript` |
|---|---|
| A page backed by Sheets, Drive, Gmail or Calendar (employees, tools, mileage, safety, requisitions, Sunset, tracking sheets) | The file `CODEBASE_MAP.md` names in its row. This side calls it through `src/lib/appsScript.ts`. |
| A new or changed action the Assistant calls | `WebApp.js`, the `doPost` router |
| Voiding a bill | `_jtVoidDocument` in `JobTread.js` |
| Billing-period rule | `deriveBillingPeriod()` in `Config.js` (`src/lib/billing.ts` copies it) |
| Where a bill PDF is named and filed | `DRIVE_FILING.md`, `reconcileDriveFiling()` |
| Invoice ingestion from Gmail | `Ingestion.js` |

Do this:

1. Read this repo's side first. `CODEBASE_MAP.md` names the Apps Script file.
2. If the fix needs a change there, say so. Then attach it: `add_repo` with owner `notkeywitt`, repo `ascent-appscript`.
3. Read its `CLAUDE.md` before you edit. It has its own hard rules (no scope change in `appsscript.json`, probe every write, keep DRY_RUN guards).
4. A push there deploys nothing. The deploy is a separate step the owner approves.

## Docs — where a new one goes

- **Do not add a new `.md` file at the repo root.** Put the fact in the doc that
  already owns its topic. `CODEBASE_MAP.md` lists which doc owns what.
- **A plan or an audit goes in `docs/plans/`.** That folder holds work that is
  proposed or under way, not rules. Code comments may cite a plan by bare file name.
- **Every file in `docs/plans/` starts with a status line**, directly under its
  title: `Status: draft | agreed | in progress | done — YYYY-MM-DD`. Update it
  when the state changes. A test fails on a plan without one.
- **When a plan is done, delete it.** First move any rule it holds that is still
  true into the doc that owns the topic. Git history keeps the plan's text.

## Don't touch without asking

- `HANDOFF.md` — don't read automatically.
- Auth/session (`src/auth.ts`, `src/middleware.ts`) and the write gates
  (`src/lib/config.ts`, `src/lib/paveGateway.ts`) — changing these changes who can
  do what; get the owner's ok.
