"use client";

import { useEffect, useState } from "react";

import { Card, Chip, Skeleton } from "@/components/ui";
import { jtToDoUrl } from "@/lib/jtLinks";
import { fmtDate } from "@/lib/leadBoard";

/**
 * The signed-in person's own open JobTread to-dos, as a card on the Jobs page
 * (Admin and Office, while no job is picked). Overdue first, then soonest due.
 * Read-only: a row opens the to-do in JobTread. The read is
 * /api/jobs-hub/my-todos, which shows only to-dos assigned to this person.
 */

interface Todo {
  id: string;
  name: string;
  due: string | null;
  overdue: boolean;
  jobName: string | null;
}
interface Mine {
  ok: boolean;
  me?: { linked: boolean };
  todos?: Todo[];
  total?: number;
  overdue?: number;
}

export function HubMyTodos({ className = "" }: { className?: string }) {
  const [d, setD] = useState<Mine | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs-hub/my-todos", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: Mine) => !cancelled && (j.ok ? setD(j) : setFailed(true)))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className={`flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">My to-dos</h2>
        {d && (d.overdue ?? 0) > 0 && <Chip tone="danger">{d.overdue} overdue</Chip>}
      </div>
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <p className="text-[12px] text-neutral-500">Could not read your to-dos from JobTread.</p>
        ) : !d ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : !d.me?.linked ? (
          <p className="text-[12px] text-neutral-500">
            This account is not linked to a JobTread user, so it has no to-dos.
          </p>
        ) : (d.todos ?? []).length === 0 ? (
          <p className="text-[12px] text-neutral-500">Nothing open. You are clear.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {(d.todos ?? []).map((t) => (
              <li key={t.id}>
                <a
                  href={jtToDoUrl(t.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-md px-1 py-1.5 hover:bg-line-soft"
                >
                  <div className="truncate text-[13px] font-medium">{t.name}</div>
                  <div className="flex flex-wrap gap-x-2 text-[11px] text-neutral-500 dark:text-neutral-400">
                    {t.due && (
                      <span className={t.overdue ? "font-semibold text-danger" : ""}>
                        {t.overdue ? "Overdue · " : "Due "}
                        {fmtDate(t.due)}
                      </span>
                    )}
                    {t.jobName && <span className="truncate">{t.jobName}</span>}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {d && (d.total ?? 0) > (d.todos ?? []).length && (
        <div className="shrink-0 border-t border-line-soft pt-1.5 text-[11px] text-neutral-500">
          {(d.total ?? 0) - (d.todos ?? []).length} more in JobTread
        </div>
      )}
    </Card>
  );
}
