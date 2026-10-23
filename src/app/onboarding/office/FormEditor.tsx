"use client";

import { useState } from "react";

import { Banner, Button, Checkbox, Dialog, QuietInput, Select, quietInputCls } from "@/components/ui";
import { PREFILL_LABELS, type FieldConfig, type FieldRole, type PrefillKey } from "@/lib/onboarding/fields";

import type { OfficeForm } from "./OnboardingOffice";

const ROLE_LABELS: Record<FieldRole, string> = {
  employee: "New hire fills",
  office: "Office fills later",
  fixed: "Always this value",
  hidden: "Leave blank",
};

/**
 * One form's field setup: what each field is called on the phone, who fills
 * it, and what it is pre-filled from. The app's first guess comes from the
 * PDF's own field names and tooltips; this is where a wrong guess is fixed.
 */
export function FormEditor({
  form,
  onClose,
  onSaved,
}: {
  form: OfficeForm;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [fields, setFields] = useState<FieldConfig[]>(form.fields);
  const [name, setName] = useState(form.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (i: number, patch: Partial<FieldConfig>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  async function save() {
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/onboarding/office/forms", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: form.id, name, fields }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  let lastPage = -1;
  return (
    <Dialog
      onClose={onClose}
      busy={busy}
      size="lg"
      pad={false}
      title="Form fields"
      description="Check the guesses. The new hire answers only the fields marked “New hire fills”."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
        </div>
      }
    >
      <div className="border-b border-line-soft px-4 py-3">
        <label className="text-xs text-neutral-500" htmlFor="fe-name">Name new hires see</label>
        <QuietInput id="fe-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      {err && <Banner tone="error" className="m-4">{err}</Banner>}
      <div className="divide-y divide-line-soft">
        {fields.map((f, i) => {
          const pageBreak = f.page !== lastPage;
          lastPage = f.page;
          return (
            <div key={f.name}>
              {pageBreak && (
                <div className="bg-neutral-100 px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:bg-white/5">
                  Page {f.page + 1}
                </div>
              )}
              <div className="space-y-2 px-4 py-3">
                <QuietInput value={f.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Label" />
                <p className="truncate text-[11px] text-neutral-400" title={f.name}>
                  {f.kind === "signature" ? "Signature · " : f.kind === "check" ? "Checkbox · " : f.kind === "choice" ? "Choice · " : ""}
                  PDF field “{f.name}”
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Select
                    className="!w-auto"
                    value={f.role}
                    onChange={(e) => set(i, { role: e.target.value as FieldRole })}
                    aria-label="Who fills it"
                  >
                    {(Object.keys(ROLE_LABELS) as FieldRole[]).map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </Select>
                  {f.role === "employee" && (f.kind === "text" || f.kind === "choice") && (
                    <Select
                      className="!w-auto"
                      value={f.prefill ?? ""}
                      onChange={(e) => set(i, { prefill: (e.target.value || undefined) as PrefillKey | undefined })}
                      aria-label="Pre-fill from"
                    >
                      <option value="">No pre-fill</option>
                      {(Object.keys(PREFILL_LABELS) as PrefillKey[]).map((k) => (
                        <option key={k} value={k}>From: {PREFILL_LABELS[k]}</option>
                      ))}
                    </Select>
                  )}
                  {f.role === "employee" && f.kind === "text" && (
                    <Checkbox checked={!!f.required} onChange={(e) => set(i, { required: e.target.checked })} label="Required" />
                  )}
                  {f.role === "employee" && !f.box && (f.kind === "text" || f.kind === "signature") && (
                    <Checkbox
                      checked={f.kind === "signature"}
                      onChange={(e) => set(i, { kind: e.target.checked ? "signature" : "text" })}
                      label="Signature goes here"
                    />
                  )}
                  {f.role === "employee" && f.kind === "check" && (
                    <input
                      className={`${quietInputCls} w-48`}
                      placeholder="Pick-one group (optional)"
                      value={f.group ?? ""}
                      onChange={(e) => set(i, { group: e.target.value || undefined })}
                      aria-label="Pick-one group"
                    />
                  )}
                  {f.role === "fixed" && (
                    <input
                      className={`${quietInputCls} min-w-0 flex-1`}
                      placeholder={f.kind === "check" ? "Any text = ticked" : "Value"}
                      value={f.value ?? ""}
                      onChange={(e) => set(i, { value: e.target.value })}
                      aria-label="Fixed value"
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
