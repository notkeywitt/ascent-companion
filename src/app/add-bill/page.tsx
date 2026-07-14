"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface VendorRef {
  id: string;
  name: string;
}

interface PreviewLine {
  name: string;
  csi: string;
  coded: boolean;
  unitCost: number;
  quantity: number;
}

interface AddBillResult {
  previewed?: boolean;
  wrote?: boolean;
  alreadyExisted?: boolean;
  docId?: string;
  fileAttached?: boolean;
  message?: string;
  vendor?: string;
  isSunset?: boolean;
  amount?: number;
  tax?: number;
  lineCount?: number;
  codedLines?: number;
  billingMonth?: number;
  billingYear?: number;
  issueDate?: string;
  dueDate?: string;
  externalId?: string;
  syncKicked?: boolean;
  warnings?: string[];
  lines?: PreviewLine[];
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function AddBill() {
  const search = useSearchParams();
  const jobId = (search.get("jobId") ?? "").trim();

  const [file, setFile] = useState<File | null>(null);
  // Idempotency key — generated ONCE per chosen file so a retry of the same
  // upload can't create a second bill in JobTread.
  const [externalId, setExternalId] = useState("");
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorId, setVendorId] = useState(""); // "" = let Gemini match
  const [singleLine, setSingleLine] = useState(false); // collapse to one cost item
  const [needVendor, setNeedVendor] = useState(""); // 422 message when unmatched
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AddBillResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => setVendors(j.vendors ?? []))
      .catch(() => {});
  }, []);

  function onPickFile(f: File | null) {
    setFile(f);
    setResult(null);
    setError("");
    setNeedVendor("");
    setExternalId(f ? "INV-" + crypto.randomUUID().slice(0, 8) : "");
  }

  function reset() {
    onPickFile(null);
    setVendorId("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!file || !jobId || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("jobId", jobId);
      fd.set("externalId", externalId);
      if (vendorId) fd.set("vendorId", vendorId);
      if (singleLine) fd.set("singleLine", "1");
      const res = await fetch("/api/add-bill", { method: "POST", body: fd });
      const json = await res.json();
      if (res.status === 422 && json.vendorUnresolved) {
        setNeedVendor(
          `${json.message}${json.extractedVendor ? ` (Gemini read: "${json.extractedVendor}")` : ""}`,
        );
      } else if (!res.ok) {
        setError(json.error ?? "Request failed");
      } else {
        setNeedVendor("");
        setResult(json);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  const done = result && (result.wrote || result.alreadyExisted);

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <header className="mb-5">
        <p className="text-sm text-neutral-500">
          Snap or upload an invoice — Gemini extracts and codes it, and it lands as a draft
          vendor bill in the coding queue.
        </p>
      </header>

      {!jobId && (
        <p className="mb-3 text-sm text-neutral-500">Pick a job above first — the bill is created on that job.</p>
      )}

      {!done && (
        <section className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Invoice (PDF or photo)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/*"
              disabled={busy}
              onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
              className="block w-full rounded-lg border border-neutral-300 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white dark:border-neutral-700"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Vendor {needVendor ? "(required)" : "(optional — Gemini matches it)"}
            </label>
            <select
              value={vendorId}
              disabled={busy}
              onChange={(e) => setVendorId(e.target.value)}
              className="block w-full rounded-lg border border-neutral-300 bg-transparent p-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            >
              <option value="">Let Gemini match the vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            {needVendor && <p className="mt-1 text-sm text-amber-600">{needVendor}</p>}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={singleLine}
              disabled={busy}
              onChange={(e) => setSingleLine(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-300"
            />
            <span>
              Single line — don&apos;t itemize
              <span className="block text-xs text-neutral-500">
                Collapse the whole invoice into one cost item at the net total (for bills with lots of
                lines). Code it once in the queue.
              </span>
            </span>
          </label>

          <button
            onClick={submit}
            disabled={!file || !jobId || busy || (Boolean(needVendor) && !vendorId)}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Extracting with Gemini…" : "Log Bill"}
          </button>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </section>
      )}

      {result && (
        <section className="mt-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-bold">
            {result.wrote
              ? "Draft bill created"
              : result.alreadyExisted
                ? "Already logged"
                : "Preview — nothing written"}
          </h2>
          {result.message && <p className="mt-1 text-xs text-neutral-500">{result.message}</p>}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">Vendor</dt>
            <dd className="text-right font-medium">{result.vendor ?? "—"}</dd>
            <dt className="text-neutral-500">Amount</dt>
            <dd className="text-right font-medium">{money(result.amount)}</dd>
            <dt className="text-neutral-500">Tax</dt>
            <dd className="text-right">{money(result.tax)}</dd>
            <dt className="text-neutral-500">Lines coded</dt>
            <dd className="text-right">
              {result.codedLines}/{result.lineCount}
            </dd>
            <dt className="text-neutral-500">Billing month</dt>
            <dd className="text-right">
              {result.billingMonth ? `${MONTHS[result.billingMonth - 1]} ${result.billingYear}` : "—"}
            </dd>
            <dt className="text-neutral-500">Issue date</dt>
            <dd className="text-right">{result.issueDate ?? "—"}</dd>
            <dt className="text-neutral-500">Ref</dt>
            <dd className="text-right font-mono text-xs">{result.externalId}</dd>
          </dl>

          {result.wrote && result.fileAttached === false && (
            <p className="mt-2 text-sm text-amber-600">File attach failed — add it in JobTread.</p>
          )}
          {result.wrote && result.syncKicked && (
            <p className="mt-2 text-sm text-emerald-600">
              Syncing to the sheet &amp; Drive now — it&apos;ll appear within a minute or two.
            </p>
          )}
          {(result.warnings ?? []).map((w, i) => (
            <p key={i} className="mt-2 text-sm text-amber-600">
              {w}
            </p>
          ))}

          {result.previewed && (result.lines ?? []).length > 0 && (
            <div className="mt-3 border-t border-neutral-200 pt-2 dark:border-neutral-800">
              {(result.lines ?? []).map((l, i) => (
                <div key={i} className="flex items-baseline justify-between gap-2 py-0.5 text-xs">
                  <span className="truncate">{l.name}</span>
                  <span className="whitespace-nowrap text-neutral-500">
                    {l.csi || "uncoded"}
                    {l.csi && !l.coded ? " (out of budget)" : ""} · {money(l.unitCost * l.quantity)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex gap-2">
            {result.docId && (
              <Link
                href={`/bill/${encodeURIComponent(result.docId)}?jobId=${encodeURIComponent(jobId)}`}
                className="flex-1 rounded-lg bg-accent px-4 py-2 text-center text-sm font-semibold text-white"
              >
                Review coding →
              </Link>
            )}
            <button
              onClick={reset}
              className="flex-1 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold dark:border-neutral-700"
            >
              Add another
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default function AddBillPage() {
  return (
    <Suspense>
      <AddBill />
    </Suspense>
  );
}
