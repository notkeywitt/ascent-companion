import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { driveIdFromLink } from "@/lib/houseManual";
import {
  addJobSource,
  listJobSources,
  listSpecDocs,
  readDriveFile,
  removeJobSource,
  removeSpecDoc,
  walkDriveLink,
} from "@/lib/specDocs";

/**
 * Specifications → the job's Drive documents, read for AscentBot (lib/specDocs).
 *
 *   GET    ?jobId=                → the job's documents (no text) and linked sources
 *   GET    ?jobId=&link=          → every file under a Drive file or folder link,
 *                                   each marked `done` when already read unchanged;
 *                                   the link joins the job's sources (shared with
 *                                   House Manual's Job files)
 *   POST   { jobId, file }        → read one of those files and keep its text
 *   DELETE ?jobId=&id=            → forget one document (the Drive file stays)
 *   DELETE ?jobId=&source=        → unlink a source, on both pages
 *
 * The page reads files one request at a time, so a big folder never runs into
 * the function's time limit. Read-only against Drive; companion DB only.
 * Gated by the "specs" view with /api/specs.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_ID = /^[A-Za-z0-9]{6,32}$/;

/** A bridge deployment older than JobFiles.js answers "Unknown action". */
function bridgeError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  const error = /Unknown action/i.test(m) ? "Drive reading is not deployed yet. Run ./deploy.sh in ascent-appscript." : m;
  return NextResponse.json({ error }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  const docs = await listSpecDocs(jobId);
  const link = req.nextUrl.searchParams.get("link");
  if (link === null) return NextResponse.json({ docs, sources: await listJobSources(jobId) });

  const id = driveIdFromLink(link);
  if (!id) return NextResponse.json({ error: "Paste a Google Drive file or folder link." }, { status: 400 });
  try {
    const walk = await walkDriveLink(id);
    const session = await auth();
    await addJobSource(jobId, walk.root, session?.user?.email ?? "", true);
    const seen = new Map(docs.map((d) => [d.driveId, d.modified]));
    const files = walk.files.map((f) => ({ ...f, done: !!f.modified && seen.get(f.id) === f.modified }));
    return NextResponse.json({ root: walk.root.name, files, truncated: walk.truncated });
  } catch (e) {
    return bridgeError(e);
  }
}

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown; file?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const f = body.file ?? {};
  const id = driveIdFromLink(String(f.id ?? ""));
  if (!JOB_ID.test(jobId) || !id) return NextResponse.json({ error: "Send jobId and a file." }, { status: 400 });
  const session = await auth();
  const doc = await readDriveFile(
    jobId,
    {
      id,
      name: String(f.name ?? ""),
      mimeType: String(f.mimeType ?? ""),
      modified: String(f.modified ?? ""),
      folder: String(f.folder ?? ""),
    },
    session?.user?.email ?? "",
  );
  return NextResponse.json({ doc });
}

export async function DELETE(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const jobId = q.get("jobId")?.trim() ?? "";
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  const source = driveIdFromLink(q.get("source") ?? "");
  if (source) {
    await removeJobSource(jobId, source);
    return NextResponse.json({ ok: true });
  }
  const id = Number(q.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Send id or source." }, { status: 400 });
  await removeSpecDoc(jobId, id);
  return NextResponse.json({ ok: true });
}
