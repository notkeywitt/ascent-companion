/**
 * Lead research — a property dossier for one lead.
 *
 * THE FLOW
 *   1. The office taps "Research" on a lead (/leads). `requestResearch` logs a
 *      run as `requested`.
 *   2. A Mac with scripts/lead-research/ installed (the office Mac mini, the
 *      owner's MacBook, or both) asks every 2 minutes whether a run is due. The
 *      first to call `beginRun` claims it and starts Claude Code on Opus with
 *      skill /lead-research. The run reads the county's property, permit and
 *      inspection records and any other source, downloads the photos and
 *      documents, and submits a dossier (`submitResult`) and the files
 *      (`createFile` + `saveChunk`).
 *   3. The run is `ready`: everything is PENCILED IN. Nothing has reached
 *      JobTread. /leads/research/<id> shows the summary, the JobTread fields
 *      it would fill, the app's own property fields and the files.
 *   4. A person approves (`applyFields`, then `applyFile` per file). The fields
 *      go through the same allowlisted write as the Clients editor
 *      (`clientDirectory.applyPatch`), journalled. Each file goes to the
 *      JobTread folder "Background" on the newest job, or on the customer when
 *      there is no job. The run is then `reviewed`.
 *
 * A lead not yet in JobTread ("inq_…") can be researched. Its JobTread fields
 * wait until the lead is pushed: the run resolves its customer at approve time.
 *
 * This replaces the appscript ParcelEnrichment.js assessor lookup.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import {
  leadInquiries,
  leadResearch,
  leadResearchChunks,
  leadResearchFiles,
  leads as leadsTable,
  type LeadResearchFileRow,
  type LeadResearchRow,
} from "@/db/schema";
import {
  CF_TARGET_BY_KIND,
  applyPatch,
  getCustomFields,
  readRecordFlat,
  validatePatch,
  type CfTarget,
  type CustomFieldDef,
  type WriteKind,
} from "@/lib/clientDirectory";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { diffFields, openJournal } from "@/lib/financialJournal";
import { clearJtRefCache, getResearchSubject, uploadFileToFolder, type ResearchSubject } from "@/lib/jobtread";
import { inquirySummary, type InquiryFields } from "@/lib/leadInquiry";
import {
  BACKGROUND_FOLDER,
  BLOCKED_FIELDS,
  CHUNK_BYTES,
  MAX_FILE_BYTES,
  MAX_RUN_BYTES,
  MAX_RUN_FILES,
  buildPatches,
  cleanSubmission,
  readDossier,
  readMatch,
  safeFileName,
  type Dossier,
  type Fact,
  type FieldCatalog,
  type MatchInfo,
  type ProposalTarget,
} from "@/lib/leadResearchRules";

/** A run left `running` this long gave up: its Mac slept or Claude died. */
const STALE_RUN_MINUTES = 150;

const now = () => new Date().toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

export type RunStatus = "requested" | "running" | "ready" | "reviewed" | "error" | "cancelled";
const ACTIVE: RunStatus[] = ["requested", "running"];

// ── The lead behind a run ───────────────────────────────────────────────────

interface LeadContext {
  leadKey: string;
  /** The JobTread customer, once there is one. */
  accountId: string;
  inquiry: typeof leadInquiries.$inferSelect | null;
  tracking: typeof leadsTable.$inferSelect | null;
}

/**
 * The board's lead id → its JobTread customer (if any), its intake answers and
 * our tracking row. An inquiry id resolves to its account once pushed; an
 * account id finds the inquiry that was pushed into it.
 */
async function leadContext(leadKey: string): Promise<LeadContext> {
  await ensureDb();
  let inquiry: LeadContext["inquiry"] = null;
  let accountId = "";
  if (leadKey.startsWith("inq_")) {
    [inquiry] = await db.select().from(leadInquiries).where(eq(leadInquiries.id, leadKey));
    accountId = inquiry?.jtAccountId ?? "";
  } else {
    accountId = leadKey;
    [inquiry] = await db.select().from(leadInquiries).where(eq(leadInquiries.jtAccountId, leadKey));
  }
  const keys = [leadKey, accountId, inquiry?.id ?? ""].filter(Boolean);
  const [tracking] = await db.select().from(leadsTable).where(inArray(leadsTable.accountId, keys));
  return { leadKey, accountId, inquiry: inquiry ?? null, tracking: tracking ?? null };
}

