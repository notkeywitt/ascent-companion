/**
 * Budget Import → JobTread. Matches a tracking sheet's estimate (the items
 * appscript BudgetImport.js reads off the sheet) to a job's LIVE budget, and
 * writes the difference straight into it — updating the budget items that are
 * already there instead of adding a second copy, which is what a CSV import does.
 *
 * Why update in place: time entries and bill lines attach to a budget item by
 * its id, so an item must keep its id. Nothing here deletes a budget item. An
 * item the sheet no longer has is listed and left alone.
 *
 * Matching, per cost code, strongest first:
 *   1. the same NAME, one each side     — a re-sync of a budget this tool built
 *   2. the same COST, one each side     — a hand-entered line typed differently
 *   3. the same COST TYPE, one each side
 *   4. one item left each side
 * Whatever is left is a "choose" row: the office picks which JobTread item on
 * that code the sheet item updates, or creates a new one. With nothing left on
 * the JobTread side, the sheet item is created. A matched item takes the sheet's
 * name, so every later re-sync pairs on pass 1. Its description is the
 * office's and is never overwritten.
 *
 * Cost comes before cost type because of job 002's Mobilization: a $4,160 line
 * typed Other beside a $0 Labor placeholder. Pairing on type updated the
 * placeholder and left the real line counting beside it — $4,160 of double
 * budget. Items in the "Selections" group are the client's picks, not budget
 * lines, and are never matched.
 *
 * PRICE. Probed live 2026-09-24 (scripts/probe-budget-write.mjs): an item created
 * through the API with no unitPrice gets a $0 price — JobTread does not apply
 * the cost type's margin — and an update never moves the price. So every write
 * sends unitPrice = unitCost × (1 + the markup the office typed), owner's call.
 *
 * TIME ENTRIES. JobTread rejects a time entry on a cost type that is not time
 * trackable, so an item that already carries time entries keeps its cost type
 * when the sheet asks for one that is not, and the plan says so.
 */
import { createHash } from "node:crypto";
import { pageAll, pave, type PaveConfig } from "@/lib/jobtread";
import type { Journal } from "@/lib/financialJournal";

/** One item as appscript `_biBudgetItems` returns it. */
export interface SheetItem {
  costGroup: string;
  name: string;
  description: string;
  quantity: number | "";
  unit: string;
  unitCost: number;
  costType: string;
  costCode: string;
  codeNumber: string;
}

/** One live budget item (a job cost item with no document). */
export interface BudgetLeaf {
  id: string;
  name: string;
  code: string;
  costType: string;
  unit: string;
  quantity: number | null;
  unitCost: number | null;
  unitPrice: number | null;
  timeEntries: number;
  /** Sits under the job's "Selections" group — a client pick, not a budget line. */
  selection?: boolean;
}

export interface BudgetGroup {
  id: string;
  name: string;
  parentId: string | null;
}

export type ChangeField = "name" | "quantity" | "unitCost" | "unitPrice" | "costType" | "unit";

export interface Change {
  field: ChangeField;
  before: string | number | null;
  after: string | number | null;
}

export type PlanRow =
  | { key: string; action: "create"; sheet: SheetItem }
  | {
      key: string;
      action: "update" | "unchanged";
      sheet: SheetItem;
      target: BudgetLeaf;
      changes: Change[];
      /** The sheet's cost type was not applied: the item carries time entries. */
      keptType?: string;
    }
  | { key: string; action: "choose"; sheet: SheetItem; candidates: BudgetLeaf[] };

