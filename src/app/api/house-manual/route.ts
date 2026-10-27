import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { houseManuals, specLists } from "@/db/schema";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getJobHeaderInfo, getJobSpecifications, getJobVendors, getVendorDetail } from "@/lib/jobtread";
import { asManual, draftManual, manualHtml, type ManualContact } from "@/lib/houseManual";
import type { SpecList } from "@/lib/specList";

/**
 * House Manual — a job's homeowner's manual, edited here and published to the
 * Squarespace page, which loads it from /m/<token> (src/app/m/[token]/route.ts).
 *
 *   GET ?jobId=[&fresh=1]   → the saved manual (or a fresh draft), the job's vendors, publish state
 *   GET ?vendorId=          → one vendor as a contact (phone and email from JobTread)
 *   PUT { jobId, manual }   → save the manual
 *   POST { jobId, manual }  → save AND publish it: the live page shows it within a minute
 *   DELETE ?jobId=          → unpublish: the live page shows nothing; the token is kept
 *
 * The published html is rendered HERE from the manual, never taken from the
 * browser, so the public page only ever carries what `manualHtml` writes.
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
    const [saved] = q.get("fresh")
      ? []
      : await db.select().from(houseManuals).where(eq(houseManuals.jobId, jobId)).limit(1);
    const [manual, vendors] = await Promise.all([
      saved ? asManual(JSON.parse(saved.value)) : draft(jobId),
      getJobVendors(getPaveConfig(), jobId),
    ]);
    return NextResponse.json({
      manual,
      vendors,
      saved: saved ? { updatedAt: saved.updatedAt, updatedBy: saved.updatedBy } : null,
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
    value: JSON.stringify(manual),
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
    value: JSON.stringify(manual),
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
