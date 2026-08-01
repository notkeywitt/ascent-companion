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
2. **Writes stay behind `writesEnabled()` + an allowlist** (see gateway below). Reads are open to
   authorized roles; mutations are explicitly enumerated.
3. **Role/view gating** (`lib/views.ts`) decides which views + data each role sees — enforced in
   middleware, not just hidden in the UI.

## The "customizable" core — a generic guarded Pave gateway

Today each view needs a bespoke `src/app/api/*` route. Because we now hold the **entire schema**, we
can add **one** server endpoint that executes an arbitrary Pave query object, so new views compose
queries directly instead of waiting on a new route:

```
POST /api/pave            (server-only; grantKey injected server-side)
  body: { query: <Pave query object, WITHOUT the $.grantKey> }
  guard:
    - require an authenticated session; resolve role from the JWT
    - REJECT if the query contains any mutation root field (create*/update*/delete*/send*/submit*/
      rerun*/cancel*/close*/renameFolder/markCommentAsUnread/notify*) UNLESS:
        * writesEnabled() is true, AND
        * the mutation name is in an explicit per-role ALLOWLIST
    - inject $.grantKey (+ organizationId defaults) server-side
    - pass through pave() so cachedRef / retry / error-normalization still apply
  response: the Pave result tree (or { errors } normalized)
```

- **Reads:** any authorized role can run any read query — the schema is the contract, and
  [JT_API_REFERENCE.md](JT_API_REFERENCE.md) tells the view author exactly what to select.
- **Writes:** default-denied. A mutation only runs when the gate is on *and* the mutation is
  allowlisted for that role. This is the single choke point for the "never fight the JT→sheet mirror"
  rule (CLAUDE.md) — keep the appscript mirror as the source of truth and only allow front-end writes
  that don't race it.
- **Keep bespoke typed routes** for hot or multi-step paths (add-bill, invoice staging, budget
  cost-to-complete) where server-side composition/validation matters. The gateway is for the long
  tail of read views and simple writes.

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
rule #3) before enabling it in the gateway allowlist.

## Open items before coding

- Confirm the gateway's mutation allowlist per role with the owner (which writes the front end may do
  vs. which must stay in the appscript mirror).
- Finish the last two API-reference domains (Logs/Forms/Automation) once the MCP connector is back,
  so reporting/automation views aren't guesswork.