/** Every key a lead has gone by, so a run started before a push still shows. */
async function keysFor(leadKey: string): Promise<string[]> {
  const ctx = await leadContext(leadKey);
  return [...new Set([leadKey, ctx.accountId, ctx.inquiry?.id ?? ""].filter(Boolean))];
}

function inquiryFields(row: NonNullable<LeadContext["inquiry"]>): InquiryFields {
  return {
    name: row.name,
    email: row.email,
    phone: row.phone,
    contactMethod: row.contactMethod,
    residency: row.residency,
    address: row.address,
    services: row.services,
    projectDetails: row.projectDetails,
    designStatus: row.designStatus,
    budget: row.budget,
    startDate: row.startDate,
    targetDate: row.targetDate,
    leadSource: row.leadSource,
    customerType: row.customerType,
    notes: row.notes,
  };
}

// ── Request, list, read ─────────────────────────────────────────────────────

export interface RunView {
  id: string;
  leadKey: string;
  leadName: string;
  address: string;
  status: RunStatus;
  requestNote: string;
  requestedBy: string;
  requestedAt: string;
  runner: string;
  startedAt: string;
  finishedAt: string;
  summary: string;
  match: MatchInfo;
  dossier: Dossier & { warnings?: string[] };
  error: string;
  reviewedBy: string;
  reviewedAt: string;
}

function view(r: LeadResearchRow): RunView {
  return {
    id: r.id,
    leadKey: r.leadKey,
    leadName: r.leadName,
    address: r.address,
    status: r.status as RunStatus,
    requestNote: r.requestNote,
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt,
    runner: r.runner,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    summary: r.summary,
    match: readMatch(r.match),
    dossier: readDossier(r.dossier),
    error: r.error,
    reviewedBy: r.reviewedBy,
    reviewedAt: r.reviewedAt,
  };
}

export type FileView = Omit<LeadResearchFileRow, "chunks"> & { complete: boolean };

/**
 * Log a run for a lead. One active run per lead: a second tap while one is
 * waiting or running returns that one.
 */
export async function requestResearch(
  leadKey: string,
  by: string,
  note: string,
  lead: { name: string; address: string },
): Promise<RunView> {
  await ensureDb();
  const keys = await keysFor(leadKey);
  const [active] = await db
    .select()
    .from(leadResearch)
    .where(and(inArray(leadResearch.leadKey, keys), inArray(leadResearch.status, ACTIVE)));
  if (active) return view(active);
  const t = now();
  const row = {
    id: newId("rsr"),
    leadKey,
    leadName: lead.name.slice(0, 200),
    address: lead.address.slice(0, 500),
    status: "requested",
    requestNote: note.slice(0, 2000),
    requestedBy: by,
    requestedAt: t,
    updatedAt: t,
  };
  await db.insert(leadResearch).values(row);
  const [saved] = await db.select().from(leadResearch).where(eq(leadResearch.id, row.id));
  return view(saved);
}

/** A lead's runs, newest first. */
export async function runsForLead(leadKey: string): Promise<RunView[]> {
  await ensureDb();
  await expireStale();
  const keys = await keysFor(leadKey);
  const rows = await db
    .select()
    .from(leadResearch)
    .where(inArray(leadResearch.leadKey, keys))
    .orderBy(desc(leadResearch.requestedAt));
  return rows.map(view);
}

/** The newest run per lead, for the board's marks. */
export async function latestRuns(): Promise<Record<string, Pick<RunView, "id" | "status" | "requestedAt">>> {
  await ensureDb();
  const rows = await db
    .select({ id: leadResearch.id, leadKey: leadResearch.leadKey, status: leadResearch.status, requestedAt: leadResearch.requestedAt })
    .from(leadResearch)
    .orderBy(asc(leadResearch.requestedAt));
  const out: Record<string, Pick<RunView, "id" | "status" | "requestedAt">> = {};
  for (const r of rows) out[r.leadKey] = { id: r.id, status: r.status as RunStatus, requestedAt: r.requestedAt };
  return out;
}

