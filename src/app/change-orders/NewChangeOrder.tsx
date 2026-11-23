"use client";

import { useEffect, useMemo, useState } from "react";

import { Dialog } from "@/components/Dialog";
import { toast } from "@/components/Toast";
import { Banner, Button, Checkbox, IconButton, Input, Label, Loading, Select, Textarea } from "@/components/ui";
import { checkCo, coTotals, priceOf, type CoInput, type CoLineInput } from "@/lib/changeOrders";
import { money } from "@/lib/money";

type Form = {
  markup: number;
  taxRate: number;
  codes: { id: string; number: string; name: string }[];
  costTypes: { id: string; name: string }[];
  defaultCostTypeId: string;
  writes: boolean;
};
type Line = { key: number; costCodeId: string; costTypeId: string; name: string; description: string; cost: string; isTaxable: boolean };

let nextKey = 1;
const blank = (costTypeId: string): Line => ({
  key: nextKey++,
  costCodeId: "",
  costTypeId,
  name: "",
  description: "",
  cost: "",
  isTaxable: true,
});

/**
 * New CO: a draft change order in JobTread (POST /api/change-orders). The job
 * is fixed on the Jobs page's tab, picked here on /change-orders.
 */
export function NewChangeOrder({
  jobId: fixedJob,
  jobs,
  onClose,
  onCreated,
}: {
  jobId?: string;
  jobs: { id: string; label: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [jobId, setJobId] = useState(fixedJob ?? "");
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState("");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [markupPct, setMarkupPct] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    setForm(null);
    setFormError("");
    fetch(`/api/change-orders/form?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) return setFormError(d.error);
        setForm(d);
        setMarkupPct(String(Math.round((d.markup - 1) * 10000) / 100));
        setLines((ls) => (ls.length ? ls : [blank(d.defaultCostTypeId)]));
      })
      .catch(() => !cancelled && setFormError("Could not load the job."));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const markup = 1 + (Number(markupPct) || 0) / 100;
  const codeById = useMemo(() => new Map((form?.codes ?? []).map((c) => [c.id, c])), [form]);
  const input: CoInput = {
    jobId,
    title,
    reason,
    markup,
    lines: lines.map(
      (l): CoLineInput => ({
        costCodeId: l.costCodeId,
        code: codeById.get(l.costCodeId)?.number ?? "",
        codeName: codeById.get(l.costCodeId)?.name ?? "",
        costTypeId: l.costTypeId,
        name: l.name,
        description: l.description,
        cost: Number(l.cost),
        isTaxable: l.isTaxable,
      }),
    ),
  };
  const problems = checkCo(input);
  const totals = coTotals(input, form?.taxRate ?? 0);
  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function create() {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/change-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (d.error) return setError(d.error);
      if (!d.wrote) return setError("JobTread writes are off here. Nothing was created.");
      toast(`CO #${d.number} created`, { action: { label: "Open", onClick: () => window.open(d.url, "_blank", "noopener") } });
      onCreated();
    } catch {
      setError("Could not reach the app. Nothing was created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="New CO"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <div className="flex w-full items-center gap-2">
          <span className="min-w-0 flex-1 text-sm tabular-nums">
            {form && (
              <>
                <span className="font-semibold">{money(totals.total)}</span>{" "}
                <span className="text-neutral-500">
                  {money(totals.price)} + tax {money(totals.tax)}
                </span>
              </>
            )}
          </span>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy || !form}>
            {busy ? "Creating…" : "Create draft"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {!fixedJob && (
          <div>
            <Label htmlFor="nco-job">Job</Label>
            <Select id="nco-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">Pick a job…</option>
              {[...jobs]
                .sort((a, b) => a.label.localeCompare(b.label))
                .map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.label}
                  </option>
                ))}
            </Select>
          </div>
        )}

        {formError && <Banner tone="error">{formError}</Banner>}
        {jobId && !form && !formError && <Loading />}

        {form && (
          <>
            <div>
              <Label htmlFor="nco-title">Title</Label>
              <Input id="nco-title" value={title} maxLength={128} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="nco-reason">Reason</Label>
              <Textarea id="nco-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <div className="w-32">
              <Label htmlFor="nco-markup">Markup %</Label>
              <Input
                id="nco-markup"
                inputMode="decimal"
                value={markupPct}
                onChange={(e) => setMarkupPct(e.target.value)}
              />
            </div>

            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-card border border-line p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-semibold">Line {i + 1}</span>
                    {lines.length > 1 && (
                      <IconButton label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        ✕
                      </IconButton>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>
                      <Label htmlFor={`nco-code-${l.key}`}>Cost code</Label>
                      <Select id={`nco-code-${l.key}`} value={l.costCodeId} onChange={(e) => set(l.key, { costCodeId: e.target.value })}>
                        <option value="">Pick…</option>
                        {form.codes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.number} {c.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={`nco-type-${l.key}`}>Cost type</Label>
                      <Select id={`nco-type-${l.key}`} value={l.costTypeId} onChange={(e) => set(l.key, { costTypeId: e.target.value })}>
                        {form.costTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label htmlFor={`nco-name-${l.key}`}>Item</Label>
                    <Input id={`nco-name-${l.key}`} value={l.name} onChange={(e) => set(l.key, { name: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`nco-desc-${l.key}`}>Notes</Label>
                    <Textarea id={`nco-desc-${l.key}`} rows={2} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-36">
                      <Label htmlFor={`nco-cost-${l.key}`}>Cost</Label>
                      <Input id={`nco-cost-${l.key}`} inputMode="decimal" value={l.cost} onChange={(e) => set(l.key, { cost: e.target.value })} />
                    </div>
                    <div className="pb-3 text-sm tabular-nums">
                      <span className="text-neutral-500">Price </span>
                      {money(priceOf(Number(l.cost) || 0, markup))}
                    </div>
                    <Checkbox
                      className="pb-3"
                      label="Taxable"
                      checked={l.isTaxable}
                      onChange={(e) => set(l.key, { isTaxable: e.target.checked })}
                    />
                  </div>
                </div>
              ))}
              <Button variant="secondary" onClick={() => setLines((ls) => [...ls, blank(form.defaultCostTypeId)])}>
                Add line
              </Button>
            </div>

            {!form.writes && <Banner tone="warning">JobTread writes are off here.</Banner>}
          </>
        )}

        {tried && problems.length > 0 && <Banner tone="error">{problems.join(" ")}</Banner>}
        {error && <Banner tone="error">{error}</Banner>}
      </div>
    </Dialog>
  );
}
