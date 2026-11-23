# PERMITS_PLAN.md — permits and inspections per job

Status: draft — 2026-11-23

The plan for the Roadmap feature `permits` (`src/lib/roadmap.ts`): "Each job's
permits and inspections with dates and results, plus the combo inspection
checklist beside the final punch list." Size M. Ty marked it Must.

Sources read 2026-11-23 from Drive, JobTread and the code.

## What exists today

| Thing | Where | State |
|---|---|---|
| Permits | Drive PDFs per job: "PERMIT BUILD-24-0418.pdf", "PERMIT DEMO-25-0042.pdf", "Demo PERMIT.pdf", "SOLAR PERMIT.pdf", "Miller - SJC Permit Renewal.pdf" | No register. Number, dates and expiry live only inside the PDF |
| Inspections | JobTread schedule tasks: "Footing Inspection", "Stem Wall Inspection", "Sub Slab Plumbing Inspection", "Framing Inspection", "Electrical Inspection", "County Insulation Inspection", "Final Inspection" | Dated, with progress (done when 1). No pass/fail result. Some to-dos too ("Schedule sub slab plumbing inspection") |
| Combo inspection checklist | Drive doc "Combo Inspection Checklist" (March 2026) | Four sections: Pre-Inspection Basics (7), Framing Rough-In (10, fireblocking has 5 sub-items), Plumbing Rough-In (7), Mechanical Rough-In (7) |
| Final inspection checklist | The app's Punch List (`src/lib/punchList.ts`, table `punch_lists`) | Built. Its "Permit & Documentation" section asks for the inspections to be done |
| Permit records for leads | Lead research (`src/lib/leadResearchRules.ts`, `Permit`) | Reads county records for a property before it is a job |

JobTread has no permit custom field. Inspection dates belong in the JobTread
schedule, and stay there.

## The design

Three parts on one new Jobs-page tab, "Permits".

**1. Permits (companion DB).** One row per permit:
- type (building, demo, electrical, plumbing, mechanical, septic/tank, solar, other)
- number, issuer (San Juan County, L&I, other), applied, issued and expires dates
- status: applied, issued, finaled, expired
- the permit PDF: a link to its Drive file, picked from the job's folder
- a note

New table `job_permits`. Expiry joins the warnings the Renewals calendar
already gives (`src/lib/renewals.ts`): a warning 30 days before a permit expires
while the job is open.

**2. Inspections (JobTread read + companion result).**
- The list is read from JobTread: the job's schedule tasks whose name contains
  "Inspection". Name, date, done or not. Read with `pageAll`, in
  `src/lib/jobtread/` (scalars only).
- The app adds what JobTread lacks, keyed by the JobTread task id: result
  (passed, partial, failed), inspector, correction notes, a photo of the
  inspection card. New table `inspection_results`.
- A failed or partial inspection shows a "re-inspection needed" flag until a
  later inspection of the same name passes.
- No JobTread write. Scheduling an inspection stays in JobTread.

**3. Combo inspection checklist.** The Drive doc as a checklist, built on the
Punch List engine: the same template/state/ops shape, a second template. Shown
under the inspections, before the Framing inspection. Fireblocking's five
sub-items become five items. State lives in a new table `combo_checklists`
(one JSON row per job), or a `kind` column on `punch_lists` — see question 3.

## Stages

| Stage | What | Size |
|---|---|---|
| 1 — the rules | `src/lib/permits.ts` (permit status, expiry warning, re-inspection flag) and the combo template on the Punch List engine. Tests | S |
| 2 — the inspection read | `getJobInspections(jobId)` in `src/lib/jobtread/`, re-exported from `jobtread.ts`. Fixture test on the live names above | S |
| 3 — store and routes | Tables `job_permits`, `inspection_results`, combo state (schema change: Opus, owner ok before shipping). `GET/POST /api/permits?jobId=`, gated by a new `permits` VIEW | S |
| 4 — the tab | Jobs-page "Permits" tab: permits, then inspections with result chips, then the combo checklist. Phone-first: a lead records a result on site | M |
| 5 — warnings | Permit expiry on the Renewals list and the Office Dashboard. Failed inspections on the job board card. Set `built` in `roadmap.ts` | S |
| 6 (later) | AscentBot answers "what's the permit number on Studio?" and "did framing pass?" from these tables | S |

## Open questions for the owner

1. **Who records results.** Leads on site, or only the office? The plan lets
   leads (and field) record a result and a photo.
2. **Back-fill.** Enter permits for the open jobs now (Studio, Main House,
   Job 37, Beach Shack), or only new ones? A one-time AI read of the Drive
   permit PDFs could pencil them in for the office to confirm. That is extra
   work (S).
3. **Combo checklist storage.** A new table, or one `punch_lists`-style table
   with a `kind` column for both checklists? The plan prefers the `kind` column:
   one engine, one table.
4. **Inspection names.** The plan matches "Inspection" in the task name. A to-do
   like "Schedule sub slab plumbing inspection" would match too. Skip to-dos
   (`isToDo`)? The plan says skip them.
