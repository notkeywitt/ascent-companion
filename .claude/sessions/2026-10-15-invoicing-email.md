---
slug: invoicing-email
repo: ascent-companion-invoice-email
branch: claude/invoicing-email
status: shipped
started: 2026-10-15T21:15:42Z
updated: 2026-10-15T22:02:48Z
goal: One button on Tracking Sheets all-jobs that drafts the monthly Invoicing Package email in Gmail, each job's tracking sheet attached as a PDF
next: Owner runs ./deploy.sh in ascent-appscript (invoice PDFs from JobTread's pdf mutation), then presses Update invoicing email on /trackingsheet for September: draft should carry each Monthly Invoice PDF next to its tracking sheet
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-15 17:15 · `bd771f2` companion: tracking sheets all-jobs drafts the month's invoicing package email in gmail, each job's tracking sheet attached as a pdf
  src/app/api/invoicing-summary/email/route.ts, src/app/trackingsheet/AllJobs.tsx, src/lib/invoicingEmail.test.ts, src/lib/invoicingEmail.ts, src/lib/jobtread.ts
- 2026-10-15 17:27 · `a4f246f` companion: close session 2026-10-02-time-card-autostage
- 2026-10-15 17:33 · `c80bfe2` companion: draft invoicing email again replaces that month's gmail draft with the latest instead of adding a second one
  src/app/api/invoicing-summary/email/route.ts, src/app/trackingsheet/AllJobs.tsx
- 2026-10-15 17:56 · `c8fb129` companion: invoicing email attaches each jobtread invoice pdf instead of linking to the invoice
  src/app/api/invoicing-summary/email/route.ts, src/app/trackingsheet/AllJobs.tsx, src/lib/invoicingEmail.test.ts, src/lib/invoicingEmail.ts, src/lib/jobtread.ts
- 2026-10-15 18:02 · `7c4a916` companion: invoicing email keeps the jobtread invoice link beside the attached pdf
  src/lib/invoicingEmail.test.ts, src/lib/invoicingEmail.ts

## Notes
- 2026-10-15 21:15 — Invoice PDFs from JobTread are links, not attachments: JT's pdf mutation would attach them but is an unprobed mutation; needs owner OK.
- 2026-10-15 21:56 — JobTread pdf mutation (isWrite in schema) answers with the PDF bytes, filename 'Monthly Invoice 002-379.pdf', and saves nothing to the document: probed on Berger #379, file count unchanged. Owner asked for it 2026-10-15.
