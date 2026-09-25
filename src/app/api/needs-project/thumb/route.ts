import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * Page 1 of a held bill's Drive PDF, as an image, for the Needs Project queue.
 *
 * The browser cannot load Drive's own thumbnail: it needs a Google login cookie,
 * which Safari and the Chrome side panel block, so the page showed a broken
 * image. The Apps Script owns the Drive and fetches it instead (`billPdfImage`).
 * It is keyed on the ExpID, so only a PDF filed against a bill can come back.
 *
 * Under /api/needs-project, so the "needs-project" view gates it.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const expId = req.nextUrl.searchParams.get("expId")?.trim();
  if (!expId) return NextResponse.json({ error: "Pass ?expId=" }, { status: 400 });

  // A read: safe to retry.
  const r = await callAppsScript<{ ok?: boolean; error?: string; mime?: string; data?: string }>(
    { action: "billPdfImage", expId },
    { timeoutMs: 50_000, retry: true },
  );
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  const d = r.data ?? {};
  if (d.ok === false || !d.data) {
    return NextResponse.json({ error: d.error ?? "No preview." }, { status: 404 });
  }
  return new NextResponse(Buffer.from(d.data, "base64"), {
    headers: {
      "Content-Type": d.mime || "image/jpeg",
      // The PDF behind an ExpID does not change while it waits in the queue.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
