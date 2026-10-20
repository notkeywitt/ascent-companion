---
slug: jobtread-email-records
repo: ascent-companion
branch: claude/jobtread-email-records-zug7um
status: shipped
started: 2026-10-20T14:49:50Z
updated: 2026-10-20T14:50:09Z
goal: 
next: check Invoice Status on a live month; if QBO-sent invoices dominate, consider reading QuickBooks email status
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-20 14:49 · `d8e4a9f` companion: turn the invoicing package page into invoice status
  CODEBASE_MAP.md, src/app/api/invoicing-summary/route.ts, src/app/invoicing-summary/page.tsx, src/components/InvoicingTabs.tsx, src/lib/invoiceStatus.test.ts, src/lib/invoiceStatus.ts, +3 more

## Notes
- 2026-10-20 14:49 — Invoice Status reads documentRecipient.emailDeliveryStatus live; QBO-sent invoices have no JT email record, shown as 'not sent from JobTread'.
