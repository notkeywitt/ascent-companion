---
slug: automate-timesheet-email
repo: ascent-companion
branch: claude/automate-timesheet-email-cshzx9
status: shipped
started: 2026-10-16T23:14:04Z
updated: 2026-10-16T23:24:00Z
goal: Draft the pay-period time entries email (JobTread CSV attached) from a button on the Timesheets tab
next: Press 'Email Oct 16-31 time entries' on the Timesheets tab on Nov 1 and check the draft; confirm the Apps Script deploy carries draftTimeEntriesEmail first
---

## Log

<!-- Appended by .githooks/post-commit. Do not hand-write rows here. -->
- 2026-10-16 23:23 · `105c0d3` companion: draft the pay-period time entries email from the timesheets tab
  CODEBASE_MAP.md, src/app/api/employee-time/email/route.ts, src/app/employee-time/EmployeeTimeClient.tsx, src/app/employee-time/TimeEntriesEmailButton.tsx, src/lib/jobtread.ts, src/lib/timeEntriesEmail.test.ts, +1 more

## Notes
- 2026-10-16 23:23 — Time entries CSV verified against the Oct 1-15 attachment (time-entries-2026-10-16.csv): identical bytes except 13 Approved cells approved since the download. JobTread's export writes Start/End in the BROWSER's zone (that file was Eastern); ours writes org Pacific. Row order = start desc, then user name asc.
