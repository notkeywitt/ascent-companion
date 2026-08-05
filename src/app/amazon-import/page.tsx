"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Label,
  PageHeader,
  Select,
  Spinner,
  Toggle,
  btn,
} from "@/components/ui";
import { parseAmazonCsv, type AmazonOrder } from "@/lib/amazonImport";

interface JobRef {
  id: string;
  name: string;
  number?: string;
  customer?: string;
}
interface VendorRef {
  id: string;
  name: string;
}
interface RowSel {
  jobId: string;
  costCode: string; // CSI number ("" = uncoded)
  ym: string; // billing month, "YYYY-MM"
  include: boolean;
}
type OrderStatus = "created" | "exists" | "skipped" | "failed" | "preview";
interface OrderResult {
  orderId: string;
  status: OrderStatus;
  docId?: string;
  jobName?: string;
  amount?: number;
  coded?: boolean;
  message?: string;
}
interface PostResult {
  wrote: boolean;
  previewed: boolean;
  vendorName?: string;
  syncKicked?: boolean;
  counts: { created: number; exists: number; failed: number; preview: number };
  results: OrderResult[];
}

// A PDF pulled out of the invoice zip, matched to an order by filename.
interface PdfFile {
  name: string;
  bytes: Uint8Array;
}
// Per-order attach outcome after a push.
interface AttachState {
  ok: number;
  fail: number;
}

// Amazon order-id shape (###-#######-#######) — the same token appears in the CSV
// and (virtually always) somewhere in each invoice PDF's filename, so we match on
// it rather than on Amazon's exact naming scheme.
const ORDER_ID_RE = /\d{3}-\d{7}-\d{7}/g;

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const jobLabel = (j: JobRef) => (j.customer ? `${j.customer} — ${j.name}` : j.name);

// Last 18 months as {ym, label} options for the billing-month dropdown.
function monthOptions() {
  const opts: { ym: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 18; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    opts.push({ ym, label: d.toLocaleString("en-US", { month: "long", year: "numeric" }) });
  }
  return opts;
}

// Best-effort job guess from the PO Number the office typed at checkout. Takes
// the token before a dash ("Ferron - Masonry" → "Ferron") and finds a job whose
// customer or name contains it. The user confirms/overrides every guess.
function suggestJob(po: string, jobs: JobRef[]): string {
  const token = po.split(/[-–—/]/)[0].trim().toLowerCase();
  if (token.length < 3) return "";
  const hit = jobs.find(
    (j) =>
      (j.customer ?? "").toLowerCase().includes(token) || j.name.toLowerCase().includes(token),
  );
  return hit?.id ?? "";
}