export interface BudgetPlan {
  rows: PlanRow[];
  /** Budget items the sheet does not have. Never written. */
  untouched: BudgetLeaf[];
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const round4 = (n: number) => Math.round(n * 10000) / 10000;
const same = (a: number | null, b: number | null) =>
  a === b || (a != null && b != null && Math.abs(a - b) < 1e-6);

export const unitPriceFor = (unitCost: number, markupPct: number) =>
  round4(unitCost * (1 + markupPct / 100));

export const sheetCost = (s: SheetItem) => (s.quantity === "" ? 1 : s.quantity) * s.unitCost;
export const leafCost = (l: BudgetLeaf) => (l.quantity ?? 1) * (l.unitCost ?? 0);

function pairRow(
  key: string,
  s: SheetItem,
  l: BudgetLeaf,
  markupPct: number,
  timeTrackable: Set<string>,
): PlanRow {
  const changes: Change[] = [];
  if (s.name !== l.name) changes.push({ field: "name", before: l.name, after: s.name });
  const qty = s.quantity === "" ? null : s.quantity;
  // A lump sum at quantity 1 costs the same as one at no quantity.
  if (!same(l.quantity, qty) && !(qty === null && l.quantity === 1)) {
    changes.push({ field: "quantity", before: l.quantity, after: qty });
  }
  if (!same(l.unitCost, s.unitCost)) changes.push({ field: "unitCost", before: l.unitCost, after: s.unitCost });
  const price = unitPriceFor(s.unitCost, markupPct);
  if (!same(l.unitPrice, price)) changes.push({ field: "unitPrice", before: l.unitPrice, after: price });
  const keepType = l.costType !== s.costType && l.timeEntries > 0 && !timeTrackable.has(s.costType);
  if (l.costType !== s.costType && !keepType) {
    changes.push({ field: "costType", before: l.costType, after: s.costType });
  }
  if (s.unit && s.unit !== l.unit) changes.push({ field: "unit", before: l.unit || null, after: s.unit });
  return {
    key,
    action: changes.length ? "update" : "unchanged",
    sheet: s,
    target: l,
    changes,
    ...(keepType ? { keptType: s.costType } : {}),
  };
}

/** The plan. Pure: same sheet + same budget → same rows, same keys. */
export function planBudgetImport(
  sheet: SheetItem[],
  leaves: BudgetLeaf[],
  markupPct: number,
  timeTrackable: Set<string>,
): BudgetPlan {
  const seen = new Map<string, number>();
  const keyed = sheet.map((s) => {
    const n = seen.get(s.name) ?? 0;
    seen.set(s.name, n + 1);
    return { key: `${s.name}#${n}`, s };
  });
  // JobTread's auto "Uncategorized <code>" rollups are not budget lines, and
  // neither are the client's selections.
  const pool = leaves.filter((l) => !l.selection && !/^uncategorized\b/i.test(l.name));

  const pairs = new Map<string, BudgetLeaf>();
  const choose = new Map<string, BudgetLeaf[]>();
  for (const code of new Set(keyed.map((k) => norm(k.s.codeNumber)))) {
    let S = keyed.filter((k) => norm(k.s.codeNumber) === code);
    let J = pool.filter((l) => norm(l.code) === code);
    const pair = (k: (typeof keyed)[number], l: BudgetLeaf) => {
      pairs.set(k.key, l);
      S = S.filter((x) => x !== k);
      J = J.filter((x) => x !== l);
    };
    for (const k of [...S]) {
      const j = J.filter((l) => norm(l.name) === norm(k.s.name));
      if (j.length === 1 && S.filter((x) => norm(x.s.name) === norm(k.s.name)).length === 1) pair(k, j[0]);
    }
    for (const k of [...S]) {
      const c = sheetCost(k.s);
      const j = J.filter((l) => same(leafCost(l), c));
      if (c !== 0 && j.length === 1 && S.filter((x) => same(sheetCost(x.s), c)).length === 1) pair(k, j[0]);
    }
    for (const t of new Set(S.map((k) => k.s.costType))) {
      const s = S.filter((k) => k.s.costType === t);
      const j = J.filter((l) => l.costType === t);
      if (s.length === 1 && j.length === 1) pair(s[0], j[0]);
    }
    if (S.length === 1 && J.length === 1) pair(S[0], J[0]);
    for (const k of S) if (J.length) choose.set(k.key, J);
  }

  const rows: PlanRow[] = keyed.map(({ key, s }) => {
    const l = pairs.get(key);
    if (l) return pairRow(key, s, l, markupPct, timeTrackable);
    const c = choose.get(key);
    return c ? { key, action: "choose", sheet: s, candidates: c } : { key, action: "create", sheet: s };
  });
  const paired = new Set([...pairs.values()].map((l) => l.id));
  // A selection that carries a cost still counts in the budget, so it is shown.
  const untouched = leaves.filter(
    (l) => !paired.has(l.id) && !/^uncategorized\b/i.test(l.name) && (!l.selection || leafCost(l) !== 0),
  );
  return { rows, untouched };
}

/**
 * Turn every "choose" row into an update or a create from the office's picks
 * (`choices[key]` = a candidate's id, or "new"). Throws on a missing pick, a
 * pick that is not one of that row's candidates, or one item picked twice.
 */
export function resolveChoices(
  plan: BudgetPlan,
  choices: Record<string, string>,
  markupPct: number,
  timeTrackable: Set<string>,
): PlanRow[] {
  const taken = new Set<string>();
  for (const r of plan.rows) if (r.action === "update" || r.action === "unchanged") taken.add(r.target.id);
  return plan.rows.map((r) => {
    if (r.action !== "choose") return r;
    const pick = choices[r.key];
    if (!pick) throw new Error(`Choose what "${r.sheet.name}" does before writing.`);
    if (pick === "new") return { key: r.key, action: "create", sheet: r.sheet };
    const target = r.candidates.find((l) => l.id === pick);
    if (!target) throw new Error(`"${r.sheet.name}": that JobTread item is not one of its choices.`);
    if (taken.has(pick)) throw new Error(`Two sheet items are set to update "${target.name}".`);
    taken.add(pick);
    return pairRow(r.key, r.sheet, target, markupPct, timeTrackable);
  });
}

/**
 * Fingerprint of what a plan was built from, so a write refuses a stale preview.
 * Only the fields a write reads or overwrites — not the time-entry count, which
 * moves every time someone logs an hour and would refuse writes on a busy job.
 */
export function planHash(sheet: SheetItem[], leaves: BudgetLeaf[], markupPct: number): string {
  const l = [...leaves]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, name, code, costType, unit, quantity, unitCost, unitPrice, selection }) =>
      [id, name, code, costType, unit, quantity, unitCost, unitPrice, !!selection]);
  return createHash("sha256").update(JSON.stringify({ sheet, l, markupPct })).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// JobTread reads
