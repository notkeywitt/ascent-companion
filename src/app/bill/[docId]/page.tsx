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
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

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

  // Lines whose picked code differs from what's currently saved in JobTread.
  const pending = (lines ?? []).flatMap((l) => {
    const sel = picked[l.id];
    return sel && sel !== (l.jobCostItem?.id ?? "")
      ? [{ costItemId: l.id, jobCostItemId: sel }]
      : [];
  });

  async function saveCoding() {
    if (pending.length === 0) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch("/api/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: pending }),
      });
      const json = await res.json();
      if (!res.ok) setSaveMsg(json.error ?? "Save failed");
      else if (json.previewed)
        setSaveMsg(
          `Preview only — writes are OFF. ${pending.length} line(s) would be recoded in JobTread.`,
        );
      else {
        const ok = (json.results ?? []).filter((r: { ok: boolean }) => r.ok).length;
        const bad = (json.results ?? []).length - ok;
        setSaveMsg(`Saved ${ok} line(s)${bad ? `, ${bad} failed` : ""}.`);
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

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
        {jobId && (
          <a
            href={`https://app.jobtread.com/jobs/${jobId}/documents/${docId}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent"
          >
            Open in JobTread ↗
          </a>
        )}
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

          <div className="mt-6 space-y-2">
            <button
              type="button"
              onClick={saveCoding}
              disabled={saving || pending.length === 0}
              className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {saving
                ? "Saving…"
                : pending.length
                  ? `Save coding (${pending.length})`
                  : "No changes to save"}
            </button>
            {saveMsg && (
              <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs dark:bg-neutral-800">
                {saveMsg}
              </p>
            )}
            <p className="rounded-lg bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Writes are OFF by default. Until we coordinate with the existing AppSheet→JobTread
              flow, Save shows a preview and sends nothing (enable with
              <span className="font-mono"> COMPANION_WRITES_ENABLED=true</span>).
            </p>
          </div>
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
