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
  Loading,
  PageHeader,
  Select,
  Toggle,
} from "@/components/ui";

// Register vendor-bill email SENDERS for automatic import. Paste a link to one of
// their emails → the page shows the sender/subject and a dry-run of what would be
// booked → pick the vendor, assign a cost code, set a subject pattern, and say
// where the job name lives (subject/body/PDF). The Apps Script scan then auto-logs
// every matching bill to the right job. All calls proxy through /api/email-senders
// to the Apps Script registry (the "Email Senders" sheet).

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
  jobPattern: string;
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
  jobPattern: string;
  vendorId: string;
  costCode: string;
}

const EMPTY_FORM: FormState = {
  senderEmail: "",
  subjectPattern: "",
  jobSource: "subject",
  jobPattern: "",
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
  const [link, setLink] = useState("");
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<"idle" | "form">("idle");
  const [editing, setEditing] = useState(false); // true = editing an existing row
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    setLink("");
    setMode("idle");
    setEditing(false);
    setShowAdvanced(false);
    setCcFilter("");
    setResolveError("");
    setSaveError("");
  }

  // Paste a link → resolve the email + show what would be booked, then prefill.
  async function doPreview() {
    const gmailLink = link.trim();
    if (!gmailLink || resolving) return;
    setResolving(true);
    setResolveError("");
    setSaveOk("");
    try {
      const r = await callSenders<Preview>({ action: "resolveEmailLink", gmailLink });
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
        jobPattern: "",
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
    setLink("");
    setForm({
      senderEmail: row.senderEmail,
      subjectPattern: row.subjectPattern || "",
      jobSource: (["subject", "body", "pdf"].includes(row.jobSource) ? row.jobSource : "subject") as JobSource,
      jobPattern: row.jobPattern || "",
      vendorId: row.vendorId || "",
      costCode: row.costCode || "",
    });
    setShowAdvanced(!!row.jobPattern);
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
        jobPattern: showAdvanced ? form.jobPattern : "",
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
            <Label htmlFor="email-link">Paste a link to one of their bill emails</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="email-link"
                value={link}
                placeholder="https://mail.google.com/mail/u/0/#inbox/…"
                onChange={(e) => setLink(e.target.value)}
                disabled={resolving}
                className="min-w-0 flex-1"
              />
              <Button className="shrink-0" onClick={() => void doPreview()} disabled={!link.trim() || resolving}>
                {resolving ? "Reading…" : "Preview"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Open the email in Gmail and copy its URL. We&apos;ll read the sender and subject and show
              what would be booked before you save anything.
            </p>
            {resolving && (
              <div className="mt-3">
                <Loading label="Reading the email and testing the extraction…" />
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
              <div className="mb-4 rounded-lg bg-neutral-50 p-3 text-sm dark:bg-neutral-800/40">
                <p className="font-semibold">{preview.subject || "(no subject)"}</p>
                <p className="mt-0.5 text-xs text-neutral-500">{preview.fromHeader}</p>
                {preview.pdfAttachments && preview.pdfAttachments.length > 0 && (
                  <p className="mt-1 text-xs text-neutral-500">
                    📎 {preview.pdfAttachments.map((a) => a.name).join(", ")}
                  </p>
                )}
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  {(["subject", "body", "pdf"] as JobSource[]).map((s) => {
                    const g = preview.preview?.bySource[s];
                    return (
                      <div
                        key={s}
                        className="rounded border border-neutral-200 px-2 py-1.5 dark:border-neutral-700/60"
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
                <Input value={form.senderEmail} readOnly className="bg-neutral-50 dark:bg-neutral-800/40" />
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

              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="text-xs font-semibold text-accent hover:underline dark:text-accent-soft"
                >
                  {showAdvanced ? "Hide" : "Show"} advanced (job pattern)
                </button>
                {showAdvanced && (
                  <div className="mt-2">
                    <Label htmlFor="job-pattern">
                      Job pattern — a regular expression to pull the job name out (group 1). Optional.
                    </Label>
                    <Input
                      id="job-pattern"
                      value={form.jobPattern}
                      placeholder="e.g. Project:\s*(.+)"
                      onChange={(e) => setForm((f) => ({ ...f, jobPattern: e.target.value }))}
                    />
                    <p className="mt-1 text-xs text-neutral-500">
                      Leave blank to search the whole {SOURCE_LABEL[form.jobSource]} for a job name.
                    </p>
                  </div>
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
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        Registered senders {senders.length > 0 && `(${senders.length})`}
      </h2>

      {loading && <CardSkeletonList rows={2} />}

      {!loading && !loadError && senders.length === 0 && (
        <EmptyState>No senders yet — paste a bill email above to add your first one.</EmptyState>
      )}

      <ul className="space-y-2">
        {senders.map((row) => {
          const busy = busyEmail === row.senderEmail;
          return (
            <li key={row.senderEmail}>
              <Card className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{row.senderEmail}</p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      {vendorName(row.vendorId)} · {costCodeName(row.costCode)}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-500">
                      Subject: {row.subjectPattern || "any"} · Job from {row.jobSource}
                    </p>
                  </div>
                  <Toggle
                    checked={row.enabled}
                    disabled={busy}
                    onChange={() => void toggleEnabled(row)}
                    label={row.enabled ? "On" : "Off"}
                  />
                </div>
                <div className="mt-2 flex items-center gap-3">
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
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