const STATUS_STYLE: Record<OrderStatus, { label: string; cls: string }> = {
  created: { label: "Created", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" },
  exists: { label: "Already in JT", cls: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" },
  preview: { label: "Preview", cls: "bg-accent/15 text-accent dark:text-accent-soft" },
  skipped: { label: "Skipped", cls: "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" },
  failed: { label: "Failed", cls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300" },
};

export default function AmazonImportPage() {
  const [fileName, setFileName] = useState("");
  const [orders, setOrders] = useState<AmazonOrder[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [budgets, setBudgets] = useState<Record<string, Option[]>>({});
  const [budgetLoading, setBudgetLoading] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<Record<string, RowSel>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [applyMonth, setApplyMonth] = useState("");
  const [existing, setExisting] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState(false);
  const [pdfZipName, setPdfZipName] = useState("");
  const [pdfsByOrder, setPdfsByOrder] = useState<Record<string, PdfFile[]>>({});
  const [unmatchedPdfs, setUnmatchedPdfs] = useState<string[]>([]);
  const [pdfError, setPdfError] = useState("");
  const [attach, setAttach] = useState<Record<string, AttachState>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PostResult | null>(null);

  const months = useMemo(monthOptions, []);

  useEffect(() => {
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => {
        const vs: VendorRef[] = j.vendors ?? [];
        setVendors(vs);
        const amazon = vs.find((v) => /amazon/i.test(v.name));
        if (amazon) setVendorId(amazon.id);
      })
      .catch(() => {});
  }, []);

  // Fetch cost-code options for any assigned job we haven't loaded yet.
  const loadBudgets = useCallback(
    (jobIds: string[]) => {
      const need = jobIds.filter((id) => id && !(id in budgets) && !budgetLoading[id]);
      if (need.length === 0) return;
      setBudgetLoading((b) => ({ ...b, ...Object.fromEntries(need.map((id) => [id, true])) }));
      fetch(`/api/amazon-import?jobIds=${encodeURIComponent(need.join(","))}`)
        .then((r) => r.json())
        .then((j) => {
          const got: Record<string, Option[]> = j.budgets ?? {};
          setBudgets((prev) => {
            const next = { ...prev };
            for (const id of need) next[id] = got[id] ?? [];
            return next;
          });
        })
        .catch(() => {
          setBudgets((prev) => {
            const next = { ...prev };
            for (const id of need) if (!(id in next)) next[id] = [];
            return next;
          });
        })
        .finally(() =>
          setBudgetLoading((b) => {
            const next = { ...b };
            for (const id of need) delete next[id];
            return next;
          }),
        );
    },
    [budgets, budgetLoading],
  );

  // Whenever assignments change, make sure each assigned job's budget is loading.
  useEffect(() => {
    loadBudgets([...new Set(Object.values(sel).map((s) => s.jobId).filter(Boolean))]);
  }, [sel, loadBudgets]);

  function resetPdfs() {
    setPdfZipName("");
    setPdfsByOrder({});
    setUnmatchedPdfs([]);
    setPdfError("");
  }

  async function onPickFile(f: File | null) {
    setResult(null);
    setError("");
    setParseWarnings([]);
    setExisting({});
    setAttach({});
    resetPdfs(); // PDF↔order matching depends on the CSV; re-add the zip after
    if (!f) {
      setFileName("");
      setOrders([]);
      setSel({});
      return;
    }
    setFileName(f.name);
    try {
      const text = await f.text();
      const { orders: parsed, warnings } = parseAmazonCsv(text);
      setOrders(parsed);
      setParseWarnings(warnings);
      // Seed selections: auto-suggest the job, default billing month to the order month.
      const nextSel: Record<string, RowSel> = {};
      for (const o of parsed) {
        const ym =
          o.orderYear && o.orderMonth
            ? `${o.orderYear}-${String(o.orderMonth).padStart(2, "0")}`
            : months[0].ym;
        nextSel[o.orderId] = {
          jobId: suggestJob(o.poNumber, jobs),
          costCode: "",
          ym,
          include: true,
        };
      }
      setSel(nextSel);
      setApplyMonth(parsed[0] && nextSel[parsed[0].orderId] ? nextSel[parsed[0].orderId].ym : months[0].ym);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read the file.");
      setOrders([]);
      setSel({});
    }
  }

  // Re-run job suggestions once jobs finish loading (if a file was dropped first).
  useEffect(() => {
    if (jobs.length === 0 || orders.length === 0) return;
    setSel((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const o of orders) {
        const cur = next[o.orderId];
        if (cur && !cur.jobId) {
          const guess = suggestJob(o.poNumber, jobs);
          if (guess) {
            next[o.orderId] = { ...cur, jobId: guess };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [jobs, orders]);

  // Idempotency pre-check: once a report is parsed AND the vendor is known, ask
  // JobTread which of these orders are already ingested (a bill with externalId
  // AMZ-<OrderID> exists on the vendor). Flag them and deselect them so the office
  // never re-creates a bill. Re-runs if the vendor changes.
  useEffect(() => {
    if (orders.length === 0 || !vendorId) return;
    let cancelled = false;
    setChecking(true);
    fetch("/api/amazon-import/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendorId, orderIds: orders.map((o) => o.orderId) }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const ex: string[] = j.existing ?? [];
        setExisting(Object.fromEntries(ex.map((id) => [id, true])));
        if (ex.length > 0) {
          setSel((prev) => {
            const next = { ...prev };
            for (const id of ex) if (next[id]?.include) next[id] = { ...next[id], include: false };
            return next;
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orders, vendorId]);

  // Unzip an invoice zip in the browser and match each PDF to an order by the
  // Amazon order-id found in its filename. Unmatched PDFs are surfaced, never
  // guessed onto a bill. Runs entirely client-side (no upload size limit).
  async function onPickPdfZip(f: File | null) {
    setPdfError("");
    setAttach({});
    if (!f) {
      resetPdfs();
      return;
    }
    if (orders.length === 0) {
      setPdfError("Upload the CSV report first, then the PDF zip.");
      return;
    }
    setPdfZipName(f.name);
    try {
      const buf = new Uint8Array(await f.arrayBuffer());
      // Load fflate on demand — only needed when a zip is actually processed, so it stays
      // out of the amazon-import initial bundle.
      const { unzipSync } = await import("fflate");
      const entries = unzipSync(buf, {
        filter: (file) =>
          /\.pdf$/i.test(file.name) &&
          !file.name.startsWith("__MACOSX/") &&
          !file.name.split("/").pop()!.startsWith("."),
      });
      const orderIds = new Set(orders.map((o) => o.orderId));
      const byOrder: Record<string, PdfFile[]> = {};
      const unmatched: string[] = [];
      for (const [path, bytes] of Object.entries(entries)) {
        if (!bytes || bytes.length === 0) continue;
        const base = path.split("/").pop() || path;
        const ids = base.match(ORDER_ID_RE) ?? [];
        const hit = ids.find((id) => orderIds.has(id));
        if (hit) (byOrder[hit] ??= []).push({ name: base, bytes });
        else unmatched.push(base);
      }
      setPdfsByOrder(byOrder);
      setUnmatchedPdfs(unmatched);
      if (Object.keys(byOrder).length === 0) {
        setPdfError(
          "No PDF filename contained an order number from this report. Check you exported the " +
            "invoices for the same month, or rename the files to include the Amazon order id.",
        );
      }
    } catch (e) {
      resetPdfs();
      setPdfError(
        e instanceof Error ? `Couldn't read the zip: ${e.message}` : "Couldn't read the zip.",
      );
    }
  }

  // After a push, attach each created bill's matched PDF(s) to its JT document.
  // Small concurrency so we don't hammer the GCS upload flow. Attaching to JT is
  // enough — the hourly mirror files each PDF into Drive automatically.
  async function attachPdfs(created: { orderId: string; docId: string }[]) {
    const jobs = created.filter((c) => (pdfsByOrder[c.orderId]?.length ?? 0) > 0);
    if (jobs.length === 0) return;
    setAttach(Object.fromEntries(jobs.map((c) => [c.orderId, { ok: 0, fail: 0 }])));
    let i = 0;
    const worker = async () => {
      while (i < jobs.length) {
        const { orderId, docId } = jobs[i++];
        for (const pdf of pdfsByOrder[orderId] ?? []) {
          try {
            const fd = new FormData();
            fd.set("docId", docId);
            // Cast: fflate types bytes as Uint8Array<ArrayBufferLike>, which the DOM
            // File/BlobPart types don't accept directly (SharedArrayBuffer edge). Safe here.
            fd.set(
              "file",
              new File([pdf.bytes as unknown as BlobPart], pdf.name, { type: "application/pdf" }),
            );
            const res = await fetch("/api/amazon-import/attach", { method: "POST", body: fd });
            const ok = res.ok && (await res.json().catch(() => ({})))?.ok === true;
            setAttach((prev) => {
              const cur = prev[orderId] ?? { ok: 0, fail: 0 };
              return { ...prev, [orderId]: ok ? { ...cur, ok: cur.ok + 1 } : { ...cur, fail: cur.fail + 1 } };
            });
          } catch {
            setAttach((prev) => {
              const cur = prev[orderId] ?? { ok: 0, fail: 0 };
              return { ...prev, [orderId]: { ...cur, fail: cur.fail + 1 } };
            });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker));
  }

  function setRow(orderId: string, patch: Partial<RowSel>) {
    setSel((prev) => ({ ...prev, [orderId]: { ...prev[orderId], ...patch } }));
  }

  const included = orders.filter((o) => sel[o.orderId]?.include);
  const havePdfZip = pdfZipName !== "";
  const hasPdf = (orderId: string) => (pdfsByOrder[orderId]?.length ?? 0) > 0;
  // The invoice PDF is REQUIRED, not optional: nothing here can attach one to a bill
  // after the fact, and a bill with no file never reaches Drive — the hourly
  // pullJtBillPdfsToDrive has nothing to pull and reports nothing when it skips.
  // So an order is only creatable once it has a job AND a matched PDF.
  const ready = included.filter((o) => sel[o.orderId]?.jobId && hasPdf(o.orderId));
  const missingJob = included.filter((o) => !sel[o.orderId]?.jobId).length;
  const missingPdf = included.filter((o) => sel[o.orderId]?.jobId && !hasPdf(o.orderId)).length;
  const existingCount = orders.filter((o) => existing[o.orderId]).length;
  const totalReady = ready.reduce((s, o) => s + o.netTotal, 0);
  const matchedCount = orders.filter((o) => hasPdf(o.orderId)).length;
  const attachedOk = Object.values(attach).reduce((s, a) => s + a.ok, 0);
  const attachedFail = Object.values(attach).reduce((s, a) => s + a.fail, 0);
  const resultByOrder = useMemo(() => {
    const m: Record<string, OrderResult> = {};
    for (const r of result?.results ?? []) m[r.orderId] = r;
    return m;
  }, [result]);

  async function createBills() {
    if (busy || !vendorId || ready.length === 0) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const payload = {
        vendorId,
        orders: ready.map((o) => {
          const s = sel[o.orderId];
          const [y, m] = s.ym.split("-").map((x) => parseInt(x, 10));
          return {
            orderId: o.orderId,
            jobId: s.jobId,
            costCode: s.costCode || undefined,
            billingMonth: m,
            billingYear: y,
            tax: o.tax,
            amount: o.netTotal,
            lines: o.lines.map((l) => ({
              name: l.title,
              unitCost: l.ppu > 0 ? l.ppu : l.quantity ? l.subtotal / l.quantity : l.subtotal,
              quantity: l.quantity || 1,
            })),
          };
        }),
      };
      const res = await fetch("/api/amazon-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as PostResult & { error?: string };
      if (!res.ok) {
        setError(json.error ?? "Request failed.");
      } else {
        setResult(json);
        // Attach matched PDFs to the bills we just created (skip preview mode).
        if (json.wrote && havePdfZip) {
          const created = (json.results ?? [])
            .filter((r) => r.status === "created" && r.docId)
            .map((r) => ({ orderId: r.orderId, docId: r.docId! }));
          await attachPdfs(created);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  const selectedVendorName = vendors.find((v) => v.id === vendorId)?.name;

  return (
    <main className="mx-auto max-w-3xl px-4 pb-32 pt-6">
      <PageHeader
        title="Amazon Import"
        description="Upload the monthly Amazon Business order report, pick a job, cost code, and billing month for each order, then create all the JobTread bills in one push."
      />

      {orders.length === 0 ? (
        <section className="space-y-4">
          <Card>
            <Label>Amazon Business order report (CSV)</Label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-neutral-300 bg-white p-2 text-sm transition file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-accent-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink-raised"
            />
            <p className="mt-2 text-xs text-neutral-500">
              In Amazon Business: <span className="font-medium">Reports → Order history</span>, export
              a month as CSV. Each order becomes one vendor bill; the job is guessed from the PO
              Number you typed at checkout.
            </p>
          </Card>
          {error && <Banner tone="error">{error}</Banner>}
        </section>
      ) : (
        <section className="space-y-4">
          {/* Batch controls */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px] flex-1">
                <Label>Vendor</Label>
                <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                  <option value="">— pick the Amazon vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="min-w-[160px]">
                <Label>Set all billing months</Label>
                <Select
                  value={applyMonth}
                  onChange={(e) => {
                    const ym = e.target.value;
                    setApplyMonth(ym);
                    setSel((prev) => {
                      const next = { ...prev };
                      for (const id of Object.keys(next)) next[id] = { ...next[id], ym };
                      return next;
                    });
                  }}
                >
                  {months.map((m) => (
                    <option key={m.ym} value={m.ym}>
                      {m.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Invoice PDFs — REQUIRED zip, matched to orders by order id in the filename */}
            <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <Label>Invoice PDFs (zip, required)</Label>
              <input
                type="file"
                accept=".zip,application/zip"
                onChange={(e) => onPickPdfZip(e.target.files?.[0] ?? null)}
                className="block w-full rounded-lg border border-neutral-300 bg-white p-2 text-sm transition file:mr-3 file:rounded-md file:border-0 file:bg-accent/90 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-accent-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink-raised"
              />
              {pdfError ? (
                <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">{pdfError}</p>
              ) : havePdfZip ? (
                <p className="mt-1 text-xs text-neutral-500">
                  {pdfZipName} · matched {matchedCount}/{orders.length} orders
                  {unmatchedPdfs.length > 0 && ` · ${unmatchedPdfs.length} PDF(s) unmatched`}
                </p>
              ) : (
                <p className="mt-1 text-xs text-neutral-500">
                  Export the month&apos;s invoices from Amazon and drop the zip here — each PDF attaches
                  to its bill (and lands in Drive via the hourly sync). Matched by the order id in the
                  filename. Required: an order with no matched PDF can&apos;t be created, because there
                  is no way to attach one afterward from here.
                </p>
              )}
              {unmatchedPdfs.length > 0 && (
                <details className="mt-1 text-xs text-neutral-500">
                  <summary className="cursor-pointer hover:text-accent">
                    Show {unmatchedPdfs.length} unmatched file(s)
                  </summary>
                  <ul className="mt-1 space-y-0.5 pl-3">
                    {unmatchedPdfs.map((n, i) => (
                      <li key={i} className="truncate font-mono">
                        {n}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-neutral-200 pt-3 text-sm dark:border-neutral-800">
              <span className="flex items-center gap-1.5 text-neutral-500">
                {orders.length} order{orders.length === 1 ? "" : "s"} · {fileName}
                {checking && (
                  <>
                    <Spinner /> checking JobTread…
                  </>
                )}
                {!checking && existingCount > 0 && (
                  <span className="text-neutral-400">· {existingCount} already in JobTread</span>
                )}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setSel((prev) => {
                      const next = { ...prev };
                      // Don't re-arm orders already in JobTread.
                      for (const id of Object.keys(next))
                        next[id] = { ...next[id], include: !existing[id] };
                      return next;
                    })
                  }
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Select all
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setSel((prev) => {
                      const next = { ...prev };
                      for (const id of Object.keys(next)) next[id] = { ...next[id], include: false };
                      return next;
                    })
                  }
                  className="text-xs font-medium text-neutral-500 hover:underline"
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => onPickFile(null)}
                  className="text-xs font-medium text-neutral-500 hover:underline"
                >
                  New file
                </button>
              </div>
            </div>
          </Card>

          {parseWarnings.map((w, i) => (
            <Banner key={i} tone="warning">
              {w}
            </Banner>
          ))}

          {result && (
            <Banner tone={result.counts.failed > 0 || attachedFail > 0 ? "warning" : "success"}>
              {result.previewed ? (
                <>
                  Preview only — writes are OFF (COMPANION_WRITES_ENABLED not set).{" "}
                  {result.counts.preview} order(s) would be created.
                </>
              ) : (
                <>
                  Created {result.counts.created} bill(s)
                  {result.counts.exists > 0 && `, ${result.counts.exists} already in JobTread`}
                  {result.counts.failed > 0 && `, ${result.counts.failed} failed`}.
                  {havePdfZip &&
                    (attachedOk > 0 || attachedFail > 0) &&
                    ` ${attachedOk} PDF(s) attached${attachedFail > 0 ? `, ${attachedFail} failed` : ""}.`}
                  {attachedFail > 0 &&
                    " Attach the failed PDF(s) by hand in JobTread — a bill with no file never reaches Drive."}
                  {result.syncKicked && " Syncing to the sheet & Drive now."}
                </>
              )}
            </Banner>
          )}
          {error && <Banner tone="error">{error}</Banner>}

          {/* Order cards */}
          <ul className="space-y-2">
            {orders.map((o) => {
              const s = sel[o.orderId] ?? { jobId: "", costCode: "", ym: months[0].ym, include: true };
              const codeOptions = budgets[s.jobId] ?? [];
              const res = resultByOrder[o.orderId];
              const isOpen = expanded[o.orderId];
              return (
                <li key={o.orderId}>
                  <Card
                    className={`space-y-3 ${s.include ? "" : "opacity-55"}`}
                  >
                    {/* header row */}
                    <div className="flex items-start gap-3">
                      <Toggle
                        checked={s.include}
                        onChange={(v) => setRow(o.orderId, { include: v })}
                        label=""
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-semibold">{money(o.netTotal)}</span>
                          {o.poNumber && (
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent dark:text-accent-soft">
                              PO: {o.poNumber}
                            </span>
                          )}
                          {res ? (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[res.status].cls}`}
                            >
                              {STATUS_STYLE[res.status].label}
                            </span>
                          ) : (
                            existing[o.orderId] && (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE.exists.cls}`}
                              >
                                Already in JobTread
                              </span>
                            )
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">
                          {o.orderDate} · {o.lines.length} item{o.lines.length === 1 ? "" : "s"}
                          {o.tax > 0 && ` · tax ${money(o.tax)}`}
                          {o.accountUser && ` · ${o.accountUser}`}
                          {o.cardLast4 && ` · ····${o.cardLast4}`}
                        </div>
                        {havePdfZip &&
                          (() => {
                            const pdfs = pdfsByOrder[o.orderId] ?? [];
                            const att = attach[o.orderId];
                            if (att) {
                              return (
                                <div
                                  className={`mt-0.5 text-xs ${att.fail > 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400"}`}
                                >
                                  📎 {att.ok} attached{att.fail > 0 ? `, ${att.fail} failed` : ""}
                                </div>
                              );
                            }
                            if (pdfs.length > 0) {
                              return (
                                <div className="mt-0.5 truncate text-xs text-neutral-500">
                                  📎 {pdfs.length === 1 ? pdfs[0].name : `${pdfs.length} PDFs`}
                                </div>
                              );
                            }
                            return (
                              <div className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                                no PDF matched — won&apos;t be created
                              </div>
                            );
                          })()}
                        <button
                          type="button"
                          onClick={() => setExpanded((e) => ({ ...e, [o.orderId]: !e[o.orderId] }))}
                          className="mt-1 text-xs font-medium text-accent hover:underline"
                        >
                          {isOpen ? "Hide items" : "Show items"}
                        </button>
                        {isOpen && (
                          <div className="mt-1.5 space-y-1 border-l-2 border-neutral-200 pl-3 dark:border-neutral-700">
                            {o.lines.map((l, i) => (
                              <div
                                key={i}
                                className="flex items-baseline justify-between gap-2 text-xs"
                              >
                                <span className="truncate text-neutral-600 dark:text-neutral-300">
                                  {l.quantity > 1 ? `${l.quantity}× ` : ""}
                                  {l.title}
                                </span>
                                <span className="whitespace-nowrap text-neutral-500">
                                  {money(l.subtotal)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* selections */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <div>
                        <Label>Job</Label>
                        <Select
                          value={s.jobId}
                          onChange={(e) => setRow(o.orderId, { jobId: e.target.value, costCode: "" })}
                        >
                          <option value="">— pick a job —</option>
                          {jobs.map((j) => (
                            <option key={j.id} value={j.id}>
                              {jobLabel(j)}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>Cost code</Label>
                        {!s.jobId ? (
                          <div className="rounded-lg border border-dashed border-neutral-300 px-2 py-2 text-xs text-neutral-400 dark:border-neutral-700">
                            Pick a job first
                          </div>
                        ) : budgetLoading[s.jobId] ? (
                          <div className="flex items-center gap-2 rounded-lg border border-neutral-300 px-2 py-2 text-xs text-neutral-500 dark:border-neutral-600">
                            <Spinner /> Loading codes…
                          </div>
                        ) : (
                          <CostCodeSelect
                            options={codeOptions}
                            value={codeOptions.find((c) => c.number === s.costCode)?.id ?? ""}
                            onChange={(id) =>
                              setRow(o.orderId, {
                                costCode: codeOptions.find((c) => c.id === id)?.number ?? "",
                              })
                            }
                          />
                        )}
                      </div>
                      <div className="sm:w-40">
                        <Label>Billing month</Label>
                        <Select value={s.ym} onChange={(e) => setRow(o.orderId, { ym: e.target.value })}>
                          {months.map((m) => (
                            <option key={m.ym} value={m.ym}>
                              {m.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>

                    {res?.message && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">{res.message}</p>
                    )}
                    {res?.docId && (
                      <Link
                        href={`/bill/${encodeURIComponent(res.docId)}?jobId=${encodeURIComponent(s.jobId)}`}
                        className={btn("secondary", "sm")}
                      >
                        Open bill →
                      </Link>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>

          {orders.length > 0 && ready.length === 0 && (
            <EmptyState>
              Select at least one order, give it a job, and drop the invoice zip — every bill needs its
              PDF to create.
            </EmptyState>
          )}
        </section>
      )}

      {/* Sticky create bar */}
      {orders.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-ink/95">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-semibold">{ready.length}</span> bill
              {ready.length === 1 ? "" : "s"} · {money(totalReady)}
              {missingJob > 0 && (
                <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                  {missingJob} selected order{missingJob === 1 ? "" : "s"} need a job
                </span>
              )}
              {missingPdf > 0 && (
                <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">
                  {missingPdf} without a PDF — held back
                </span>
              )}
            </div>
            <Button
              size="lg"
              onClick={createBills}
              disabled={busy || !vendorId || ready.length === 0}
            >
              {busy ? (
                <>
                  <Spinner /> {result ? "Attaching PDFs…" : "Creating…"}
                </>
              ) : (
                `Create ${ready.length} bill${ready.length === 1 ? "" : "s"} in JobTread`
              )}
            </Button>
          </div>
          {!vendorId && (
            <p className="mx-auto mt-1 max-w-3xl text-xs text-amber-600 dark:text-amber-400">
              Pick the Amazon vendor above first.
            </p>
          )}
          {!havePdfZip && (
            <p className="mx-auto mt-1 max-w-3xl text-xs text-amber-600 dark:text-amber-400">
              Drop the invoice zip above — a bill can&apos;t be created without its PDF, and there is no
              way to attach one later.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
