"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  Input,
  Label,
  Loading,
  MetaLine,
  PageHeader,
  QuietInput,
  SectionHeading,
  StatementBlock,
  StickyActionBar,
  btn,
} from "@/components/ui";
import { money } from "@/lib/money";
import { orgDay } from "@/lib/orgTime";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { checkPhotoName, longDate } from "@/lib/depositTracker";
import type { OpenInvoiceRow, RecordedPayment } from "@/lib/jobtread";
import { shrinkPhoto, takePendingPhotos } from "./pendingPhotos";

/**
 * DEPOSIT CHECKS — three screens, one deposit.
 *
 *   1. Photos. Home's button took the first photo; "Add a check" takes more.
 *      "Save to JobTread" files each photo on the Office job, folder Deposits.
 *   2. Invoices. Every open client invoice; tick the ones the checks pay and
 *      set the amount (the balance by default). "Mark paid" records the
 *      payments in JobTread, then drafts the email to Sara and Casey.
 *   3. Done. What each invoice owes now, and the link to the draft.
 *
 * `key` is minted once per deposit: the record route uses it to find payments
 * an earlier press already made, so pressing twice never pays twice.
 */

type Step = "photos" | "invoices" | "done";

interface Photo {
  id: string;
  file: File;
  preview: string;
  saved?: { id: string; name: string; folder: string | null };
  error?: string;
}

const today = () => orgDay(new Date().toISOString());
const newKey = () => crypto.randomUUID();
const shortDate = (ymd: string) => (ymd ? longDate(ymd) : "");

async function errorOf(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string } | null;
  return j?.error || `HTTP ${res.status}`;
}

