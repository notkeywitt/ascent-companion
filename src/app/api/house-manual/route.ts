import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { houseManuals, specLists } from "@/db/schema";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getJobHeaderInfo, getJobSpecifications, getJobVendors, getVendorDetail } from "@/lib/jobtread";
import { asManual, draftManual, manualHtml, specSections, type HouseManual, type ManualContact } from "@/lib/houseManual";
import { addJobSource, listJobSources } from "@/lib/specDocs";
import type { SpecList } from "@/lib/specList";

/**
 * House Manual — a job's homeowner's manual, edited here and published to the
 * Squarespace page, which loads it from /m/<token> (src/app/m/[token]/route.ts).
 *
 *   GET ?jobId=[&fresh=1]   → the saved manual (or a fresh draft), the job's vendors, publish state,
 *                             and every spec list read for the job (on /specs or here)
 *   GET ?jobId=&specList=   → one of those spec lists as manual sections
 *   GET ?vendorId=          → one vendor as a contact (phone and email from JobTread)
 *   PUT { jobId, manual }   → save the manual
 *   POST { jobId, manual }  → save AND publish it: the live page shows it within a minute
 *   DELETE ?jobId=          → unpublish: the live page shows nothing; the token is kept
 *
 * The published html is rendered HERE from the manual, never taken from the
 * browser, so the public page only ever carries what `manualHtml` writes.
 *
 * `manual.sources` (Job files) is NOT stored in the manual: it is the job's
 * shared `job_sources` list (lib/specDocs), the same one /specs shows, filled
 * in on every GET and stripped on every save. A manual saved before that keeps
 * its old list in its JSON; the first GET moves it to the table.
 *
 * Reads JobTread; writes the companion DB only. Gated by the "house-manual" view.
 */

export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9]{6,32}$/;

async function draft(jobId: string) {
  const cfg = getPaveConfig();
  const [job, jtSpecs, [list]] = await Promise.all([
    getJobHeaderInfo(cfg, jobId),
    getJobSpecifications(cfg, jobId),
    db.select().from(specLists).where(eq(specLists.jobId, jobId)).orderBy(desc(specLists.id)).limit(1),
  ]);
  return draftManual(job.name, list ? (JSON.parse(list.value) as SpecList) : null, jtSpecs);
}

/** The manual as stored: without `sources`, which live in job_sources. */
const stored = (m: HouseManual) => JSON.stringify({ ...m, sources: [] });

/** The job's spec list imports, newest first: what Job files offers to add. */
async function specListsFor(jobId: string) {
  const rows = await db.select().from(specLists).where(eq(specLists.jobId, jobId)).orderBy(desc(specLists.id)).limit(20);
  return rows.map((r) => {
    const l = JSON.parse(r.value) as SpecList;
    return { id: r.id, title: l.title || r.fileName, revision: l.revision, importedAt: r.importedAt, rows: l.rows.length };
  });
}

/** Publish state for the page. `token` outlives an unpublish, so the snippet does too. */
async function published(jobId: string) {
  const [r] = await db
    .select({ at: houseManuals.publishedAt, by: houseManuals.publishedBy, token: houseManuals.publicToken, html: houseManuals.publishedHtml })
    .from(houseManuals)
    .where(eq(houseManuals.jobId, jobId))
    .limit(1);
  return r?.token ? { token: r.token, at: r.html ? r.at : "", by: r.html ? r.by : "" } : null;
}

export async function GET(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const q = req.nextUrl.searchParams;
  try {
    const vendorId = q.get("vendorId")?.trim() ?? "";
    if (vendorId) {
      if (!ID.test(vendorId)) return NextResponse.json({ error: "Bad vendor id." }, { status: 400 });
      const v = await getVendorDetail(getPaveConfig(), vendorId);
      const person = v.contacts.find((c) => c.phone || c.email);
      const contact: ManualContact = {
        vendorId,
        trade: "",
        name: v.name,
        phone: v.phone || person?.phone || "",
        email: v.email || person?.email || "",
        url: "",
      };
      return NextResponse.json({ contact });
    }

    const jobId = q.get("jobId")?.trim() ?? "";
    if (!ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
    await ensureDb();

    const listId = Number(q.get("specList"));
    if (listId) {
      const [row] = await db.select().from(specLists).where(eq(specLists.id, listId)).limit(1);
      if (!row || row.jobId !== jobId) return NextResponse.json({ error: "That spec list is gone." }, { status: 404 });
      const list = JSON.parse(row.value) as SpecList;
      return NextResponse.json({ sections: specSections(list), rows: list.rows.length });
    }

    const [saved] = await db.select().from(houseManuals).where(eq(houseManuals.jobId, jobId)).limit(1);
    // A manual saved before job_sources: move its Job files to the shared list, once.
    const old = saved ? asManual(JSON.parse(saved.value)) : null;
    if (saved && old && old.sources.length) {
      for (const src of old.sources) await addJobSource(jobId, src, saved.updatedBy);
      await db.update(houseManuals).set({ value: stored(old) }).where(eq(houseManuals.jobId, jobId));
    }
    const [manual, vendors, sources, lists] = await Promise.all([
      saved && !q.get("fresh") ? old : draft(jobId),
      getJobVendors(getPaveConfig(), jobId),
      listJobSources(jobId),
      specListsFor(jobId),
    ]);
    return NextResponse.json({
      manual: manual && { ...manual, sources },
      specLists: lists,
      vendors,
      saved: saved && !q.get("fresh") ? { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : null,
      published: await published(jobId),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  let body: { jobId?: unknown; manual?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const manual = asManual(body.manual);
  if (!ID.test(jobId) || !manual) return NextResponse.json({ error: "Send jobId and manual." }, { status: 400 });
  const session = await auth();
  const row = {
    jobId,
    value: stored(manual),
    updatedAt: new Date().toISOString(),
    updatedBy: session?.user?.email ?? "",
  };
  await ensureDb();
  await db.insert(houseManuals).values(row).onConflictDoUpdate({ target: houseManuals.jobId, set: row });
  return NextResponse.json({ saved: { updatedAt: row.updatedAt, updatedBy: row.updatedBy } });
}

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown; manual?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const manual = asManual(body.manual);
  if (!ID.test(jobId) || !manual) return NextResponse.json({ error: "Send jobId and manual." }, { status: 400 });
  const session = await auth();
  const now = new Date().toISOString();
  const by = session?.user?.email ?? "";
  await ensureDb();
  const [old] = await db
    .select({ token: houseManuals.publicToken })
    .from(houseManuals)
    .where(eq(houseManuals.jobId, jobId))
    .limit(1);
  const row = {
    jobId,
    value: stored(manual),
    updatedAt: now,
    updatedBy: by,
    publishedHtml: manualHtml(manual),
    publishedAt: now,
    publishedBy: by,
    publicToken: old?.token || randomBytes(18).toString("base64url"),
  };
  await db.insert(houseManuals).values(row).onConflictDoUpdate({ target: houseManuals.jobId, set: row });
  return NextResponse.json({
    saved: { updatedAt: now, updatedBy: by },
    published: { token: row.publicToken, at: now, by },
  });
}

export async function DELETE(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  await ensureDb();
  await db
    .update(houseManuals)
    .set({ publishedHtml: "", publishedAt: "", publishedBy: "" })
    .where(eq(houseManuals.jobId, jobId));
  return NextResponse.json({ published: await published(jobId) });
}
