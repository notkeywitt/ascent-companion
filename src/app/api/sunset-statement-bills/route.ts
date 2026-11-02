import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db, ensureDb } from "@/db";
import { sunsetStatements, type SunsetStatement } from "@/db/schema";
import {
  attachFileToDocument,
  createVendorBill,
  getJobHeaderInfo,
  getSunsetStatementBills,
  getVendors,
  isSunsetVendor,
  OFFICE_JOB_ID,
  resolveSunsetStatementLeaf,
  SUNSET_STATEMENT_CSI,
} from "@/lib/jobtread";
import { callAppsScriptOrThrow, kickJtSync } from "@/lib/appsScript";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { openJournal } from "@/lib/financialJournal";
import { driveIdFromLink } from "@/lib/houseManual";
import { statementBillLines, statementIssueDate } from "@/lib/sunsetStatementBill";

// "Create Bills" on the Sunset Statements page: one draft Bill per UNPAID
// statement, on the Office job (owner, 2026-11-02). The statement bill is what
// gets paid; the per-job Sunset invoices stay on their jobs for job cost.
//
//   GET  → the unpaid statements with no bill yet, and how many are not read
//          yet (no discount on file). Read-only.
//   POST { expIds } → create each one's bill. Each statement is re-read from the
//          companion cache first, and skipped unless it is still unpaid, read,
//          and has no bill. The amounts come from the cache, never the browser.
//
// Each bill: Sunset vendor, name "Bill" (paid later, off the statement), issue
// date = statement date, externalId = the statement's sheet ExpID ("STMT-…"),
// two lines coded 88 70 00 — the total, and the printed discount as a negative
// line — and the statement PDF attached. Every bill is journalled.
export const maxDuration = 60;

const MAX_PER_CALL = 5; // each bill also fetches and uploads its PDF — keep a call inside the limit

interface Candidate {
  expId: string;
  project: string;
  statementDate: string;
  statementNumber: string;
  total: string;
  discount: string;
  net: string;
}

const toCandidate = (r: SunsetStatement): Candidate => ({
  expId: r.expId,
  project: r.project,
  statementDate: r.statementDate,
  statementNumber: r.statementNumber,
  total: r.total,
  discount: r.discount,
  net: r.net,
});

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    await ensureDb();
    const [rows, billed] = await Promise.all([
      db.select().from(sunsetStatements),
      getSunsetStatementBills(getPaveConfig()),
    ]);
    const open = rows.filter((r) => r.status === "unpaid" && !billed.has(r.expId));
    const statements = open
      .filter((r) => r.extractedAt !== "")
      .sort((a, b) => a.statementDate.localeCompare(b.statementDate) || a.expId.localeCompare(b.expId))
      .map(toCandidate);
    return NextResponse.json({ ok: true, statements, unread: open.length - statements.length });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}

interface Outcome {
  expId: string;
  ok: boolean;
  docId?: string;
  reason?: string;
  warning?: string;
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { expIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const expIds = [
    ...new Set((Array.isArray(body.expIds) ? body.expIds : []).map((x) => String(x).trim()).filter(Boolean)),
  ];
  if (expIds.length === 0) return NextResponse.json({ error: "No statements picked." }, { status: 400 });
  if (expIds.length > MAX_PER_CALL) {
    return NextResponse.json({ error: `Too many statements (max ${MAX_PER_CALL}).` }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, results: [] });
  }

  const cfg = getPaveConfig();
  let vendor: { id: string; name: string };
  let leafId: string;
  let billed: Map<string, string>;
  let office: { name: string; address: string };
  try {
    const sunsetId = (process.env.JT_SUNSET_VENDOR_ID ?? "").trim();
    const found = (await getVendors(cfg)).find((v) => (sunsetId ? v.id === sunsetId : isSunsetVendor(v)));
    if (!found) throw new Error("No Sunset Builders Supply vendor in JobTread.");
    vendor = found;
    // The existing-bill read fails CLOSED: if it throws, nothing is created.
    [leafId, billed, office] = await Promise.all([
      resolveSunsetStatementLeaf(cfg),
      getSunsetStatementBills(cfg),
      getJobHeaderInfo(cfg, OFFICE_JOB_ID),
    ]);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }

