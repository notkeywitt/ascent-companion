---
slug: allbills-vendor-collapsed
repo: ascent-companion
branch: claude/allbills-vendor-collapsed
status: in-progress
started: 2026-09-14T17:52:26Z
updated: 2026-09-16T00:35:36Z
goal: 
next: on the deployed /vendors: pick a vendor with no email/phone/address (e.g. Ace Hardware), fill all three, Save, confirm it reads back and check /journal for the vendor.details.set rows
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-14 10:52 · `1aa2257` companion: start every vendor pane collapsed
  src/app/trackingsheet/AllBills.tsx
- 2026-09-14 11:34 · `a960ff3` companion: filter the month by paid state and bill vs expense
  src/app/trackingsheet/AllBills.tsx, src/lib/jobtread.ts
- 2026-09-14 11:51 · `b7dc159` companion: show a vendor's email, phone and address
  src/app/api/vendor-bills/[id]/route.ts, src/app/vendors/page.tsx, src/lib/jobtread.ts
- 2026-09-14 11:59 · `2e1734e` companion: fill in a vendor's missing email, phone or address
  src/app/api/vendor-details/route.ts, src/app/vendors/page.tsx, src/lib/clientDirectory.ts, src/lib/views.ts
- 2026-09-15 15:53 · `762eae6` companion: anchor search results panel below search bar
  src/components/GlobalSearch.tsx
- 2026-09-15 17:00 · `458d6ac` companion: lock field time-entry identity after first pick
  src/app/employee-time/EmployeeTimeClient.tsx
- 2026-09-15 17:03 · `47de5f1` bunch of updates idk claude did it
- 2026-09-15 17:35 · `5de852a` companion: resolve time identity from the JobTread membership when the roster link is blank
  src/app/employee-time/page.tsx, src/lib/actingAs.ts

## Notes
