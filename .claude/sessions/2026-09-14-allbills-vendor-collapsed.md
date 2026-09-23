---
slug: allbills-vendor-collapsed
repo: ascent-companion
branch: claude/allbills-vendor-collapsed
status: in-progress
started: 2026-09-14T17:52:26Z
updated: 2026-09-23T15:18:53Z
goal: 
next: 1) Check /needs-project live: PDF shows inline, tap opens full screen, link opens Drive. 2) Phase 3: owner runs ./deploy.sh in ascent-appscript, registers one vendor on /email-senders, runs previewRegisteredSenderBills() (dry run) to check job, total, pinned vendor, CSI.
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
- 2026-09-16 12:21 · `7ecb180` companion: share a month's bills, or one bill, with the client
  src/app/api/document-access/route.ts, src/app/trackingsheet/BillCodingCard.tsx, src/app/trackingsheet/Board.tsx, src/components/DocumentAccess.tsx, src/lib/jobtread.ts, src/lib/views.ts
- 2026-09-16 18:25 · `138fd45` companion: land field users on employee time, drop the duplicate tab bar on their home
  src/app/page.tsx, src/components/TabBar.tsx
- 2026-09-16 18:43 · `2ee9323` companion: replace the employee time beta tag with a jobtread link indicator
  src/app/employee-time/EmployeeTimeClient.tsx
- 2026-09-17 10:48 · `0663588` companion: add a break and a mid-shift cost-code switch to employee time
  src/app/api/employee-time/clock/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/lib/employeeClock.test.ts, src/lib/employeeClock.ts, src/lib/jobtread.ts
- 2026-09-17 17:52 · `c125bfd` companion: put the break on a docked pause button
  src/app/employee-time/EmployeeTimeClient.tsx
- 2026-09-17 17:54 · `98a9e8b` companion: restore the 30-day session so people stop signing in daily
  src/auth.ts
- 2026-09-17 17:54 · `4cb308a` companion: record the session-length fix in the ledger
- 2026-09-17 17:58 · `135bb4c` companion: link straight to the time entry in jobtread
  src/app/api/employee-time/history/route.ts, src/app/employee-time/EmployeeTimeClient.tsx
- 2026-09-17 18:04 · `ef6acdc` companion: make a break a split, the way jobtread models one
  src/app/api/employee-time/clock/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/lib/employeeClock.test.ts, src/lib/employeeClock.ts, src/lib/jobtread.ts
- 2026-09-17 18:33 · `07374a6` companion: bill amazon shipping and promotions, and import from order-summary PDFs
  src/app/amazon-import/page.tsx, src/app/api/amazon-import/parse-pdf/route.ts, src/lib/amazonImport.test.ts, src/lib/amazonImport.ts, src/lib/claudeExtract.ts
- 2026-09-22 07:57 · `10943ae` companion: register vendor email senders for automatic bill import
- 2026-09-22 07:57 · `aada910` companion: register vendor email senders for automatic bill import
  src/app/api/email-senders/route.ts, src/app/email-senders/EmailSenders.tsx, src/app/email-senders/page.tsx, src/lib/copy.ts, src/lib/nav.ts, src/lib/views.ts
- 2026-09-22 15:25 · `0102c45` companion: find a vendor's example bill by address, not a pasted link
  src/app/api/email-senders/route.ts, src/app/email-senders/EmailSenders.tsx
- 2026-09-22 19:01 · `2d1bd5c` companion: stop a draft-list test failing by the calendar
  src/lib/codingDraft.test.ts
- 2026-09-23 10:54 · `5e5e563` companion: load the sender registry page in one call, not three
  src/app/api/email-senders/route.ts, src/app/email-senders/EmailSenders.tsx, src/lib/appsScript.ts
- 2026-09-23 10:58 · `679a110` companion: show the needs-project pdf inline instead of a new tab
  src/app/needs-project/page.tsx, src/components/InvoiceViewer.tsx
- 2026-09-23 11:06 · `ede579f` companion: price invoice-review time at the current rate card
  src/app/api/email-senders/route.ts, src/app/email-senders/EmailSenders.tsx, src/app/email-senders/page.tsx, src/lib/invoiceReview/checks.test.ts, src/lib/invoiceReview/checks/costBasis.ts
- 2026-09-23 11:07 · `5e949eb` companion: log session 2026-09-14-allbills-vendor-collapsed
- 2026-09-23 11:08 · `84a38ac` companion: set the auto-ingest sender registry aside
  src/lib/appsScript.ts, src/lib/copy.ts, src/lib/nav.ts, src/lib/views.ts
- 2026-09-23 11:18 · `2bf1731` companion: the vendor address index behind the mail check
  src/lib/jobtread.ts, src/lib/vendorMail.test.ts, src/lib/vendorMail.ts

## Notes
- 2026-09-16 16:01 — Document Access bulk-share: new /api/document-access (GET list + POST grant) + Give Document Access button in the Tracking Sheets closing row. createAce{targetType:document, assignee:{membership}} is the JobTread Document Access list — confirmed by READ (every bill's aces carry the admin membership). The createAce WRITE is unprobed: the live probe was blocked by the permission classifier, so it needs one real click before trusting.
- 2026-09-16 16:08 — Per-document access added: DocumentAccess.tsx is one component for both scopes (ym = the month, docId = one bill); the route reads a docId's job off the document, so the contact list can never cross clients. Bill card block is collapsed by default — two JT reads per open otherwise.
- 2026-09-17 01:47 — Break + mid-shift cost-code switch built on /employee-time. Break banks minutes on the clock record and clock-out sends them as JobTread endNow:{breakDuration}; switch closes the running entry now and opens a new one on the new code. NOT pushed - JobTread write path, needs owner ok. endNow.breakDuration arithmetic is UNVERIFIED: the live probe was refused by the permission classifier, so the route falls back to a shortened endedAt if JobTread rejects it.
- 2026-09-17 22:04 — JT break is a SPLIT, not a deduction: its add-break UI takes a start time + duration and splits the entry in two. endNow:{breakDuration} was accepted by the API but kept the full span (live proof: entries 22PegupKfnmV and 22PegwQFx6jX, 2026-09-17). Break rebuilt as pause (close entry now) + resume (op in, new entry).
