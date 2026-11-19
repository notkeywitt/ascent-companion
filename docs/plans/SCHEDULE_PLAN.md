# Schedule plan

Status: in progress — 2026-11-19

Source: App Feedback request 50. The Home "This week" card becomes "Schedule".
Its title opens a Schedule page, a Gantt chart. It grows into the JobTread
Gantt functions, then links bills and estimates to tasks.

## Stages

| # | Stage | State |
|---|---|---|
| 1 | Schedule page, read-only: a Gantt by job, 4 or 12 weeks, a details dialog | built |
| 2 | Edit: the existing task dialog on a bar; drag to move (a JobTread write) | not started |
| 3 | One Gantt component for the Home card, the Tracking Sheet and the Jobs Hub Schedule tab | not started |
| 4 | Bills and estimates on a task | built (owner chose JobTread's own link, 2026-11-19) |

## Stage 1

- Page `src/app/schedule/`, route `/api/schedule`, view `schedule` (office + admin).
- Reads `getUpcomingScheduleTasks`. That read leaves out finished tasks and
  tasks with no dates. Stage 2 should add finished tasks.
- Math is `src/lib/scheduleGantt.ts`.

## Stage 4 (built)

- Read: `GET /api/schedule/links` (every counted document on a task) and
  `?jobId=` (the job's documents on no task). `src/lib/jobtread/taskDocuments.ts`.
- Write: `POST /api/schedule/links { documentId, taskId | null }`. It sends
  `updateDocument { taskId }` and nothing else. It checks the document and task
  first (same org and job, a schedule task on an open job, not voided). It reads
  the document back. If status, cost, price or externalId moved, it puts the old
  task back and says so. Each change goes in the financial journal as
  `document.task.set`. View `schedule-links`.
- UI: a count and total beside each task with documents; the task dialog lists
  them (bills and estimates totalled apart), with Attach and Remove.
- The first live Attach is the probe for the open checks below. The
  ascent-appscript repo does not read `document.task` (grepped 2026-11-19).

## Stage 4 research

Question: can JobTread link a bill or an estimate to a schedule task? Checked
2026-11-19 against `JT_API_REFERENCE.md` and the live org (read-only queries).

**Yes. JobTread has the link. Nobody uses it yet.**

- `document.task → task?` and `task.documents` (a connection) are in the schema.
- `createDocument` and `updateDocument` both take `taskId`. Setting it is one
  JobTread write per document.
- Live count: 0 of about 1,390 documents carry a task. There are 586 leaf
  schedule tasks. So a read of the link returns nothing today.
- Document types: `vendorBill` (bills), `customerOrder` (estimates, 53),
  `vendorOrder` (3), `bidRequest` (1), `customerInvoice`.
- The vendor is the document's `account`. The job is `document.job`. The app
  needs no table to keep an estimate with a vendor and a job.
- `scheduledDocuments.taskId` on `createDocument` is something else: it bills
  an invoice when a task finishes. Do not mix the two.

### Options

| | Option | Cost | Risk |
|---|---|---|---|
| A | Use JobTread's own `taskId`. Read `task.documents`. Set it with `updateDocument`. | A read route plus one write path. No new table. | The write touches live bills. A bill that is already coded or invoiced is edited. Needs the owner's ok. |
| B | Keep the link in the companion DB: table `task_links` (task id, document id). | A table and a read join. No JobTread write. | Two sources of truth. JobTread's own task view never shows it. |
| C | A first, B only if the owner will not allow the write. | | |

Recommendation: A. It keeps JobTread the source of truth. The link then shows
in JobTread's own task dialog too.

### Before building stage 4

1. The owner decides A or B. A is a new JobTread write path ("Stop and ask").
2. Check that `updateDocument { taskId }` on a vendor bill leaves its status,
   lines and `externalId` alone. Probe on one Office-job bill first, as
   `scripts/probe-deposit-line.mjs` does (dry by default).
3. Check that the appscript mirror ignores a changed `taskId` and does not
   re-create the bill.
4. The read: per task, `documents { id type status name cost price account { name } }`.
   Do not nest it in a paged tasks connection (PAVE_GOTCHAS: two-phase rule).
   Read the documents by job, then join to tasks by id.
5. The dialog shows each linked document with its type, vendor and amount, and
   the task's total. A bar can show a small count badge.
