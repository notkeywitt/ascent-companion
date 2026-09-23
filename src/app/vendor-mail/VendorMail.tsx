"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Card,
  CardSkeletonList,
  Chip,
  EmptyState,
  FilterChip,
  ChipScroller,
  ListCard,
  ListRow,
  MetaLine,
  PageHeader,
  Select,
} from "@/components/ui";

/**
 * VENDOR MAIL — every email a known vendor sent, and whether it was captured.
 *
 * A checking tool, not a capturing one. Its predecessor tried to import
 * automatically and was set aside; this one only answers "did anything slip?"
 * and leaves every judgement to the office.
 *
 * COVERAGE IS PART OF THE ANSWER. The sweep searches by the addresses on file in
 * JobTread, so a vendor nobody indexed is invisible and their absence from the
 * list proves nothing. The coverage line is shown level with the rows, not
 * tucked in a corner, because an all-clear over a half-built index is a lie.
 */

type State = "captured" | "likely" | "new";
type Kind = "invoice" | "receipt";
type Payment = "paid" | "unpaid" | "draft";

interface Row {
  messageId: string;
  subject: string;
  from: string;
  fromAddress: string;
  date: string;
  attachmentCount: number;
  subjectAmount: number | null;
  threadUrl: string;
  vendorId: string;
  vendorName: string;
  state: State;
  kind: Kind;
  expId: string;
  bill: {
    id: string;
    number: number | null;
    cost: number;
    jobId: string | null;
    jobName: string;
    payment: Payment;
  } | null;
}

interface Coverage {
  total: number;
  indexed: number;
  missing: number;
  pct: number;
}

interface Payload {
  ok: boolean;
  days: number;
  coverage: Coverage;
  collisions: { address: string; vendors: string[] }[];
  truncated: boolean;
  swept: { messages: number; addresses: number };
  rows: Row[];
  unindexed: { id: string; name: string }[];
  error?: string;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 10)
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const STATE_LABEL: Record<State, string> = {
  captured: "Captured",
  likely: "Likely captured",
  new: "Not in JobTread",
};

type Filter = "all" | "new" | "likely" | "captured";

export default function VendorMail() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [filter, setFilter] = useState<Filter>("new");

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/vendor-mail?days=${d}`);
      const json: Payload = await res.json();
      if (!json.ok) throw new Error(json.error || "Could not read the mailbox.");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      all: rows.length,
      new: rows.filter((r) => r.state === "new").length,
      likely: rows.filter((r) => r.state === "likely").length,
      captured: rows.filter((r) => r.state === "captured").length,
    };
  }, [data]);

  const shown = useMemo(() => {
    const rows = data?.rows ?? [];
    return filter === "all" ? rows : rows.filter((r) => r.state === filter);
  }, [data, filter]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Vendor Mail"
        description="Every email from a vendor we have an address for, and whether it reached JobTread."
        actions={
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="How far back to look"
            className="w-auto"
          >
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
          </Select>
        }
      />

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {/* Coverage is the scope of the answer, so it sits above the rows. */}
      {data && (
        <Card className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold tracking-tight">
              {data.coverage.indexed} of {data.coverage.total} vendors have an email on file
            </span>
            <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              {data.coverage.pct}%
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
            <div className="h-full rounded-full bg-brand" style={{ width: `${data.coverage.pct}%` }} />
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-500 dark:text-neutral-400">
            Read {data.swept.messages} email{data.swept.messages === 1 ? "" : "s"} from{" "}
            {data.swept.addresses} address{data.swept.addresses === 1 ? "" : "es"} in the last{" "}
            {data.days} days. The {data.coverage.missing} vendors without an address are not
            searched, so nothing here can speak for them.{" "}
            <a href="/vendor-mail/index" className="font-semibold text-accent hover:underline dark:text-accent-soft">
              Fill the gaps →
            </a>
          </p>
        </Card>
      )}

      {data && data.collisions.length > 0 && (
        <Banner tone="warning" className="mb-4">
          {data.collisions.map((c) => (
            <div key={c.address}>
              <span className="font-semibold">{c.address}</span> is on {c.vendors.join(" and ")} — its
              mail is attributed to {c.vendors[0]} only.
            </div>
          ))}
        </Banner>
      )}

      {data?.truncated && (
        <Banner tone="warning" className="mb-4">
          The sweep hit its message cap, so this is not the whole window. Narrow the range.
        </Banner>
      )}

      <ChipScroller className="mb-3">
        {(["new", "likely", "captured", "all"] as Filter[]).map((f) => (
          <FilterChip key={f} on={filter === f} onClick={() => setFilter(f)}>
            {f === "all" ? "Everything" : STATE_LABEL[f as State]} ({counts[f]})
          </FilterChip>
        ))}
      </ChipScroller>

      {loading && <CardSkeletonList rows={4} />}

      {!loading && !error && shown.length === 0 && (
        <EmptyState>
          {data && data.swept.messages === 0
            ? "No vendor mail was found at all in this window — check that before reading it as all-clear."
            : filter === "new"
              ? `Nothing unaccounted for in the ${data?.swept.messages ?? 0} emails read.`
              : "No mail matches this filter."}
        </EmptyState>
      )}

      {!loading && shown.length > 0 && (
        <ListCard>
          {shown.map((r) => (
            <ListRow
              key={r.messageId}
              href={r.threadUrl}
              label={
                <span className="flex items-center gap-2">
                  <span className="truncate">{r.vendorName || r.fromAddress}</span>
                  {r.state === "new" && <Chip tone="warning">New</Chip>}
                </span>
              }
              desc={
                <span className="block">
                  <span className="block truncate">{r.subject}</span>
                  <MetaLine
                    items={[
                      dayLabel(r.date),
                      STATE_LABEL[r.state],
                      r.kind === "receipt" ? "Receipt" : "Invoice",
                      r.bill && r.bill.payment !== "draft"
                        ? r.bill.payment === "paid"
                          ? "Paid"
                          : "Unpaid"
                        : r.bill
                          ? "Draft bill"
                          : "",
                      r.bill?.jobName || "",
                      r.subjectAmount ? money(r.subjectAmount) : "",
                    ]}
                  />
                </span>
              }
            />
          ))}
        </ListCard>
      )}

      {data && (
        <p className="mt-4 text-[11.5px] text-neutral-500 dark:text-neutral-400">
          Captured is proof — the email&apos;s Gmail id is recorded against a bill. Likely captured is
          inference — a bill from that vendor near that date. This page reads only; it captures
          nothing.
        </p>
      )}
    </main>
  );
}
