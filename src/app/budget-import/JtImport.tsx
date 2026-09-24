"use client";

import { useState } from "react";
import {
  Banner,
  Button,
  Chip,
  ListCard,
  ListRow,
  MetaLine,
  SectionHeading,
  Select,
  StickyActionBar,
} from "@/components/ui";
import type { BudgetLeaf, BudgetPlan, Change, PlanRow, SheetItem } from "@/lib/budgetImport";

/**
 * "Import into JT" — previews how the sheet lands on the job's LIVE budget,
 * then writes it: updates the items already there (they keep their ids, so
 * their time entries and bill lines stay attached), creates what is missing,
 * and leaves every item the sheet does not have alone. The rules live in
 * src/lib/budgetImport.ts; this is the preview and the picks.
 */

interface PlanAnswer {
  plan: BudgetPlan;
  hash: string;
  problems: string[];
  missing: string[];
  writesEnabled: boolean;
}

interface ApplyAnswer {
  wrote: boolean;
  message?: string;
  updated?: number;
  created?: number;
  groupsCreated?: number;
  failed?: { name: string; error: string };
}

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const sheetCost = (s: SheetItem) => (s.quantity === "" ? 1 : s.quantity) * s.unitCost;
const leafCost = (l: BudgetLeaf) => (l.quantity ?? 1) * (l.unitCost ?? 0);

const FIELD: Record<Change["field"], string> = {
  name: "Name",
  quantity: "Qty",
  unitCost: "Unit cost",
  unitPrice: "Unit price",
  costType: "Type",
  unit: "Unit",
};
const fmt = (c: Change, v: Change["before"]) =>
  v == null || v === "" ? "—" : c.field === "unitCost" || c.field === "unitPrice" ? money(Number(v)) : String(v);

