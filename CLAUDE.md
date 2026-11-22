# CLAUDE.md — Ascent Assistant (companion)

The human-facing app for Ascent Building Co.: a **Next.js (App Router) app on
Vercel** over **JobTread** (its "Pave" API), plus a small companion database
(Drizzle + libSQL). It replaced AppSheet. The sibling repo `ascent-appscript`
runs the automated back end (Gmail→Claude invoice ingestion, the hourly
JobTread↔Sheet↔Drive mirror).

## Read before you work

| Before you… | Read |
|---|---|
| touch `src/` | the task table in `CODEBASE_MAP.md`. It is not auto-loaded. Do not guess where a file lives. If it does not name the file: `docs/CODEBASE_DIRS.md` |
| write UI | "Rules for writing UI" in `THEME.md`. Only that section, unless the task is a palette |
| compose or change a Pave query | `PAVE_GOTCHAS.md`, then only the `JT_API_REFERENCE.md` section you need (`PAVE_GOTCHAS.md` says how) |
| refactor, or ask "should we rewrite X" | `ARCHITECTURE_REVIEW.md`. Do not re-open its closed decisions. Tick its checklist as stages land |
| change how views reach JobTread | `FRONTEND_ARCHITECTURE.md` |

## Write like this

Simplified Technical English, relaxed. These rules apply to every response.

- One idea per sentence, under 25 words. Active voice, present tense.
- Use one word for one thing. Do not vary wording for style.
- Answer first. Add a reason only when it changes a decision.
- Report the result. Do not narrate your process or restate the diff.
- Prefer lists and tables. Six sentences per paragraph, maximum.
- Cut filler ("essentially", "basically", "it's worth noting", "let me").
- State a risk once, in one sentence. Do not soften it.
- Define a dev-tooling term the first time you use it, in eight words or fewer,
  in parentheses. The owner knows this system well but not dev jargon.

## Shipping

**`main` is production.** Only the lander (a GitHub Action that merges the
release queue, verifies and deploys it) pushes `main`. Never push `main`. Never
bypass the pre-push hook with `--no-verify`.

Work in a worktree (a private copy of the repo folder) when the session-start
hook says so. A cloud session on a `claude/*` branch is already isolated.

**Ship when a change is done.** Do not wait to be asked.

```
git add <each file this change touched>
npm run ship -- "companion: <message>" "<one plain sentence>"
```

The second argument becomes the commit's `Change-log:` line. Admin's Change Log
shows it. Write what the office will notice, with no code words.

`ship` checks for binary-looking text files, runs typecheck and tests, commits
what is staged and queues the branch as `ready/<name>`. Tell the owner one line:
what is queued for production. Do not show git output.

- Stage only the files this change touched, by name. Never `git add -A` or
  `git commit -a`. Leave edits you did not make, and name those files.
- `--now` (express deploy, ahead of the batch) only when the owner says "push
  through": `npm run ship -- --now "companion: <message>"`.
- Commit message: short, lowercase, imperative, prefixed `companion:`. End it
  with a `Co-Authored-By:` trailer naming the model in use.
- Never force-push `main`. Never rewrite history on `main`.
- A branch the lander cannot land moves to `stuck/<name>`. The session-start
  hook lists stuck branches and prints the fix.
- To look at a change: `npm run dev`. On the owner's phone: commit, then
  `npm run preview` (JobTread writes off). The preview uses the production
  companion database: do not preview an `applySchema` change unless asked.
- One task per session. Default model is Sonnet. Use Opus for a design decision,
  a schema change, the lander, or a "Stop and ask" change.

## Stop and ask

Get the owner's ok before you change any of these. Do not ship them on your own.

- `src/auth.ts`, `src/middleware.ts` (who can do what)
- `src/lib/config.ts`, `src/lib/paveGateway.ts` (the write gates)
- Any JobTread write path, including a new one. New pages are read-first.

**`COMPANION_WRITES_ENABLED` is armed in production.** Coding saves, bill
creation, invoicing, time entries and leave posting write to the live JobTread
org. You cannot see Vercel env vars from here: the `false` in `.env.example` is
a local default. Never tell the owner writes are off.

