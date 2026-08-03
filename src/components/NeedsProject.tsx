"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAccess } from "@/components/AccessProvider";

/**
 * The "bills are waiting for a job" indicator on the Home launcher.
 *
 * Sunset ingestion writes an Expenditure row even when the invoice's "Sold-To"
 * token doesn't resolve to a single job — it tags the email, files the PDF, and
 * deliberately refuses to guess the job (Ingestion.js: handleSunsetInvoice). The
 * row then sits at Status "Needs Review" with no Project ID and nothing in
 * JobTread until a human opens /needs-project and picks the job. Nothing else
 * announces it: the email looks processed and the bill looks filed, so the queue
 * could grow for weeks unnoticed.
 *
 * So this is purely an announcement — it reads the same queue the page does and
 * never writes. Two exports, ONE fetch (the hook is called once by Home and its
 * result handed to the banner and the menu badges, rather than each fetching):
 *   useNeedsProjectCount — fetches /api/needs-project; no-ops without access.
 *   NeedsProjectBanner   — self-hiding card, shown only when the queue isn't empty.
 *
 * Gated on the `needs-project` view — the same gate as the page and the API
 * route, so nobody is nagged about a queue they can't open.
 */

/** One queued bill, as returned by listNeedsProject (Diagnostics.js). */
export interface NeedsProjectItem {
  expId: string;
  vendor: string;
  amount: number;
  date: string;
  driveUrl: string;
}

export interface NeedsProjectState {
  items: NeedsProjectItem[];
  count: number;
  loading: boolean;
  error: string;
  refresh: () => void;
}

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Read the Needs-Project queue once per page load. Deliberately uncached
 * (`no-store`): the queue is short-lived — assigning a job on /needs-project
 * empties it immediately — and a cached count that kept claiming work was
 * waiting after it was cleared would train the owner to ignore the badge.
 */
export function useNeedsProjectCount(): NeedsProjectState {
  const access = useAccess();
  const canSee = access.can("needs-project");

  const [items, setItems] = useState<NeedsProjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!canSee) return;
    let alive = true;
    setLoading(true);
    setError("");
    fetch("/api/needs-project", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.ok === false || j.error) {
          setError(String(j.error ?? "Could not check the queue"));
          return;
        }
        setItems(Array.isArray(j.items) ? j.items : []);
      })
      // A failed check must never break the launcher it's mounted on — the
      // indicator is additive. Record it; the banner offers a retry.
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [canSee, nonce]);

  return useMemo(
    () => ({ items, count: items.length, loading, error, refresh }),
    [items, loading, error, refresh],
  );
}

/**
 * The banner itself. Renders nothing when the queue is empty (the normal state),
 * so Home stays quiet until there's actually something to do. Takes the hook's
 * result rather than calling it, so the menu badges share the same fetch.
 */
export function NeedsProjectBanner({ state }: { state: NeedsProjectState }) {
  const access = useAccess();
  const { items, count, loading, error, refresh } = state;

  if (!access.can("needs-project")) return null;

  // A broken check is worth saying out loud — an indicator that silently fails
  // reads exactly like an empty queue.
  if (error) {
    return (
      <div className="mb-4 rounded-xl bg-neutral-100 px-4 py-3 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        Couldn’t check the Needs Project queue ({error}).{" "}
        <button type="button" onClick={refresh} className="font-semibold underline">
          Retry
        </button>
      </div>
    );
  }
  if (count === 0) return null;

  return (
    <div
      role="status"
      className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold">
            {count === 1 ? "1 bill needs a job" : `${count} bills need a job`}
          </p>
          <p className="mt-0.5 break-words text-xs opacity-90">
            {items
              .slice(0, 3)
              .map((it) => `${it.vendor || "Unknown vendor"} ${money(it.amount)}`)
              .join(", ")}
            {count > 3 ? `, +${count - 3} more` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="shrink-0 text-xs font-semibold underline disabled:opacity-50"
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>
      <Link href="/needs-project" className="mt-2 inline-block text-sm font-semibold underline">
        Open Needs Project →
      </Link>
    </div>
  );
}
