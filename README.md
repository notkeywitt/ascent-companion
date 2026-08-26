# Ascent Assistant

The human-facing app for Ascent Building Co. — a phone-first PWA (plus a Chrome
side panel that docks next to JobTread) that puts the day-to-day office and field
work in one place. It replaced the retired AppSheet front end and is the UI layer
over two back ends: **JobTread** (via its Pave API) and the **Ascent Apps Script
engine** (the Gmail→Gemini→JobTread ingestion/sync suite in the sibling
`../ascent-appscript` repo).

**JobTread is the source of truth for anything financial** — bills, jobs,
budgets, invoices. The app holds no billing database; it reads and writes
JobTread live. A small companion database exists only for data JobTread has no
home for (RFIs, feature requests, the sign-in allowlist, a couple of workflow
flags, and a Sunset-statement cache).

Live at **https://ascent-companion.vercel.app** (Vercel). Access is restricted to
Ascent staff via Google sign-in (allowlist), with a shared-password fallback.

## What it does

The launcher (`src/app/page.tsx`) groups every screen into four areas:

### Financials — JobTread bills, unbilled costs, and invoicing
- **Coding Review** (`/coding`) — draft vendor bills waiting to be coded. Fast,
  flat, touch-friendly cost-code assignment on each line, then approve. This is
  the thing JobTread buries under nested layers; it was the original reason for
  the app.
- **Invoicing** (`/stage`) — assemble a month's draft customer invoice from a
  job's unbilled costs (owner reviews/sends inside JobTread; we only stage).
- **Unbilled** (`/unbilled`) — a per-job view of uninvoiced expenses by cost
  code (cost vs. invoiced). The view JobTread lacks.
- **Email Invoices** (`/email`) — log an invoice sitting in the office inbox.
- **Needs Project** (`/needs-project`) — ingested bills that arrived without a
  matchable job; assign the job here.
- **Add a Bill** (`/add-bill`) — manual capture: upload a photo/PDF, Gemini
  extracts and codes it against the job's live budget, and a draft vendor bill
  lands in the coding queue with the file attached.

### Tools — the field tool inventory
- **Tool Inventory** (`/tools`) — search, edit, or scan a tool's QR code to
  update its location/photo.

### Safety — job-site records
- **Safety Meeting** (`/safety-meeting`) — pass the iPad and collect drawn
  sign-ins; a roster PDF is written to Drive.
- **Mileage** (`/mileage-tracker`) — one-tap start/end captures two GPS points;
  the server turns them into driving miles + street addresses (Google Maps
  Routes/Geocoding).
- **Employee Time** (`/employee-time`) — a phone time clock: clock in/out (the
  running clock lives in JobTread, so it resumes on any device), a day-grouped
  Timesheets tab for the pay period, and a "log a range" form for time already
  worked. Job/cost/pay default to the last one used; the clock-out can be
  back-dated. Required note, optional photos; creates a JobTread time entry.
  The page is server-rendered with the jobs, the identity, and the running clock
  already in it — the email → JobTread link is cached in `jt_user_links` and in
  the sign-in token, so no page load waits on Apps Script (~3 s per round trip).

### Utilities — assistant, records, imports, and admin
- **Assistant** (`/chat`) — a read-only Claude chat over a job's bills and
  budget.
- **RFIs** (`/rfis`) — view and create a job's RFIs (companion-owned; JobTread
  has no RFI object).