export async function getRun(id: string): Promise<{ run: RunView; files: FileView[]; filesTarget: string } | null> {
  await ensureDb();
  await expireStale();
  const [row] = await db.select().from(leadResearch).where(eq(leadResearch.id, id));
  if (!row) return null;
  const files = await filesOf(id);
  return { run: view(row), files, filesTarget: await filesTargetLabel(row.leadKey) };
}

async function filesOf(runId: string): Promise<FileView[]> {
  const rows = await db.select().from(leadResearchFiles).where(eq(leadResearchFiles.runId, runId)).orderBy(asc(leadResearchFiles.createdAt));
  const counts = rows.length
    ? await db
        .select({ fileId: leadResearchChunks.fileId, n: sql<number>`count(*)` })
        .from(leadResearchChunks)
        .where(inArray(leadResearchChunks.fileId, rows.map((r) => r.id)))
        .groupBy(leadResearchChunks.fileId)
    : [];
  const have = new Map(counts.map((c) => [c.fileId, Number(c.n)]));
  return rows.map(({ chunks, ...f }) => ({ ...f, complete: f.status !== "staged" || (have.get(f.id) ?? 0) >= chunks }));
}

/** "Job 1234 Smith Remodel" or "the customer" — where approve files things. */
async function filesTargetLabel(leadKey: string): Promise<string> {
  const ctx = await leadContext(leadKey);
  if (!ctx.accountId || !hasGrant()) return "";
  try {
    const s = await getResearchSubject(getPaveConfig(), ctx.accountId);
    if (!s) return "";
    return s.job ? `job ${[s.job.number, s.job.name].filter(Boolean).join(" ")}` : `customer ${s.name}`;
  } catch {
    return "";
  }
}

/** Stop a run that is waiting, or throw away a finished one's staged files. */
export async function cancelRun(id: string, by: string): Promise<void> {
  await ensureDb();
  const [row] = await db.select().from(leadResearch).where(eq(leadResearch.id, id));
  if (!row) return;
  if (row.status === "requested" || row.status === "running" || row.status === "ready" || row.status === "error") {
    await db
      .update(leadResearch)
      .set({ status: "cancelled", error: row.error || `Cancelled by ${by}.`, updatedAt: now() })
      .where(eq(leadResearch.id, id));
  }
  await dropStagedFiles(id);
}

async function dropStagedFiles(runId: string): Promise<void> {
  const staged = await db
    .select({ id: leadResearchFiles.id })
    .from(leadResearchFiles)
    .where(and(eq(leadResearchFiles.runId, runId), eq(leadResearchFiles.status, "staged")));
  if (!staged.length) return;
  const ids = staged.map((s) => s.id);
  await db.delete(leadResearchChunks).where(inArray(leadResearchChunks.fileId, ids));
  await db.update(leadResearchFiles).set({ status: "discarded" }).where(inArray(leadResearchFiles.id, ids));
}

async function expireStale(): Promise<void> {
  await db
    .update(leadResearch)
    .set({ status: "error", error: "The Mac running this stopped answering. Tap Research to try again.", updatedAt: now() })
    .where(and(eq(leadResearch.status, "running"), lt(leadResearch.startedAt, minutesAgo(STALE_RUN_MINUTES))));
}

// ── The Mac's side (/api/invoice-review/agent/research) ─────────────────────

export async function dueNow(): Promise<{ due: boolean; waiting: number }> {
  await ensureDb();
  await expireStale();
  const rows = await db.select({ id: leadResearch.id }).from(leadResearch).where(eq(leadResearch.status, "requested"));
  return { due: rows.length > 0, waiting: rows.length };
}

/** A custom field Claude may fill, with what the record holds now. */
interface CatalogField {
  id: string;
  name: string;
  type: string;
  options: string[];
  current: string;
}

export interface BeginAnswer {
  runId: string;
  lead: {
    key: string;
    name: string;
    address: string;
    inJobTread: boolean;
    requestNote: string;
    requestedBy: string;
    inquiry: string;
    scope: string;
    ourNotes: string;
    /** Every customer field JobTread holds, by name — Notes carries the
     *  website inquiry for a lead pushed from the form. */
    jtCustomerFields: Record<string, string>;
    /** Files the customer attached to the website inquiry. */
    inquiryFiles: { name: string; url: string }[];
  };
  subject: ResearchSubject | null;
  fields: Record<ProposalTarget, CatalogField[]>;
  filesGoTo: string;
  limits: { chunkBytes: number; maxFileBytes: number; maxRunBytes: number; maxRunFiles: number };
}

