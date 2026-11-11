"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Card, Chip, Skeleton } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { STAGE_LABELS } from "@/components/HomeLeadBoard";
import { fmtDate, type LeadLike } from "@/lib/leadBoard";

/**
 * The five newest leads, each with its status and next step — a card on the
 * Jobs page (Admin and Office, while no job is picked). Newest by the day the
 * lead arrived. Read-only: a row opens that lead on /leads. Reads /api/leads,
 * the same list the Leads board uses, so an archived lead is hidden the same way
 * the board hides it.
 */

const HOW_MANY = 5;

/** Both of these leave the board and sit in the archive (see /api/leads). */
const ARCHIVED = new Set(["not_qualified", "not_converted"]);

type Row = LeadLike & { tracking: LeadLike["tracking"] & { qualification?: string } };

export function HubLeadsCard({ className = "" }: { className?: string }) {
  const allowed = useAccess().can("leads");
  const [leads, setLeads] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    fetch("/api/leads")
      .then((r) => r.json())
      .then((j) => !cancelled && setLeads(j.error ? [] : (j.leads ?? [])))
      .catch(() => !cancelled && setLeads([]));
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  const newest = useMemo(
    () =>
      (leads ?? [])
        .filter((l) => !ARCHIVED.has(l.tracking.qualification ?? ""))
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))
        .slice(0, HOW_MANY),
    [leads],
  );

  if (!allowed) return null;
  return (
    <Card className={`flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Newest leads</h2>
        <Link href="/leads" className="text-[11px] font-semibold text-accent hover:underline">
          All leads
        </Link>
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {!leads ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : newest.length === 0 ? (
          <p className="text-[12px] text-neutral-500">No open leads.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {newest.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/leads#${encodeURIComponent(l.id)}`}
                  className="block rounded-md px-1 py-1.5 hover:bg-line-soft"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-[13px] font-medium">{l.name}</span>
                    <Chip tone="neutral">{STAGE_LABELS[l.tracking.stage] ?? l.tracking.stage}</Chip>
                  </div>
                  <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                    {l.tracking.nextAction ? (
                      <>
                        Next: {l.tracking.nextAction}
                        {l.tracking.nextActionDate && ` · by ${fmtDate(l.tracking.nextActionDate)}`}
                      </>
                    ) : (
                      <span className="italic">No next step set</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
