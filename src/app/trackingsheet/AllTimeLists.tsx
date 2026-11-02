"use client";

import { useMemo, useState } from "react";
import { Banner, ListCard, ListRow, Loading, MetaLine, SectionHeading, Select } from "@/components/ui";
import { money } from "@/lib/money";
import type { JobCostContributors } from "./Board";
import { CoiDot } from "@/components/CoiDot";

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
 * disagree. Bills come back as lines; they are summed per bill here, and
 * grouped by vendor (owner, 2026-11-02). The vendor filter narrows the bills;
 * the cost-code filter narrows both lists, and a bill then counts only its
 * lines on that code.
 */

/** One bill, summed from its lines. */
interface AllTimeBill {
  docId: string;
  vendor: string;
  label: string;
  issueDate: string | null;
  status: string;
  cost: number;
  codes: Set<string>;
}

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
  const [vendor, setVendor] = useState("");
  const [code, setCode] = useState("");

  const vendors = useMemo(
    () => [...new Set((data?.bills ?? []).map((l) => l.vendor))].sort((a, b) => a.localeCompare(b)),
    [data],
  );
  const codes = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data?.bills ?? []) if (l.code) m.set(l.code, 0);
    for (const t of data?.time ?? []) if (t.code) m.set(t.code, 0);
    return [...m.keys()].sort();
  }, [data]);

  /** Vendor → its bills, newest first; vendors A–Z. */
  const groups = useMemo(() => {
    const byDoc = new Map<string, AllTimeBill>();
    for (const l of data?.bills ?? []) {
      if (vendor && l.vendor !== vendor) continue;
      if (code && l.code !== code) continue;
      const b = byDoc.get(l.docId) ?? {
        docId: l.docId,
        vendor: l.vendor,
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
    const byVendor = new Map<string, AllTimeBill[]>();
    for (const b of byDoc.values()) byVendor.set(b.vendor, [...(byVendor.get(b.vendor) ?? []), b]);
    return [...byVendor.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => ({
        name,
        bills: list.sort((a, b) => (b.issueDate ?? "").localeCompare(a.issueDate ?? "")),
        total: list.reduce((s, b) => s + b.cost, 0),
      }));
  }, [data, vendor, code]);
  const time = useMemo(
    () =>
      (data?.time ?? [])
        .filter((t) => !code || t.code === code)
        .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
    [data, code],
  );

  if (error) return <Banner tone="error">{error}</Banner>;
  if (loading || !data) return <Loading label="Loading every bill and time entry…" />;

  const billCount = groups.reduce((n, g) => n + g.bills.length, 0);
  const billTotal = groups.reduce((s, g) => s + g.total, 0);
  const timeTotal = time.reduce((s, t) => s + t.cost, 0);
  const timeHours = time.reduce((s, t) => s + t.hours, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-auto">
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Select aria-label="Cost code" value={code} onChange={(e) => setCode(e.target.value)} className="w-auto">
          <option value="">All cost codes</option>
          {codes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </div>

      <section className="space-y-3">
        <SectionHeading
          trailing={
            <span className="text-sm font-semibold tabular-nums">
              {money(billTotal)} · {billCount} bill{billCount === 1 ? "" : "s"}
            </span>
          }
        >
          Bills · all time
        </SectionHeading>
        {groups.length === 0 ? (
          <MetaLine items={[vendor || code ? "No bills match these filters." : "No vendor bills on this job yet."]} />
        ) : (
          groups.map((g) => (
            <div key={g.name} className="space-y-1">
              <div className="flex items-baseline justify-between gap-2 px-1 text-[12px] font-semibold">
                <span className="min-w-0 truncate">{g.name}<CoiDot vendor={g.name} /></span>
                <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">
                  {money(g.total)} · {g.bills.length}
                </span>
              </div>
              <ListCard>
                {g.bills.map((b) => (
                  <ListRow
                    key={b.docId}
                    href={`/bill/${encodeURIComponent(b.docId)}`}
                    label={b.label}
                    desc={[day(b.issueDate), b.status, [...b.codes].sort().join(", ")].filter(Boolean).join(" · ")}
                    trailing={<span className="tabular-nums">{money(b.cost)}</span>}
                  />
                ))}
              </ListCard>
            </div>
          ))
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
          <MetaLine items={[code ? "No time on this cost code." : "No time logged on this job yet."]} />
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