function catalogOf(defs: Record<CfTarget, CustomFieldDef[]> | null): FieldCatalog {
  const pick = (list: CustomFieldDef[] | undefined) =>
    (list ?? [])
      .filter((d) => d.editable && !BLOCKED_FIELDS.has(d.name.trim().toLowerCase()))
      .map((d) => ({ id: d.id, name: d.name, type: d.type, options: d.options, editable: d.editable }));
  return {
    account: pick(defs?.customer),
    location: pick(defs?.location),
    job: pick(defs?.job),
  };
}

/**
 * Claim the oldest waiting run for `runner` and hand out everything the skill
 * needs. Null when nothing is waiting, or another Mac took it first.
 */
export async function beginRun(runner: string): Promise<BeginAnswer | null> {
  await ensureDb();
  await expireStale();
  const [next] = await db
    .select()
    .from(leadResearch)
    .where(eq(leadResearch.status, "requested"))
    .orderBy(asc(leadResearch.requestedAt))
    .limit(1);
  if (!next) return null;
  const t = now();
  // The claim: only one Mac's update finds the row still `requested`.
  const claimed = await db
    .update(leadResearch)
    .set({ status: "running", runner: runner.slice(0, 120), startedAt: t, updatedAt: t })
    .where(and(eq(leadResearch.id, next.id), eq(leadResearch.status, "requested")))
    .returning({ id: leadResearch.id });
  if (!claimed.length) return null;

  const ctx = await leadContext(next.leadKey);
  let subject: ResearchSubject | null = null;
  let defs: Awaited<ReturnType<typeof getCustomFields>> | null = null;
  if (hasGrant()) {
    const cfg = getPaveConfig();
    [subject, defs] = await Promise.all([
      ctx.accountId ? getResearchSubject(cfg, ctx.accountId).catch(() => null) : Promise.resolve(null),
      getCustomFields(cfg).catch(() => null),
    ]);
  }
  const catalog = catalogOf(defs);
  const withCurrent = (target: ProposalTarget): CatalogField[] =>
    catalog[target].map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      options: d.options,
      current: subject?.values[target][d.id] ?? "",
    }));
  const inquiry = ctx.inquiry ? inquirySummary(inquiryFields(ctx.inquiry), { loggedAt: ctx.inquiry.createdAt, loggedBy: ctx.inquiry.createdBy }) : "";
  const address = subject?.location?.formattedAddress || subject?.location?.address || ctx.inquiry?.address || next.address;
  return {
    runId: next.id,
    lead: {
      key: next.leadKey,
      name: subject?.name || ctx.inquiry?.name || next.leadName,
      address,
      inJobTread: !!ctx.accountId,
      requestNote: next.requestNote,
      requestedBy: next.requestedBy,
      inquiry,
      scope: ctx.tracking?.projectScope ?? "",
      ourNotes: ctx.tracking?.notes ?? "",
      jtCustomerFields: Object.fromEntries(
        (defs?.customer ?? [])
          .map((d) => [d.name, subject?.values.account[d.id] ?? ""] as const)
          .filter(([, v]) => v),
      ),
      inquiryFiles: parseFiles(ctx.inquiry?.relatedFiles ?? ""),
    },
    subject,
    fields: { account: withCurrent("account"), location: withCurrent("location"), job: withCurrent("job") },
    filesGoTo: subject?.job
      ? `JobTread job ${subject.job.number} ${subject.job.name}, folder ${BACKGROUND_FOLDER}`
      : `the JobTread customer, folder ${BACKGROUND_FOLDER}`,
    limits: { chunkBytes: CHUNK_BYTES, maxFileBytes: MAX_FILE_BYTES, maxRunBytes: MAX_RUN_BYTES, maxRunFiles: MAX_RUN_FILES },
  };
}

function parseFiles(json: string): { name: string; url: string }[] {
  try {
    const list = JSON.parse(json || "[]");
    return Array.isArray(list) ? list.map((f) => ({ name: String(f?.name ?? ""), url: String(f?.url ?? "") })).filter((f) => f.url) : [];
  } catch {
    return [];
  }
}

