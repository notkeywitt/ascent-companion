# Lightweight Custom JobTread Front End — Architecture

**Goal:** a lightweight, *customizable* front end over JobTread — the views Ascent actually needs,
without fighting the JobTread UI. The prerequisite (stop guessing at the API) is now met by
[JT_API_REFERENCE.md](JT_API_REFERENCE.md) + the live introspection recipe. This doc is the
architecture sketch for the build; it is guidance, not a line-by-line implementation plan.

> **Target repo:** the front end lives in **`ascent-companion`** (the Next.js "Ascent Assistant" on
> Vercel), not this Apps Script repo. Paths below are relative to `ascent-companion/`.

## Core decision — extend `ascent-companion`, do not start a new app

`ascent-companion` **already is** a lightweight Pave front end. Starting over would rebuild auth,
caching, the design system, deployment, and the write-safety gate for no reason. What already exists
and gets reused as-is:

| Concern | Reuse |
|---|---|
| Pave client | `src/lib/jobtread.ts` — the typed `pave()` client + `cachedRef` (TTL cache), covering jobs, budgets, bills, invoices, cost-to-complete, time entries, memberships, file upload |
| Config / secrets | `src/lib/config.ts` — `getPaveConfig()`, `JT_GRANT_KEY`/`JT_ORG_ID` from env (server-only) |
| Write safety | `writesEnabled()` master gate (`COMPANION_WRITES_ENABLED`) — global JT-write kill switch |
| UI system | `src/components/ui.tsx` primitives + the ink dark-surface scale (never hand-roll styles) |
| Access control | `src/lib/views.ts` + middleware — Admin/Office/Field roles, per-user overrides, role baked into the JWT at sign-in, managed at `/admin` |
| Route pattern | `src/app/api/**` — working examples of each call (add-bill, unbilled, job-budget, employee-time, labor-rates, reassign-job, combine-lines, …) |

## Security invariants (non-negotiable)

1. **The `grantKey` never reaches the browser.** All Pave traffic goes through Next.js server code
   (route handlers / server actions). The client calls *our* endpoints; only the server holds the key.
2. **Writes stay behind `writesEnabled()`**, each in its own purpose-built route. Reads are open
   to the roles a view's `paths` allow.
3. **Role/view gating** (`lib/views.ts`) decides which views + data each role sees — enforced in
   middleware, not just hidden in the UI.

## No generic gateway

An earlier design here added one endpoint, `POST /api/pave`, that ran any Pave
query the browser composed. It was built, then removed on 2026-11-08: its last
two callers moved to purpose-built routes. Every view reads and writes JobTread
through its own route in `src/app/api/**`, which calls `src/lib/jobtread.ts`.
The route is what a view's `paths` gate in `src/lib/views.ts`.

Two parts outlived the gateway. `src/lib/paveGateway.ts` still defines what
counts as a write (`findMutations`), and `pave()` never retries one; its per-role
mutation allowlist gates no route now. `COMPANION_GATEWAY_WRITES_ENABLED` gated
only `/api/pave`, so it gates nothing. `COMPANION_WRITES_ENABLED` is the master
switch for every write.

The `jobs` page is the worked example of a purpose-built read:
`src/app/jobs/` reads `/api/jobs/browser` and `/api/jobs/cost-detail`. Those two
routes are not on the `jobs` view's `paths`, because a lead's job panel also
reads cost-detail.

## Views, gates and links — rules that hold for every page

- **Never rename or merge a view id.** Role Defaults, per-user grants, rail
  pins and `home.dest.<view>` copy keys all hang off it.
- **A new view id reaches a user only at their next sign-in.** The role sits in
  the session token.
- **A tab that needs its own gate is its own path,** listed in that view's
  `paths` in `src/lib/views.ts`. Middleware ignores the query string.
- **Gate each section, not only the tab,** when a page calls another view's API
  (the `TrackingSheetSync.tsx` pattern).
- **Folding pages into a hub.** Every old route redirects, non-permanent, in
  `next.config.mjs`. Staff have bookmarks. Each section keeps its own view gate.
  Two patterns exist: hub tabs with embedded pages (the Jobs page,
  `src/app/jobs-hub/`) and `?section=` strips (Inbox, Payroll).
- **Link to a job with `hubHref`** (`src/lib/hubUrl.ts`), never
  `/trackingsheet?jobId=`.
- **Today's rows read stored or cached results.** A live sweep (vendor mail
  runs up to 120 s) never runs on Today's load.
- **Keep the Chrome side panel's `/?jobId=` contract on Today.**
- **Open security item (M-1):** an API route that no view lists in `paths`
  is open to any signed-in role. A few are open on purpose
  (`/api/jobs/cost-detail`, read by a lead's job panel). Refusing unlisted
  routes in `src/middleware.ts` closes them together; it needs the owner's ok.

## View roadmap (each maps to a JT_API_REFERENCE.md domain)

Build on `ui.tsx` + role gating, in priority order:

1. **Jobs** — list + detail; budget & cost-to-complete (`job`, `costItem`, `costGroup`; server-side
   `group`/aggregates for financials). *Reference: Jobs / Budget & Cost.*
2. **Documents** — bills / invoices / payments; the coding & invoicing queues (`document`,
   `documentPayment`, `payment`; unbilled = Σ approved vendorBill.cost − Σ customerInvoice.cost).
   *Reference: Documents & Payments.*
3. **Tasks / Schedule** — schedule + to-dos (`task`, `taskType`). *Reference: Tasks & Schedule.*
4. **Time entries** — clock in/out, approvals (`timeEntry`; remember the UTC-timestamp conversion).
   *Reference: Time Entries.*
5. **Contacts / Accounts** — customers & vendors (`account`, `contact`, `location`).
   *Reference: Grants/Org/Accounts.*

## Optional acceleration

Generate typed per-entity client helpers **from** the JT_API_REFERENCE.md catalog (entity → field
list + types), so hand-written client code shrinks and stays in sync with the schema. Re-generate
after each introspection refresh.

## Working rule for every new view

**Introspect before you build.** When a view needs a field the reference doesn't already list, run
the 4-step recipe (see JT_API_REFERENCE.md → Fundamentals) against the live schema, add it to the
doc, then build. For any **write** of a newly-used field, still probe behavior first (CLAUDE.md
rule #3) before you add it to a route.

## Open items before coding

- Finish the last two API-reference domains (Logs/Forms/Automation) once the MCP connector is back,
  so reporting/automation views aren't guesswork.
