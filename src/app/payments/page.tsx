"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import { JtLink } from "@/components/JtLink";
import { Banner, Button, CardSkeletonList, EmptyState, PageHeader, Spinner } from "@/components/ui";

const TSYS_URL = "https://hostedpaynow.com/hostedapp/tsys/paymentOptions";
const FILTERS = ["unpaid", "paid", "all"] as const;
type Filter = (typeof FILTERS)[number];
const EXTRACT_BATCH = 4; // statements Gemini-read per request (bounded so it never times out)

interface Statement {
  expId: string;
  project: string;
  statementDate: string;
  pdfUrl: string;
  accountName: string;
  statementNumber: string;
  total: string;
  discount: string;
  net: string;
  extractedAt: string;
  status: string;
  paidAt: string;
}

const money = (s: string) => {
  const n = Number(s);
  return s !== "" && Number.isFinite(n)
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
};

export default function PaymentsPage() {
  const [items, setItems] = useState<Statement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("unpaid");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [filling, setFilling] = useState(false);
  const runRef = useRef(0);

  // Progressively Gemini-extract the uncached statements in small batches so no
  // single request ever runs unbounded work. `token` guards against a filter
  // change superseding an in-flight fill.
  const fill = useCallback(async (ids: string[], token: number) => {
    setFilling(true);
    for (let i = 0; i < ids.length; i += EXTRACT_BATCH) {
      if (token !== runRef.current) return;
      const chunk = ids.slice(i, i + EXTRACT_BATCH);
      try {
        const res = await fetch("/api/sunset-statements/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expIds: chunk }),
        });
        const json = await res.json();
        if (token !== runRef.current) return;
        if (res.ok && json.ok !== false) {
          const ex: Record<string, Statement> = json.extracted ?? {};
          const fail: string[] = json.failed ?? [];
          if (Object.keys(ex).length) {
            setItems((rows) => rows.map((r) => (ex[r.expId] ? { ...r, ...ex[r.expId] } : r)));
          }
          if (fail.length) setFailed((f) => ({ ...f, ...Object.fromEntries(fail.map((id) => [id, true])) }));
        } else {
          setFailed((f) => ({ ...f, ...Object.fromEntries(chunk.map((id) => [id, true])) }));
        }
      } catch {
        if (token !== runRef.current) return;
        setFailed((f) => ({ ...f, ...Object.fromEntries(chunk.map((id) => [id, true])) }));
      }
    }
    if (token === runRef.current) setFilling(false);
  }, []);

  const load = useCallback(
    async (f: Filter) => {
      const token = ++runRef.current;
      setLoading(true);
      setError("");
      setFilling(false);
      setFailed({});
      try {
        const res = await fetch(`/api/sunset-statements?status=${f}`);
        const json = await res.json();
        if (token !== runRef.current) return;
        if (!res.ok || json.ok === false) {
          setError(json.error ?? "Request failed");
          return;
        }
        const list: Statement[] = json.items ?? [];
        setItems(list);
        const uncached = list.filter((s) => !s.extractedAt).map((s) => s.expId);
        if (uncached.length) fill(uncached, token);
      } catch (e) {
        if (token === runRef.current) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (token === runRef.current) setLoading(false);
      }
    },
    [fill],
  );

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  async function setPaid(expId: string, status: "paid" | "unpaid") {
    setBusy((b) => ({ ...b, [expId]: true }));
    try {
      const res = await fetch(`/api/sunset-statements/${encodeURIComponent(expId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setError(json.error ?? "Could not update");
        return;
      }
      setItems((rows) =>
        filter === "all"
          ? rows.map((r) => (r.expId === expId ? { ...r, ...json.statement } : r))
          : rows.filter((r) => r.expId !== expId),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy((b) => ({ ...b, [expId]: false }));
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Payments"
        description="Sunset statements to pay at TSYS — copy the fields, pay, mark it done."
        className="!mb-4"
      />

      <div className="mb-4 flex items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={
              "rounded-full px-3 py-1 text-xs font-semibold capitalize transition " +
              (filter === f
                ? "bg-accent/10 text-accent dark:text-accent-soft"
                : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/10")
            }
          >
            {f}
          </button>
        ))}
        {filling && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-neutral-500">
            <Spinner /> Reading statements…
          </span>
        )}
      </div>

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && items.length === 0 && (
        <EmptyState>
          {filter === "unpaid"
            ? "Nothing to pay — every Sunset statement is marked paid. 🎉"
            : "No statements here."}
        </EmptyState>
      )}

      <ul className="space-y-2">
        {items.map((s) => {
          const done = !!s.extractedAt;
          const fail = !!failed[s.expId];
          return (
            <li
              key={s.expId}
              className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{s.accountName || s.project || s.expId}</div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {s.statementNumber ? `Statement #${s.statementNumber}` : "Statement #—"}
                    {s.statementDate ? ` · ${s.statementDate}` : ""}
                    {s.project && s.accountName ? ` · ${s.project}` : ""}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-bold tabular-nums">{money(s.net)}</div>
                  <div className="text-[11px] uppercase tracking-wide text-neutral-400">net to pay</div>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-neutral-600 tabular-nums dark:text-neutral-400">
                <span>Total {money(s.total)}</span>
                <span>Discount {s.discount ? "−" + money(s.discount) : "—"}</span>
              </div>

              {!done &&
                (fail ? (
                  <Banner tone="warning" className="mt-2 !py-2 text-xs">
                    Couldn&apos;t read this statement automatically — open the PDF for the numbers.
                  </Banner>
                ) : (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                    <Spinner /> Reading statement…
                  </div>
                ))}

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {s.accountName && <CopyButton value={s.accountName} label="Account" />}
                {s.statementNumber && <CopyButton value={s.statementNumber} label="Stmt #" />}
                {s.net && <CopyButton value={s.net} label="Net" />}
                <JtLink
                  href={TSYS_URL}
                  className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-accent-fg transition hover:bg-accent-hover"
                >
                  Pay at TSYS ↗
                </JtLink>
                {s.pdfUrl && (
                  <a
                    href={s.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-semibold text-neutral-600 transition hover:border-accent hover:text-accent dark:border-neutral-600 dark:text-neutral-300"
                  >
                    View PDF
                  </a>
                )}
                <div className="ml-auto">
                  {s.status === "paid" ? (
                    <Button variant="secondary" size="sm" disabled={busy[s.expId]} onClick={() => setPaid(s.expId, "unpaid")}>
                      {busy[s.expId] ? "…" : "Undo paid"}
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy[s.expId]} onClick={() => setPaid(s.expId, "paid")}>
                      {busy[s.expId] ? "…" : "Mark paid"}
                    </Button>
                  )}
                </div>
              </div>

              {s.status === "paid" && s.paidAt && (
                <div className="mt-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                  Paid {new Date(s.paidAt).toLocaleDateString()}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
