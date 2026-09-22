"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Banner,
  Button,
  Card,
  CardSkeletonList,
  EmptyState,
  Input,
  Label,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
  Toggle,
} from "@/components/ui";

// Register vendor-bill email SENDERS for automatic import. Type the vendor's email
// address → the back end finds their newest bill in the office mailbox and shows a
// dry-run of what would be booked → pick the vendor, assign a cost code, set a
// subject pattern, and say where the job name lives (subject/body/PDF). The Apps
// Script scan then auto-logs every matching bill to the right job. All calls proxy
// through /api/email-senders to the Apps Script registry (the "Email Senders" sheet).
//
// It asks for the ADDRESS, not a link to the email, because a Gmail web URL ends in
// a permalink id ("…#all/FMfcgz…") that no Gmail API call can resolve — and the
// address is what the registry is keyed on anyway.

interface VendorOpt {
  id: string;
  name: string;
}
interface CostCodeOpt {
  code: string;
  name: string;
}
interface SenderRow {
  senderEmail: string;
  enabled: boolean;
  subjectPattern: string;
  jobSource: string;
  vendorId: string;
  costCode: string;
  addedBy?: string;
  notes?: string;
}
interface JobGuess {
  job: string;
  customer: string;
}
interface Preview {
  ok: boolean;
  sender?: string;
  fromHeader?: string;
  subject?: string;
  bodySnippet?: string;
  pdfAttachments?: { index: number; name: string }[];
  preview?: {
    bySource: { subject: JobGuess; body: JobGuess; pdf: JobGuess };
    total: number | null;
  };
  error?: string;
}

type JobSource = "subject" | "body" | "pdf";

interface FormState {
  senderEmail: string;
  subjectPattern: string;
  jobSource: JobSource;
  vendorId: string;
  costCode: string;
}

const EMPTY_FORM: FormState = {
  senderEmail: "",
  subjectPattern: "",
  jobSource: "subject",
  vendorId: "",
  costCode: "",
};

async function callSenders<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetch("/api/email-senders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n));
}

const SOURCE_LABEL: Record<JobSource, string> = {
  subject: "the email subject",
  body: "the email body",
  pdf: "the PDF attachment",
};

