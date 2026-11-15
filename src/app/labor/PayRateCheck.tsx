"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toast";
import { Banner, Button, EmptyState, Loading } from "@/components/ui";
import {
  findMismatches,
  unmappedPairs,
  type JobCodeRate,
  type RateEntry,
} from "@/lib/laborRateMatch";

interface Member {
  userId: string;
  types: { name: string }[];
}

/**
 * The pay-rate check. Each job pays each cost code at one pay type (the map,
 * table job_code_rates). This lists the period's entries that carry another
 * type and offers two fixes per entry, each its own press:
 *   - "Fix the entry" sets the entry's pay type to the map's (POST
 *     /api/time-entry, which re-rates it in JobTread);
 *   - "Map it to this" changes the map to what the entry used.
 * A job + code with no map row lists the types in use; one press adds the row.
 * Nothing changes until a button is pressed.
 */
export function PayRateCheck({
  entries,
  periodLabel,
  writes,
  onChanged,
  onClose,
}: {
  entries: RateEntry[];
  periodLabel: string;
  writes: boolean;
  /** An entry was re-rated in JobTread, so the page should re-read the period. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [map, setMap] = useState<JobCodeRate[] | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    fetch("/api/labor/rate-map", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => (b.error ? setError(b.error) : setMap(b.rates as JobCodeRate[])))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load the map"));
    // Who holds which pay type, so a fix the person cannot take is not offered.
    fetch("/api/labor-rates/members", { cache: "no-store" })
      .then((r) => r.json())
      .then((b) => setMembers((b.members ?? []) as Member[]))
      .catch(() => {});
  }, []);

  const mismatches = useMemo(() => (map ? findMismatches(entries, map) : []), [entries, map]);
  const unmapped = useMemo(() => (map ? unmappedPairs(entries, map) : []), [entries, map]);

  const saveMap = useCallback(
    async (rate: JobCodeRate) => {
      setBusy(`${rate.jobId}|${rate.costCode}`);
      try {
        const r = await fetch("/api/labor/rate-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rate),
        });
        const b = await r.json();
        if (b.error) return toast(b.error, { tone: "error" });
        setMap((m) => [
          ...(m ?? []).filter((x) => !(x.jobId === rate.jobId && x.costCode === rate.costCode)),
          rate,
        ]);
        toast("Map updated.");
      } finally {
        setBusy("");
      }
    },
    [],
  );

  async function fixEntry(e: RateEntry, type: string) {
    setBusy(e.id);
    try {
      const r = await fetch("/api/time-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: e.id, type }),
      });
      const b = await r.json();
      if (b.error) toast(b.error, { tone: "error" });
      else if (b.previewed) toast(b.message, { tone: "error" });
      else {
        toast("Fixed in JobTread.");
        onChanged();
      }
    } finally {
      setBusy("");
    }
  }

  const lacks = (e: RateEntry, type: string) => {
    const m = members.find((x) => x.userId === e.userId);
    return Boolean(m && !m.types.some((t) => t.name === type));
  };

  return (
    <Dialog label="Check pay rates" title="Check pay rates" size="xl" onClose={onClose}>
      <p className="mb-3 text-xs text-neutral-500">
        {periodLabel} · {entries.length} entries checked against each job&apos;s cost code pay types.
      </p>
      {error && (
        <Banner tone="error" className="mb-3">
          {error}
        </Banner>
      )}
      {!writes && (
        <Banner tone="warning" className="mb-3">
          Writes are off, so fixes to entries are not sent to JobTread.
        </Banner>
      )}
      {!map ? (
        <Loading label="Reading the map…" />
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-1 text-sm font-semibold">Mismatches ({mismatches.length})</h3>
            {mismatches.length === 0 ? (
              <EmptyState>Every mapped pair in this period uses its pay type.</EmptyState>
            ) : (
              <ul className="divide-y divide-line-soft">
                {mismatches.map(({ entry: e, expected }) => (
                  <li key={e.id} className="space-y-1.5 py-2 text-sm">
                    <p>
                      <span className="font-semibold">{e.employee}</span> · {e.date} · {e.jobName} · {e.code} ·{" "}
                      {e.hours.toFixed(2)}h
                    </p>
                    <p className="text-xs text-neutral-600 dark:text-neutral-300">
                      Used <b>{e.type || "no pay type"}</b>. The map says <b>{expected}</b>.
                    </p>
                    {lacks(e, expected) && (
                      <p className="text-xs text-warn">
                        {e.employee} has no &ldquo;{expected}&rdquo; pay type yet. Add it on Pay Rates first.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="xs"
                        onClick={() => void fixEntry(e, expected)}
                        disabled={!writes || busy === e.id || lacks(e, expected)}
                      >
                        Fix the entry
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={() =>
                          void saveMap({ jobId: e.jobId, jobName: e.jobName, costCode: e.code, payType: e.type })
                        }
                        disabled={!e.type || busy === `${e.jobId}|${e.code}`}
                      >
                        Map it to this
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-1 text-sm font-semibold">Not in the map yet ({unmapped.length})</h3>
            {unmapped.length === 0 ? (
              <EmptyState>Every job and cost code in this period has a mapped pay type.</EmptyState>
            ) : (
              <ul className="divide-y divide-line-soft">
                {unmapped.map((p) => (
                  <li key={`${p.jobId}|${p.costCode}`} className="space-y-1.5 py-2 text-sm">
                    <p>
                      <span className="font-semibold">{p.jobName}</span> · {p.costCode}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {p.types.map((t) => (
                        <Button
                          key={t.payType}
                          size="xs"
                          variant="secondary"
                          disabled={busy === `${p.jobId}|${p.costCode}`}
                          onClick={() =>
                            void saveMap({
                              jobId: p.jobId,
                              jobName: p.jobName,
                              costCode: p.costCode,
                              payType: t.payType,
                            })
                          }
                        >
                          Map to {t.payType} ({t.count})
                        </Button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
