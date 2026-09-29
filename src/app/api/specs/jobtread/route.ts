import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { specLists } from "@/db/schema";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import { clearJobCostCaches, pageAll, pave } from "@/lib/jobtread";
import { DESCRIPTION_MAX, mergeSpecEntry, type BudgetLine, type SpecList } from "@/lib/specList";

/**
 * Specifications → JobTread, ONE ROW AT A TIME (owner's call, 2026-09-29).
 *
 *   GET  ?jobId=                          → the job's budget lines, for the picker
 *   POST { listId, index, costItemId }    → save that row onto that budget line
 *
 * A JobTread Specification is a budget line with `isSpecification` on, and its
 * details are the line's description. So the save flags the line as a
 * Specification, turns on client approval (owner's call), and adds the row to
 * the description BELOW the estimator's note — see `mergeSpecEntry`. Nothing
 * else on the line changes: not its cost, price, code or type.
 *
 * A live JobTread write, behind the master writesEnabled() gate, journalled.
 * The route rides the "specs" view with the rest of /api/specs.
 */

export const dynamic = "force-dynamic";

const ROUTE = "/api/specs/jobtread";
const JOB_ID = /^[A-Za-z0-9]{6,32}$/;
const NO_DOCUMENT = { "=": [{ field: ["document", "id"] }, { value: null }] };

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  const nodes = await pageAll<{
    id: string;
    name: string;
    isSpecification: boolean;
    costGroup: { name: string } | null;
  }>(getPaveConfig(), {
    label: "job.costItems (budget)",
    query: (args) => ({
      job: {
        $: { id: jobId },
        costItems: {
          $: { ...args, where: NO_DOCUMENT },
          nextPage: {},
          nodes: { id: {}, name: {}, isSpecification: {}, costGroup: { name: {} } },
        },
      },
    }),
    pick: (a) => a?.job?.costItems,
  });
  const lines: BudgetLine[] = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    group: n.costGroup?.name ?? "",
    isSpecification: n.isSpecification,
  }));
  return NextResponse.json({ lines, writesEnabled: writesEnabled() });
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  let body: { listId?: unknown; index?: unknown; costItemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const listId = Number(body.listId);
  const index = Number(body.index);
  const costItemId = String(body.costItemId ?? "").trim();
  if (!Number.isInteger(listId) || !Number.isInteger(index) || !JOB_ID.test(costItemId)) {
    return NextResponse.json({ error: "Send listId, index and costItemId." }, { status: 400 });
  }

  await ensureDb();
  const [stored] = await db.select().from(specLists).where(eq(specLists.id, listId)).limit(1);
  if (!stored) return NextResponse.json({ error: "That spec list is gone." }, { status: 404 });
  const list = JSON.parse(stored.value) as SpecList;
  const row = list.rows[index];
  if (!row) return NextResponse.json({ error: "No such row." }, { status: 400 });

  // Read the line fresh: its job, that it is a BUDGET line, and the description
  // the merge builds on. A description typed in JobTread a minute ago survives.
  const cfg = getPaveConfig();
  const answer = await pave(cfg, {
    costItem: {
      $: { id: costItemId },
      id: {},
      name: {},
      description: {},
      isSpecification: {},
      requireSpecificationApproval: {},
      job: { id: {} },
      document: { id: {} },
    },
  });
  const item = answer?.costItem;
  if (!item || item.job?.id !== stored.jobId || item.document) {
    return NextResponse.json({ error: "That line is not on this job's budget." }, { status: 400 });
  }

  const description = mergeSpecEntry(item.description, row);
  if (description.length > DESCRIPTION_MAX) {
    return NextResponse.json(
      { error: `"${item.name}" would pass JobTread's ${DESCRIPTION_MAX}-character description limit. Pick another line.` },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({
      wrote: false,
      message: "Writes are OFF (COMPANION_WRITES_ENABLED not set). Nothing was written to JobTread.",
    });
  }

  const journal = await openJournal(ROUTE);
  await pave(cfg, {
    updateCostItem: {
      $: { id: costItemId, description, isSpecification: true, requireSpecificationApproval: true },
      costItem: { $: { id: costItemId }, id: {} },
    },
  });
  const base = { action: "budget.item.update", entity: "costItem", entityId: costItemId, jobId: stored.jobId, beforeSource: "read" as const };
  await journal.record([
    { ...base, field: "description", before: item.description ?? "", after: description },
    ...(item.isSpecification ? [] : [{ ...base, field: "isSpecification", before: false, after: true }]),
    ...(item.requireSpecificationApproval
      ? []
      : [{ ...base, field: "requireSpecificationApproval", before: false, after: true }]),
  ]);
  clearJobCostCaches();

  row.jt = { costItemId, line: item.name, savedAt: new Date().toISOString() };
  await db.update(specLists).set({ value: JSON.stringify(list) }).where(eq(specLists.id, listId));
  return NextResponse.json({ wrote: true, jt: row.jt });
}