// ---------------------------------------------------------------------------

const NO_DOCUMENT = { "=": [{ field: ["document", "id"] }, { value: null }] };

export async function readJobBudget(
  cfg: PaveConfig,
  jobId: string,
): Promise<{ leaves: BudgetLeaf[]; groups: BudgetGroup[] }> {
  const [items, groups] = await Promise.all([
    pageAll<any>(cfg, {
      label: "job.costItems (budget)",
      query: (args) => ({
        job: {
          $: { id: jobId },
          costItems: {
            $: { ...args, where: NO_DOCUMENT },
            nextPage: {},
            nodes: {
              id: {}, name: {}, quantity: {}, unitCost: {}, unitPrice: {},
              costCode: { number: {} }, costType: { name: {} }, unit: { name: {} },
              costGroup: { id: {} }, timeEntries: { count: {} },
            },
          },
        },
      }),
      pick: (a) => a?.job?.costItems,
    }),
    pageAll<any>(cfg, {
      label: "job.costGroups (budget)",
      query: (args) => ({
        job: {
          $: { id: jobId },
          costGroups: {
            $: { ...args, where: NO_DOCUMENT },
            nextPage: {},
            nodes: { id: {}, name: {}, parentCostGroup: { id: {} } },
          },
        },
      }),
      pick: (a) => a?.job?.costGroups,
    }),
  ]);
  const byId = new Map(groups.map((g) => [g.id, g]));
  const inSelections = (id: string | undefined): boolean => {
    for (let g = id ? byId.get(id) : undefined, hops = 0; g && hops < 20; g = byId.get(g.parentCostGroup?.id), hops++) {
      if (/^selections$/i.test(String(g.name ?? "").trim())) return true;
    }
    return false;
  };
  return {
    leaves: items.map((n) => ({
      id: n.id,
      name: n.name ?? "",
      code: n.costCode?.number ?? "",
      costType: n.costType?.name ?? "",
      unit: n.unit?.name ?? "",
      quantity: n.quantity ?? null,
      unitCost: n.unitCost ?? null,
      unitPrice: n.unitPrice ?? null,
      timeEntries: n.timeEntries?.count ?? 0,
      selection: inSelections(n.costGroup?.id),
    })),
    groups: groups.map((g) => ({ id: g.id, name: g.name ?? "", parentId: g.parentCostGroup?.id ?? null })),
  };
}