- **Employees** (`/employees`) — list/filter/sort/**edit** the Project Database
  employee roster.
- **Labor Import** (`/labor-import`) — turn a QuickBooks Time labor CSV into a
  JobTread time-entry import CSV (client-side; no JT writes).
- **Actions** (`/actions`) — run an Apps Script job on demand.
- **Requests** (`/requests`) — coworkers ask for fixes and new features.
- **Admin** (`/admin`) — manage who can sign in (extra allowed emails on top of
  the env founders).
- **Logs** (`/logs`) — the automation audit trail.

There is also a **Payments** screen (`/payments`) — one-click Sunset statement
paying at TSYS, showing the printed early-pay discount (Gemini-extracted once and
cached).

## Architecture

```
 Phone (installable PWA) ┐
 Chrome side panel ──────┼──► Ascent Assistant (Next.js on Vercel)
                         ┘        │
        ┌────────────────────────┼───────────────────────────────┐
        ▼                        ▼                                ▼
  JobTread Pave API      Apps Script web app              Companion libSQL DB
  (bills, jobs,          (/exec — Sheets/Drive:           (RFIs, feature reqs,
   budgets, invoices)     employees, tools, safety,        allowed users, saved/
   — source of truth      mileage, employee time,          reviewed bill flags,
   for financials)        email logging, Sunset            Sunset-statement cache)
                          payments)
```

- **No billing database.** JobTread holds the state and does the aggregation
  (unbilled = Σ approved `vendorBill.cost` − Σ `customerInvoice.cost`, per cost
  code). Server routes hold the Pave client so the grant key never reaches the
  browser.
- **The Apps Script bridge.** The Assistant has no Google Sheets/Drive client, so
  Sheets/Drive-backed features POST `{action, secret, …}` to the engine's
  versioned `/exec` web app (secret = Script Property `SYNC_TRIGGER_SECRET`). See
  the engine repo's README for the ingestion/sync side.
- **The companion DB** (`src/db/schema.ts`, Drizzle over libSQL/Turso) is a local
  SQLite file in dev and a hosted libSQL URL in prod. Tables: `rfis`,
  `feature_requests`, `allowed_users`, `saved_bills` (per-bill saved/reviewed
  flags keyed by JT document id), `sunset_statements` (payment cache).
- **Writes to JobTread are gated** behind `COMPANION_WRITES_ENABLED` (off by
  default). Invoice creation is always draft-only.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind 3 with the in-repo UI
primitives in `src/components/ui.tsx` (shadcn-style; the ink dark-surface scale and
Roboto brand font) · Auth.js (next-auth) Google sign-in with a `APP_PASSWORD`
fallback · Drizzle ORM over libSQL/Turso · deployed on Vercel.

External services: **JobTread Pave API** (financial source of truth), **Gemini**
(bill + Sunset-statement extraction), **Anthropic Claude** (the `/chat`
assistant), **Google Maps** Routes/Geocoding (mileage), and the **Apps Script web
app** (Sheets/Drive features).

## Why this is a separate repo

The `ascent-appscript` repo is a clasp project with `skipSubdirectories: false`
and no `.claspignore`, so `clasp push` would sweep any `.js`/`.json` here into the
Apps Script project. Keeping this a sibling repo avoids that entirely.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the secrets (all documented inline)
npm run dev                  # http://localhost:3000
```

`.env.example` is the authoritative list of configuration — every secret is
documented there (JobTread grant, Gemini/Anthropic/Maps keys, the Apps Script
sync URL+secret, the DB URL, and the auth vars). With `APP_PASSWORD` unset, auth
is off for local dev.

- **Deploy:** `DEPLOY.md` (Vercel + hosted libSQL, secrets, Google sign-in).
- **Chrome side panel:** `extension/README.md` (dev) and
  `extension/STORE_LISTING.md` (Web Store submission).

## History

This app grew out of a plan to replace AppSheet. The original three features —
coding, unbilled, invoice staging — were confirmed against the live JobTread Pave
API (see `../ascent-appscript/CLAUDE.md` → "Assistant-tool findings" and the
`_invp*` probes in `Diagnostics.js`), shipped, and the app then absorbed the rest
of the retired AppSheet surface plus new field tools. AppSheet was retired
2026-07-10. The superseded migration write-up lives at
`../ascent-appscript/MIGRATION_PLAN.md` (and in git history) for background.
