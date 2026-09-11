"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { JobPicker } from "@/components/JobPicker";
import { confirmLeaveIfDirty, useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { Banner, Button, Card, Label, PageHeader, Select, btn } from "@/components/ui";

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
  /** The number is already on file, but for a different amount — a revised
   *  invoice, not a re-upload. `comparison` carries both sides. */
  duplicateChanged?: boolean;
  /** Is the bill on file still in a state this page may rewrite (draft/pending)? */
  replaceable?: boolean;
  comparison?: DupeComparison;
  /** The existing bill's lines were replaced with this upload's. */
  replaced?: boolean;
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

/** One side of the duplicate comparison — what a bill costs, line by line. */
interface DupeSide {
  net: number;
  tax: number;
  total: number;
  lines: { name: string; csi: string; coded: boolean; amount: number }[];
}
interface DupeComparison {
  docId: string;
  status: string;
  priorIssueDate: string;
  existing: DupeSide;
  incoming: DupeSide;
  delta: number;
}

interface TotalsMismatch {
  message: string;
  printedAmount: number;
  printedNet: number;
  linesNet: number;
  tax: number;
  delta: number;
  lines: PreviewLine[];
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The picked invoice, rendered inline so it can be read next to a warning. */
function BillPreview({
  file,
  url,
  className = "",
}: {
  file: File;
  url: string;
  className?: string;
}) {
  const isPdf = file.type === "application/pdf";
  return (
    <div
      className={`overflow-hidden rounded-lg border border-line bg-white dark:border-neutral-800 ${className}`}
    >
      {isPdf ? (
        <iframe src={url} title="Uploaded invoice" className="h-full w-full" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Uploaded invoice" className="h-full w-full object-contain" />
      )}
    </div>
  );
}

function AddBill() {
  const search = useSearchParams();
  // The job is picked HERE. It seeds from ?jobId so the header's Add bill button
  // still lands on the job you were looking at, but the header no longer carries
  // an app-wide picker — so without one on the page there was no way to set it.
  const router = useRouter();
  const [jobId, setJobId] = useState((search.get("jobId") ?? "").trim());

  const [file, setFile] = useState<File | null>(null);
  // Idempotency key — generated ONCE per chosen file so a retry of the same
  // upload can't create a second bill in JobTread.
  const [externalId, setExternalId] = useState("");
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorId, setVendorId] = useState(""); // "" = let the extractor match
  const [singleLine, setSingleLine] = useState(false); // collapse to one cost item
  const [needVendor, setNeedVendor] = useState(""); // 422 message when unmatched
  const [mismatch, setMismatch] = useState<TotalsMismatch | null>(null); // 422 lines != invoice
  const [previewUrl, setPreviewUrl] = useState<string | null>(null); // object URL for the picked file
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AddBillResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * NO INVOICE CAME WITH THIS BILL — a phone order, a counter charge, a vendor
   * who never sends anything. There is no document to read, so the office types
   * the facts instead and the route draws the Ascent record that stands in for
   * the invoice (lib/billPdf), the same one /api/bill/create-file makes after
   * the fact. The bill is never left fileless.
   */
  const [noFile, setNoFile] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [billNumber, setBillNumber] = useState("");

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => setVendors(j.vendors ?? []))
      .catch(() => {});
  }, []);

  // Don't let a tap walk off a running upload. /api/add-bill holds the request
  // open — it is not detached like /api/employee-time — so leaving costs the
  // answer at best: the doc id, the warnings, and any question the route came
  // back with (vendor unmatched, totals mismatch, a revised duplicate) that
  // creates NOTHING until it gets an answer. A refresh or tab close is worse: it
  // aborts the connection, which can truncate the write between the bill and its
  // file, or between the new lines and the old ones on a replace.
  useUnsavedChanges(
    busy,
    "This invoice is still being read. Leaving loses the result, and can leave the bill half-written — leave anyway?",
  );

  // Free the object URL when it's replaced or the page unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Claude vision reads JPEG/PNG/GIF/WebP but NOT HEIC, which is what an iPhone
  // hands over when the camera is set to "High Efficiency". Safari can still
  // DECODE that file, so drawing it to a canvas and re-encoding gives us a JPEG
  // the reader accepts — and shrinks a 4 MB phone photo on the way. Same
  // technique the /tools serial-photo picker uses.
  //
  // Returns the original file untouched for a PDF, and for any image the browser
  // could not decode: the route then answers with the HEIC message rather than
  // this failing silently.
  async function toReadableUpload(f: File): Promise<File> {
    if (!f.type.startsWith("image/")) return f;
    try {
      const bitmap = await createImageBitmap(f);
      const scale = Math.min(1, 2200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return f;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.9),
      );
      if (!blob) return f;
      return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", {
        type: "image/jpeg",
      });
    } catch {
      return f;
    }
  }

  // The idempotency key is normally minted when a file is picked. With no file
  // to pick, it is minted when the no-invoice form is opened — same purpose,
  // same shape: one key per bill being captured, so a double-submit cannot
  // create a second bill.
  useEffect(() => {
    if (noFile) setExternalId("INV-" + crypto.randomUUID().slice(0, 8));
  }, [noFile]);

  function onPickFile(f: File | null) {
    setFile(f);
    setResult(null);
    setError("");
    setNeedVendor("");
    setMismatch(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
    setExternalId(f ? "INV-" + crypto.randomUUID().slice(0, 8) : "");
  }

  function reset() {
    onPickFile(null);
    setVendorId("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit(opts?: {
    acceptTotals?: boolean;
    forceSingleLine?: boolean;
    replaceDocId?: string;
  }) {
    if ((!file && !noFile) || !jobId || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setMismatch(null);
    try {
      const fd = new FormData();
      if (file) fd.set("file", await toReadableUpload(file));
      if (noFile) {
        fd.set("noFile", "1");
        fd.set("amount", amount);
        fd.set("description", description);
        if (billNumber.trim()) fd.set("billNumber", billNumber.trim());
      }
      fd.set("jobId", jobId);
      fd.set("externalId", externalId);
      if (vendorId) fd.set("vendorId", vendorId);
      if (singleLine || opts?.forceSingleLine) fd.set("singleLine", "1");
      if (opts?.acceptTotals) fd.set("acceptTotals", "1");
      if (opts?.replaceDocId) fd.set("replaceDocId", opts.replaceDocId);
      const res = await fetch("/api/add-bill", { method: "POST", body: fd });
      const json = await res.json();
      if (res.status === 422 && json.vendorUnresolved) {
        setNeedVendor(
          `${json.message}${json.extractedVendor ? ` (read as: "${json.extractedVendor}")` : ""}`,
        );
      } else if (res.status === 422 && json.totalsMismatch) {
        setMismatch(json as TotalsMismatch);
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
  const compare = result?.comparison;
  const wide = Boolean(((mismatch || error) && file && previewUrl) || result?.duplicateChanged);

  /** One side of the comparison: a column of lines with its own total. */
  const side = (title: string, s: DupeSide, note?: string) => (
    <div className="min-w-0 flex-1">
      <p className="text-xs font-semibold">{title}</p>
      {note && <p className="text-[11px] text-neutral-500">{note}</p>}
      <div className="mt-1.5 divide-y divide-line-soft border-t border-line-soft text-xs">
        {s.lines.map((l, i) => (
          <div key={i} className="flex items-baseline justify-between gap-2 py-1">
            <span className="min-w-0 truncate" title={l.name}>
              {l.name}
            </span>
            <span className="whitespace-nowrap text-neutral-500">
              {l.csi || "uncoded"} · {money(l.amount)}
            </span>
          </div>
        ))}
        {s.tax > 0 && (
          <div className="flex items-baseline justify-between gap-2 py-1 text-neutral-500">
            <span>Sales tax</span>
            <span className="whitespace-nowrap">{money(s.tax)}</span>
          </div>
        )}
        <div className="flex items-baseline justify-between gap-2 py-1 font-semibold">
          <span>Total</span>
          <span>{money(s.total)}</span>
        </div>
      </div>
    </div>
  );

  const mismatchBanner = mismatch ? (
      <Banner tone="warning">
        <p className="font-semibold">Line items don&apos;t match the invoice total</p>
        <p className="mt-1">{mismatch.message}</p>
        <div className="mt-2 border-t border-current/20 pt-2 text-xs">
          {mismatch.lines.map((l, i) => (
            <div key={i} className="flex items-baseline justify-between gap-2 py-0.5">
              <span className="truncate">{l.name}</span>
              <span className="whitespace-nowrap opacity-80">
                {l.csi || "uncoded"} · {money(l.unitCost * l.quantity)}
              </span>
            </div>
          ))}
          <div className="mt-1 flex items-baseline justify-between gap-2 border-t border-current/20 pt-1 font-semibold">
            <span>Extracted total</span>
            <span>{money(mismatch.linesNet)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2 font-semibold">
            <span>Invoice net (total − tax)</span>
            <span>{money(mismatch.printedNet)}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          <Button
            size="sm"
            onClick={() => submit({ acceptTotals: true, forceSingleLine: true })}
            disabled={busy}
          >
            Use invoice net — one line at {money(mismatch.printedNet)}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => submit({ acceptTotals: true })}
            disabled={busy}
          >
            Keep the extracted lines anyway ({money(mismatch.linesNet)})
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMismatch(null)} disabled={busy}>
            Cancel — I&apos;ll check the invoice
          </Button>
        </div>
      </Banner>
  ) : null;

  return (
    <main className={`mx-auto px-4 pb-24 pt-6 ${wide ? "max-w-4xl" : "max-w-xl"}`}>
      <PageHeader
        title="Add Bill"
        description={
          noFile
            ? "No invoice to upload — type what the charge was and it lands as a draft vendor bill, filed with an Ascent record in place of the missing document."
            : "Snap or upload an invoice — Claude extracts and codes it, and it lands as a draft vendor bill in the coding queue."
        }
        actions={
          /* THE WAY OUT. This page is reached from the header's + button and
             from a job, and until now the only way back was the browser's own
             Back — which the unsaved-changes guard then questions. Back where
             it came from, or Home when it was opened cold (a shared link, a
             refresh), so the button is never a dead end. */
          <button
            type="button"
            onClick={() => {
              if (!confirmLeaveIfDirty()) return;
              if (window.history.length > 1) router.back();
              else router.push(jobId ? `/trackingsheet?jobId=${encodeURIComponent(jobId)}` : "/");
            }}
            title="Close without logging a bill"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-sm font-semibold text-neutral-500 transition hover:text-accent dark:text-neutral-400"
          >
            <span aria-hidden className="text-lg leading-none">
              ✕
            </span>
            <span className="sr-only">Close</span>
          </button>
        }
      />

      {!done && (
        <section className="space-y-4">
          <div>
            <Label>Job</Label>
            <JobPicker
              value={jobId}
              onChange={setJobId}
              includeAll={false}
              placeholder="Choose a job…"
            />
            <p className="mt-1 text-xs text-neutral-500">The bill is created on this job.</p>
          </div>

          {noFile ? (
            /* NO INVOICE — the office types what the document would have said.
               Vendor comes from the picker below, which stops being optional
               here: there is nothing to match a name against. */
            <div className="space-y-4 rounded-xl border border-line bg-neutral-50 p-3 dark:bg-ink-raised/60">
              <div>
                <Label htmlFor="ab-amount">Total</Label>
                <input
                  id="ab-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="block w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm tabular-nums outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 dark:bg-ink-raised"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  What the vendor charged. It lands as one line, coded in the queue.
                </p>
              </div>
              <div>
                <Label htmlFor="ab-desc">What the charge was for</Label>
                <textarea
                  id="ab-desc"
                  rows={3}
                  value={description}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Counter charge — 40 sheets 5/8 drywall, picked up by Miguel"
                  className="block w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 dark:bg-ink-raised"
                />
                <p className="mt-1 text-xs text-neutral-500">
                  This is the record. With no invoice behind it, what you write here is the only
                  account of what was bought — it prints on the PDF filed to Drive.
                </p>
              </div>
              <div>
                <Label htmlFor="ab-num">Vendor&apos;s bill number (optional)</Label>
                <input
                  id="ab-num"
                  value={billNumber}
                  disabled={busy}
                  onChange={(e) => setBillNumber(e.target.value)}
                  placeholder="Leave blank if there isn't one"
                  className="block w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/25 dark:bg-ink-raised"
                />
              </div>
            </div>
          ) : (
            <div>
              <Label>Invoice (PDF or photo)</Label>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                disabled={busy}
                onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-lg border border-neutral-300 bg-white p-2 text-sm transition file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-accent-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 dark:border-neutral-600 dark:bg-ink-raised"
              />
              {file && previewUrl && !mismatch && !error && (
                <BillPreview file={file} url={previewUrl} className="mt-2 h-64" />
              )}
            </div>
          )}

          {/* The switch between the two ways a bill arrives. Under the input it
              replaces, because it is the answer to "I have nothing to upload". */}
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={noFile}
              disabled={busy}
              onChange={(e) => {
                setNoFile(e.target.checked);
                if (e.target.checked) onPickFile(null);
                setError("");
                setResult(null);
              }}
              className="mt-0.5 h-4 w-4 rounded border-neutral-300"
            />
            <span>
              No invoice to upload
              <span className="block text-xs text-neutral-500">
                A phone order, a counter charge, a vendor who never sends one. Type what it was and
                the bill is filed with an Ascent record in place of the invoice.
              </span>
            </span>
          </label>

          <div>
            <Label>
              Vendor{" "}
              {noFile || needVendor ? "(required)" : "(optional — matched from the invoice)"}
            </Label>
            <Select value={vendorId} disabled={busy} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">
                {noFile ? "Pick the vendor…" : "Match the vendor from the invoice"}
              </option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </Select>
            {needVendor && <p className="mt-1 text-sm text-amber-600">{needVendor}</p>}
          </div>

          <label className={`flex items-start gap-2 text-sm ${noFile ? "hidden" : ""}`}>
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

          <Button
            size="lg"
            className="w-full"
            onClick={() => submit()}
            disabled={
              !jobId ||
              busy ||
              (noFile
                ? !vendorId || !amount.trim() || !description.trim()
                : !file || (Boolean(needVendor) && !vendorId))
            }
          >
            {busy
              ? noFile
                ? "Creating the bill…"
                : "Extracting with Claude…"
              : noFile
                ? "Log Bill — no invoice"
                : "Log Bill"}
          </Button>

          {(error || mismatch) && file && previewUrl ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <BillPreview
                file={file}
                url={previewUrl}
                className="h-[60vh] lg:sticky lg:top-4 lg:h-[80vh]"
              />
              <div className="space-y-3">
                {error && <Banner tone="error">{error}</Banner>}
                {mismatchBanner}
              </div>
            </div>
          ) : (
            <>
              {error && <Banner tone="error">{error}</Banner>}
              {mismatchBanner}
            </>
          )}

        </section>
      )}

      {result && (
        <Card pad={false} className="mt-4 p-4">
          <h2 className="text-sm font-bold">
            {result.replaced
              ? "Original bill updated"
              : result.wrote
                ? "Draft bill created"
                : result.duplicateChanged
                  ? "Already saved, but with a different total"
                  : result.alreadyExisted
                    ? "Already logged — nothing created"
                    : "Preview — nothing written"}
          </h2>
          {result.message && <p className="mt-1 text-xs text-neutral-500">{result.message}</p>}

          {compare && result.duplicateChanged && (
            <div className="mt-3">
              <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">
                {side(
                  "On file in JobTread",
                  compare.existing,
                  `${compare.status || "draft"}${compare.priorIssueDate ? ` · ${compare.priorIssueDate}` : ""}`,
                )}
                {side("This upload", compare.incoming, "the revised invoice")}
              </div>
              <p className="mt-2 text-sm font-semibold">
                {compare.delta >= 0 ? "Increase" : "Decrease"} of {money(Math.abs(compare.delta))}
              </p>
              {!result.replaceable && (
                <p className="mt-1 text-sm text-amber-600">
                  The bill on file is {compare.status} — it is already in the cost reports and may sit
                  behind a client invoice, so this page won&apos;t rewrite it. Set it back to draft in
                  JobTread first, or edit it there.
                </p>
              )}
            </div>
          )}

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
            <dt className="text-neutral-500">Bill #</dt>
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
            <div className="mt-3 border-t border-line pt-2 dark:border-neutral-800">
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

          {compare && result.duplicateChanged && result.replaceable && (
            <Button
              className="mt-4 w-full"
              disabled={busy}
              onClick={() => submit({ replaceDocId: compare.docId })}
            >
              Replace the original with this invoice ({money(compare.incoming.total)})
            </Button>
          )}

          <div className="mt-2 flex gap-2">
            {result.docId && (
              <Link
                href={`/bill/${encodeURIComponent(result.docId)}?jobId=${encodeURIComponent(jobId)}`}
                className={btn(
                  result.duplicateChanged ? "secondary" : "primary",
                  "md",
                  "flex-1",
                )}
              >
                {result.wrote ? "Review coding →" : "Open the bill on file →"}
              </Link>
            )}
            <Button variant="secondary" className="flex-1" onClick={reset}>
              {result.duplicateChanged ? "Cancel this upload" : "Add another"}
            </Button>
          </div>
        </Card>
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
