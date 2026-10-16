import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getTimeEntriesForExport, jtIsoToOrgLocal } from "@/lib/jobtread";
import {
  composeTimeEntriesEmail,
  payPeriod,
  timeEntriesCsv,
  TIME_ENTRIES_EMAIL_TO,
} from "@/lib/timeEntriesEmail";

/**
 * POST { ym: "2026-10", half: "a" | "b" } — the pay period's time entries
 * email as a Gmail draft in the office mailbox: every employee's JobTread time
 * for that half month, as JobTread's own CSV export, to Casey, Ty and Sara.
 * The "Email time entries" button on the Timesheets tab. Saves a draft and
 * never sends. Pressed again for the same period, it replaces that period's
 * draft with the latest (Apps Script keeps the draft id).
 *
 * Admin and office only, checked here: /api/employee-time is on no view's
 * paths, because every employee's clock calls it.
 *
 * One read (JobTread), then one write (Gmail, through Apps Script).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = session?.user?.role ?? "field";
  if (role !== "admin" && role !== "office") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { ym?: unknown; half?: unknown };
  const period = payPeriod(String(body.ym ?? ""), body.half === "b" ? "b" : "a");
  if (!period) return NextResponse.json({ error: "ym must look like 2026-10." }, { status: 400 });

  let draft: { csv: string; entries: number; running: number; email: ReturnType<typeof composeTimeEntriesEmail> };
  try {
    const entries = await getTimeEntriesForExport(getPaveConfig(), period.sinceIso, period.untilIso);
    const today = jtIsoToOrgLocal(new Date().toISOString()).slice(0, 10);
    draft = {
      csv: timeEntriesCsv(entries),
      entries: entries.length,
      running: entries.filter((e) => !e.endedAt).length,
      email: composeTimeEntriesEmail(period, today),
    };
  } catch (e) {
    console.error("[time-entries-email]", e);
    return NextResponse.json(
      { error: `Reading JobTread: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 502 },
    );
  }

  const res = await callAppsScript<{ ok?: boolean; error?: string; draftUrl: string; updated: boolean }>(
    {
      action: "draftTimeEntriesEmail",
      key: period.key,
      to: TIME_ENTRIES_EMAIL_TO,
      subject: draft.email.subject,
      html: draft.email.html,
      text: draft.email.text,
      fileName: draft.email.fileName,
      // Base64 so the byte-order mark and every byte after it arrive as sent.
      csvBase64: Buffer.from(draft.csv, "utf8").toString("base64"),
    },
    { timeoutMs: 60_000 },
  );
  if (res.error) return NextResponse.json({ error: `Saving the draft: ${res.error}` }, { status: res.status });
  if (res.data?.ok !== true) {
    return NextResponse.json(
      { error: `Saving the draft: ${res.data?.error || "Apps Script did not say why."}` },
      { status: 502 },
    );
  }
  return NextResponse.json({
    draftUrl: res.data.draftUrl,
    updated: res.data.updated === true,
    subject: draft.email.subject,
    entries: draft.entries,
    running: draft.running,
  });
}
