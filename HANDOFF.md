# HANDOFF — Safety Meeting Signatures (`/safety-meeting`)

Status: **BUILT + verified; deployed 2026-07-18.** Branch:
`claude/safety-meeting-signatures-gb8xo0` (merged to `main`).

## What it is

An iPad-friendly Companion page for recording **safety-meeting attendance** with a
real drawn signature per attendee. Set the header once (Date / Topic / Meeting
Lead), then pass the iPad around — each person picks their name and signs; each
"Add attendee" = one record. "Save meeting" writes everything and shows the
roster PDF + Drive folder.

## Decisions made (the three open forks — all resolved)

1. **Employee source → Apps Script proxy.** The Companion has no Google Sheets
   client, so the attendee dropdown is served by the Apps Script web app's new
   `listEmployees` action, which reads the Project Database **Employee** tab
   (Active only). Chosen over JobTread `/api/jt-users` because that misses field
   crew who aren't JT users but do attend meetings.
2. **Storage → Google Sheet + Drive PNGs + PDF.** Apps Script (it holds the
   Sheets/Drive grants) writes one row per attendee to a new **"Safety Meetings"**
   sheet tab, saves each signature PNG, and renders a **roster PDF**.
3. **Per-meeting PDF roster → yes, in v1.** Built as a Google Doc (so signature
   images embed reliably) then exported to PDF into the meeting's Drive folder.

## Architecture

Companion = UI only. It talks to the Apps Script `doPost` web app over the shared
secret (`APPS_SCRIPT_SYNC_URL` / `APPS_SCRIPT_SYNC_SECRET` — same env as
`/api/email`; secret stays server-side). Apps Script does all Sheet/Drive/PDF
writing.

### Companion files (this repo)
- `src/app/api/employees/route.ts` — GET → proxies `listEmployees`.
- `src/app/api/safety-meeting/route.ts` — POST → proxies `saveSafetyMeeting`
  (`maxDuration = 120`; signatures travel as base64 PNGs).
- `src/components/SignaturePad.tsx` — hand-rolled retina/pointer signature canvas
  (no npm dep); imperative handle `{ toDataURL, clear, isEmpty }`.
- `src/app/safety-meeting/page.tsx` — the flow (header → add signers → save →
  success screen with roster PDF + Drive folder links).
- `src/components/TabBar.tsx` — "Safety Meeting" tab.
- Both API routes sit behind normal Google sign-in (NOT the ingest secret — the
  browser calls them; the secret is used outbound only). Manifest scope is `/`,
  so the PWA already covers the route — installable via Safari → Add to Home
  Screen.

### Apps Script side (ascent-appscript repo)
- New file `SafetyMeeting.js` — `_companionListEmployees` / `_companionSaveSafetyMeeting`
  handlers + `_smtg*` helpers; `diagnoseSafetyMeeting()` read-only probe at the
  top of the file. Wired into the `doPost` switch + `WEBAPP_ACTIONS` in
  `Diagnostics.js`.
- On first save it auto-creates a **"Safety Meetings"** Drive folder at My Drive
  root (id cached in Script Property `SAFETY_MEETING_FOLDER_ID` — move the folder
  anywhere afterward, lookup is id-based) and the **"Safety Meetings"** sheet tab.

## Verified

Companion `tsc --noEmit` + `next build` clean; Apps Script `node --check` clean.
Apps Script web app redeployed (build stamp `2026-07-18 · add listEmployees +
saveSafetyMeeting`). Companion deployed to Vercel via `main`.

## First-run check

Run `diagnoseSafetyMeeting()` from the Apps Script Run dropdown (read-only — lists
Active employees + reports the folder/tab plan). Then open `/safety-meeting`,
add one signed test attendee, Save, and confirm the roster PDF + folder links.

## Possible v2

- A read-back / index view of past meetings (currently write-only; records live
  in the Sheet + Drive).
- Reminders / cadence tracking (e.g. weekly toolbox talks).
- Let an attendee not in the Employee tab be entered by hand (today the dropdown
  is Active employees only).

---

# Employees page (`/employees`) — BUILT + deployed 2026-07-18

A roster-management tab: list every employee from the Project Database **Employee**
tab, search/filter (by status), sort (Name/Position/Status), and **edit** their
details back to that same sheet. Same Apps Script proxy architecture as the safety
page (Companion = UI; Apps Script holds the Sheets grant).

- **Apps Script** `Employees.js` — `listEmployeesFull` (all employees, all fields +
  distinct statuses) and `updateEmployee` (`{id, fields}` → per-cell write matched
  by **Employee ID**, forced text format, user-lock serialized). `diagnoseEmployees()`
  read-only probe. Wired into `doPost` + `WEBAPP_ACTIONS`. The Employee tab is NOT
  part of the JT mirror, so edits can't fight the hourly sync.
- **Companion** — `/api/employees` route extended: `GET ?full=1` → full list,
  `PATCH {id, fields}` → edit (default `GET` still returns the minimal Active list
  the safety page's dropdown uses). `src/app/employees/page.tsx` (table + search +
  status filter + sortable headers + edit modal). TabBar "Employees" entry.
- **Employee ID is the read-only row key** (not editable — it's the join key). Only
  changed fields are sent on save, so untouched cells keep their sheet formatting.
- Edits write to the **live production sheet** — verify with one test edit after
  deploy (change a phone, Save, confirm it lands in the Employee tab).
- v2 ideas: add / retire employees (today it's edit-only); make Employee ID
  editable behind a guard if ever needed.