Do not read `HANDOFF.md` unless the owner asks.

## Stack

- Pages: `src/app/<route>/page.tsx`. API routes: `src/app/api/**/route.ts`,
  the only place the grant key is used.
- Shared logic: `src/lib/` — `jobtread.ts` (typed Pave client), `config.ts`,
  `views.ts` (roles + gating), `workspaces.ts` (nav).
- Auth: Auth.js (Google). Session carries `user.role`
  (`admin`/`office`/`lead`/`field`) plus per-user view overrides.
- DB (`src/db`): companion-only data (time-off, tools, requisitions). Not
  JobTread data.
- **One nav list, one search box.** Every page sits in `WORKSPACES`
  (`src/lib/workspaces.ts`), which feeds the menu, the bar and search. Search is
  `src/components/GlobalSearch.tsx`. Add a kind of answer there; never a second
  search field.

## How to build a new page

1. **Read JobTread through a purpose-built route.** Add the read under
   `src/lib/jobtread/` (page with `pageAll`/`pageEach`), re-export it from
   `src/lib/jobtread.ts`, and call it from `src/app/api/<name>/route.ts`. A value
   two parts read at load time goes in `jobtread/core.ts`. Worked example:
   `src/app/jobs/`. There is no generic gateway; do not add one back.
2. **Server page → client component.** `page.tsx` renders a `"use client"`
   component that fetches the route (`jobs/page.tsx` → `JobsBrowser.tsx`).
3. **Gate it.** Add a `VIEW` in `src/lib/views.ts` (a new id defaults to
   office+admin). List every API route the page calls in its `paths`, or any
   signed-in role can call it. Add a tab in `src/lib/workspaces.ts`.
4. **Build on `ui.tsx` primitives.** Mobile-first (`max-w-2xl`, thumb-sized
   targets), theme-aware. Match `src/app/jobs`, `src/app/unbilled`.
5. **Ship.** Run `npm run build` first when you add a page or a route.

## JobTread rules

- The browser never composes a Pave query. The grant key (`JT_GRANT_KEY`) is
  server-only. Never call `https://api.jobtread.com/pave` from client code.
- Writes go through `writesEnabled()` (`src/lib/config.ts`).
- Never hand-write a page loop. Use `pageAll` / `pageEach`.
- Never nest a heavy connection (`customFieldValues`, `costItems`) in a paged
  one. Fetch it in a second phase.
- **JobTread is the source of truth.** The appscript hourly loop mirrors it to
  the Sheet and Drive. Do not add a write path that races the mirror.

## Never delete a bill. Void it.

A bill that must stop counting is **voided**: remove every applied payment,
then set status `denied`. Every report and reconcile in both repos excludes
`denied`, and the bill keeps its `externalId`, so the mirror does not re-create
it. Route a void through appscript `_jtVoidDocument`. Never add
`deleteDocument`, `deletePayment` or `deleteDocumentPayment` to a route.

Deleting one bill **line** is allowed (`/api/delete-line`). Any path that
removes a line keeps the `getLineJournalSnapshot` record of it.

## When a task needs the Apps Script repo

Pages backed by Sheets, Drive, Gmail or Calendar; a new Assistant action
(`WebApp.js`); a void; the billing-period rule; Drive PDF filing; Gmail
ingestion. `CODEBASE_MAP.md` names the file.

1. Read this repo's side first.
2. If the fix needs appscript, say so, then `add_repo` (owner `notkeywitt`,
   repo `ascent-appscript`).
3. Read its `CLAUDE.md` before you edit. It has its own hard rules.
4. A push there deploys nothing. The owner approves the deploy.

## Docs

- No new `.md` at the repo root. Put the fact in the doc that owns the topic.
- A plan or audit goes in `docs/plans/`, with a status line under its title
  (`Status: draft | agreed | in progress | done — YYYY-MM-DD`). A test enforces it.
- When a plan is done, move its still-true rules to the owning doc, then delete it.
