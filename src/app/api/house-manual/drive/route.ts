import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { callAppsScriptOrThrow } from "@/lib/appsScript";
import { driveIdFromLink, specSections, type DriveItem } from "@/lib/houseManual";
import { addJobSource, listJobSources, removeJobSource } from "@/lib/specDocs";
import { importSpecPdf } from "@/lib/specImport";

/**
 * House Manual → the job's own Drive files, through the Apps Script bridge
 * (appscript JobFiles.js). The companion never reads Drive itself.
 *
 *   GET  ?id=                  → a file, or a folder and its children
 *   POST { jobId, fileId }     → read that file as a spec list: stored as the
 *                                job's newest import (so /specs shows it too)
 *                                and returned as manual sections
 *   PUT  { jobId, link }       → link a file or folder to the job: the shared
 *                                job_sources list, which /specs shows too
 *   DELETE ?jobId=&id=         → unlink one, on both pages
 *
 * Read-only against Drive. Rides the "house-manual" view with /api/house-manual.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const JOB_ID = /^[A-Za-z0-9]{6,32}$/;

/** A bridge deployment older than JobFiles.js answers "Unknown action". */
function bridgeError(e: unknown) {
  const m = e instanceof Error ? e.message : String(e);
  const error = /Unknown action/i.test(m)
    ? "Drive reading is not deployed yet. Run ./deploy.sh in ascent-appscript."
    : m;
  return NextResponse.json({ error }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const id = driveIdFromLink(req.nextUrl.searchParams.get("id") ?? "");
  if (!id) return NextResponse.json({ error: "Paste a Google Drive file or folder link." }, { status: 400 });
  try {
    const r = await callAppsScriptOrThrow<{ item: DriveItem; children: DriveItem[]; truncated?: boolean }>({
      action: "listDriveFolder",
      id,
    });
    return NextResponse.json({ item: r.item, children: r.children ?? [], truncated: !!r.truncated });
  } catch (e) {
    return bridgeError(e);
  }
}

export async function POST(req: NextRequest) {
  let body: { jobId?: unknown; fileId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const fileId = driveIdFromLink(String(body.fileId ?? ""));
  if (!JOB_ID.test(jobId) || !fileId) return NextResponse.json({ error: "Send jobId and fileId." }, { status: 400 });
  try {
    const file = await callAppsScriptOrThrow<{ name: string; data: string }>(
      { action: "getDriveFilePdf", id: fileId },
      { timeoutMs: 120_000 },
    );
    const session = await auth();
    const { id, list } = await importSpecPdf({
      jobId,
      fileName: file.name,
      bytes: Buffer.from(file.data, "base64"),
      importedBy: session?.user?.email ?? "",
    });
    return NextResponse.json({
      sections: specSections(list),
      rows: list.rows.length,
      list: { id, title: list.title || file.name, revision: list.revision, importedAt: new Date().toISOString(), rows: list.rows.length },
    });
  } catch (e) {
    return bridgeError(e);
  }
}

export async function PUT(req: NextRequest) {
  let body: { jobId?: unknown; link?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const jobId = String(body.jobId ?? "").trim();
  const id = driveIdFromLink(String(body.link ?? ""));
  if (!JOB_ID.test(jobId)) return NextResponse.json({ error: "Pick a job." }, { status: 400 });
  if (!id) return NextResponse.json({ error: "Paste a Google Drive file or folder link." }, { status: 400 });
  try {
    const { item } = await callAppsScriptOrThrow<{ item: DriveItem }>({ action: "listDriveFolder", id });
    const session = await auth();
    await addJobSource(jobId, item, session?.user?.email ?? "");
  } catch (e) {
    return bridgeError(e);
  }
  return NextResponse.json({ sources: await listJobSources(jobId) });
}

export async function DELETE(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId")?.trim() ?? "";
  const id = driveIdFromLink(req.nextUrl.searchParams.get("id") ?? "");
  if (!JOB_ID.test(jobId) || !id) return NextResponse.json({ error: "Send jobId and id." }, { status: 400 });
  await removeJobSource(jobId, id);
  return NextResponse.json({ sources: await listJobSources(jobId) });
}