export interface Catalog {
  codeId: Map<string, string>;
  typeId: Map<string, string>;
  timeTrackable: Set<string>;
  unitId: Map<string, string>;
}

export async function readCatalog(cfg: PaveConfig): Promise<Catalog> {
  const org = (field: string, nodes: Record<string, unknown>) =>
    pageAll<any>(cfg, {
      label: `organization.${field}`,
      query: (args) => ({ organization: { $: { id: cfg.orgId }, [field]: { $: args, nextPage: {}, nodes } } }),
      pick: (a) => a?.organization?.[field],
    });
  const [codes, types, units] = await Promise.all([
    org("costCodes", { id: {}, number: {} }),
    org("costTypes", { id: {}, name: {}, isTimeTrackable: {} }),
    org("units", { id: {}, name: {} }),
  ]);
  return {
    codeId: new Map(codes.map((c) => [norm(c.number ?? ""), c.id])),
    typeId: new Map(types.map((t) => [t.name, t.id])),
    timeTrackable: new Set(types.filter((t) => t.isTimeTrackable).map((t) => t.name)),
    unitId: new Map(units.map((u) => [u.name, u.id])),
  };
}

/** Every code, type and unit the writes will need that JobTread does not have. */
export function missingFromCatalog(rows: PlanRow[], cat: Catalog): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.action === "create") {
      if (!cat.codeId.has(norm(r.sheet.codeNumber))) out.add(`cost code ${r.sheet.codeNumber}`);
      if (!cat.typeId.has(r.sheet.costType)) out.add(`cost type ${r.sheet.costType}`);
      if (r.sheet.unit && !cat.unitId.has(r.sheet.unit)) out.add(`unit ${r.sheet.unit}`);
    } else if (r.action === "update") {
      for (const c of r.changes) {
        if (c.field === "costType" && !cat.typeId.has(String(c.after))) out.add(`cost type ${c.after}`);
        if (c.field === "unit" && !cat.unitId.has(String(c.after))) out.add(`unit ${c.after}`);
      }
    }
  }
  return [...out];
}

// ---------------------------------------------------------------------------
// JobTread writes
// ---------------------------------------------------------------------------

export interface ApplyResult {
  updated: number;
  created: number;
  groupsCreated: number;
  /** The first write that failed. Every write before it stands; re-run to finish. */
  failed?: { name: string; error: string };
}

/**
 * Write the plan, one item at a time, stopping at the first failure. Each write
 * is journalled. A re-run after a failure is safe: what already landed now
 * matches by name and reads as unchanged.
 */
