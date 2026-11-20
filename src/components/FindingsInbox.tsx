"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";
import { fixTarget, type FixTarget } from "@/components/findingFix";
import { toast } from "@/components/Toast";
import { Banner, Button, Chip, EmptyState, Loading, MetaLine, Notice, SectionHeading, type BannerTone, type ChipTone } from "@/components/ui";
import type { FindingRow } from "@/lib/findings";
import type { MacCheckStatus } from "@/lib/findingSources";
import { forgetFact } from "@/lib/homeFacts";
import { lswddApprovalTarget } from "@/lib/lswddPay";
import type { FindingDisposition } from "@/lib/invoiceReview/types";

/**
 * THE INBOX — every open finding in the store (lib/findings), one `Notice`
 * each: what is wrong, a link to where the fix lives, Later (hide for a day)
 * and ✕ (dismiss). Reads and writes /api/findings.
 *
 * Two readers: the /attention page draws all of it, and the office Home's
 * "Needs attention" sheet draws the first `limit` rows with a link to the rest.
 *
 * Two kinds of row carry an inline fix (findingFix.ts): Approve bill and Mark
 * done. Each calls the write route its own page calls, behind that route's
 * view. A fixed row hides here at once. The store keeps it open until its
 * source stops reporting it, so "resolved" still means the source saw it fixed.
 */

type Row = FindingRow & { hidden: boolean; verdict: FindingDisposition | null };

/** A source's heading. A source with no entry shows its id. */
export const SOURCE_LABEL: Record<string, string> = {
  "invoice-review": "Invoice review",
  "stuck-vendors": "Stuck vendors",
  "needs-project": "Bills with no job",
  uncaptured: "Bills not in JobTread",
  "flagged-bills": "Flagged bills",
  "time-sync": "Time sync",
  "pre-send": "Before you send",
  "sunset-duplicates": "Sunset duplicates",
  digest: "Daily digest",
  "sunset-unreconciled": "Sunset statements",
  "tracking-sheet-risks": "Tracking sheet columns",
  "billing-month": "Billing month",
  "lswdd-pay": "LSWDD payment",
  notices: "Notices",
};

const TONE: Record<string, BannerTone> = { error: "error", warning: "warning", info: "info" };

const VERDICT: Record<FindingDisposition["verdict"], { label: string; tone: ChipTone }> = {
  confirmed: { label: "Mac check: real problem", tone: "danger" },
  "probably-fine": { label: "Mac check: probably fine", tone: "success" },
  "needs-human": { label: "Mac check: needs a person", tone: "warning" },
};

const FIX_LABEL: Record<FixTarget["action"], string> = { "approve-bill": "Approve bill", "complete-todo": "Mark done" };
/** The view that gates each fix's write route (src/lib/views.ts). */
const FIX_VIEW: Record<FixTarget["action"], string> = { "approve-bill": "bill-approve", "complete-todo": "home" };

type FixResult = { toast: string; hide: boolean };

const readJson = async (r: Response | null) =>
  ((await r?.json().catch(() => null)) as Record<string, unknown> | null) ?? null;

/** Same write as the bill page and the Tracking Sheet board (useBillApproval). */
async function approveBill(docId: string): Promise<FixResult> {
  // The row does not say Bill or Expense, so read the bill first: a Bill goes
  // to pending, an Expense to approved.
  const b = await fetch(`/api/bill?docId=${encodeURIComponent(docId)}`, { cache: "no-store" }).catch(() => null);
  const bj = await readJson(b);
  const h = bj?.header as { status?: string; name?: string; qboDocumentType?: string } | null | undefined;
  if (!b?.ok || !h) throw new Error(String(bj?.error ?? "Could not read the bill."));
  if (h.status !== "draft") return { toast: `This bill is already ${h.status} in JobTread.`, hide: true };
  const r = await fetch("/api/bill-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      docId,
      status: lswddApprovalTarget({ name: h.name ?? "", qboDocumentType: h.qboDocumentType ?? "" }),
    }),
  }).catch(() => null);
  const j = await readJson(r);
  if (!r?.ok || j?.error) throw new Error(String(j?.error ?? "Approve failed."));
  if (j?.previewed) return { toast: "Writes are off. Nothing was saved.", hide: false };
  return { toast: "Bill approved.", hide: true };
}

