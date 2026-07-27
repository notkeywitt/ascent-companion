"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { JobPicker } from "@/components/JobPicker";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Label,
  Loading,
  PageHeader,
  Select,
  Textarea,
  inputCls,
} from "@/components/ui";

/**
 * /requisitions — leads submit a request for the office to buy/approve something
 * for their job (materials, a rental, a sub, a misc purchase); the office tracks
 * it through its status lifecycle. One free-text description box per request (the
 * owner's chosen structure). The page adapts to `isOffice` from the API: a lead
 * sees only their own requests (read-only status), the office sees every request
 * and can change status + add office notes. No JobTread write, no email — this is
 * pure capture + tracking in the Project Database "Requisitions" tab.
 */

// A requisition row as returned by Apps Script: an object keyed by sheet header,
// values are display strings.
type Requisition = Record<string, string>;

const TYPES = ["Materials", "Rental", "Equipment", "Subcontractor", "Other"];
const PRIORITIES = ["Normal", "Urgent"];

const statusClass: Record<string, string> = {
  // "Requested" = needs attention → filled theme accent. Ordered is the accent
  // tinted; Received is done-green; Denied/Canceled are muted.
  Requested: "text-accent-fg bg-accent",
  Ordered: "text-accent bg-accent/10",
  Received: "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50",
  Denied: "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-950/40",
  Canceled: "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800",
};

function StatusBadge({ status }: { status: string }) {
  const cls = statusClass[status] ?? "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800";
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {status || "Requested"}
    </span>
  );
}

const jobLabelOf = (j: { name: string; customer?: string }) =>
  j.customer ? `${j.customer} - ${j.name}` : j.name;

function newClientKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