async function runningRun(runId: string): Promise<LeadResearchRow> {
  const [row] = await db.select().from(leadResearch).where(eq(leadResearch.id, runId));
  if (!row) throw new Error("No such run.");
  if (row.status !== "running") throw new Error(`This run is ${row.status}, not running.`);
  return row;
}

/** Save the dossier. The run becomes `ready`: penciled in, waiting for review. */
export async function submitResult(runId: string, raw: unknown): Promise<{ warnings: string[]; proposals: number; facts: number }> {
  await ensureDb();
  const row = await runningRun(runId);
  const ctx = await leadContext(row.leadKey);
  let subject: ResearchSubject | null = null;
  let defs: Awaited<ReturnType<typeof getCustomFields>> | null = null;
  if (hasGrant()) {
    const cfg = getPaveConfig();
    [subject, defs] = await Promise.all([
      ctx.accountId ? getResearchSubject(cfg, ctx.accountId).catch(() => null) : Promise.resolve(null),
      getCustomFields(cfg).catch(() => null),
    ]);
  }
  const clean = cleanSubmission(raw, {
    catalog: catalogOf(defs),
    current: subject?.values ?? { account: {}, location: {}, job: {} },
    currentAddress: subject?.location?.address || subject?.location?.formattedAddress || "",
  });
  const t = now();
  await db
    .update(leadResearch)
    .set({
      status: "ready",
      summary: clean.summary,
      match: JSON.stringify(clean.match),
      dossier: JSON.stringify({ ...clean.dossier, warnings: clean.warnings }),
      address: subject?.location?.formattedAddress || row.address,
      finishedAt: t,
      updatedAt: t,
    })
    .where(eq(leadResearch.id, runId));
  return { warnings: clean.warnings, proposals: clean.dossier.proposals.length, facts: clean.dossier.facts.length };
}

/** The Mac could not finish. The office sees the reason and can ask again. */
export async function failRun(runId: string, message: string): Promise<void> {
  await ensureDb();
  const [row] = await db.select().from(leadResearch).where(eq(leadResearch.id, runId));
  if (!row || (row.status !== "running" && row.status !== "requested")) return;
  await db
    .update(leadResearch)
    .set({ status: "error", error: message.slice(0, 2000) || "The run failed.", finishedAt: now(), updatedAt: now() })
    .where(eq(leadResearch.id, runId));
}