export async function applyBudgetImport(
  cfg: PaveConfig,
  jobId: string,
  rows: PlanRow[],
  groups: BudgetGroup[],
  cat: Catalog,
  markupPct: number,
  journal: Journal,
): Promise<ApplyResult> {
  const res: ApplyResult = { updated: 0, created: 0, groupsCreated: 0 };
  const known = [...groups];

  // The division group matches on its two-digit prefix ("07 Thermal & Moisture
  // Protection" is the same division as the sheet's "07 Thermal and Moisture
  // Protection"); a row's own sub-group matches on its cost code.
  async function group(name: string, parentId: string | null, prefix: string): Promise<string> {
    const siblings = known.filter((g) => g.parentId === parentId);
    const hit =
      siblings.find((g) => norm(g.name) === norm(name)) ??
      siblings.find((g) => norm(g.name).startsWith(prefix) && (parentId || !/^\d{2} \d{2} \d{2}/.test(g.name)));
    if (hit) return hit.id;
    const $ = parentId ? { parentCostGroupId: parentId, name } : { jobId, name };
    const r = await pave(cfg, { createCostGroup: { $, createdCostGroup: { id: {} } } });
    const id = r?.createCostGroup?.createdCostGroup?.id;
    if (!id) throw new Error(`createCostGroup returned no id for "${name}".`);
    known.push({ id, name, parentId });
    res.groupsCreated++;
    await journal.record([{ action: "budget.group.create", entity: "costGroup", entityId: id, jobId, after: name, beforeSource: "none" }]);
    return id;
  }

  for (const r of rows) {
    if (r.action !== "create" && r.action !== "update") continue;
    const s = r.sheet;
    try {
      if (r.action === "update") {
        const $: Record<string, unknown> = { id: r.target.id };
        for (const c of r.changes) {
          if (c.field === "costType") $.costTypeId = cat.typeId.get(String(c.after));
          else if (c.field === "unit") $.unitId = cat.unitId.get(String(c.after));
          else $[c.field] = c.after;
        }
        await pave(cfg, { updateCostItem: { $, costItem: { $: { id: r.target.id }, id: {} } } });
        res.updated++;
        const delta = Math.round((sheetCost(s) - leafCost(r.target)) * 100) / 100;
        await journal.record(
          r.changes.map((c, i) => ({
            action: "budget.item.update",
            entity: "costItem",
            entityId: r.target.id,
            jobId,
            field: c.field,
            before: c.before,
            after: c.after,
            beforeSource: "read" as const,
            amount: i === 0 && delta ? delta : null,
            meta: { name: r.target.name },
          })),
        );
      } else {
        const [div, sub] = s.costGroup.split("; ");
        let groupId = await group(div, null, norm(div).slice(0, 3));
        if (sub) groupId = await group(sub, groupId, norm(s.codeNumber) + " ");
        const item = {
          costGroupId: groupId,
          name: s.name,
          description: s.description || null,
          costCodeId: cat.codeId.get(norm(s.codeNumber)),
          costTypeId: cat.typeId.get(s.costType),
          ...(s.unit ? { unitId: cat.unitId.get(s.unit) } : {}),
          quantity: s.quantity === "" ? null : s.quantity,
          unitCost: s.unitCost,
          unitPrice: unitPriceFor(s.unitCost, markupPct),
          isTaxable: true,
        };
        const out = await pave(cfg, { createCostItem: { $: item, createdCostItem: { id: {} } } });
        const id = out?.createCostItem?.createdCostItem?.id;
        if (!id) throw new Error("createCostItem returned no id.");
        res.created++;
        await journal.record([
          { action: "budget.item.create", entity: "costItem", entityId: id, jobId, after: item, beforeSource: "none", amount: sheetCost(s) },
        ]);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await journal.record([
        { action: `budget.item.${r.action}`, entity: "costItem", entityId: r.action === "update" ? r.target.id : undefined, jobId, outcome: "error", error, meta: { name: s.name } },
      ]);
      res.failed = { name: s.name, error };
      return res;
    }
  }
  return res;
}
