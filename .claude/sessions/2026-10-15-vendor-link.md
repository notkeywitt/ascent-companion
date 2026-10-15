---
slug: vendor-link
repo: ascent-companion-vendor-link
branch: claude/vendor-link
status: in-progress
started: 2026-10-15T11:35:11Z
updated: 2026-10-15T11:40:32Z
goal: Stuck vendor: link a bill's unmatched vendor name to an existing JobTread vendor, and remember the alias for future captures
next: Owner runs ./deploy.sh in ascent-appscript (linkVendor action). Then open Tracking Sheets > Not in JobTread, expand a1_septic_on_lopez_llc, pick A1 Septic, Link, Push as-is. Confirm the Vendor Aliases tab got a row.
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-15 07:40 · `e753139` companion: link a stuck bill's vendor to an existing jobtread vendor, remembered for the next invoice
  src/app/api/stuck-vendors/route.ts, src/app/api/uncaptured/route.ts, src/components/LinkVendor.tsx, src/components/StuckVendors.tsx, src/components/UncapturedBills.tsx

## Notes
