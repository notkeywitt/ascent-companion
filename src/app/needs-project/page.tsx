"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { JobPicker } from "@/components/JobPicker";
import { PageTitle } from "@/components/PageTitle";

interface NeedsItem {
  expId: string;
  vendor: string;
  amount: number;
  date: string;
  driveUrl: string;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The queue only lists rows with no JT Doc ID, but the page fetches once on mount
// — a sync can link a bill to JobTread while you're looking at the stale list.
// Both backend guards say "already in JobTread"; that means the bill is now
// handled, so the row is simply out of date and should drop off rather than
// showing the user an error they can't act on.
const isStale = (err?: string) => /already in JobTread/i.test(err ?? "");

// Bills ingestion held because it couldn't determine the job (e.g. a Sunset
// "Sold-To" that names a customer with more than one job, and no PO# to
// disambiguate). Pick the job from the PDF and assign — it pushes to JobTread
// and re-files in Drive.
export default function NeedsProjectPage() {
  const [items, setItems] = useState<NeedsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  // Cross-tab "bills waiting" flag — fetched independently in the background so
  // a slow/failed JobTread count never blocks or errors the queue above.
  const [draftBillCount, setDraftBillCount] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/needs-project");
      const json = await res.json();
      if (!res.ok || json.ok === false) setError(json.error ?? "Request failed");
      else setItems(json.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    let alive = true;
    fetch("/api/vendor-bill-count")
      .then((r) => r.json())
      .then((j) => {
        if (alive) setDraftBillCount(typeof j.count === "number" ? j.count : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const drop = (expId: string) => setItems((prev) => prev.filter((it) => it.expId !== expId));

  async function assign(expId: string) {
    const jobId = picked[expId];
    if (!jobId) return;
    setBusy((b) => ({ ...b, [expId]: true }));
    setMsg((m) => ({ ...m, [expId]: "" }));
    try {
      const res = await fetch("/api/needs-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expId, jobId }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (isStale(json.error)) {
          drop(expId);
          return;
        }
        setMsg((m) => ({ ...m, [expId]: json.error ?? "Assign failed" }));
      } else {
        // Pushed to JobTread on the chosen job — drop it from the queue.
        drop(expId);
      }
    } catch (e) {
      setMsg((m) => ({ ...m, [expId]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setBusy((b) => ({ ...b, [expId]: false }));
    }
  }

  // Clear a row that's already been handled another way (re-imported / entered in
  // JobTread by hand), is a duplicate, or isn't a bill. Non-destructive: the sheet
  // row + Drive PDF stay; it just stops showing here.
  async function dismiss(expId: string) {
    if (
      !window.confirm(
        "Remove this from the queue?\n\nUse this when the bill was already imported/entered another way, is a duplicate, or isn't a bill. The sheet row and its PDF are kept — it just stops showing here.",
      )
    )
      return;
    setBusy((b) => ({ ...b, [expId]: true }));
    setMsg((m) => ({ ...m, [expId]: "" }));
    try {
      const res = await fetch("/api/needs-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expId, dismiss: true }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (isStale(json.error)) {
          drop(expId);
          return;
        }
        setMsg((m) => ({ ...m, [expId]: json.error ?? "Dismiss failed" }));
      } else {
        drop(expId);
      }
    } catch (e) {
      setMsg((m) => ({ ...m, [expId]: e instanceof Error ? e.message : "Network error" }));
    } finally {
      setBusy((b) => ({ ...b, [expId]: false }));
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <header className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <PageTitle>Needs Project</PageTitle>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-semibold text-neutral-500 hover:text-neutral-800 disabled:opacity-40 dark:border-neutral-700 dark:hover:text-neutral-200"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <p className="mt-0.5 text-sm text-neutral-500">
          Ingested bills held because the job couldn’t be determined automatically. Open the PDF,
          pick the job, and Assign — it pushes to JobTread and re-files in Drive.
        </p>
      </header>

      {!!draftBillCount && (
        <Link
          href="/"
          className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-accent/10 px-4 py-2.5 text-sm text-accent hover:bg-accent/15"
        >
          <span>
            <b className="font-semibold">{draftBillCount}</b> vendor bill
            {draftBillCount === 1 ? "" : "s"} waiting in Coding Review across all jobs
          </span>
          <span className="shrink-0 font-semibold">Go to queue →</span>
        </Link>
      )}

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="rounded-lg bg-neutral-100 px-4 py-6 text-center text-sm text-neutral-500 dark:bg-neutral-800">
          Nothing waiting — every ingested bill has a job. 🎉
        </p>
      )}

      <ul className="space-y-3">
        {items.map((it) => (
          <li
            key={it.expId}
            className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{it.vendor || "Vendor bill"}</div>
                <div className="mt-0.5 font-mono text-xs text-neutral-500">
                  {it.date ? it.date + " · " : ""}Inv# {it.expId}
                </div>
              </div>
              <div className="font-mono text-sm font-semibold">{money(it.amount)}</div>
            </div>

            {it.driveUrl && (
              <a
                href={it.driveUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-sm font-semibold text-accent"
              >
                View PDF ↗
              </a>
            )}

            <div className="mt-3 flex items-center gap-2">
              <JobPicker
                value={picked[it.expId] ?? ""}
                onChange={(id) => setPicked((p) => ({ ...p, [it.expId]: id }))}
              />
              <button
                type="button"
                onClick={() => assign(it.expId)}
                disabled={!picked[it.expId] || busy[it.expId]}
                className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                {busy[it.expId] ? "Assigning…" : "Assign"}
              </button>
              <button
                type="button"
                onClick={() => dismiss(it.expId)}
                disabled={busy[it.expId]}
                title="Already imported / duplicate / not a bill — remove from this queue"
                className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-semibold text-neutral-500 hover:text-neutral-800 disabled:opacity-40 dark:border-neutral-700 dark:hover:text-neutral-200"
              >
                Dismiss
              </button>
            </div>
            {msg[it.expId] && (
              <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                {msg[it.expId]}
              </p>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
