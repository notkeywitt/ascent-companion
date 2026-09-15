---
slug: allbills-vendor-collapsed
repo: ascent-companion
branch: claude/allbills-vendor-collapsed
status: in-progress
started: 2026-09-14T17:52:26Z
updated: 2026-09-14T18:59:56Z
goal: 
next: open /vendors, pick HOBI Plumbing (account + address), Glacier Window (contact-only email/phone) and a vendor with neither — confirm the Details card renders or hides correctly
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

## Notes
