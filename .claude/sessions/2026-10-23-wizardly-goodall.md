---
slug: wizardly-goodall
repo: ascent-companion
branch: claude/wizardly-goodall-399znh
status: in-progress
started: 2026-10-23T16:30:26Z
updated: 2026-10-23T16:30:34Z
goal: New-hire paperwork: invite a hire, they sign in, fill a profile and sign the Drive forms (W-4, I-9, Direct Deposit) in the app; the office downloads the packet for the bookkeeper
next: Upload the current W-4 (irs.gov) and I-9 (uscis.gov) on New Hires, check their field setup in Fields, then invite a test hire end to end
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-23 16:30 · `4c7d6c0` companion: add new-hire paperwork — invite, profile, sign the forms in the app
  CODEBASE_MAP.md, package-lock.json, package.json, src/app/api/onboarding/me/forms/[id]/route.ts, src/app/api/onboarding/me/route.ts, src/app/api/onboarding/office/file/route.ts, +18 more

## Notes
- 2026-10-23 16:30 — Drive folder 1aforu9… holds Direct Deposit (fillable, preset added), I-9 2019 and W-4 2020 (both flat, no fields, and out of date). The sandbox proxy blocks irs.gov/uscis.gov, so the current fillable copies must be uploaded by the office.