async function post(body: Record<string, unknown>) {
  const r = await fetch("/api/budget-import/jobtread", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok && !(b.wrote && b.failed)) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

export default function JtImport({ projectId, markup }: { projectId: string; markup: number }) {
  const [answer, setAnswer] = useState<PlanAnswer | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"" | "plan" | "apply">("");
  const [error, setError] = useState("");
  const [applied, setApplied] = useState<ApplyAnswer | null>(null);

  async function preview() {
    setBusy("plan");
    setError("");
    try {
      setAnswer(await post({ op: "plan", projectId, markup }));
      setChoices({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const rows = answer?.plan.rows ?? [];
  type Pair = Extract<PlanRow, { target: BudgetLeaf }>;
  const updates = rows.filter((r): r is Pair => r.action === "update");
  const unchanged = rows.filter((r): r is Pair => r.action === "unchanged");
  const creates = rows.filter((r): r is Extract<PlanRow, { action: "create" }> => r.action === "create");
  const chooses = rows.filter((r): r is Extract<PlanRow, { action: "choose" }> => r.action === "choose");
  const kept = [...updates, ...unchanged].filter((r) => r.keptType);
  // A candidate the office picked is being updated, so it no longer sits apart.
  const picked = new Set(Object.values(choices));
  const untouched = (answer?.plan.untouched ?? []).filter((l) => !picked.has(l.id));
  // A leftover on a code the sheet also uses still counts in the budget — most
  // likely a hand-entered duplicate of a line the sheet now owns.
  const sheetCodes = new Set(rows.map((r) => r.sheet.codeNumber.replace(/\s+/g, " ").trim().toLowerCase()));
  const sameCode = (l: BudgetLeaf) => sheetCodes.has(l.code.replace(/\s+/g, " ").trim().toLowerCase()) && leafCost(l) !== 0;
  const dupes = untouched.filter(sameCode);
  const sheetTotal = rows.reduce((t, r) => t + sheetCost(r.sheet), 0);
  const leftTotal = untouched.reduce((t, l) => t + leafCost(l), 0);
  const writes = updates.length + creates.length + chooses.length;
  const ready = !!answer && answer.writesEnabled && writes > 0 && chooses.every((r) => choices[r.key]) && !answer.missing.length;

  async function write() {
    if (!answer) return;
    if (!window.confirm(`Write ${writes} change${writes === 1 ? "" : "s"} to this job's JobTread budget?`)) return;
    setBusy("apply");
    setError("");
    setApplied(null);
    let wrote = false;
    try {
      setApplied(await post({ op: "apply", projectId, markup, hash: answer.hash, choices }));
      wrote = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
    // Show what the budget looks like now — what landed reads as unchanged. Not
    // after a refused write: the re-read would clear the reason off the screen.
    if (wrote) await preview();
  }

  return (
    <div className="space-y-4">
      <Button variant="secondary" onClick={preview} disabled={!!busy}>
        {busy === "plan" ? "Reading the JobTread budget…" : "Import into JT"}
      </Button>

      {error && <Banner tone="error">{error}</Banner>}

      {applied && (
        <Banner tone={applied.failed ? "error" : applied.wrote ? "success" : "neutral"}>
          {applied.wrote ? (
            <>
              <p className="font-semibold">
                Updated {applied.updated}, created {applied.created}
                {applied.groupsCreated ? `, plus ${applied.groupsCreated} groups` : ""}.
              </p>
              {applied.failed && (
                <p className="mt-1">
                  Stopped at “{applied.failed.name}”: {applied.failed.error}. Everything before it was written; fix
                  that and import again to finish.
                </p>
              )}
            </>
          ) : (
            applied.message
          )}
        </Banner>
      )}

      {answer && (
        <>
          <MetaLine
            items={[
              `${updates.length} to update`,
              `${creates.length} to create`,
              chooses.length > 0 && `${chooses.length} need a choice`,
              `${unchanged.length} unchanged`,
              untouched.length > 0 && `${untouched.length} left alone`,
              `budget after: ${money(sheetTotal + leftTotal)}`,
            ]}
          />
          {dupes.length > 0 && (
            <Banner tone="warning">
              {dupes.length === 1 ? "1 item" : `${dupes.length} items`} ({money(dupes.reduce((t, l) => t + leafCost(l), 0))})
              sit on codes the sheet also uses and still count in the budget. If they are hand-entered duplicates,
              zero them in JobTread.
            </Banner>
          )}

          {!answer.writesEnabled && (
            <Banner tone="neutral">Writes are off in this environment. This preview writes nothing.</Banner>
          )}
          {answer.missing.length > 0 && (
            <Banner tone="error">JobTread has no {answer.missing.join(", ")}. Fix the sheet or JobTread first.</Banner>
          )}
          {answer.problems.length > 0 && (
            <Banner tone="warning">
              The sheet has {answer.problems.length} problem{answer.problems.length === 1 ? "" : "s"} (listed above).
            </Banner>
          )}
          {kept.length > 0 && (
            <Banner tone="warning">
              {kept.map((r) => (
                <p key={r.key}>
                  “{r.target.name}” keeps {r.target.costType}: it has {r.target.timeEntries} time entries, and{" "}
                  {r.keptType} can’t hold them.
                </p>
              ))}
            </Banner>
          )}

          {chooses.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Needs a choice</SectionHeading>
              <ListCard className="divide-y divide-line-soft">
                {chooses.map((r) => (
                  <div key={r.key} className="space-y-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-semibold tracking-tight">{r.sheet.name}</p>
                      <MetaLine items={[r.sheet.costType, money(sheetCost(r.sheet))]} />
                    </div>
                    <Select
                      aria-label={`What ${r.sheet.name} does`}
                      value={choices[r.key] ?? ""}
                      onChange={(e) => setChoices((c) => ({ ...c, [r.key]: e.target.value }))}
                    >
                      <option value="">Choose…</option>
                      {r.candidates.map((l) => (
                        <option
                          key={l.id}
                          value={l.id}
                          disabled={Object.entries(choices).some(([k, v]) => v === l.id && k !== r.key)}
                        >
                          Update “{l.name}” — {l.costType}, {money(leafCost(l))}
                          {l.timeEntries ? `, ${l.timeEntries} time entries` : ""}
                        </option>
                      ))}
                      <option value="new">Create a new item</option>
                    </Select>
                  </div>
                ))}
              </ListCard>
            </section>
          )}

          {updates.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Update</SectionHeading>
              <ListCard>
                {updates.map((r) => (
                  <ListRow
                    key={r.key}
                    label={r.target.name}
                    desc={<MetaLine items={r.changes.map((c) => `${FIELD[c.field]} ${fmt(c, c.before)} → ${fmt(c, c.after)}`)} />}
                    badge={r.target.timeEntries > 0 ? <Chip tone="info">{r.target.timeEntries} time entries</Chip> : undefined}
                  />
                ))}
              </ListCard>
            </section>
          )}

          {creates.length > 0 && (
            <section className="space-y-2">
              <SectionHeading>Create</SectionHeading>
              <ListCard>
                {creates.map((r) => (
                  <ListRow
                    key={r.key}
                    label={r.sheet.name}
                    desc={<MetaLine items={[r.sheet.costGroup, r.sheet.costType]} />}
                    trailing={<span className="shrink-0 text-sm tabular-nums">{money(sheetCost(r.sheet))}</span>}
                  />
                ))}
              </ListCard>
            </section>
          )}

          {untouched.length > 0 && (
            <section className="space-y-2">
              <SectionHeading trailing={<span className="text-xs tabular-nums">{money(leftTotal)}</span>}>
                Left alone
              </SectionHeading>
              <ListCard>
                {untouched.map((l) => (
                  <ListRow
                    key={l.id}
                    label={l.name}
                    desc={<MetaLine items={[l.code, l.costType, l.timeEntries > 0 && `${l.timeEntries} time entries`]} />}
                    badge={sameCode(l) ? <Chip tone="warning">same code</Chip> : undefined}
                    trailing={<span className="shrink-0 text-sm tabular-nums">{money(leafCost(l))}</span>}
                  />
                ))}
              </ListCard>
            </section>
          )}

          {writes > 0 && (
            <StickyActionBar>
              <Button onClick={write} disabled={!ready || !!busy}>
                {busy === "apply" ? "Writing to JobTread…" : `Write ${writes} change${writes === 1 ? "" : "s"} to JobTread`}
              </Button>
              {chooses.some((r) => !choices[r.key]) && (
                <span className="text-xs text-neutral-500 dark:text-neutral-400">Make every choice first.</span>
              )}
            </StickyActionBar>
          )}
        </>
      )}
    </div>
  );
}
