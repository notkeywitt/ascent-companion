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
  period: string;
  coverage: { total: number; indexed: number; missing: number; pct: number };
  swept?: { emails: number; truncated?: boolean };
  candidates?: Candidate[];
  error?: string;
}

/** How many billing periods back the walk goes. */
const PERIODS = 3;

export default function VendorMailIndex() {
  const [coverage, setCoverage] = useState<Payload["coverage"] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("");
  const [swept, setSwept] = useState({ emails: 0, periods: [] as string[], truncated: false });
  const [failures, setFailures] = useState<{ period: string; error: string }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [done, setDone] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, string>>({});

  /**
   * One request per billing period. A whole-month all-mail sweep takes most of a
   * minute, so three in one request timed out — and the first version reported
   * that as an empty mailbox. Each period now reports for itself, and a failure
   * is shown rather than counted as "nothing found".
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setFailures([]);
    setCandidates([]);
    setSwept({ emails: 0, periods: [], truncated: false });

    const seen = new Set<string>();
    const found: Candidate[] = [];
    const failed: { period: string; error: string }[] = [];
    let emails = 0;
    let truncated = false;
    const periods: string[] = [];

    for (let back = 0; back < PERIODS; back++) {
      setProgress(`Reading billing period ${back + 1} of ${PERIODS}…`);
      try {
        const res = await fetch(`/api/vendor-mail/seed?back=${back}`);
        const json: Payload = await res.json();
        if (json.coverage) setCoverage(json.coverage);
        if (!json.ok) {
          failed.push({ period: json.period ?? `#${back}`, error: json.error ?? "Failed." });
          continue;
        }
        periods.push(json.period);
        emails += json.swept?.emails ?? 0;
        if (json.swept?.truncated) truncated = true;
        // One vendor gets one proposal, even across periods.
        for (const c of json.candidates ?? []) {
          if (seen.has(c.vendorId)) continue;
          seen.add(c.vendorId);
          found.push(c);
        }
        setCandidates([...found]);
        setSwept({ emails, periods: [...periods], truncated });
      } catch (e) {
        failed.push({ period: `#${back}`, error: e instanceof Error ? e.message : "Network error" });
      }
    }
    setFailures(failed);
    if (failed.length === PERIODS) {
      setError("No billing period could be read — the results below mean nothing.");
    }
    setProgress("");
    setLoading(false);
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

  const pending = candidates.filter((c) => !done[c.vendorId]);

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

      {failures.length > 0 && (
        <Banner tone="warning" className="mb-3">
          {failures.length === PERIODS
            ? "Every billing period failed to read, so nothing below can be trusted:"
            : `${failures.length} of ${PERIODS} billing periods could not be read, so this list is incomplete:`}
          {failures.map((f) => (
            <div key={f.period} className="mt-1">
              <span className="font-semibold">{f.period}</span> — {f.error}
            </div>
          ))}
        </Banner>
      )}

      {coverage && (
        <Card className="mb-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold tracking-tight">
              {coverage.indexed + Object.keys(done).length} of {coverage.total} vendors indexed
            </span>
            <span className="text-[11.5px] text-neutral-500 dark:text-neutral-400">
              {coverage.pct}%
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] text-neutral-500 dark:text-neutral-400">
            {progress ||
              (swept.periods.length === 0
                ? "No mail read yet."
                : `Read ${swept.emails} invoice-looking email${swept.emails === 1 ? "" : "s"} across ${swept.periods.length} billing period${swept.periods.length === 1 ? "" : "s"} (${swept.periods.join(", ")}).${swept.truncated ? " A period hit its read limit, so run Rescan again after saving these." : ""}`)}
          </p>
        </Card>
      )}

      {loading && <CardSkeletonList rows={3} />}

      {!loading && pending.length === 0 && failures.length < PERIODS && (
        <EmptyState>
          {Object.keys(done).length > 0
            ? "Every proposal has been saved."
            : swept.emails === 0
              ? "No invoice-looking mail was found in these periods at all — which is worth checking before trusting it."
              : `Read ${swept.emails} emails, but none came from an un-indexed vendor we could match by name. The remaining vendors need an address by hand.`}
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
