# CHANGE_ORDER_LOG_PLAN.md — a job's change orders, contract growth and % increase

Status: draft — 2026-11-23

The plan for the Roadmap feature `change-orders` (`src/lib/roadmap.ts`):
"A job's change orders — pending and approved — with the revised contract total
and % increase." Size M. Read-only against JobTread.

Figures below come from a live JobTread read on 2026-11-23 and the code.

## What the data holds today

All 53 `customerOrder` documents in the org, by name:

| Name | Count | Priced | Notes |
|---|---|---|---|
| Proposal | 15 | all | The contract. One approved per job, except Siding Replacement (4 draft option proposals) |
| Selection | 36 | 2 | Most are $0 choices. Two carry money: Siding Replacement #1 ($15,033, pending), Studio #1 ($35,400, draft) |
| Change Order | 2 | both | Bunkhouse #70 ($77,874, approved), Studio #18 ($11,448, draft, signature required) |

- `signedAt` is empty on every order. Status is the only approval signal.
- Bunkhouse #70 is one roll-up. Berger's per-change history lives in Drive as
  signed "Estimated Change Order" docs and in the tracking sheet's change columns.
- `getJobClientDocuments` (`src/lib/jobtread/sunsetStatements.ts`) already reads
  every order with name, number, status, dates, price, total and
  `includeInBudget`. The new feature needs no new Pave query in stage 1.

## The rule (pure, `src/lib/changeOrders.ts`)

Fold one job's `ClientDocRow[]` into a log:

- **Original contract** = the earliest approved, `includeInBudget` order named
  "Proposal". If none, the earliest approved `includeInBudget` order.
- **Change** = every other order with a non-zero price. A priced Selection counts.
  A $0 Selection does not.
- Each change row: number, name, issue date, status, price before tax, total with tax.
- **Status buckets:** approved (counts), pending (sent, not approved), draft
  (not sent). Denied is listed greyed and counts nowhere.
- **Revised contract** = original + approved changes.
- **% increase** = approved changes ÷ original. Null when the original is $0.
- **If all pending approve** = revised + pending. Drafts never count.
- Before-tax is the headline figure. Tax-included shows beside it.

Revised contract must equal `summarizeClientDocs(...).totals.contractBeforeTax`
for the same job. A test pins that, so the bot and the page never disagree.

## Stages

| Stage | What | Size |
|---|---|---|
| 1 — the rule | `src/lib/changeOrders.ts` + tests on the live shapes above (Bunkhouse, Studio, Siding Replacement, a job with no changes) | S |
| 2 — the per-job page | `GET /api/change-orders?jobId=` (calls `getJobClientDocuments`, then the rule). Page `/change-orders`: job picker, then contract → changes → revised total and %. Each row links to the document in JobTread | S |
| 3 — all jobs | `?all=1`: one row per open job — original, approved changes, pending, revised, % increase. Sorted by % increase. One org-wide `documents` walk with `pageAll`, not one call per job | S |
| 4 — surfaces | A "Change orders" line on the job board's money card (`src/app/trackingsheet/Board.tsx`) and a block on `/client-budget`, both linking to the page. The bot's `summarizeClientDocs` gains `changes` and `pctIncrease` | S |
| 5 — legacy history (optional) | See open question 1 | M |

Gate: a new `VIEW` `change-orders` in `src/lib/views.ts` (office + admin), paths
`/change-orders` and `/api/change-orders`. Tab in `src/lib/workspaces.ts` under
Financials, beside Client Budget. Set `built` in `roadmap.ts` when stage 4 ships.

No JobTread write in any stage. Creating a change order stays in JobTread.

## Open questions for the owner

1. **Berger's per-change history.** JobTread holds one $77,874 roll-up for
   Bunkhouse. Do you want the individual changes listed? Options:
   a. No. JobTread is the record; the roll-up is enough. (Recommended)
   b. Hand-entered lines in the companion DB, marked "from Drive", shown under
      the roll-up and never added to the total.
   c. New changes go into JobTread as separate Change Order documents from now on.
      This is a process change, not code.
2. **Priced Selections.** Count a priced Selection as a change order? The plan
   says yes. Siding Replacement's $15,033 pending Selection is the test case.
3. **Siding Replacement's four draft Proposals.** These read as options, not
   changes. The plan ignores drafts when it picks the original contract. Confirm.
4. **Who sees it.** Office + admin only, or leads too (no money elsewhere for leads)?
