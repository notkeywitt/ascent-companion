"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CostCodeSelect, type Option } from "@/components/CostCodeSelect";

interface Line {
  id: string;
  name?: string;
  cost?: number;
  costCode?: { number?: string; name?: string } | null;
  jobCostItem?: { id?: string } | null;
}
interface Header {
  id: string;
  name?: string;
  subject?: string;
  fromName?: string;
  status?: string;
  cost?: number;
  issueDate?: string;
}
interface FileNode {
  id: string;
  name?: string;
  type?: string;
  url?: string;
}

const money = (n?: number) =>
  typeof n === "number"
    ? "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";

const isImage = (f: FileNode) =>
  /^image\//i.test(f.type ?? "") || /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");

function BillDetail() {
  const params = useParams<{ docId: string }>();
  const search = useSearchParams();
  const docId = params.docId;
  const jobId = search.get("jobId") ?? "";

  const [header, setHeader] = useState<Header | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [budget, setBudget] = useState<Option[]>([]);
  const [files, setFiles] = useState<FileNode[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Record<string, string>>({}); // local-only (Phase B)

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/bill?docId=${encodeURIComponent(docId)}&jobId=${encodeURIComponent(jobId)}`,
        );
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) setError(json.error ?? "Request failed");
        else {
          setHeader(json.header ?? null);
          setLines(json.lines ?? []);
          setBudget(json.budget ?? []);
          setFiles(json.files ?? []);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [docId, jobId]);

  const total = lines?.reduce((s, l) => s + (l.cost ?? 0), 0) ?? 0;
  const title = header?.fromName || header?.subject || header?.name || "Vendor bill";
  const subtitle = header?.subject && header.subject !== title ? header.subject : "";

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <Link href={`/?jobId=${encodeURIComponent(jobId)}`} className="text-sm font-semibold text-accent">
        ‹ Coding queue
      </Link>

      <header className="mb-4 mt-2">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
        <p className="mt-1 font-mono text-xs text-neutral-500">
          {header?.issueDate ? header.issueDate + " · " : ""}
          {docId}
        </p>
      </header>

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Attached invoice image / PDF */}
      {files.length > 0 && (
        <div className="mb-5 space-y-2">
          {files.map((f) =>
            f.url && isImage(f) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                <img
                  src={f.url}
                  alt={f.name ?? "invoice"}
                  className="max-h-96 w-full rounded-lg border border-neutral-200 object-contain dark:border-neutral-800"
                />
              </a>
            ) : (
              <a
                key={f.id}
                href={f.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-sm hover:border-accent dark:border-neutral-800"
              >
                📄 {f.name || "View attachment"}
              </a>
            ),
          )}
        </div>
      )}

      {lines && (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-sm font-medium">
              {lines.length} {lines.length === 1 ? "line" : "lines"}
            </span>
            <span className="font-mono text-sm font-semibold">{money(total)}</span>
          </div>

          <ul className="space-y-2">
            {lines.map((l) => {
              const current = picked[l.id] ?? l.jobCostItem?.id ?? "";
              return (
                <li
                  key={l.id}
                  className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 font-medium">{l.name || "Line item"}</div>
                    <div className="font-mono text-sm font-semibold">{money(l.cost)}</div>
                  </div>
                  <div className="mt-2">
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Cost code
                    </span>
                    <CostCodeSelect
                      options={budget}
                      value={current}
                      onChange={(id) => setPicked((p) => ({ ...p, [l.id]: id }))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Read-only preview. Saving coding back to JobTread comes next (Phase B) — we&apos;ll
            wire it up after coordinating with the existing AppSheet flow.
          </p>
        </>
      )}
    </main>
  );
}

export default function BillPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <BillDetail />
    </Suspense>
  );
}