export function DepositTracker({ writes }: { writes: boolean }) {
  const [step, setStep] = useState<Step>("photos");
  const [key, setKey] = useState(newKey);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const camera = useRef<HTMLInputElement>(null);

  // Step 2
  const [invoices, setInvoices] = useState<OpenInvoiceRow[] | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // invoice id → amount typed
  const [date, setDate] = useState(today);
  const [reference, setReference] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Step 3
  const [payments, setPayments] = useState<RecordedPayment[]>([]);
  const [draft, setDraft] = useState<{ url: string; subject: string } | null>(null);
  const [emailError, setEmailError] = useState("");

  useUnsavedChanges(
    !!busy || (step !== "done" && photos.some((p) => p.saved)),
    "The check photos are in JobTread, but no invoice is marked paid yet. Leave anyway?",
  );

  // The photos Home took on the way in.
  useEffect(() => {
    const first = takePendingPhotos();
    if (first.length) addPhotos(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Free the previews when the page goes.
  const previews = useRef<string[]>([]);
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function addPhotos(files: File[]) {
    const added = files.map((file) => {
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      return { id: crypto.randomUUID(), file, preview };
    });
    setPhotos((p) => [...p, ...added]);
  }

  function removePhoto(id: string) {
    setPhotos((p) => p.filter((x) => x.id !== id));
  }

  async function savePhotos() {
    setError("");
    setBusy("Saving the photos to JobTread…");
    const stamp = today();
    const list = [...photos];
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.saved) continue;
      try {
        const name = checkPhotoName(stamp, i, list.length);
        const jpeg = await shrinkPhoto(p.file, name);
        const form = new FormData();
        form.append("file", jpeg);
        form.append("name", name);
        const res = await fetch("/api/deposit-tracker/photo", { method: "POST", body: form });
        if (!res.ok) throw new Error(await errorOf(res));
        const { file } = (await res.json()) as { file: Photo["saved"] };
        list[i] = { ...p, saved: file, error: undefined };
      } catch (e) {
        failed++;
        list[i] = { ...p, error: e instanceof Error ? e.message : "Upload failed" };
      }
      setPhotos([...list]);
    }
    setBusy("");
    if (failed) {
      setError(`${failed} photo${failed === 1 ? "" : "s"} did not save. Press Save again to retry.`);
      return;
    }
    setStep("invoices");
    loadInvoices();
  }

  async function loadInvoices() {
    setInvoices(null);
    try {
      const res = await fetch("/api/deposit-tracker/invoices");
      if (!res.ok) throw new Error(await errorOf(res));
      setInvoices(((await res.json()) as { invoices: OpenInvoiceRow[] }).invoices);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the invoices.");
      setInvoices([]);
    }
  }

  const byId = useMemo(() => new Map((invoices ?? []).map((i) => [i.id, i])), [invoices]);
  const lines = Object.entries(picked).map(([invoiceId, amount]) => ({ invoiceId, amount: Number(amount) }));
  const total = lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? Math.round(l.amount * 100) : 0), 0) / 100;
  const badAmount = lines.some((l) => {
    const inv = byId.get(l.invoiceId);
    return !Number.isFinite(l.amount) || l.amount <= 0 || (!!inv && Math.round(l.amount * 100) > Math.round(inv.balance * 100));
  });

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = new Map<string, OpenInvoiceRow[]>();
    for (const inv of invoices ?? []) {
      const hit =
        !q ||
        picked[inv.id] !== undefined ||
        `${inv.customerName} ${inv.jobName} ${inv.number}`.toLowerCase().includes(q);
      if (!hit) continue;
      const k = inv.customerName || "No customer";
      out.set(k, [...(out.get(k) ?? []), inv]);
    }
    return [...out];
  }, [invoices, filter, picked]);

  function toggle(inv: OpenInvoiceRow) {
    setPicked((p) => {
      const next = { ...p };
      if (next[inv.id] !== undefined) delete next[inv.id];
      else next[inv.id] = inv.balance.toFixed(2);
      return next;
    });
  }

  async function markPaid() {
    setConfirming(false);
    setError("");
    setBusy("Recording the payments in JobTread…");
    try {
      const res = await fetch("/api/deposit-tracker/record", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, date, reference, lines }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      setPayments(((await res.json()) as { payments: RecordedPayment[] }).payments);
    } catch (e) {
      setBusy("");
      setError(e instanceof Error ? e.message : "Recording the payments failed.");
      return;
    }
    setStep("done");
    await draftEmail();
  }

  async function draftEmail() {
    setEmailError("");
    setBusy("Drafting the email to Sara and Casey…");
    try {
      const res = await fetch("/api/deposit-tracker/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          date,
          reference,
          lines,
          fileIds: photos.map((p) => p.saved?.id).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      const j = (await res.json()) as { draftUrl: string; subject: string };
      setDraft({ url: j.draftUrl, subject: j.subject });
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : "The draft was not saved.");
    } finally {
      setBusy("");
    }
  }

  function startOver() {
    previews.current.forEach((u) => URL.revokeObjectURL(u));
    previews.current = [];
    setStep("photos");
    setKey(newKey());
    setPhotos([]);
    setPicked({});
    setFilter("");
    setReference("");
    setDate(today());
    setPayments([]);
    setDraft(null);
    setEmailError("");
    setError("");
  }

  const cameraInput = (
    <input
      ref={camera}
      type="file"
      accept="image/*"
      capture="environment"
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = "";
        if (files.length) addPhotos(files);
      }}
    />
  );

  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-32 pt-3">
      <PageHeader
        title="Deposit checks"
        description={
          step === "photos"
            ? "Photograph each check. The photos go to the Office job in JobTread, folder Deposits."
            : step === "invoices"
              ? "Select the invoices the checks pay. Each one is marked paid in JobTread."
              : "Recorded in JobTread."
        }
      />
      {!writes && (
        <Banner tone="warning" className="mb-4">
          JobTread writes are off in this app, so nothing can be saved.
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}
      {cameraInput}

      {step === "photos" && (
        <>
          {photos.length === 0 ? (
            <EmptyState>No check photographed yet.</EmptyState>
          ) : (
            <div className="grid grid-cols-2 gap-2 pad:grid-cols-3">
              {photos.map((p, i) => (
                <Card key={p.id} pad={false} className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.preview} alt={`Check ${i + 1}`} className="aspect-[4/3] w-full object-cover" />
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <MetaLine
                      items={[
                        `Check ${i + 1}`,
                        p.saved ? <span className="text-ok">Saved</span> : p.error ? <span className="text-danger">Not saved</span> : null,
                      ]}
                    />
                    {!p.saved && !busy && (
                      <Button size="xs" variant="ghost" onClick={() => removePhoto(p.id)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
          <Button variant="outline" className="mt-3 w-full" disabled={!!busy} onClick={() => camera.current?.click()}>
            {photos.length ? "Add a check" : "Take a photo"}
          </Button>
          {photos.length > 0 && (
            <StickyActionBar>
              <span className="text-sm text-neutral-500">{busy || `${photos.length} photo${photos.length === 1 ? "" : "s"}`}</span>
              <Button className="ml-auto" disabled={!writes || !!busy} onClick={savePhotos}>
                Save to JobTread
              </Button>
            </StickyActionBar>
          )}
        </>
      )}

      {step === "invoices" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="dep-date">Date received</Label>
              <Input id="dep-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="dep-ref">Check numbers</Label>
              <Input id="dep-ref" placeholder="Optional" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
          </div>
          <Input
            type="search"
            placeholder="Find a customer, job or invoice #"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-3"
          />
          {invoices === null ? (
            <Loading label="Reading open invoices…" />
          ) : groups.length === 0 ? (
            <EmptyState>{filter ? "No open invoice matches." : "No client invoice is waiting on a payment."}</EmptyState>
          ) : (
            <div className="space-y-4">
              {groups.map(([customer, rows]) => (
                <section key={customer}>
                  <SectionHeading className="mb-2">{customer}</SectionHeading>
                  <Card pad={false} className="divide-y divide-line-soft">
                    {rows.map((inv) => {
                      const on = picked[inv.id] !== undefined;
                      const amt = Number(picked[inv.id]);
                      const over = on && Math.round(amt * 100) > Math.round(inv.balance * 100);
                      return (
                        <div key={inv.id} className="px-3 py-2.5">
                          <label className="flex cursor-pointer items-start gap-3">
                            <Checkbox checked={on} onChange={() => toggle(inv)} className="mt-0.5" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">
                                #{inv.number} · {inv.jobName}
                              </span>
                              <MetaLine
                                items={[
                                  inv.issueDate && `Issued ${shortDate(inv.issueDate)}`,
                                  inv.amountPaid > 0 && `${money(inv.amountPaid)} paid`,
                                ]}
                              />
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums">{money(inv.balance)}</span>
                          </label>
                          {on && (
                            <div className="mt-2 flex items-center justify-end gap-2 pl-7">
                              <span className="text-[12px] text-neutral-500">Paying</span>
                              <QuietInput
                                inputMode="decimal"
                                aria-label={`Amount paid on invoice ${inv.number}`}
                                value={picked[inv.id]}
                                onChange={(e) => setPicked((p) => ({ ...p, [inv.id]: e.target.value }))}
                                className={`w-28 text-right tabular-nums ${over ? "text-danger" : ""}`}
                              />
                            </div>
                          )}
                          {over && <p className="mt-1 text-right text-[12px] text-danger">More than the balance owed.</p>}
                        </div>
                      );
                    })}
                  </Card>
                </section>
              ))}
            </div>
          )}
          {lines.length > 0 && (
            <StickyActionBar>
              <span className="text-sm text-neutral-500">
                {busy || `${lines.length} invoice${lines.length === 1 ? "" : "s"} · ${money(total)}`}
              </span>
              <Button className="ml-auto" disabled={!writes || !!busy || badAmount || !date} onClick={() => setConfirming(true)}>
                Mark paid
              </Button>
            </StickyActionBar>
          )}
          {confirming && (
            <Dialog
              onClose={() => setConfirming(false)}
              title="Mark these invoices paid?"
              description={`JobTread records ${money(total)} received ${shortDate(date)}. Then the app drafts the email to Sara and Casey.`}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button onClick={markPaid}>Mark paid</Button>
                </>
              }
            >
              <ul className="space-y-1 text-sm">
                {lines.map((l) => {
                  const inv = byId.get(l.invoiceId);
                  return (
                    <li key={l.invoiceId} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">
                        {inv?.customerName} · #{inv?.number} {inv?.jobName}
                      </span>
                      <span className="shrink-0 tabular-nums">{money(l.amount)}</span>
                    </li>
                  );
                })}
              </ul>
            </Dialog>
          )}
        </>
      )}

      {step === "done" && (
        <>
          <StatementBlock label="Deposit recorded" value={money(total)} sub={`Received ${shortDate(date)}`} className="mb-5" />
          <SectionHeading className="mb-2">Invoices</SectionHeading>
          <Card pad={false} className="divide-y divide-line-soft">
            {payments.flatMap((p) =>
              p.applied.map((a) => {
                const inv = byId.get(a.invoiceId);
                const left = a.balanceAfter;
                return (
                  <div key={a.invoiceId} className="flex items-start justify-between gap-3 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">
                        #{a.number} · {inv?.jobName ?? p.customerName}
                      </span>
                      <MetaLine
                        items={[
                          p.customerName,
                          left == null ? (
                            <span className="text-warn">Balance not read back</span>
                          ) : Math.round(left * 100) <= 0 ? (
                            <span className="text-ok">Paid</span>
                          ) : (
                            `${money(left)} still owed`
                          ),
                        ]}
                      />
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{money(a.amount)}</span>
                  </div>
                );
              }),
            )}
          </Card>

          <SectionHeading className="mb-2 mt-6">Email to Sara and Casey</SectionHeading>
          {busy ? (
            <Loading label={busy} />
          ) : draft ? (
            <a href={draft.url} target="_blank" rel="noreferrer" className={btn("primary", "md", "w-full")}>
              Open the draft ↗
            </a>
          ) : (
            <>
              <Banner tone="error" className="mb-2">
                {emailError || "The draft was not saved."} The payments are recorded; only the email is missing.
              </Banner>
              <Button variant="outline" className="w-full" onClick={draftEmail}>
                Try the email again
              </Button>
            </>
          )}

          <div className="mt-6 flex flex-col gap-2">
            <Link href={`/office?folder=${encodeURIComponent("Deposits")}`} className={btn("ghost", "md", "w-full")}>
              See the photos in Office files
            </Link>
            <Button variant="ghost" className="w-full" onClick={startOver}>
              Start another deposit
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
