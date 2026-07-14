"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

interface Rfi {
  id: number;
  jobId: string;
  subject: string;
  question: string;
  status: string;
  assignee: string;
  dueDate: string;
  dateSent: string;
  dateAnswered: string;
  answer: string;
  createdAt: string;
  updatedAt: string;
}
interface Vendor {
  id: string;
  name: string;
}

const STATUS = ["open", "answered", "closed"];
const statusClass: Record<string, string> = {
  open: "text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950/50",
  answered: "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50",
  closed: "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800",
};
const today = () => new Date().toISOString().slice(0, 10);

function Rfis() {
  const search = useSearchParams();
  const jobId = search.get("jobId") ?? "";

  const [rfis, setRfis] = useState<Rfi[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ subject: "", question: "", assignee: "", dueDate: "", dateSent: "" });

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/rfis?jobId=${encodeURIComponent(jobId)}`);
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Failed to load");
      else setRfis(json.rfis ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => setVendors(j.vendors ?? []))
      .catch(() => {});
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.subject.trim()) return;
    const res = await fetch("/api/rfis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, ...form }),
    });
    if (res.ok) {
      setForm({ subject: "", question: "", assignee: "", dueDate: "", dateSent: "" });
      setShowNew(false);
      load();
    }
  }

  async function patch(id: number, fields: Partial<Rfi>) {
    const res = await fetch(`/api/rfis/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (res.ok) {
      const json = await res.json();
      setRfis((rs) => rs.map((r) => (r.id === id ? json.rfi : r)));
    }
  }

  const vendorList = (
    <datalist id="vendors">
      {vendors.map((v) => (
        <option key={v.id} value={v.name} />
      ))}
    </datalist>
  );
  const inputCls =
    "w-full rounded-lg border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700";

  if (!jobId) {
    return (
      <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
        <h1 className="text-2xl font-bold tracking-tight">RFIs</h1>
        <p className="mt-3 text-sm text-neutral-500">
          Open a job in JobTread (or load one on the Coding Review tab) to see and create its RFIs.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      {vendorList}
      <header className="mb-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
          Ascent Companion
        </p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">RFIs</h1>
          <button
            onClick={() => setShowNew((s) => !s)}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            {showNew ? "Cancel" : "+ New RFI"}
          </button>
        </div>
        <p className="mt-0.5 font-mono text-xs text-neutral-500">job {jobId}</p>
      </header>

      {showNew && (
        <form
          onSubmit={create}
          className="mb-5 space-y-2 rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
        >
          <input
            autoFocus
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Subject (required)"
            className={inputCls}
          />
          <textarea
            value={form.question}
            onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="Question / details"
            rows={3}
            className={inputCls}
          />
          <input
            list="vendors"
            autoComplete="off"
            value={form.assignee}
            onChange={(e) => setForm({ ...form, assignee: e.target.value })}
            placeholder={vendors.length ? "Assignee (vendor)" : "Assignee (loading vendors…)"}
            className={inputCls}
          />
          <div className="grid grid-cols-2 gap-x-3 gap-y-3">
            <label className="text-xs text-neutral-500">
              Date sent
              <input
                type="date"
                value={form.dateSent}
                onChange={(e) => setForm({ ...form, dateSent: e.target.value })}
                className={inputCls}
              />
            </label>
            <label className="text-xs text-neutral-500">
              Due date
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className={inputCls}
              />
            </label>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
          >
            Create RFI
          </button>
        </form>
      )}

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {!loading && rfis.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700">
          No RFIs yet for this job.
        </div>
      )}

      <ul className="space-y-2">
        {rfis.map((r) => {
          const expanded = open === r.id;
          return (
            <li
              key={r.id}
              className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            >
              <button
                onClick={() => setOpen(expanded ? null : r.id)}
                className="flex w-full items-start justify-between gap-3 p-3 text-left"
              >
                <div className="min-w-0">
                  <div className="font-medium">
                    <span className="font-mono text-xs text-neutral-400">#{r.id}</span> {r.subject}
                  </div>
                  <div className="mt-0.5 text-xs text-neutral-500">
                    {r.assignee && <>👤 {r.assignee} </>}
                    {r.dateSent && <>· sent {r.dateSent} </>}
                    {r.dateAnswered && <>· answered {r.dateAnswered} </>}
                    {r.dueDate && !r.dateAnswered && <>· due {r.dueDate}</>}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass[r.status] ?? ""}`}
                >
                  {r.status}
                </span>
              </button>

              {expanded && (
                <div className="space-y-3 border-t border-neutral-100 p-3 dark:border-neutral-800">
                  {r.question && (
                    <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                      {r.question}
                    </p>
                  )}

                  <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                      Assignee
                      <input
                        list="vendors"
                        autoComplete="off"
                        defaultValue={r.assignee}
                        onBlur={(e) => e.target.value !== r.assignee && patch(r.id, { assignee: e.target.value })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                      Due date
                      <input
                        type="date"
                        defaultValue={r.dueDate}
                        onChange={(e) => patch(r.id, { dueDate: e.target.value })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                      Date sent
                      <input
                        type="date"
                        defaultValue={r.dateSent}
                        onChange={(e) => patch(r.id, { dateSent: e.target.value })}
                        className={inputCls}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-neutral-500">
                      Date answered
                      <input
                        type="date"
                        defaultValue={r.dateAnswered}
                        onChange={(e) => patch(r.id, { dateAnswered: e.target.value })}
                        className={inputCls}
                      />
                    </label>
                  </div>

                  <div>
                    <span className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-400">
                      Answer
                    </span>
                    <textarea
                      defaultValue={r.answer}
                      onBlur={(e) => e.target.value !== r.answer && patch(r.id, { answer: e.target.value })}
                      placeholder="Type the answer, then click away to save…"
                      rows={3}
                      className={inputCls}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">Status</span>
                    {STATUS.map((s) => (
                      <button
                        key={s}
                        onClick={() =>
                          patch(r.id, {
                            status: s,
                            ...(s === "answered" && !r.dateAnswered ? { dateAnswered: today() } : {}),
                          })
                        }
                        className={
                          "rounded-full px-2.5 py-1 text-xs font-semibold " +
                          (r.status === s
                            ? statusClass[s]
                            : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")
                        }
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export default function RfisPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Rfis />
    </Suspense>
  );
}
