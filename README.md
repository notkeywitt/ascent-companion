# Ascent Companion

A JobTread companion tool that fixes three things JobTread does poorly, for Ascent
Building Co. **JobTread is the source of truth — this app holds no database.**

1. **Coding** — fast, flat cost-code assignment on draft vendor bills (JT buries it).
2. **Unbilled expenses** — a per-job view of costs not yet billed to the client.
3. **Monthly invoice staging** — one-tap assembly of a draft customer invoice.

Phone-first (installable PWA) + a desktop side-panel that sits next to JobTread.

## Why this lives outside the Apps Script repo

The `ascent-appscript` repo is a clasp project with `skipSubdirectories: false` and no
`.claspignore`, so `clasp push` would sweep any `.js`/`.json` here into the Apps Script
project. Keeping this a **sibling repo** avoids that entirely. (Could later be merged into
one repo behind a `.claspignore`.)

## Status

Discovery complete — all three features are confirmed against the live JobTread Pave API
(see `../ascent-appscript/CLAUDE.md` → "Companion-tool findings", and the `_invp*` probes
in `Diagnostics.js`). `src/lib/jobtread.ts` encodes the verified calls. One detail remains:
the exact `lineItems` shape for creating a customer invoice (marked TODO).

## Confirmed API mechanics

| Feature | Pave call |
|---|---|
| Unbilled | `job.documents` grouped by `type`+`status`, `sum: cost` / `sum: priceWithTax` |
| Coding queue | `vendorBill` docs with `status: draft` |
| Code a line | set cost item's `jobCostItem` → budget `jobCostItemId` |
| Ingest a bill | `createDocument type:vendorBill status:draft` (existing engine already does this) |
| Stage invoice | `createDocument type:customerInvoice status:draft` (lineItems TODO) |

Unbilled = Σ approved `vendorBill.cost` − Σ `customerInvoice.cost`.

## Planned stack

Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. Server routes hold the Pave
client so the grant key never reaches the browser. Deploy to Cloud Run (or Vercel). Auth:
Google sign-in allowlisted to office@ / keillor@.

## Secrets (server-side only — see `.env.example`)

`JT_GRANT_KEY`, `JT_ORG_ID` (see `.env.example` for auth and writes flags).

## Roadmap

- **A** Read side: coding queue + unbilled view (live, no writes).
- **B** Coding writes: code lines + approve bills (DRY_RUN → live).
- **C** Invoice staging: lock lineItems shape → one-tap draft invoice.
- **D** Retarget ingestion → `createDocument vendorBill/draft`.
- **E** PWA + desktop side-panel; retire AppSheet.

See `../ascent-appscript/MIGRATION_PLAN.md` for the full plan.
