# Stage 7 — Tools and Mileage move to the companion DB

Status: in progress — 2026-11-10

**Phases 1–3 are built and shipped with both flags off.** Nothing reads the new
tables. Stage 7 itself is in `ARCHITECTURE_REVIEW.md`.

## Why

Every Tools and Miles read ends at Apps Script and a Google Sheet. Vercel
function duration, Oct 26 – Nov 10 2026:

| Route | p50 | p75 | Calls |
|---|---|---|---|
| `/api/tools` | 4.7 s | 6.0 s | 79 |
| `/api/tool-tracker` | 4.9 s | — | 18 |
| `/api/mileage` | 3.8 s | 4.1 s | 69 |
| `/api/employees` | 3.7 s | — | 35 |
| `/api/jobs` (JobTread, cached) | 0.04 s | 0.17 s | 1,642 |
| `/api/mileage/active` (companion DB) | — | 0.5 s | — |

The last row is the target: the same page, reading the DB.

## What exists now

| Piece | Where |
|---|---|
| Tables `tools`, `mileage_trips` | `src/db/schema.ts`, DDL in `applySchema` (`src/db/index.ts`) |
| Flags, copy, backfill, check | `src/lib/sheetTables.ts` |
| Backfill + check URL (admin only) | `src/app/api/admin/sheet-tables/route.ts` |
| Tests | `src/lib/sheetTables.test.ts` |

**Flags** (Vercel env vars, both unset = off):

- `COMPANION_TOOLS_DB_WRITES=true` — each tool write (create, edit, rename,
  scan, photo, delete, trailer load move) still goes to Apps Script first. On
  success the route copies the tool Apps Script answered with into `tools`.
- `COMPANION_MILEAGE_DB_WRITES=true` — each trip log or edit still goes to Apps
  Script first. After the reply, the route re-reads that person's trips from the
  sheet and upserts them into `mileage_trips`. (`logMileage` does not answer
  with the row it wrote, so a re-read is the only exact copy.)

A failed copy is logged (`[stage7] …`) and swallowed. It never changes the
route's answer.

**Backfill and check.** Signed in as an admin, open:

- `/api/admin/sheet-tables?dataset=tools&backfill=1` — copy the Tools tab in.
- `/api/admin/sheet-tables?dataset=tools` — compare sheet and table.
- The same two with `dataset=mileage`. The signed-in email must be on Apps
  Script's mileage admin list, or the sheet answers with one driver's trips and
  the route refuses.

A clean check reads `"missingFromDb":[], "notOnSheet":[], "changed":[]`.
Re-running the backfill is safe and is also the repair for drift.

## Known limits of the copy

- An edit made by hand in the sheet reaches the DB only on the next backfill.
- Two keyless legacy trips that share a TripID become one DB row. The check
  then shows `sheet` one higher than `db` with all three lists empty.
- Two tool writes landing within the same second can copy out of order. The
  check shows it under `changed`; the backfill repairs it.

## To flip Tools reads (phase 4 — not built)

Owner steps before the code change:

1. Set `COMPANION_TOOLS_DB_WRITES=true` in Vercel. Redeploy.
2. Open the Tools backfill URL once.
3. Use the app for a week. Open the check URL a few times. It must read clean.

Then one code change, for review:

- `GET /api/tools`, `GET /api/tool-tracker` and `getSheetTools`
  (`toolScheduleStore.ts`) read `tools` from the DB behind a second flag,
  `COMPANION_TOOLS_DB_READS`. `photoUrl` is derived from `photoLink`.
- The job-site list (`projects`) and the Condition / Tool group options are
  NOT tool data. They stay on the sheet. The route reads them through a
  long-lived cache (an hour) instead of on every load, and joins
  `locationLabel` from that list.
- Writes change order: DB first, reply, then the same Apps Script action after
  the reply. That call IS the DB→Sheet mirror (below).
- Photos stay on Apps Script (Drive). `updateToolPhoto` runs first and its
  answer supplies `photoLink`.
- The chat tool `find_tools` (`chatTools.ts`) moves to the same DB read.

## The DB→Sheet mirror

**No Apps Script change and no deployment.** After the flip, the companion
keeps calling the existing actions (`updateTool`, `updateToolLocation`,
`createTool`, `deleteTool`, `logMileage`, `updateMileage`) for every write, after
it has replied. The tab stays current to within a few seconds and the owner
reads it as before. The check URL then reports any write the sheet missed.

What this does not do: push a missed write back into the sheet. If the check
shows drift after the flip, the fix is by hand in the sheet. A real repair
needs one new Apps Script action that overwrites a tab from rows the companion
sends. That touches `WebApp.js` and needs a deployment, so it waits for the
owner's ok. Nothing was changed in `ascent-appscript` for this stage.

## Mileage reads

Same five phases, one difference. Apps Script creates the TripID, so the write
order stays **sheet first, DB copy second** even after reads flip. Only the
history list (`GET /api/mileage`) and the chat tool `get_mileage` move to the
DB. Before that flip the copy must stop being best-effort: the route awaits it
and answers with a warning when it fails. Scoping (`lib/mileageScope.ts`) moves
from Apps Script's email list to the companion role, on the `driver` and
`logged_by` columns. The monthly PDF stays on Apps Script and keeps reading the
sheet, which is why the sheet must stay complete.

## Employee Time — not started, and different

Time entries post to JobTread. That is a JobTread write path, so it is
stop-and-ask. The plan is to treat it last and separately: JobTread stays the
record for the entry, and only the sheet-side staging (photos, the roster read
behind `/api/employees`) is a Stage 7 candidate. The roster read is the next
cheap win — `/api/employees` is 3.7 s at p50 and `jt_user_links` already caches
the part the Miles page needs.

## The Miles page bootstrap (step 3 of the brief) — already done

The brief asked for one bootstrap route in place of four load calls. The page
no longer makes four. `src/app/mileage-tracker/page.tsx` sends the driver and
the jobs with the HTML. `/api/employees` and `/api/jobs` run only as fallbacks,
`/api/tool-tracker` runs only once a trip is under way, and `/api/mileage` runs
only when the History tab opens. A bootstrap route would add an Apps Script
wait to a page that now starts without one, so none was added.
