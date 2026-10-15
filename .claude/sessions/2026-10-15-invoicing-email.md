---
slug: invoicing-email
repo: ascent-companion-invoice-email
branch: claude/invoicing-email
status: in-progress
started: 2026-10-15T21:15:42Z
updated: 2026-10-15T21:33:01Z
goal: One button on Tracking Sheets all-jobs that drafts the monthly Invoicing Package email in Gmail, each job's tracking sheet attached as a PDF
next: Owner runs ./deploy.sh in ascent-appscript (draft now updates in place per month), then presses Draft invoicing email twice on /trackingsheet for September: second press should say Updated and keep one draft in Gmail
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-15 17:15 · `bd771f2` companion: tracking sheets all-jobs drafts the month's invoicing package email in gmail, each job's tracking sheet attached as a pdf
  src/app/api/invoicing-summary/email/route.ts, src/app/trackingsheet/AllJobs.tsx, src/lib/invoicingEmail.test.ts, src/lib/invoicingEmail.ts, src/lib/jobtread.ts
- 2026-10-15 17:27 · `a4f246f` companion: close session 2026-10-02-time-card-autostage
- 2026-10-15 17:33 · `c80bfe2` companion: draft invoicing email again replaces that month's gmail draft with the latest instead of adding a second one
  src/app/api/invoicing-summary/email/route.ts, src/app/trackingsheet/AllJobs.tsx

## Notes
- 2026-10-15 21:15 — Invoice PDFs from JobTread are links, not attachments: JT's pdf mutation would attach them but is an unprobed mutation; needs owner OK.