  await ensureDb();
  const rows = await db.select().from(sunsetStatements).where(inArray(sunsetStatements.expId, expIds));
  const byId = new Map(rows.map((r) => [r.expId, r]));

  // One journal for the whole batch: one requestId reads back as one action.
  const j = await openJournal("/api/sunset-statement-bills");
  const results: Outcome[] = [];

  for (const expId of expIds) {
    const s = byId.get(expId);
    if (!s) {
      results.push({ expId, ok: false, reason: "statement not found" });
      continue;
    }
    if (s.status !== "unpaid") {
      results.push({ expId, ok: false, reason: "already marked paid" });
      continue;
    }
    if (billed.has(expId)) {
      results.push({ expId, ok: false, docId: billed.get(expId), reason: "already has a bill" });
      continue;
    }
    if (s.extractedAt === "") {
      results.push({ expId, ok: false, reason: "not read yet — no discount on file" });
      continue;
    }
    const issueDate = statementIssueDate(s.statementDate);
    if (!issueDate) {
      results.push({ expId, ok: false, reason: "no statement date" });
      continue;
    }
    const shaped = statementBillLines(s, leafId, SUNSET_STATEMENT_CSI);
    if ("error" in shaped) {
      results.push({ expId, ok: false, reason: shaped.error });
      continue;
    }

    let docId: string;
    try {
      ({ id: docId } = await createVendorBill(cfg, {
        jobId: OFFICE_JOB_ID,
        accountId: vendor.id,
        vendorName: vendor.name,
        subject: `${office.name || "Office"} - ${vendor.name} - Statement ${s.statementNumber || s.expId}`,
        externalId: s.expId,
        issueDate,
        billType: "Bill",
        taxAmount: 0,
        jobLocationName: office.name || "Office",
        jobLocationAddress: office.address || undefined,
        lines: shaped.lines,
      }));
    } catch (e) {
      results.push({ expId, ok: false, reason: e instanceof Error ? e.message : "createDocument failed" });
      continue;
    }
    billed.set(expId, docId);
    await j.record([
      {
        action: "bill.create",
        entity: "bill",
        entityId: docId,
        docId,
        jobId: OFFICE_JOB_ID,
        after: {
          vendor: vendor.name,
          externalId: s.expId,
          issueDate,
          statementNumber: s.statementNumber,
          total: s.total,
          discount: s.discount,
          lines: shaped.lines.length,
        },
        beforeSource: "none",
        amount: shaped.net,
        meta: { source: "sunset-statement-bill", project: s.project },
      },
    ]);

    // The statement PDF, so the bill carries its backup. Best-effort: the bill
    // stands without it, and the person is told to attach it.
    let warning: string | undefined;
    try {
      const fileId = driveIdFromLink(s.pdfUrl);
      if (!fileId) throw new Error("the statement has no PDF link");
      const pdf = await callAppsScriptOrThrow<{ data: string }>(
        { action: "getDriveFilePdf", id: fileId },
        { timeoutMs: 30_000 },
      );
      await attachFileToDocument(
        cfg,
        docId,
        Buffer.from(pdf.data, "base64"),
        "application/pdf",
        `Sunset Statement ${s.statementNumber || s.expId}.pdf`,
      );
    } catch (e) {
      warning = `bill created, but the statement PDF was not attached (${
        e instanceof Error ? e.message : "unknown error"
      }) — attach it in JobTread`;
    }
    results.push({ expId, ok: true, docId, warning });
  }

  // Mirror the new bills into the sheet soon. Fire-and-forget; the hourly sync backstops.
  if (results.some((r) => r.ok)) await kickJtSync();

  return NextResponse.json({ wrote: true, previewed: false, results });
}
