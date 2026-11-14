"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "@/components/Toast";
import { Banner, Chip, EmptyState, Loading, MetaLine, Notice, SectionHeading, type BannerTone, type ChipTone } from "@/components/ui";
import type { FindingRow } from "@/lib/findings";
import type { MacCheckStatus } from "@/lib/findingSources";
import { forgetFact } from "@/lib/homeFacts";
import type { FindingDisposition } from "@/lib/invoiceReview/types";

/**
 * THE INBOX — every open finding in the store (lib/findings), one `Notice`
 * each: what is wrong, a link to where the fix lives, Later (hide for a day)
 * and ✕ (dismiss). Reads and writes /api/findings.
 *
 * Two readers: the /attention page draws all of it, and the office Home's
 * "Needs attention" sheet draws the first `limit` rows with a link to the rest.
 */

type Row = FindingRow & { hidden: boolean; verdict: FindingDisposition | null };

/** A source's heading. A source with no entry shows its id. */
const SOURCE_LABEL: Record<string, string> = {
  "invoice-review": "Invoice review",
  "stuck-vendors": "Stuck vendors",
  "needs-project": "Bills with no job",
  uncaptured: "Bills not in JobTread",
  "flagged-bills": "Flagged bills",
};

const TONE: Record<string, BannerTone> = { error: "error", warning: "warning", info: "info" };

const VERDICT: Record<FindingDisposition["verdict"], { label: string; tone: ChipTone }> = {
  confirmed: { label: "Mac check: real problem", tone: "danger" },
  "probably-fine": { label: "Mac check: probably fine", tone: "success" },
  "needs-human": { label: "Mac check: needs a person", tone: "warning" },
};

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function FindingsInbox({ limit }: { limit?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [mac, setMac] = useState<MacCheckStatus | null>(null);
  const [error, setError] = useState("");
  const [showHidden, setShowHidden] = useState(false);

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

  if (error) return <Banner tone="error">Needs attention did not load: {error}</Banner>;
  if (!rows) return <Loading />;

  const open = rows.filter((r) => !r.hidden);
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
            {mine.map((r) => (
              <Notice
                key={r.id}
                tone={TONE[r.severity] ?? "warning"}
                title={r.title}
                action={r.link ? { label: "Fix", href: r.link } : undefined}
                onSnooze={() => act(r.id, "snooze")}
                onDismiss={() => act(r.id, "dismiss")}
              >
                <MetaLine items={[`Since ${day(r.firstSeenAt)}`, r.verdict && <Chip tone={VERDICT[r.verdict.verdict].tone}>{VERDICT[r.verdict.verdict].label}</Chip>]} />
                {r.verdict?.why && <p className="mt-1 text-[13px]">{r.verdict.why}</p>}
              </Notice>
            ))}
          </section>
        );
      })}

      {limit && open.length > shown.length && (
        <Link href="/attention" className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-2">
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
