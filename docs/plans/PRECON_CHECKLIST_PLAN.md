# PRECON_CHECKLIST_PLAN.md — the preconstruction checklist per job

Status: agreed — 2026-11-23

The plan for the Roadmap feature `precon` (`src/lib/roadmap.ts`): "The 27-step
precon checklist per job (DD review → estimate → contract → deposit →
schedule), each with a status." Size S. Ty marked it Must.

Sources read 2026-11-23 from Drive and the code.

## What the old system did

- **Template sheet:** "[Project] - Preconstrcution Process Checklist". 27 rows,
  columns Action / Status / Notes. Status values seen: In Progress, Complete, Blocked.
- **Copies used:** Seely and Killen-Gall (2025). Last edit August 2025. Only the
  first three rows were ever filled in.
- **What replaced it in 2026:** free-form docs per job ("Velorum Ventures - Precon
  Checklist"). These hold open questions and per-person to-dos, not the 27 steps.
- **The client-facing version:** "Pre-Construction Process Overview" doc. It
  groups the same steps into four phases: Design Development, Permit Set,
  Construction Documents, Contract & Mobilization.

So the 27 steps are the agreed process, but nobody kept the sheet. The app
version must be quicker than a sheet, or it will go unused too.

## The design

Copy the Punch List pattern (`src/lib/punchList.ts`, table `punch_lists`). It
already solves "a fixed template, ticked per job, items added or hidden per job".

- **Template:** the 27 steps, grouped into the four phases of the Overview doc.
  Spelling fixed ("Receive CD set", "prescribed"). Keyed by phase + slug, as the
  Punch List keys its items.
- **Per step:** status — not started, in progress, blocked, done, or n/a. One
  optional note. Who changed it and when.
- **Per job:** add a step, hide a step, a free-text "Open questions" box (what
  the Velorum doc holds today).
- **Progress:** "12 of 27 done, phase: Permit Set". The phase is the first phase
  with a step not done.
- **Storage:** one JSON row per job in a new companion table `precon_checklists`
  (`job_id` primary key, `value`, `updated_at`, `updated_by`). Not JobTread data.
- **No JobTread write.** The deposit step does not read JobTread in stage 1.

## Where it shows

| Place | What |
|---|---|
| Jobs page (`/jobs-hub`) | A "Precon" tab beside Punch List, on jobs whose Phase is PreCon or PreCon Budget (`PRECON_PHASES` in `src/lib/jobBoard.ts`). Hidden on other jobs unless the job already has a checklist |
| Job board PreCon row (`/job-board`) | A progress line on each PreCon card: "Permit Set · 12/27", plus a dot when a step is blocked |
| Search | A precon checklist is found by job name, as the Punch List is |

## Stages

| Stage | What | Size |
|---|---|---|
| 1 — the rule | `src/lib/preconChecklist.ts`: template, state, ops (`set-status`, `note`, `add`, `hide`, `questions`), `progress()`. Tests, modelled on `punchList.test.ts` | S |
| 2 — the store and route | `precon_checklists` table (schema change: Opus, owner ok before shipping). `GET/POST /api/precon-checklist?jobId=`, gated by a new `precon` VIEW (office + admin + lead) | S |
| 3 — the tab | The Jobs-page tab, phone-first: one row per step, a status chip that cycles on tap, the note under it | S |
| 4 — the board line | Progress on the PreCon cards of `/job-board`. Set `built` in `roadmap.ts` | S |
| 5 (later) | Tick "10% deposit received" by itself from the deposit read (`readDeposits`). Tick "Contract estimate" when an approved Proposal exists. Read only | S |

## Owner decisions (2026-11-23)

1. **Who ticks it:** leads and office (admin too). The `precon` VIEW grants
   office, admin and lead.
2. **The steps:** keep all 27 as the sheet has them. Spelling fixes only.
3. **Per-person to-dos** stay in JobTread, not in this checklist.
4. **Old jobs** (Seely, Killen-Gall): not imported. Every job starts fresh.

Stage 2 adds the `precon_checklists` table. Build it on Opus and show the owner
before shipping (a schema change).
