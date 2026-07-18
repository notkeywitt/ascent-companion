# HANDOFF — Safety Meeting Signatures (`/safety-meeting`)

Status: **design agreed, not yet built.** Pick this up on the laptop (VS Code Claude
extension). Branch: `claude/safety-meeting-signatures-gb8xo0`.

## Goal

An iPad-friendly page in the Companion for recording **attendance at safety meetings**
by collecting a real drawn signature per attendee.

## Agreed design (Option A — a Companion page)

- New route: `src/app/safety-meeting/page.tsx` (+ a `/safety-meeting` tab).
- **Header, set once per meeting:** Date, Topic, Admin (the person running it).
- **Per attendee, repeated:** an Employee **dropdown** + a **drawn signature** on an
  HTML `<canvas>`. Tap "Add" → one attendance record → clear the signature → next person.
- Real-world flow: set the header, then **pass the iPad around**; each person picks their
  name and signs. Each tap = one row.
- **Fast open on iPad:** installable PWA — open once in Safari → Share → *Add to Home
  Screen* → full-screen app icon. `src/app/manifest.ts` already exists; confirm it covers
  this route.

## Open design forks — decide these first (they're the real work)

1. **Where do the employee names come from?**
   The employee list lives in the **Project Database** Google Sheet → **Employee** tab.
   ⚠️ The Companion **has no Google Sheets client today** — it reads JobTread (Pave API,
   `src/lib/jobtread.ts`) and uses a small libSQL/Drizzle DB for its own data. So sourcing
   the dropdown needs one of:
   - add a Google Sheets read (googleapis + a service account) behind a new
     `src/app/api/employees/route.ts` — cleanest, live;
   - "Publish to web" that sheet range as CSV and fetch it — no new auth, but a manual step;
   - a static list in the DB / config — simplest, but goes stale.
   Recommendation: a small `/api/employees` server route reading the sheet. Confirm the
   Project Database spreadsheet ID and Employee tab column layout before building.

2. **Where do attendance records + signature images go?**
   The app "holds no database" *for JobTread financials*, but it already has a libSQL/Drizzle
   DB (`src/db/schema.ts`) for operational data (allowed users, RFIs, feature requests).
   Options:
   - a new Drizzle table `safetyMeetingSignatures` (date, topic, admin, employee, signaturePng
     as base64/blob, createdAt) — fits the existing pattern, least friction;
   - write rows to a Google Sheet + the signature PNG to a Drive folder — matches the
     "records live in Sheets/Drive" habit, but needs the Sheets/Drive write path from fork 1.
   Recommendation: start with a Drizzle table; add a Sheet/Drive export later if compliance
   wants it.

3. **Per-meeting PDF roster?** Still open. A one-page signed roster PDF per meeting (into
   Drive) may be what an inspector/insurer expects, on top of the record log. Decide whether
   to include it in v1.

## Signature capture

- HTML `<canvas>` with pointer events. Either add the `signature_pad` npm dep (simplest,
  handles touch/pencil + retina scaling) or hand-roll ~40 lines of pointer handling.
- Export as PNG data URL on "Add".

## Files to model the build after

- `src/app/add-bill/page.tsx` — closest existing pattern: a form + file/image handling page.
- `src/app/api/team/route.ts` — DB read/write route pattern (Drizzle).
- `src/db/schema.ts` + `src/db/index.ts` — how tables + `ensureDb()` work.
- `src/components/*` — existing UI building blocks (JobPicker, selects, PageTitle, TabBar).
- `src/middleware.ts` / `src/auth.ts` — the Google-sign-in allowlist this page sits behind.

## Stack conventions (from README)

Next.js App Router + TS + Tailwind. Server routes hold all secrets. Google sign-in
allowlisted. Deploy: Vercel (`vercel.json`).

## Suggested first steps on the laptop

1. `npm install`, then `npm run dev` to confirm the app boots.
2. Answer fork #1 (employee source) — get the Project Database spreadsheet ID + Employee
   tab columns.
3. Scaffold the route + a stub `/api/employees`, render the header fields + one signer row.
4. Wire the signature canvas, then the "Add" → store path (fork #2).
