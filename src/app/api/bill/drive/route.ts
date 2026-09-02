import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * Read-only: the Google Drive links for one bill — the invoice file itself and
 * the folder it's filed in — for the bill detail page's "In Google Drive" links.
 *
 * The Assistant has no Drive grant of its own, so it asks the Apps Script web app
 * (`billDriveLinks`), which looks the bill up by its JobTread doc id in the
 * Expenditure sheet and resolves the file + its parent folder through Drive. Any
 * link Drive can't supply comes back as "" so the page just hides it.
 */
interface DriveLinks {
  ok?: boolean;
  error?: string;
  fileUrl?: string;
  folderUrl?: string;
  folderName?: string;
}

export async function GET(req: NextRequest) {
  const docId = req.nextUrl.searchParams.get("docId")?.trim();
  if (!docId) {
    return NextResponse.json({ error: "Pass ?docId=<bill id>" }, { status: 400 });
  }
  const r = await callAppsScript<DriveLinks>({ action: "billDriveLinks", docId });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  const d = r.data ?? {};
  if (d.ok === false) {
    return NextResponse.json({ error: d.error ?? "Drive lookup failed." }, { status: 502 });
  }
  return NextResponse.json({
    fileUrl: d.fileUrl ?? "",
    folderUrl: d.folderUrl ?? "",
    folderName: d.folderName ?? "",
  });
}