/** Same write as Home's This Week card (WeekAhead). */
async function completeTodo(taskId: string): Promise<FixResult> {
  const r = await fetch("/api/home/week/task", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: taskId, kind: "todo", done: true }),
  }).catch(() => null);
  const j = await readJson(r);
  if (!r?.ok || !j?.ok) throw new Error(String(j?.error ?? "Could not save to JobTread."));
  if (j.previewed) return { toast: "Writes are off. Nothing was saved.", hide: false };
  return { toast: "To-do marked done.", hide: true };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function FindingsInbox({ limit }: { limit?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mac, setMac] = useState<MacCheckStatus | null>(null);
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const access = useAccess();
  // Inline fixes: the row being written (a ref as well, so a double tap cannot
  // start a second write before React re-renders), the rows fixed on this
  // visit, and each row's failure text.
  const fixingRef = useRef(false);
  const [fixing, setFixing] = useState<number | null>(null);
  const [fixed, setFixed] = useState<Set<number>>(new Set());
  const [fixError, setFixError] = useState<Record<number, string>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/findings", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? String(r.status));
      setRows(j.rows ?? []);
      setMac(j.macCheck ?? null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(
    async (id: number, action: "snooze" | "dismiss" | "restore") => {
      // Hide or show the row at once; the reload below corrects a failed save.
      setRows((rs) => rs && rs.map((r) => (r.id === id ? { ...r, hidden: action !== "restore" } : r)));
      const r = await fetch("/api/findings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      }).catch(() => null);
      if (!r?.ok) toast("Could not save", { tone: "error" });
      else if (action !== "restore")
        toast(action === "snooze" ? "Hidden until tomorrow" : "Dismissed", {
          action: { label: "Undo", onClick: () => act(id, "restore") },
        });
      forgetFact("attention"); // Home's count re-reads.
      load();
    },
    [load],
  );

  const runFix = async (r: Row, t: FixTarget) => {
    if (fixingRef.current) return;
    if (
      t.action === "approve-bill" &&
      !window.confirm(`Approve this bill?\n\n${r.title}\n\nApproving pushes it to QuickBooks and locks its lines.`)
    )
      return;
    fixingRef.current = true;
    setFixing(r.id);
    setFixError((e) => ({ ...e, [r.id]: "" }));
    try {
      const res = await (t.action === "approve-bill" ? approveBill(t.docId) : completeTodo(t.taskId));
      toast(res.toast);
      if (res.hide) setFixed((s) => new Set(s).add(r.id));
    } catch (e) {
      setFixError((x) => ({ ...x, [r.id]: e instanceof Error ? e.message : "Could not save." }));
    } finally {
      fixingRef.current = false;
      setFixing(null);
    }
  };

  if (error) return <Banner tone="error">Needs attention did not load: {error}</Banner>;
  if (!rows) return <Loading />;

  const open = rows.filter((r) => !r.hidden && !fixed.has(r.id));
  const hidden = rows.filter((r) => r.hidden);
  const shown = limit ? open.slice(0, limit) : open;
  const sources = [...new Set(shown.map((r) => r.source))];

  return (
    <div className="space-y-5">
      {mac?.late && (
        <Notice
          tone="warning"
          title="The Mac check has not run today"
          action={{ label: "Open the review", href: `/invoice-review?ym=${mac.ym}` }}
        >
          A run is due today. {mac.lastRunAt ? `It last finished ${dayTime(mac.lastRunAt)}.` : "It has not finished a run this month."}
        </Notice>
      )}

      {open.length === 0 && <EmptyState>Nothing needs attention.</EmptyState>}

      {sources.map((source) => {
        const mine = shown.filter((r) => r.source === source);
        return (
          <section key={source} className="space-y-2">
            <SectionHeading
              trailing={
                source === "invoice-review" && mac?.lastRunAt ? (
                  <span className="text-[12px] text-neutral-500">Mac check ran {dayTime(mac.lastRunAt)}</span>
                ) : undefined
              }
            >
              {SOURCE_LABEL[source] ?? source} · {open.filter((r) => r.source === source).length}
            </SectionHeading>
            {mine.map((r) => {
              const t = fixTarget(r);
              const fix = t && access.can(FIX_VIEW[t.action]) ? t : null;
              return (
                <Notice
                  key={r.id}
                  tone={TONE[r.severity] ?? "warning"}
                  title={r.title.split("\n")[0]}
                  action={r.link ? { label: "Fix", href: r.link } : undefined}
                  onSnooze={() => act(r.id, "snooze")}
                  onDismiss={() => act(r.id, "dismiss")}
                >
                  {r.title.includes("\n") && <p className="text-[13px]">{r.title.slice(r.title.indexOf("\n") + 1)}</p>}
                  <MetaLine items={[`Since ${day(r.firstSeenAt)}`, r.verdict && <Chip tone={VERDICT[r.verdict.verdict].tone}>{VERDICT[r.verdict.verdict].label}</Chip>]} />
                  {r.verdict?.why && <p className="mt-1 text-[13px]">{r.verdict.why}</p>}
                  {fix && (
                    <Button size="xs" variant="secondary" className="mt-2" disabled={fixing !== null} onClick={() => runFix(r, fix)}>
                      {fixing === r.id ? "Saving…" : FIX_LABEL[fix.action]}
                    </Button>
                  )}
                  {fixError[r.id] && <p className="mt-1 text-[13px] text-danger">{fixError[r.id]}</p>}
                </Notice>
              );
            })}
          </section>
        );
      })}

      {limit && open.length > shown.length && (
        <Link href="/office" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
          See all {open.length}
        </Link>
      )}

      {!limit && hidden.length > 0 && (
        <section className="space-y-2">
          <SectionHeading onToggle={() => setShowHidden((v) => !v)} open={showHidden}>
            Hidden · {hidden.length}
          </SectionHeading>
          {showHidden &&
            hidden.map((r) => (
              <Notice key={r.id} tone="neutral" title={r.title} action={{ label: "Restore", onClick: () => act(r.id, "restore") }}>
                {r.dismissedBy
                  ? `Dismissed by ${r.dismissedBy}${r.dismissReason ? `: ${r.dismissReason}` : ""}`
                  : `Hidden until ${dayTime(r.snoozedUntil)}`}
              </Notice>
            ))}
        </section>
      )}
    </div>
  );
}