export default function EmailSenders() {
  const [vendors, setVendors] = useState<VendorOpt[]>([]);
  const [costCodes, setCostCodes] = useState<CostCodeOpt[]>([]);
  const [senders, setSenders] = useState<SenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Add / edit form state.
  const [lookup, setLookup] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"idle" | "form">("idle");
  const [editing, setEditing] = useState(false); // true = editing an existing row
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [ccFilter, setCcFilter] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState("");
  const [busyEmail, setBusyEmail] = useState("");

  const loadSenders = useCallback(async () => {
    const r = await callSenders<{ ok: boolean; senders?: SenderRow[]; error?: string }>({
      action: "listEmailSenders",
    });
    if (!r.ok) throw new Error(r.error || "Could not load senders.");
    setSenders(r.senders ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [v, c] = await Promise.all([
        callSenders<{ ok: boolean; vendors?: VendorOpt[]; error?: string }>({ action: "listVendors" }),
        callSenders<{ ok: boolean; costCodes?: CostCodeOpt[]; error?: string }>({ action: "listCostCodes" }),
      ]);
      if (!v.ok) throw new Error(v.error || "Could not load vendors.");
      if (!c.ok) throw new Error(c.error || "Could not load cost codes.");
      setVendors(v.vendors ?? []);
      setCostCodes(c.costCodes ?? []);
      await loadSenders();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [loadSenders]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setPreview(null);
    setLookup("");
    setMode("idle");
    setEditing(false);
    setCcFilter("");
    setResolveError("");
    setSaveError("");
  }

  // Address in → their newest bill found and dry-run → the form, prefilled.
  async function doPreview() {
    const senderEmail = lookup.trim();
    if (!senderEmail || resolving) return;
    setResolving(true);
    setResolveError("");
    setSaveOk("");
    try {
      const r = await callSenders<Preview>({ action: "previewSenderEmail", senderEmail });
      if (!r.ok) {
        setResolveError(r.error || "Could not read that email.");
        return;
      }
      setPreview(r);
      // Default the job source to the first place a job actually resolved.
      const by = r.preview?.bySource;
      const suggested: JobSource =
        by?.subject.job ? "subject" : by?.body.job ? "body" : by?.pdf.job ? "pdf" : "subject";
      setForm({
        senderEmail: r.sender || "",
        subjectPattern: r.subject || "",
        jobSource: suggested,
        vendorId: "",
        costCode: "",
      });
      setEditing(false);
      setMode("form");
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Network error");
    } finally {
      setResolving(false);
    }
  }

  function editSender(row: SenderRow) {
    setSaveOk("");
    setSaveError("");
    setResolveError("");
    setPreview(null);
    setLookup("");
    setForm({
      senderEmail: row.senderEmail,
      subjectPattern: row.subjectPattern || "",
      jobSource: (["subject", "body", "pdf"].includes(row.jobSource) ? row.jobSource : "subject") as JobSource,
      vendorId: row.vendorId || "",
      costCode: row.costCode || "",
    });
    setEditing(true);
    setMode("form");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (saving) return;
    if (!form.senderEmail || !form.vendorId || !form.costCode) {
      setSaveError("Pick a vendor and a cost code first.");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveOk("");
    try {
      const r = await callSenders<{ ok: boolean; error?: string }>({
        action: "saveEmailSender",
        senderEmail: form.senderEmail,
        subjectPattern: form.subjectPattern,
        jobSource: form.jobSource,
        vendorId: form.vendorId,
        costCode: form.costCode,
        enabled: true,
      });
      if (!r.ok) {
        setSaveError(r.error || "Save failed.");
        return;
      }
      await loadSenders();
      setSaveOk(`Saved ${form.senderEmail}. Their bills will import automatically.`);
      resetForm();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(row: SenderRow) {
    if (busyEmail) return;
    setBusyEmail(row.senderEmail);
    try {
      const r = await callSenders<{ ok: boolean; error?: string }>({
        action: "setEmailSenderEnabled",
        senderEmail: row.senderEmail,
        enabled: !row.enabled,
      });
      if (r.ok) await loadSenders();
    } catch {
      /* leave as-is on failure */
    } finally {
      setBusyEmail("");
    }
  }

  async function removeSender(row: SenderRow) {
    if (busyEmail) return;
    if (typeof window !== "undefined" && !window.confirm(`Stop auto-importing ${row.senderEmail}?`)) return;
    setBusyEmail(row.senderEmail);
    try {
      const r = await callSenders<{ ok: boolean; error?: string }>({
        action: "deleteEmailSender",
        senderEmail: row.senderEmail,
      });
      if (r.ok) await loadSenders();
    } catch {
      /* leave as-is on failure */
    } finally {
      setBusyEmail("");
    }
  }

  const filteredCostCodes = useMemo(() => {
    const q = ccFilter.trim().toLowerCase();
    if (!q) return costCodes;
    return costCodes.filter(
      (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [ccFilter, costCodes]);

  const vendorName = (id: string) => vendors.find((v) => v.id === id)?.name || id;
  const costCodeName = (code: string) => {
    const c = costCodes.find((x) => x.code === code);
    return c ? `${c.code}${c.name ? " · " + c.name : ""}` : code;
  };

  const by = preview?.preview?.bySource;
  const previewJob = by ? by[form.jobSource].job : "";
  const previewCustomer = by ? by[form.jobSource].customer : "";

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Auto-Ingest Senders"
        description="Register a vendor's email address once, and every matching bill they send imports to JobTread automatically."
        actions={
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />

      {loadError && (
        <Banner tone="error" className="mb-3">
          {loadError}
        </Banner>
      )}
      {saveOk && (
        <Banner tone="success" className="mb-3">
          {saveOk}
        </Banner>
      )}

      {/* ---------------------------------------------------------- add / edit */}
      <Card className="mb-6 p-4">
        {mode === "idle" ? (
          <>
            <Label htmlFor="sender-lookup">The vendor&apos;s email address</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="sender-lookup"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                value={lookup}
                placeholder="billing@vendor.com"
                onChange={(e) => setLookup(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void doPreview();
                }}
                disabled={resolving}
                className="min-w-0 flex-1"
              />
              <Button className="shrink-0" onClick={() => void doPreview()} disabled={!lookup.trim() || resolving}>
                {resolving ? "Reading…" : "Find their latest bill"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              We&apos;ll find their most recent bill in the office mailbox and show what it would
              book before you save anything.
            </p>
            {resolving && (
              <div className="mt-3">
                <Loading label="Finding their latest bill and testing the extraction…" />
              </div>
            )}
            {resolveError && (
              <Banner tone="error" className="mt-3">
                {resolveError}
              </Banner>
            )}
          </>
        ) : (
          <>
            {/* preview summary (add mode only) */}
            {!editing && preview && (
              <div className="mb-4 rounded-lg border border-line-soft p-3 text-sm">
                <p className="font-semibold">{preview.subject || "(no subject)"}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{preview.fromHeader}</p>
                {preview.pdfAttachments && preview.pdfAttachments.length > 0 && (
                  <p className="mt-1 text-xs text-neutral-500">
                    Attached: {preview.pdfAttachments.map((a) => a.name).join(", ")}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {(["subject", "body", "pdf"] as JobSource[]).map((s) => {
                    const g = preview.preview?.bySource[s];
                    return (
                      <div
                        key={s}
                        className="rounded border border-line-soft px-2 py-1.5"
                      >
                        <div className="uppercase tracking-wide text-neutral-400">{s}</div>
                        <div className="mt-0.5 font-medium">
                          {g?.job ? g.job : g?.customer ? `${g.customer} (job?)` : "—"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-neutral-500">
                  Invoice total read from the PDF: <span className="font-semibold">{fmtMoney(preview.preview?.total)}</span>
                </p>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label>Sender</Label>
                <Input value={form.senderEmail} readOnly className="opacity-70" />
              </div>

              <div>
                <Label htmlFor="vendor">Vendor (bills post under this JobTread vendor)</Label>
                <Select
                  id="vendor"
                  value={form.vendorId}
                  onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}
                >
                  <option value="">— select a vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="costcode">Cost code (every bill from this sender codes here)</Label>
                {costCodes.length > 12 && (
                  <Input
                    placeholder="Filter cost codes…"
                    value={ccFilter}
                    onChange={(e) => setCcFilter(e.target.value)}
                    className="mb-1.5"
                  />
                )}
                <Select
                  id="costcode"
                  value={form.costCode}
                  onChange={(e) => setForm((f) => ({ ...f, costCode: e.target.value }))}
                >
                  <option value="">— select a cost code —</option>
                  {/* keep the current pick visible even if filtered out */}
                  {form.costCode && !filteredCostCodes.some((c) => c.code === form.costCode) && (
                    <option value={form.costCode}>{costCodeName(form.costCode)}</option>
                  )}
                  {filteredCostCodes.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                      {c.name ? ` · ${c.name}` : ""}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="subject-pattern">Subject pattern (use * as a wildcard; blank = any)</Label>
                <Input
                  id="subject-pattern"
                  value={form.subjectPattern}
                  placeholder="e.g. Invoice *"
                  onChange={(e) => setForm((f) => ({ ...f, subjectPattern: e.target.value }))}
                />
              </div>

              <div>
                <Label htmlFor="job-source">Where is the job name?</Label>
                <Select
                  id="job-source"
                  value={form.jobSource}
                  onChange={(e) => setForm((f) => ({ ...f, jobSource: e.target.value as JobSource }))}
                >
                  <option value="subject">In the email subject</option>
                  <option value="body">In the email body</option>
                  <option value="pdf">In the PDF attachment</option>
                </Select>
                {!editing && preview && (
                  <p className="mt-1 text-xs text-neutral-500">
                    From {SOURCE_LABEL[form.jobSource]}, we&apos;d book this to{" "}
                    <span className="font-semibold">
                      {previewJob || (previewCustomer ? `${previewCustomer} — but the job is ambiguous` : "no job we recognize")}
                    </span>
                    .
                  </p>
                )}
              </div>

              {saveError && <Banner tone="error">{saveError}</Banner>}

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={() => void save()} disabled={saving || !form.vendorId || !form.costCode}>
                  {saving ? "Saving…" : editing ? "Save changes" : "Add sender"}
                </Button>
                <Button variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* --------------------------------------------------------- sender list */}
      <SectionHeading className="mb-2">
        Registered senders {senders.length > 0 && `(${senders.length})`}
      </SectionHeading>

      {loading && <CardSkeletonList rows={2} />}

      {!loading && !loadError && senders.length === 0 && (
        <EmptyState>No senders yet — paste a bill email above to add your first one.</EmptyState>
      )}

      {senders.length > 0 && (
        <ListCard>
          {senders.map((row) => {
            const busy = busyEmail === row.senderEmail;
            return (
              <ListRow
                key={row.senderEmail}
                chevron={false}
                label={row.senderEmail}
                desc={
                  <MetaLine
                    items={[
                      vendorName(row.vendorId),
                      costCodeName(row.costCode),
                      `Subject: ${row.subjectPattern || "any"}`,
                      `Job from ${row.jobSource}`,
                    ]}
                  />
                }
                trailing={
                  <span className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={() => editSender(row)}
                      disabled={busy}
                      className="text-xs font-semibold text-accent hover:underline disabled:opacity-40 dark:text-accent-soft"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeSender(row)}
                      disabled={busy}
                      className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-40 dark:text-red-400"
                    >
                      Delete
                    </button>
                    <Toggle
                      checked={row.enabled}
                      disabled={busy}
                      onChange={() => void toggleEnabled(row)}
                      label={row.enabled ? "On" : "Off"}
                    />
                  </span>
                }
              />
            );
          })}
        </ListCard>
      )}

    </main>
  );
}
