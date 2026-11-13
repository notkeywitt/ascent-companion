"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { driveMainWindowToDoc } from "@/components/BillingSummary";
import { Chip, CountBadge, ListCard, ListRow, MetaLine, SectionHeading } from "@/components/ui";
import { cached } from "@/lib/homeFacts";
import type { AttentionRow } from "@/lib/homeAttention";
import { money0 as money } from "@/lib/money";
import { countNewRequisitions } from "@/lib/requisitionsSeen";

/**
 * TODAY — what needs this person, one row per queue, each with its count.
 *
 * THE SOURCE is `loadAttention` below: one request to /api/attention, which
 * counts every queue on the server and gates each by its own view
 * (lib/homeAttention). Phase 5 of OVERHAUL_PLAN swaps that function for the
 * findings inbox; the rows keep their shape. Cached per tab for a few minutes,
 * because Today is opened many times a day and some counts are slow.
 *
 * Two readers: the lead and field Home draws `TodayQueue` (a "Needs you"
 * section), and the office Home's "Needs attention" button opens
 * `AttentionList` in a sheet.
 *
 * "Bills to code" opens in place: the draft bills, newest first, each linking
 * to its bill. That list is what the retired Coding Review page (/coding) was.
 */

const MIN = 60_000;

interface Draft {
  id: string;
  jobId?: string;
  jobName?: string;
  fromName?: string;
  number?: string;
  externalId?: string;
  cost?: number;
  issueDate?: string;
}

/** The ONE source of "needs attention" rows. */
export function loadAttention(): Promise<AttentionRow[]> {
  return cached("attention", 3 * MIN, async () => {
    const r = await fetch("/api/attention", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    return ((await r.json()).rows ?? []) as AttentionRow[];
  });
}

/** The rows, and whether the read has settled. A failed read is no rows. */
export function useAttention(): { rows: AttentionRow[]; done: boolean } {
  const [state, setState] = useState<{ rows: AttentionRow[]; done: boolean }>({ rows: [], done: false });
  useEffect(() => {
    let alive = true;
    loadAttention()
      .then((rows) => alive && setState({ rows, done: true }))
      .catch(() => alive && setState({ rows: [], done: true }));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

/** The draft bills, read only when "Bills to code" is opened. */
const drafts = () =>
  cached("drafts", 3 * MIN, async () => {
    const r = await fetch("/api/coding-queue", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok || j?.error) throw new Error(String(j?.error ?? r.status));
    return (j.bills ?? []) as Draft[];
  });

export function TodayQueue() {
  const { rows, done } = useAttention();
  if (done && rows.length === 0) return null;
  return (
    <section className="mb-6 space-y-2">
      <SectionHeading>Needs you</SectionHeading>
      <AttentionList rows={rows} done={done} />
    </section>
  );
}

export function AttentionList({ rows, done }: { rows: AttentionRow[]; done: boolean }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Draft[] | null>(null);

  useEffect(() => {
    if (open && !list) drafts().then(setList).catch(() => setList([]));
  }, [open, list]);

  if (rows.length === 0) return <MetaLine items={[done ? "Nothing waiting." : "Checking…"]} />;
  return (
    <ListCard>
      {rows.map((r) => {
        if (r.key === "drafts")
          return (
            <div key={r.key}>
              <ListRow
                onClick={() => setOpen((o) => !o)}
                label={r.label}
                desc={r.detail}
                badge={<CountBadge n={r.count} />}
                trailing={
                  <span aria-hidden className="shrink-0 text-sm text-neutral-400">
                    {open ? "▾" : "▸"}
                  </span>
                }
                chevron={false}
              />
              {open && <DraftList bills={list} />}
            </div>
          );
        // Counted per device against the last visit to /requisitions.
        const fresh = r.ids ? countNewRequisitions(r.ids.map((ReqID) => ({ ReqID, Status: "Requested" }))) : 0;
        return (
          <ListRow
            key={r.key}
            href={r.href}
            label={r.label}
            desc={r.detail}
            badge={
              <>
                {!!fresh && <Chip tone="accent">{fresh} new</Chip>}
                <CountBadge n={r.count} />
              </>
            }
          />
        );
      })}
    </ListCard>
  );
}

function DraftList({ bills }: { bills: Draft[] | null }) {
  if (!bills) return <p className="px-3 pb-3 text-[12px] text-neutral-500">Loading…</p>;
  return (
    <ul className="border-b border-line-soft bg-accent/5 last:border-b-0">
      {bills.map((b) => (
        <li key={b.id}>
          <Link
            href={`/bill/${b.id}${b.jobId ? `?jobId=${encodeURIComponent(b.jobId)}` : ""}`}
            // In the Chrome side panel, also turn the docked JobTread tab to this
            // bill — what the retired /coding list did (extension/panel.js).
            onClick={() => b.jobId && driveMainWindowToDoc(b.jobId, b.id)}
            className="flex items-baseline gap-3 px-4 py-2 text-[13px] transition hover:bg-accent/10"
          >
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold">{b.fromName || "Unknown vendor"}</span>
              <span className="text-neutral-500"> · {b.jobName || "No job"}</span>
            </span>
            <span className="shrink-0 tabular-nums text-neutral-500">
              {[b.issueDate, typeof b.cost === "number" ? money(b.cost) : ""].filter(Boolean).join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
