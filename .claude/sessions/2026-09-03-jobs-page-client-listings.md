---
slug: jobs-page-client-listings
repo: ascent-companion
branch: claude/jobs-page-client-listings-tpb0cy
status: in-progress
started: 2026-09-03T23:03:57Z
updated: 2026-09-03T23:04:39Z
goal: 
next: Probe the multi-value customFieldValues write against one internal Ascent job, then let /clients edit job Status and Job Type (isEditableField in clientDirectory.ts is the single gate).
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-09-03 23:04 · `dbd199b` companion: add the clients & jobs directory, editable, with the invoice capture tag
  CODEBASE_MAP.md, src/app/api/clients/customer/route.ts, src/app/api/clients/invoice-tag/route.ts, src/app/api/clients/job/route.ts, src/app/api/clients/route.ts, src/app/api/clients/update/route.ts, +11 more

## Notes
- 2026-09-03 23:04 — New page /clients (Clients & Jobs): the JobTread customer + job DIRECTORY, and the app's first write path onto those records. Reads: src/lib/clientDirectory.ts. Writes: POST /api/clients/update, allowlisted, journalled, behind writesEnabled().
- 2026-09-03 23:04 — 413 confirmed live: nesting jobs inside a paged organization.accounts (size 100 / 50) returns Request Entity Too Large. The directory pages the two flat connections and joins on job.location.account.id.
- 2026-09-03 23:04 — updateAccount carries notify, defaulting to TRUE (introspected 2026-09-03). Every account write here sends notify:false so a spelling fix cannot mail the customer. updateJob/updateContact/updateLocation have no such field.
- 2026-09-03 23:04 — Held back deliberately: MULTI-VALUE custom fields (job Status, Job Type — the array-replace write is unprobed, and the live-probe attempt was blocked in this session), job defaultRetainagePercentage (a bare unbounded number, unit stated nowhere) and location customTaxRate (bounds ARE stated; withheld because it decides what a client is taxed).
