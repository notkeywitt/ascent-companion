import { NextRequest, NextResponse } from "next/server";
import { callAppsScript } from "@/lib/appsScript";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getInvoicesForPayment, getJobFilesById, OFFICE_JOB_ID } from "@/lib/jobtread";
import {
  composeDepositEmail,
  DEPOSIT_EMAIL_TO,
  DEPOSIT_FOLDER,
  type DepositEmailLine,
} from "@/lib/depositTracker";

/**
 * POST { date, reference, fileIds, lines: [{ invoiceId, amount }] } — the
 * deposit email as a Gmail draft in the office mailbox, to Sara and Casey: the
 * check photos attached, one row per invoice paid. Saves a draft and never
 * sends. Each press makes a new draft.
 *
 * The server re-reads the invoices (customer, job, number) and the photos from
 * JobTread; a photo off the Office job's Deposits folder is refused. Apps
 * Script (`draftDepositEmail`) downloads each photo and attaches it.
 *
 * Gated by the "deposit-tracker" view (src/lib/views.ts), admin by default.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!hasGrant()) return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as {
    date?: unknown;
    reference?: unknown;
    fileIds?: unknown;
    lines?: unknown;
  };
  const date = String(body.date ?? "").trim();
  const reference = String(body.reference ?? "").slice(0, 200);
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.map(String).slice(0, 20) : [];
  const lines = Array.isArray(body.lines)
    ? body.lines.map((l: any) => ({ invoiceId: String(l?.invoiceId ?? ""), amount: Number(l?.amount) }))
    : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must look like 2026-10-26." }, { status: 400 });
  }
  if (!fileIds.length || !lines.length || lines.length > 50) {
    return NextResponse.json({ error: "Send the photos and the invoices paid." }, { status: 400 });
  }

  const cfg = getPaveConfig();
  let rows: DepositEmailLine[];
  let images: { name: string; url: string; mimeType: string }[];
  try {
    const [invoices, files] = await Promise.all([
      getInvoicesForPayment(cfg, lines.map((l) => l.invoiceId)),
      getJobFilesById(cfg, OFFICE_JOB_ID, DEPOSIT_FOLDER, fileIds),
    ]);
    const missing = fileIds.filter((id) => !files[id]);
    if (missing.length) {
      return NextResponse.json(
        { error: `${missing.length} photo(s) are not in the Office job's ${DEPOSIT_FOLDER} folder.` },
        { status: 400 },
      );
    }
    rows = [];
    for (const l of lines) {
      const inv = invoices[l.invoiceId];
      if (!inv || !Number.isFinite(l.amount)) {
        return NextResponse.json({ error: `Invoice ${l.invoiceId} was not found in JobTread.` }, { status: 400 });
      }
      rows.push({
        customerName: inv.customerName,
        jobName: inv.jobName,
        jobNumber: inv.jobNumber,
        invoiceNumber: inv.number,
        amount: l.amount,
      });
    }
    images = fileIds.map((id) => {
      const f = files[id]!;
      return { name: f.name, url: f.url, mimeType: f.type || "image/jpeg" };
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Reading JobTread: ${e instanceof Error ? e.message : "Unknown error"}` },
      { status: 502 },
    );
  }

  const email = composeDepositEmail({ date, lines: rows, reference, photos: images.length });
  const res = await callAppsScript<{ ok?: boolean; error?: string; draftUrl: string; attached: number }>(
    {
      action: "draftDepositEmail",
      to: DEPOSIT_EMAIL_TO,
      subject: email.subject,
      html: email.html,
      text: email.text,
      images,
    },
    { timeoutMs: 90_000 },
  );
  if (res.error) return NextResponse.json({ error: `Saving the draft: ${res.error}` }, { status: res.status });
  if (res.data?.ok !== true) {
    return NextResponse.json(
      { error: `Saving the draft: ${res.data?.error || "Apps Script did not say why."}` },
      { status: 502 },
    );
  }
  return NextResponse.json({ draftUrl: res.data.draftUrl, attached: res.data.attached, subject: email.subject });
}
