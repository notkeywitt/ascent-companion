import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { writesEnabled } from "@/lib/config";

/**
 * LOG AN INVOICE from Home's Inbox widget — the same appscript `logInvoice`
 * the To log page (`/email` → `/api/email`) calls: Claude reads the email's
 * PDF, logs the bill on the job (Expenditure row, Drive file, JobTread draft)
 * and marks the thread Processed. A JobTread write, so it rides
 * `writesEnabled()`. Gated by the `office-inbox` view (admin).
 *
 * One email, one job: an email with several PDFs for different jobs is split
 * on the To log page, which sends `assignments`.
 *
 * POST { messageId, projectId, paid? } → { ok, kind, message, expId?, ... }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Writes are off in this copy of the app." }, { status: 403 });
  }
  let body: { messageId?: string; projectId?: string; paid?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const messageId = String(body.messageId ?? "").trim();
  const projectId = String(body.projectId ?? "").trim();
  if (!/^[0-9a-f]{8,24}$/i.test(messageId)) return NextResponse.json({ error: "Pass a message id." }, { status: 400 });
  if (!projectId) return NextResponse.json({ error: "Pick a job." }, { status: 400 });

  // logInvoice runs Claude inline (~15–45 s). Not retried: it writes.
  const r = await callAppsScript<{ ok?: boolean; message?: string; error?: string }>(
    { action: "logInvoice", messageId, projectId, paid: body.paid === true },
    { timeoutMs: 110_000, retry: false },
  );
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.data?.ok) {
    return NextResponse.json({ error: r.data?.message || r.data?.error || "The invoice was not logged." }, { status: 502 });
  }
  return NextResponse.json(r.data);
}
