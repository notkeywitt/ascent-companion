"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";
import { CountBadge, ListCard, ListRow, MetaLine, SectionHeading } from "@/components/ui";
import { cached, sunsetGreenCounts } from "@/lib/homeFacts";

/**
 * TODAY — what needs this person, one row per queue, each with its count.
 *
 * Each row reads the API its own page already uses, so the middleware gates it
 * by that page's view: a row a person cannot open is never asked for. Counts
 * are cached per tab (lib/homeFacts) for a few minutes, because Today is opened
 * many times a day and some reads are slow. A row with nothing waiting is not
 * shown; a failed read is not shown either — no row is the honest answer to
 * "could not check".
 *
 * "Bills to code" opens in place: the draft bills, newest first, each linking
 * to its bill. That list is what the retired Coding Review page (/coding) was.
 *
 * The stuck-vendor and Not in JobTread banners stay above this list: they carry
 * their own actions (create the vendor, assign the job).
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

interface Row {
  key: string;
  label: string;
  href: string;
  count: number;
  detail: string;
}

type Queue = {
  key: string;
  /** The view whose page the row opens — and whose API the count reads. */
  view: string;
  /** Office and admin only: a count of everyone's items is office work. */
  officeOnly?: boolean;
  label: string;
  href: string;
  load: () => Promise<{ count: number; detail: string }>;
};

async function getJson(url: string) {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json();
  if (!r.ok || j?.error) throw new Error(String(j?.error ?? r.status));
  return j;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** The draft bills, shared by the row's count and its list. */
const drafts = () =>
  cached("drafts", 3 * MIN, async () => ((await getJson("/api/coding-queue")).bills ?? []) as Draft[]);

const QUEUES: Queue[] = [
  {
    key: "drafts",
    view: "recode",
    label: "Bills to code",
    href: "",
    load: async () => {
      const bills = await drafts();
      const jobs = new Set(bills.map((b) => b.jobName || "No job")).size;
      return { count: bills.length, detail: `${plural(bills.length, "draft bill")} on ${plural(jobs, "job")}` };
    },
  },
  {
    key: "corrections",
    view: "bill-review",
    label: "Bill Corrections",
    href: "/needs-review",
    load: async () => {
      const n = ((await cached("corrections", 5 * MIN, () => getJson("/api/bill-review"))).bills ?? []).length;
      return { count: n, detail: `${plural(n, "bill")} flagged for a billing correction` };
    },
  },
  {
    key: "time-sync",
    view: "time-sync",
    label: "Time Sync",
    href: "/time-sync",
    // Short-lived: a retry on /time-sync empties the queue at once, and a count
    // that kept claiming work was waiting would teach the office to ignore it.
    load: async () => {
      const n = Number((await cached("time-sync", MIN, () => getJson("/api/time-sync?count=1"))).count ?? 0);
      return { count: n, detail: `${plural(n, "time record")} JobTread does not have right` };
    },
  },
  {
    key: "time-off",
    view: "time-off-admin",
    label: "Time off to approve",
    href: "/time-off",
    load: async () => {
      const j = await cached("time-off", 5 * MIN, () => getJson("/api/time-off/requests?scope=all"));
      const n = ((j.requests ?? []) as { status?: string }[]).filter((r) => r.status === "pending").length;
      return { count: n, detail: `${plural(n, "request")} waiting` };
    },
  },
  {
    key: "requisitions",
    view: "requisitions",
    officeOnly: true,
    label: "Requisitions",
    href: "/requisitions",
    load: async () => {
      const j = await cached("requisitions", 5 * MIN, () => getJson("/api/requisitions"));
      const n = ((j.requisitions ?? []) as Record<string, string>[]).filter((r) => !r.Status || r.Status === "Requested").length;
      return { count: n, detail: `${plural(n, "request")} to order` };
    },
  },
  {
    key: "sunset",
    view: "payments",
    officeOnly: true,
    label: "Sunset",
    href: "/payments",
    load: async () => {
      const { notGreen } = await sunsetGreenCounts();
      return { count: notGreen, detail: `${plural(notGreen, "unpaid statement")} not reconciled` };
    },
  },
  {
    key: "feedback",
    view: "requests",
    officeOnly: true,
    label: "App Feedback",
    href: "/requests",
    load: async () => {
      const j = await cached("feedback", 10 * MIN, () => getJson("/api/feature-requests"));
      const n = ((j.requests ?? []) as { status?: string }[]).filter((r) => r.status === "open").length;
      return { count: n, detail: `${plural(n, "request")} open` };
    },
  },
];

export function TodayQueue() {
  const access = useAccess();
  const office = access.role === "admin" || access.role === "office";
  const mine = QUEUES.filter((q) => access.can(q.view) && (!q.officeOnly || office));
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [settled, setSettled] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Draft[] | null>(null);
  const key = mine.map((q) => q.key).join("|");

  useEffect(() => {
    let alive = true;
    setRows({});
    setSettled(0);
    for (const q of mine) {
      q.load()
        .then(({ count, detail }) => {
          if (alive && count > 0) setRows((m) => ({ ...m, [q.key]: { key: q.key, label: q.label, href: q.href, count, detail } }));
        })
        .catch(() => {})
        .finally(() => alive && setSettled((n) => n + 1));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (open && !list) drafts().then(setList).catch(() => setList([]));
  }, [open, list]);

  if (mine.length === 0) return null;
  const shown = mine.map((q) => rows[q.key]).filter((r): r is Row => !!r);
  const done = settled >= mine.length;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading>Needs you</SectionHeading>
      {shown.length === 0 ? (
        <MetaLine items={[done ? "Nothing waiting." : "Checking…"]} />
      ) : (
        <ListCard>
          {shown.map((r) =>
            r.key === "drafts" ? (
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
            ) : (
              <ListRow key={r.key} href={r.href} label={r.label} desc={r.detail} badge={<CountBadge n={r.count} />} />
            ),
          )}
        </ListCard>
      )}
    </section>
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
