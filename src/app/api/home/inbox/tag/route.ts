import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { writesEnabled } from "@/lib/config";
import { isTagKind, tagNeedsJob } from "@/lib/officeInbox";

/**
 * TAG ONE INBOX THREAD FOR A JOB — Home's Inbox widget. Gated by the
 * `office-inbox` view (admin).
 *
 *   GET                              → { jobs:[{jobId, label}] } — the jobs a tag can
 *                                      name (appscript `listInvoiceTags`, read-only)
 *   POST { threadId, kind, jobId? }  → appscript `tagEmailThread`: Gmail labels only
 *
 * A label is not a JobTread write, but the `_JT …`, `_JT Invoice …` and `_todo`
 * tags make the Apps Script scans write to JobTread. So POST rides
 * `writesEnabled()`: a preview with writes off cannot start one. The label text
 * is composed on the Apps Script side; the browser names a kind and a job.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const NEEDS_DEPLOY =
  "The Apps Script web app does not have the tag action yet. Deploy ascent-appscript, then try again.";

export async function GET() {
  const r = await callAppsScript<{ ok?: boolean; tags?: { jobId: string; label: string }[]; error?: string }>(
    { action: "listInvoiceTags" },
    { timeoutMs: 25_000 },
  );
  if (r.error || !r.data?.ok) {
    return NextResponse.json({ error: r.error || r.data?.error || "Could not read the job list." }, { status: 502 });
  }
  const jobs = (r.data.tags ?? [])
    .map((t) => ({ jobId: String(t.jobId), label: String(t.label) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return NextResponse.json({ jobs });
}

export async function POST(req: NextRequest) {
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Writes are off in this copy of the app." }, { status: 403 });
  }
  let body: { threadId?: string; kind?: string; jobId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const threadId = String(body.threadId ?? "").trim();
  const kind = body.kind;
  const jobId = String(body.jobId ?? "").trim();
  if (!/^[0-9a-f]{8,24}$/i.test(threadId)) return NextResponse.json({ error: "Pass a thread id." }, { status: 400 });
  if (!isTagKind(kind)) return NextResponse.json({ error: "Pick a tag." }, { status: 400 });
  if (tagNeedsJob(kind) && !jobId) return NextResponse.json({ error: "Pick a job." }, { status: 400 });

  // Not retried: an unknown action is treated as a write everywhere else too.
  const r = await callAppsScript<{ ok?: boolean; message?: string; tag?: string; error?: string }>(
    { action: "tagEmailThread", threadId, kind, ...(tagNeedsJob(kind) ? { jobId } : {}) },
    { timeoutMs: 25_000, retry: false },
  );
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.data?.ok) {
    const raw = String(r.data?.error || "Apps Script refused the tag.");
    return NextResponse.json({ error: /unknown action/i.test(raw) ? NEEDS_DEPLOY : raw }, { status: 502 });
  }
  return NextResponse.json({ ok: true, tag: r.data.tag, message: r.data.message });
}