/** Register one downloaded file. Its bytes follow in `saveChunk` calls. */
export async function createFile(
  runId: string,
  meta: { name: string; kind: string; mime: string; size: number; source: string; description: string },
): Promise<{ fileId: string; chunks: number }> {
  await ensureDb();
  await runningRun(runId);
  const size = Math.floor(Number(meta.size) || 0);
  if (size <= 0) throw new Error("The file is empty.");
  if (size > MAX_FILE_BYTES) throw new Error(`The file is over ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  const existing = await db
    .select({ size: leadResearchFiles.size })
    .from(leadResearchFiles)
    .where(eq(leadResearchFiles.runId, runId));
  if (existing.length >= MAX_RUN_FILES) throw new Error(`A run keeps at most ${MAX_RUN_FILES} files.`);
  const total = existing.reduce((s, f) => s + f.size, 0) + size;
  if (total > MAX_RUN_BYTES) throw new Error(`A run keeps at most ${MAX_RUN_BYTES / 1024 / 1024} MB of files.`);
  const chunks = Math.ceil(size / CHUNK_BYTES);
  const fileId = newId("rsf");
  await db.insert(leadResearchFiles).values({
    id: fileId,
    runId,
    name: safeFileName(meta.name),
    kind: meta.kind === "photo" ? "photo" : "document",
    mime: String(meta.mime || "application/octet-stream").slice(0, 100),
    size,
    chunks,
    source: String(meta.source ?? "").slice(0, 1000),
    description: String(meta.description ?? "").slice(0, 1000),
    createdAt: now(),
  });
  return { fileId, chunks };
}

export async function saveChunk(fileId: string, seq: number, bytes: Buffer): Promise<void> {
  await ensureDb();
  const [file] = await db.select().from(leadResearchFiles).where(eq(leadResearchFiles.id, fileId));
  if (!file) throw new Error("No such file.");
  await runningRun(file.runId);
  if (!Number.isInteger(seq) || seq < 0 || seq >= file.chunks) throw new Error("Chunk number out of range.");
  if (bytes.length > CHUNK_BYTES) throw new Error("Chunk too large.");
  await db
    .insert(leadResearchChunks)
    .values({ fileId, seq, bytes })
    .onConflictDoUpdate({ target: [leadResearchChunks.fileId, leadResearchChunks.seq], set: { bytes } });
}

/** A staged file's bytes, joined from its chunks. Null when it is incomplete. */
export async function readFile(fileId: string): Promise<{ file: LeadResearchFileRow; bytes: Buffer } | null> {
  await ensureDb();
  const [file] = await db.select().from(leadResearchFiles).where(eq(leadResearchFiles.id, fileId));
  if (!file || file.status !== "staged") return null;
  const parts = await db
    .select()
    .from(leadResearchChunks)
    .where(eq(leadResearchChunks.fileId, fileId))
    .orderBy(asc(leadResearchChunks.seq));
  if (parts.length < file.chunks) return null;
  return { file, bytes: Buffer.concat(parts.map((p) => Buffer.from(p.bytes))) };
}

// ── Review (the page) ───────────────────────────────────────────────────────

export interface ApplyOutcome {
  wrote: boolean;
  /** Writes are off: what would have been sent. */
  previewed?: boolean;
  results: { target: ProposalTarget; ok: boolean; error?: string; fields: number }[];
}

const JOURNAL: Record<ProposalTarget, { action: string; entity: string }> = {
  account: { action: "customer.research.set", entity: "customer" },
  location: { action: "customer-location.research.set", entity: "location" },
  job: { action: "job.research.set", entity: "job" },
};

/**
 * Approve: write the picked JobTread fields, and save the reviewed summary and
 * property fields. Runs once per run; the per-file uploads follow.
 */
export async function applyFields(
  runId: string,
  by: string,
  input: { picks: { id: string; value: string }[]; facts: Fact[]; summary: string },
): Promise<ApplyOutcome> {
  await ensureDb();
  const [row] = await db.select().from(leadResearch).where(eq(leadResearch.id, runId));
  if (!row) throw new Error("No such run.");
  if (row.status !== "ready" && row.status !== "reviewed") throw new Error(`This run is ${row.status}; there is nothing to approve.`);
  const dossier = readDossier(row.dossier);
  const patches = buildPatches(dossier.proposals, input.picks);
  const results: ApplyOutcome["results"] = [];
  let previewed = false;

  if (patches.length) {
    const ctx = await leadContext(row.leadKey);
    if (!ctx.accountId) throw new Error("This lead is not in JobTread yet. Push it first, then approve the JobTread fields.");
    if (!hasGrant()) throw new Error("JT_GRANT_KEY is not set.");
    const cfg = getPaveConfig();
    const subject = await getResearchSubject(cfg, ctx.accountId);
    if (!subject) throw new Error("The JobTread customer could not be read.");
    const defs = await getCustomFields(cfg);
    const ids: Record<ProposalTarget, string> = {
      account: subject.accountId,
      location: subject.location?.id ?? "",
      job: subject.job?.id ?? "",
    };
    if (!writesEnabled()) previewed = true;
    const j = previewed ? null : await openJournal("/api/leads/research/apply");
    for (const p of patches) {
      const id = ids[p.target];
      const kind: WriteKind = p.target;
      if (!id) {
        results.push({ target: p.target, ok: false, fields: 0, error: p.target === "job" ? "The lead has no job yet." : "The customer has no address record." });
        continue;
      }
      const fieldDefs = defs[CF_TARGET_BY_KIND[kind]];
      const patch = validatePatch(kind, { fields: p.fields, customFieldValues: p.customFieldValues }, fieldDefs);
      if (patch.errors.length) {
        results.push({ target: p.target, ok: false, fields: 0, error: patch.errors.join(" ") });
        continue;
      }
      if (previewed || !j) {
        results.push({ target: p.target, ok: true, fields: p.proposalIds.length });
        continue;
      }
      let prior: Record<string, unknown> | undefined;
      try {
        prior = await readRecordFlat(cfg, kind, id, fieldDefs);
      } catch {
        prior = undefined;
      }
      const base = {
        ...JOURNAL[p.target],
        entityId: id,
        jobId: p.target === "job" ? id : "",
        beforeSource: (prior ? "read" : "none") as "read" | "none",
        meta: { researchRunId: runId },
      };
      try {
        const saved = await applyPatch(cfg, kind, id, patch, fieldDefs);
        await j.record(diffFields(prior, saved, base));
        results.push({ target: p.target, ok: true, fields: p.proposalIds.length });
        for (const pid of p.proposalIds) {
          const prop = dossier.proposals.find((x) => x.id === pid);
          if (prop) {
            prop.applied = true;
            prop.error = undefined;
            prop.value = input.picks.find((x) => x.id === pid)?.value.trim() || prop.value;
          }
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        await j.record(diffFields(prior, { ...patch.fields }, base).map((ev) => ({ ...ev, outcome: "error" as const, error: message })));
        results.push({ target: p.target, ok: false, fields: 0, error: message });
        for (const pid of p.proposalIds) {
          const prop = dossier.proposals.find((x) => x.id === pid);
          if (prop) prop.error = message;
        }
      }
    }
    if (!previewed) clearJtRefCache();
  }

  if (previewed) return { wrote: false, previewed: true, results };

  // The reviewed property fields and summary are the app's own record now.
  const facts = (Array.isArray(input.facts) ? input.facts : [])
    .map((f, i) => ({
      id: String(f.id || `f${i + 1}`),
      group: dossier.facts.find((x) => x.id === f.id)?.group ?? f.group ?? "Other",
      label: String(f.label ?? "").trim().slice(0, 80),
      value: String(f.value ?? "").trim().slice(0, 2000),
      source: String(f.source ?? "").slice(0, 1000),
    }))
    .filter((f) => f.label && f.value);
  const t = now();
  await db
    .update(leadResearch)
    .set({
      status: "reviewed",
      summary: String(input.summary ?? row.summary).trim().slice(0, 3000),
      dossier: JSON.stringify({ ...dossier, facts }),
      reviewedBy: by,
      reviewedAt: t,
      updatedAt: t,
    })
    .where(eq(leadResearch.id, runId));
  return { wrote: true, results };
}

/** Approve one file: upload it to "Background" in JobTread, then drop its bytes. */
export async function applyFile(fileId: string): Promise<{ ok: boolean; previewed?: boolean; error?: string; jtFileId?: string }> {
  await ensureDb();
  const got = await readFile(fileId);
  if (!got) return { ok: false, error: "The file is not staged, or not all of it arrived." };
  const [run] = await db.select().from(leadResearch).where(eq(leadResearch.id, got.file.runId));
  if (!run || (run.status !== "ready" && run.status !== "reviewed")) return { ok: false, error: "The run is not waiting for review." };
  const ctx = await leadContext(run.leadKey);
  if (!ctx.accountId) return { ok: false, error: "This lead is not in JobTread yet. Push it first." };
  if (!hasGrant()) return { ok: false, error: "JT_GRANT_KEY is not set." };
  if (!writesEnabled()) return { ok: true, previewed: true };
  const cfg = getPaveConfig();
  try {
    const subject = await getResearchSubject(cfg, ctx.accountId);
    if (!subject) throw new Error("The JobTread customer could not be read.");
    const target = subject.job
      ? { targetType: "job" as const, targetId: subject.job.id }
      : { targetType: "account" as const, targetId: subject.accountId };
    const saved = await uploadFileToFolder(cfg, target, BACKGROUND_FOLDER, got.bytes, got.file.mime, got.file.name);
    await db.update(leadResearchFiles).set({ status: "uploaded", jtFileId: saved.id, error: "" }).where(eq(leadResearchFiles.id, fileId));
    await db.delete(leadResearchChunks).where(eq(leadResearchChunks.fileId, fileId));
    return { ok: true, jtFileId: saved.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await db.update(leadResearchFiles).set({ error: message.slice(0, 500) }).where(eq(leadResearchFiles.id, fileId));
    return { ok: false, error: message };
  }
}

/** Leave a file out: it never reaches JobTread. */
export async function discardFile(fileId: string): Promise<void> {
  await ensureDb();
  await db.delete(leadResearchChunks).where(eq(leadResearchChunks.fileId, fileId));
  await db
    .update(leadResearchFiles)
    .set({ status: "discarded" })
    .where(and(eq(leadResearchFiles.id, fileId), eq(leadResearchFiles.status, "staged")));
}
