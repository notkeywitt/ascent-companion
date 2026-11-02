"use client";

import { useMemo } from "react";
import { Banner, ListCard, ListRow, Loading, MetaLine, SectionHeading } from "@/components/ui";
import { money } from "@/lib/money";
import type { JobCostContributors } from "./Board";

/**
 * The job's bills and time entries from ALL TIME — what the Jobs page's board
 * lists while its rings are on "All Time" (owner, 2026-11-02).
 *
 * Read-only on purpose. The month's lists carry the board's month actions
 * (Approve Draft Bills, Finalize, Push, Document Access); handing them the
 * whole job would widen every one of those writes. A bill row opens the bill's
 * own page, where it is edited.
 *
 * Built from the whole-job read the rings' hover cards already make
 * (/api/trackingsheet/contributors), so the rings and these lists cannot
 * disagree. Bills come back as lines; they are summed per bill here.
 */

const day = (iso: string | null) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No date";

const hours = (n: number) => {
  const v = Math.round(n * 10) / 10;
  return `${Number.isInteger(v) ? v : v.toFixed(1)} hrs`;
};

export function AllTimeLists({
  data,
  loading,
  error,
}: {
  data: JobCostContributors | null;
  loading: boolean;
  error: string;
}) {
  const bills = useMemo(() => {
    const byDoc = new Map<
      string,
      { docId: string; label: string; issueDate: string | null; status: string; cost: number; codes: Set<string> }
    >();
    for (const l of data?.bills ?? []) {
      const b = byDoc.get(l.docId) ?? {
        docId: l.docId,
        label: l.label || l.vendor,
        issueDate: l.issueDate,
        status: l.status,
        cost: 0,
        codes: new Set<string>(),
      };
      b.cost += l.cost;
      if (l.code) b.codes.add(l.code);
      byDoc.set(l.docId, b);
    }
    return [...byDoc.values()].sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? ""));
  }, [data]);
  const time = useMemo(
    () => [...(data?.time ?? [])].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [data],
  );

  if (error) return <Banner tone="error">{error}</Banner>;
  if (loading || !data) return <Loading label="Loading every bill and time entry…" />;

  const billTotal = bills.reduce((s, b) => s + b.cost, 0);
  const timeTotal = time.reduce((s, t) => s + t.cost, 0);
  const timeHours = time.reduce((s, t) => s + t.hours, 0);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeading
          trailing={
            <span className="text-sm font-semibold tabular-nums">
              {money(billTotal)} · {bills.length} bill{bills.length === 1 ? "" : "s"}
            </span>
          }
        >
          Bills · all time
        </SectionHeading>
        {bills.length === 0 ? (
          <MetaLine items={["No vendor bills on this job yet."]} />
        ) : (
          <ListCard>
            {bills.map((b) => (
              <ListRow
                key={b.docId}
                href={`/bill/${encodeURIComponent(b.docId)}`}
                label={b.label}
                desc={[day(b.issueDate), b.status, [...b.codes].sort().join(", ")].filter(Boolean).join(" · ")}
                trailing={<span className="tabular-nums">{money(b.cost)}</span>}
              />
            ))}
          </ListCard>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeading
          trailing={
            <span className="text-sm font-semibold tabular-nums">
              {money(timeTotal)} · {hours(timeHours)}
            </span>
          }
        >
          Time · all time
        </SectionHeading>
        {time.length === 0 ? (
          <MetaLine items={["No time logged on this job yet."]} />
        ) : (
          <ListCard>
            {time.map((t) => (
              <ListRow
                key={t.id}
                label={t.employee}
                desc={[day(t.startedAt), t.code, t.notes, t.isApproved ? "approved" : null]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <span className="tabular-nums">
                    {hours(t.hours)} · {money(t.cost)}
                  </span>
                }
              />
            ))}
          </ListCard>
        )}
      </section>
    </div>
  );
}
