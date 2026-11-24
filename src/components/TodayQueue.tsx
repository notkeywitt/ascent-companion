"use client";

import { useEffect, useState } from "react";
import { Chip, CountBadge, ListCard, ListRow, MetaLine, SectionHeading } from "@/components/ui";
import { cached } from "@/lib/homeFacts";
import type { AttentionRow } from "@/lib/homeAttention";
import { countNewRequisitions } from "@/lib/requisitionsSeen";

/**
 * TODAY — what needs this person, one row per queue, each with its count.
 *
 * THE SOURCE is `loadAttention` below: one request to /api/attention, which
 * counts every queue on the server and gates each by its own view
 * (lib/homeAttention). If the work queues move to the findings inbox, only
 * that function changes; the rows keep their shape. Cached per tab for a few minutes,
 * because Today is opened many times a day and some counts are slow.
 *
 * Two readers: the lead and field Home draws `TodayQueue` (a "Needs you"
 * section), and the office Home's "Needs attention" button opens
 * `AttentionList` in a sheet.
 */

const MIN = 60_000;

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
  if (rows.length === 0) return <MetaLine items={[done ? "Nothing waiting." : "Checking…"]} />;
  return (
    <ListCard>
      {rows.map((r) => {
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
