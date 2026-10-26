"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { InvoiceAttachment } from "@/components/InvoiceViewer";
import {
  EmptyState,
  Input,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  SplitView,
  btn,
} from "@/components/ui";
import { money } from "@/lib/money";

/**
 * Bills — the draft bills waiting to be coded, newest first, with the open
 * bill's summary in a panel beside the list (SplitView).
 *
 * The list is the same one Today's "Bills to code" row opens (/api/coding-queue).
 * The panel is read-only on purpose: coding, moving and voiding stay on the
 * bill page (/bill/[docId]), which the panel's button opens. The selected bill
 * rides in the URL (?docId=…) so Back and a shared link keep it.
 *
 * Gated by the "bills" view in src/lib/views.ts. /api/coding-queue rides the
 * "recode" gate, so a person needs both — office and admin hold both by default.
 */

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

interface BillLine {
  id: string;
  name?: string;
  cost?: number;
  costCode?: { number?: string; name?: string } | null;
}
interface BillFile {
  id: string;
  name?: string;
  type?: string;
  url?: string;
  imageUrl?: string | null;
}
interface BillPayload {
  header?: { cost?: number } | null;
  lines?: BillLine[];
  files?: BillFile[];
  error?: string;
}

/** "2026-10-19" → "Oct 19, 2026". */
const dateLabel = (d?: string) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const billHref = (b: Draft) =>
  `/bill/${b.id}${b.jobId ? `?jobId=${encodeURIComponent(b.jobId)}` : ""}`;

function BillPanel({ bill }: { bill: Draft }) {
  const [data, setData] = useState<BillPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    fetch(
      `/api/bill?docId=${encodeURIComponent(bill.id)}&jobId=${encodeURIComponent(bill.jobId ?? "")}`,
    )
      .then((r) => r.json())
      .then((j: BillPayload) => {
        if (!alive) return;
        if (j.error) setError(String(j.error));
        else setData(j);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Network error"));
    return () => {
      alive = false;
    };
  }, [bill.id, bill.jobId]);

  const lines = data?.lines ?? [];
  const file = (data?.files ?? []).find((f) => f.url);

  return (
    <div className="space-y-4">
      <SectionHeading
        trailing={
          <span className="text-[11px] tabular-nums text-neutral-500">
            {money(data?.header?.cost ?? bill.cost ?? 0)}
          </span>
        }
      >
        {bill.fromName || "Unknown vendor"}
      </SectionHeading>
      <MetaLine
        items={[
          bill.jobName || "No job",
          dateLabel(bill.issueDate),
          bill.externalId ? `Invoice ${bill.externalId}` : "",
          bill.number ? `#${bill.number}` : "",
        ]}
      />

      <Link href={billHref(bill)} className={btn("primary", "md")}>
        Open to code ›
      </Link>

      {error && <p className="text-sm text-danger">{error}</p>}
      {!data && !error && <Loading label="Loading bill…" />}
      {data && (
        <>
          {lines.length > 0 && (
            <ListCard>
              {lines.map((l) => (
                <ListRow
                  key={l.id}
                  label={l.name || "Line"}
                  desc={
                    l.costCode?.number
                      ? `${l.costCode.number} ${l.costCode.name ?? ""}`.trim()
                      : "Not coded"
                  }
                  trailing={<span className="text-sm tabular-nums">{money(l.cost ?? 0)}</span>}
                />
              ))}
            </ListCard>
          )}
          {file && <InvoiceAttachment file={file} />}
        </>
      )}
    </div>
  );
}

export function BillsBrowser() {
  const router = useRouter();
  const search = useSearchParams();
  const openId = search.get("docId") ?? "";

  const [bills, setBills] = useState<Draft[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/coding-queue", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) =>
        j.error ? setError(String(j.error)) : setBills(Array.isArray(j.bills) ? j.bills : []),
      )
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"));
  }, []);

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (bills ?? []).filter(
        (b) =>
          !q ||
          [b.fromName, b.jobName, b.externalId, b.number].some((s) =>
            (s ?? "").toLowerCase().includes(q),
          ),
      ),
    [bills, q],
  );
  const open = bills?.find((b) => b.id === openId) ?? null;

  // The selection lives in the URL, so Back closes the panel on a phone.
  const select = (id: string) =>
    router.push(id ? `/bills?docId=${encodeURIComponent(id)}` : "/bills", { scroll: false });

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 lg:max-w-6xl pb-24 pt-6">
      <PageHeader title="Bills" description="Draft bills waiting to be coded, newest first." />

      <SplitView
        onClose={() => select("")}
        backLabel="Back to bills"
        empty="Pick a bill to see it here."
        detail={open && <BillPanel bill={open} />}
        list={
          <div className="space-y-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Vendor, job or invoice #"
              aria-label="Search bills"
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            {!bills && !error && <Loading label="Loading bills…" />}
            {bills && (
              <div className="space-y-2 pt-2">
                <SectionHeading>{`To code · ${shown.length}`}</SectionHeading>
                {shown.length === 0 ? (
                  <EmptyState>
                    {q ? `Nothing matches “${query.trim()}”.` : "No bills waiting to be coded."}
                  </EmptyState>
                ) : (
                  <ListCard>
                    {shown.map((b) => (
                      <ListRow
                        key={b.id}
                        onClick={() => select(b.id)}
                        selected={b.id === openId}
                        label={b.fromName || "Unknown vendor"}
                        desc={[b.jobName || "No job", dateLabel(b.issueDate)]
                          .filter(Boolean)
                          .join(" · ")}
                        trailing={
                          typeof b.cost === "number" ? (
                            <span className="text-sm font-semibold tabular-nums">
                              {money(b.cost)}
                            </span>
                          ) : undefined
                        }
                      />
                    ))}
                  </ListCard>
                )}
              </div>
            )}
          </div>
        }
      />
    </main>
  );
}
