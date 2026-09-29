import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, ensureDb } from "@/db";
import { specLists } from "@/db/schema";
import { extractSpecListWithClaude } from "@/lib/claudeExtract";
import { extractPdfLinks } from "@/lib/pdfLinks";
import { resolveSpecList, type RawSpecList, type SpecList } from "@/lib/specList";

/**
 * Specifications — a job's spec selection list, read out of the architect's PDF.
 *
 *   GET   ?jobId=[&id=]                 → the newest import (or import `id`), plus the others by date
 *   POST  multipart { jobId, file }     → read the PDF, store it as a new import
 *   PATCH { id, index, status }         → mark one row open or decided
 *
 * Gated by the "specs" view (lib/views). Companion DB only: nothing here writes
 * to JobTread.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 20 * 1024 * 1024;
const JOB_ID = /^[A-Za-z0-9]{6,32}$/;

async function newest(jobId: string, pick = 0) {
  await ensureDb();
  const rows = await db
    .select()
    .from(specLists)
    .where(eq(specLists.jobId, jobId))
    .orderBy(desc(specLists.id))
    .limit(20);
  const top = rows.find((r) => r.id === pick) ?? rows[0];
  return {
    current: top
      ? {
          id: top.id,
          fileName: top.fileName,
          importedAt: top.importedAt,
          importedBy: top.importedBy,
          list: JSON.parse(top.value) as SpecList,
        }
      : null,
    others: rows
      .filter((r) => r !== top)
      .map((r) => ({ id: r.id, fileName: r.fileName, importedAt: r.importedAt })),
  };
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  return NextResponse.json(await newest(jobId, Number(req.nextUrl.searchParams.get("id")) || 0));
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the PDF as a file upload." }, { status: 400 });
  }
  const jobId = String(form.get("jobId") ?? "").trim();
  const file = form.get("file");
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose the spec list PDF." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return NextResponse.json(
      { error: "Upload a PDF. For a spreadsheet, use File → Download → PDF; its links survive." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "The PDF is over 20 MB." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  let list: SpecList;
  try {
    const links = await extractPdfLinks(new Uint8Array(bytes));
    const raw = await extractSpecListWithClaude(bytes, links);
    if (!raw || typeof raw !== "object") throw new Error("The reader could not read this PDF as a schedule.");
    list = resolveSpecList(raw as RawSpecList, links);
    if (list.rows.length === 0) throw new Error("No rows were found in this PDF.");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }

  const session = await auth();
  await ensureDb();
  await db.insert(specLists).values({
    jobId,
    fileName: file.name.slice(0, 200),
    value: JSON.stringify(list),
    importedAt: new Date().toISOString(),
    importedBy: session?.user?.email ?? "",
  });
  return NextResponse.json(await newest(jobId));
}

export async function PATCH(req: NextRequest) {
  let body: { id?: unknown; index?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const id = Number(body.id);
  const index = Number(body.index);
  const status = body.status === "decided" ? "decided" : body.status === "open" ? "open" : null;
  if (!Number.isInteger(id) || !Number.isInteger(index) || !status) {
    return NextResponse.json({ error: "Send id, index and status." }, { status: 400 });
  }
  await ensureDb();
  const [row] = await db.select().from(specLists).where(eq(specLists.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "That list is gone." }, { status: 404 });
  const list = JSON.parse(row.value) as SpecList;
  if (index < 0 || index >= list.rows.length) {
    return NextResponse.json({ error: "No such row." }, { status: 400 });
  }
  list.rows[index].status = status;
  await db.update(specLists).set({ value: JSON.stringify(list) }).where(eq(specLists.id, id));
  return NextResponse.json({ ok: true });
}
