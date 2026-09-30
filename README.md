# Ascent Assistant

The human-facing app for Ascent Building Co. — a phone-first PWA (plus a Chrome
side panel that docks next to JobTread) that puts the day-to-day office and field
work in one place. It replaced the retired AppSheet front end and is the UI layer
over two back ends: **JobTread** (via its Pave API) and the **Ascent Apps Script
engine** (the Gmail→Claude→JobTread ingestion/sync suite in the sibling
`../ascent-appscript` repo).

**JobTread is the source of truth for anything financial** — bills, jobs,
budgets, invoices. The app holds no billing database; it reads and writes
JobTread live. A small companion database exists only for data JobTread has no
home for (RFIs, feature requests, the sign-in allowlist, a couple of workflow
flags, and a Sunset-statement cache).

Live at **https://ascent-companion.vercel.app** (Vercel). Access is restricted to
Ascent staff via Google sign-in (allowlist), with a shared-password fallback.

## What it does

Every page sits in one of ten **workspaces**, each named for a job the office
repeats. `src/lib/workspaces.ts` is the one list: it feeds the header's ☰ menu,
the bottom bar (a left rail on iPad) and the header search. Inside a workspace a
tab strip moves between its pages and carries the job and the billing month.
The plan behind this layout is `NAVIGATION_PLAN.md`.

| Workspace | Pages |
|---|---|
| **Today** (`/`) | What needs you: bills to code, bill corrections, time problems, requests to approve, imports due, to-dos |
| **Month Close** | Tracking Sheets (`/trackingsheet`, the coding workbench) · Labor Review · Bill Corrections · Taxable Flags · Invoice Review · Invoicing Package · Finalize (`/tracking-sheet`) |
| **Incoming Bills** | Email Invoices · Mail Check · Not in JobTread · Sunset Statements (`/payments`) · LSWDD Statement · Amazon Import |
| **Clients** | Leads · Directory (`/clients`) · Job Cost (`/jobs`) · Unbilled · Budget Import · Specifications · Receivables |
| **People** | Employees · Pay Rates · Time Off (Office) · Time Sync · Labor Import · Safety Meeting |
| **Search** | Bill Search · Vendors · Bill Archive (`/expenditure-history`) |
| **Office** | Office Dashboard · Notices · Actions |
| **My Work** | Time (`/employee-time`) · Miles (`/mileage-tracker`) · Tools · Requisitions · Time Off |
| **Help** | Help · Changelog · App Feedback (`/requests`) · Course |
| **Admin** | Access (`/admin`) · Page Text · Theme · System Logs · Financial Journal · Historical Cost Import |

Outside the workspaces: the bill page (`/bill/<id>`), the header's **＋ Add
bill** (`/add-bill`), the Assistant (`/chat`) and LopezRocks in the menu footer.
Each page's purpose is in `CODEBASE_MAP.md`; how to use each one is in `/help`
(`src/lib/help.ts`) and the long-form `USER_MANUAL.md`.

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

External services: **JobTread Pave API** (financial source of truth), **Claude**
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
documented there (JobTread grant, Anthropic/Maps keys, the Apps Script
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
