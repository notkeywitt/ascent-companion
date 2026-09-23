"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  CardSkeletonList,
  EmptyState,
  ListCard,
  ListRow,
  MetaLine,
  PageHeader,
  QuietInput,
  SectionHeading,
} from "@/components/ui";

/**
 * FILLING THE VENDOR ADDRESS INDEX.
 *
 * The mail check can only speak for vendors whose address is on file, so this
 * page exists to shrink the blind spot. It proposes address→vendor pairs drawn
 * from mail that actually arrived, and the office approves them one at a time.
 *
 * NOTHING IS WRITTEN WITHOUT A TAP. The proposals come from a fuzzy name/domain
 * match — the very heuristic the exact index exists to replace — so they are
 * evidence to judge, not an answer to trust. Approving one writes the address to
 * that vendor's JobTread account through /api/vendor-details, which journals the
 * change with its prior value.
 */

interface Candidate {
  address: string;
  fromName: string;
  vendorId: string;
  vendorName: string;
  messages: number;
  sampleSubject: string;
  sampleDate: string;
  threadUrl: string;
}

interface Payload {
  ok: boolean;
  coverage: { total: number; indexed: number; missing: number; pct: number };
  swept: { months: string[]; emails: number };
  candidates: Candidate[];
  error?: string;
}

export default function VendorMailIndex() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/vendor-mail/seed?months=3");
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
    void load();
  }, [load]);

  async function approve(c: Candidate) {
    if (busy) return;
    const email = (edited[c.vendorId] ?? c.address).trim();
    if (!email) return;
    setBusy(c.vendorId);
    try {
      const res = await fetch("/api/vendor-details", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: c.vendorId, email }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Save failed.");
      setDone((d) => ({ ...d, [c.vendorId]: email }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  const pending = (data?.candidates ?? []).filter((c) => !done[c.vendorId]);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Vendor Addresses"
        description="The mail check only sees vendors it has an address for. These are addresses found in recent mail, matched to vendors that have none."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Reading…" : "Rescan"}
          </Button>
        }
      />

      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}

      {data && (
        <Card className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold tracking-tight">
              {data.coverage.indexed + Object.keys(done).length} of {data.coverage.total} vendors
              indexed
            </span>
            <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              {data.coverage.pct}%
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
            Swept {data.swept.emails} emails across {data.swept.months.length} billing period
            {data.swept.months.length === 1 ? "" : "s"}.
          </p>
        </Card>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && data && pending.length === 0 && (
        <EmptyState>
          {Object.keys(done).length > 0
            ? "Every proposal has been saved."
            : "No new addresses found in recent mail. The remaining vendors haven't emailed in this window, so they need an address by hand in JobTread."}
        </EmptyState>
      )}

      {!loading && pending.length > 0 && (
        <>
          <SectionHeading className="mb-2">Proposed ({pending.length})</SectionHeading>
          <ListCard>
            {pending.map((c) => (
              <ListRow
                key={c.vendorId}
                chevron={false}
                label={c.vendorName}
                desc={
                  <span className="block">
                    <QuietInput
                      value={edited[c.vendorId] ?? c.address}
                      onChange={(e) =>
                        setEdited((x) => ({ ...x, [c.vendorId]: e.target.value }))
                      }
                      aria-label={`Email address for ${c.vendorName}`}
                      className="w-full font-medium"
                    />
                    <MetaLine
                      items={[
                        `${c.messages} email${c.messages === 1 ? "" : "s"}`,
                        c.sampleDate,
                        c.sampleSubject,
                      ]}
                    />
                  </span>
                }
                trailing={
                  <span className="flex shrink-0 items-center gap-2">
                    <a
                      href={c.threadUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
                    >
                      Check
                    </a>
                    <Button
                      size="sm"
                      onClick={() => void approve(c)}
                      disabled={busy === c.vendorId}
                    >
                      {busy === c.vendorId ? "Saving…" : "Save"}
                    </Button>
                  </span>
                }
              />
            ))}
          </ListCard>
        </>
      )}

      {Object.keys(done).length > 0 && (
        <p className="mt-4 text-[11.5px] text-neutral-500 dark:text-neutral-400">
          Saved {Object.keys(done).length} address
          {Object.keys(done).length === 1 ? "" : "es"} to JobTread. The mail check picks them up on
          its next load.
        </p>
      )}
    </main>
  );
}