function Requisitions() {
  const search = useSearchParams();
  const initialJob = (search.get("jobId") ?? "").trim();

  const [rows, setRows] = useState<Requisition[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [isOffice, setIsOffice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  // Job id → label, so the submit can send a human label alongside the id (the
  // JobPicker only surfaces the id). Fetched once; cheap + browser-cached.
  const [jobMap, setJobMap] = useState<Record<string, string>>({});

  // New-request form (revealed by the header button).
  const [showNew, setShowNew] = useState(false);
  const [jobId, setJobId] = useState(initialJob);
  const [type, setType] = useState(TYPES[0]);
  const [priority, setPriority] = useState(PRIORITIES[0]);
  const [neededBy, setNeededBy] = useState("");
  const [deliverTo, setDeliverTo] = useState("");
  const [description, setDescription] = useState("");
  const [estCost, setEstCost] = useState("");
  const [clientKey, setClientKey] = useState(newClientKey);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  async function load() {
    setLoading(true);
    setLoadErr("");
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const res = await fetch(`/api/requisitions${qs}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setLoadErr(json.error || "Could not load requisitions.");
        return;
      }
      setRows(json.requisitions ?? []);
      setStatuses(json.statuses ?? []);
      setIsOffice(!!json.isOffice);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "Could not load requisitions.");
    } finally {
      setLoading(false);
    }
  }

  // Reload when the office status filter changes (and on first mount).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => {
        const map: Record<string, string> = {};
        for (const job of j.jobs ?? []) map[job.id] = jobLabelOf(job);
        setJobMap(map);
      })
      .catch(() => {});
  }, []);

  function resetForm() {
    setJobId(initialJob);
    setType(TYPES[0]);
    setPriority(PRIORITIES[0]);
    setNeededBy("");
    setDeliverTo("");
    setDescription("");
    setEstCost("");
    setClientKey(newClientKey());
    setSaveErr("");
  }

  async function submit() {
    setSaveErr("");
    if (!description.trim()) return setSaveErr("Describe what you need.");
    setSaving(true);
    try {
      const res = await fetch("/api/requisitions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          jobLabel: jobId ? jobMap[jobId] ?? "" : "",
          type,
          priority,
          neededBy,
          deliverTo: deliverTo.trim(),
          description: description.trim(),
          estCost: estCost.trim(),
          clientKey,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setSaveErr(json.error || "Submit failed.");
        return;
      }
      setShowNew(false);
      resetForm();
      load();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Submit failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Requisitions"
        description={
          isOffice
            ? "Requests from the field to buy or approve. Move each through its status."
            : "Ask the office to buy or approve something for your job."
        }
        actions={
          <Button
            onClick={() => {
              setShowNew((s) => !s);
              if (!showNew) resetForm();
            }}
          >
            {showNew ? "Cancel" : "New request"}
          </Button>
        }
      />

      {/* New-request form */}
      {showNew && (
        <Card className="mb-5 space-y-3">
          <div>
            <Label>Job (optional)</Label>
            <JobPicker value={jobId} onChange={setJobId} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={type} onChange={(e) => setType(e.target.value)}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label>What do you need?</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="e.g. Scissor lift rental for 1 week, or 40 studs + 25 sheets 5/8 drywall delivered Fri…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Needed by (optional)</Label>
              <input
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <Label>Est. cost (optional)</Label>
              <input
                type="number"
                inputMode="decimal"
                value={estCost}
                onChange={(e) => setEstCost(e.target.value)}
                placeholder="$"
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <Label>Deliver to / pick up (optional)</Label>
            <input
              value={deliverTo}
              onChange={(e) => setDeliverTo(e.target.value)}
              placeholder="Job site, the shop, an address…"
              className={inputCls}
            />
          </div>

          {saveErr && <Banner tone="error">{saveErr}</Banner>}

          <Button className="w-full" size="lg" onClick={submit} disabled={saving}>
            {saving ? "Submitting…" : "Submit request"}
          </Button>
        </Card>
      )}

      {/* Office-only status filter */}
      {isOffice && !loading && rows.length > 0 && (
        <div className="mb-3 flex items-center gap-2">
          <Label className="!mb-0">Status</Label>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="!w-auto"
          >
            <option value="">All</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      )}

      {loadErr && (
        <Banner tone="error" className="mb-3">
          {loadErr}
        </Banner>
      )}

      {loading ? (
        <Loading label="Loading requisitions…" />
      ) : rows.length === 0 ? (
        <EmptyState>
          {statusFilter
            ? `No ${statusFilter.toLowerCase()} requisitions.`
            : isOffice
              ? "No requisitions yet."
              : "You haven't submitted any requests yet. Tap “New request” to start one."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <RequisitionCard
              key={r["ReqID"]}
              r={r}
              isOffice={isOffice}
              statuses={statuses}
              onUpdated={(fresh) =>
                setRows((list) => list.map((x) => (x["ReqID"] === fresh["ReqID"] ? fresh : x)))
              }
            />
          ))}
        </ul>
      )}
    </main>
  );
}

function RequisitionCard({
  r,
  isOffice,
  statuses,
  onUpdated,
}: {
  r: Requisition;
  isOffice: boolean;
  statuses: string[];
  onUpdated: (fresh: Requisition) => void;
}) {
  const [notes, setNotes] = useState(r["Office Notes"] ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const meta = useMemo(() => {
    const bits = [
      r["Type"],
      r["Priority"] && r["Priority"] !== "Normal" ? `⚡ ${r["Priority"]}` : r["Priority"],
      r["Needed By"] ? `by ${r["Needed By"]}` : "",
      r["Est. Cost"] ? `~$${r["Est. Cost"]}` : "",
    ].filter(Boolean);
    return bits.join(" · ");
  }, [r]);

  async function patch(payload: Record<string, unknown>) {
    setErr("");
    setBusy(true);
    try {
      const res = await fetch("/api/requisitions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reqId: r["ReqID"], ...payload }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Update failed.");
        return;
      }
      if (json.requisition) onUpdated(json.requisition);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Update failed.");
    } finally {
      setBusy(false);
    }
  }

  const notesDirty = notes !== (r["Office Notes"] ?? "");

  return (
    <li>
      <Card className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{r["Job"] || "No job"}</div>
            <div className="text-xs text-neutral-500">
              {r["Requested By"] || r["Requester Email"]}
              {r["Date"] ? ` · ${r["Date"]}` : ""}
            </div>
          </div>
          <StatusBadge status={r["Status"]} />
        </div>

        <p className="whitespace-pre-wrap text-sm">{r["Description"]}</p>

        {meta && <div className="text-xs text-neutral-500">{meta}</div>}
        {r["Deliver To"] && (
          <div className="text-xs text-neutral-500">Deliver to: {r["Deliver To"]}</div>
        )}

        {/* Office notes — read-only line for a lead, editable for the office. */}
        {isOffice ? (
          <div className="space-y-2 border-t border-neutral-200 pt-2 dark:border-neutral-700/60">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="!mb-0">Status</Label>
              <Select
                value={r["Status"] || "Requested"}
                onChange={(e) => patch({ status: e.target.value })}
                disabled={busy}
                className="!w-auto"
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Office notes (PO #, vendor, ETA…)"
            />
            {notesDirty && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => patch({ officeNotes: notes })} disabled={busy}>
                  {busy ? "Saving…" : "Save notes"}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setNotes(r["Office Notes"] ?? "")}
                  disabled={busy}
                >
                  Discard
                </Button>
              </div>
            )}
          </div>
        ) : (
          r["Office Notes"] && (
            <div className="border-t border-neutral-200 pt-2 text-xs text-neutral-500 dark:border-neutral-700/60">
              <span className="font-semibold">Office:</span> {r["Office Notes"]}
            </div>
          )
        )}

        {err && <Banner tone="error">{err}</Banner>}
      </Card>
    </li>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Requisitions />
    </Suspense>
  );
}
