---
slug: invoicing-email
repo: ascent-companion-invoice-email
branch: claude/invoicing-email
status: shipped
started: 2026-10-15T21:15:42Z
updated: 2026-10-15T21:15:47Z
goal: One button on Tracking Sheets all-jobs that drafts the monthly Invoicing Package email in Gmail, each job's tracking sheet attached as a PDF
next: Owner runs ./deploy.sh in ascent-appscript (new draftInvoicingEmail action + docs.google.com fetch allowance), then presses Draft invoicing email on /trackingsheet for September and checks the draft in Gmail
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-15 17:15 · `bd771f2` companion: tracking sheets all-jobs drafts the month's invoicing package email in gmail, each job's tracking sheet attached as a pdf
  src/app/api/invoicing-summary/email/route.ts, src/app/trackingsheet/AllJobs.tsx, src/lib/invoicingEmail.test.ts, src/lib/invoicingEmail.ts, src/lib/jobtread.ts

## Notes
- 2026-10-15 21:15 — Invoice PDFs from JobTread are links, not attachments: JT's pdf mutation would attach them but is an unprobed mutation; needs owner OK.
