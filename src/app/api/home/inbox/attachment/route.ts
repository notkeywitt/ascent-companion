import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";

/**
 * ONE EMAIL PDF for Home's Inbox widget — read-only. Appscript
 * `chatMailAttachment` (PDFs only, ≤ 20 MB) answers base64; this returns the
 * bytes, so the Add bill pop-up can start with the file picked. Gated by the
 * `office-inbox` view (admin).
 *
 * GET /api/home/inbox/attachment?id=<messageId>:<index>
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!/^[0-9a-f]{8,24}:\d{1,3}$/i.test(id)) {
    return NextResponse.json({ error: "Pass an attachment id." }, { status: 400 });
  }
  const r = await callAppsScript<{ ok?: boolean; name?: string; data?: string; error?: string }>(
    { action: "chatMailAttachment", attachmentId: id },
    { timeoutMs: 50_000, retry: false },
  );
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.data?.ok || !r.data.data) {
    return NextResponse.json({ error: r.data?.error || "Could not open the PDF." }, { status: 502 });
  }
  const bytes = Buffer.from(r.data.data, "base64");
  const name = (r.data.name || "invoice.pdf").replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
