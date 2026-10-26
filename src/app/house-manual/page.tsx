"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Banner,
  Button,
  Card,
  EmptyState,
  Input,
  Loading,
  MetaLine,
  PageHeader,
  QuietInput,
  quietInputCls,
  SectionHeading,
  Select,
  Textarea,
} from "@/components/ui";
import { JobParamPicker, useJobIdParam } from "@/components/JobPicker";
import { JobTabs } from "@/components/JobTabs";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import { manualHtml, mergeSections, type HouseManual, type JobVendor, type ManualContact, type ManualItem } from "@/lib/houseManual";
import { JobFiles } from "./JobFiles";

/**
 * House Manual — a job's homeowner's manual, built from what the app already
 * knows and pasted into Squarespace.
 *
 * The first draft comes from /api/house-manual: one section per room of the
 * job's imported spec list (or its JobTread Specifications). Job files links the
 * job's Drive folders and reads a file in as more selections. The office picks
 * which of the job's vendors go under Contacts, edits anything, saves, and
 * copies the block into a Squarespace Code Block. Squarespace has no API for
 * page content, so the paste is the hand-off.
 */

interface Saved {
  updatedAt: string;
  updatedBy: string;
}

async function readJson(r: Response) {
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const move = <T,>(xs: T[], i: number, d: number) => {
  const j = i + d;
  if (j < 0 || j >= xs.length) return xs;
  const out = [...xs];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

const blankContact: ManualContact = { trade: "", name: "", phone: "", email: "", url: "" };
const blankItem: ManualItem = { label: "", value: "", url: "" };

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 px-2 py-2 text-neutral-400 hover:text-danger"
    >
      ✕
    </button>
  );
}

/**
 * A list of items: the item's name, its selection as a paragraph that grows
 * with its text (and drags taller), and the product link.
 */
function ItemsEditor({ items, onChange }: { items: ManualItem[]; onChange: (items: ManualItem[]) => void }) {
  return (
    <>
      {items.length > 0 && (
        <Card pad={false} className="divide-y divide-line-soft">
          {items.map((it, j) => {
            const setItem = (patch: Partial<ManualItem>) => onChange(items.map((x, k) => (k === j ? { ...x, ...patch } : x)));
            return (
              <div key={j} className="flex items-start gap-2 p-2">
                <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                  <QuietInput aria-label="Item" placeholder="Item (e.g. Dishwasher)" value={it.label} onChange={(e) => setItem({ label: e.target.value })} />
                  <QuietInput aria-label="Link" placeholder="Product link" value={it.url} onChange={(e) => setItem({ url: e.target.value })} />
                  <textarea
                    aria-label="Selection"
                    placeholder="Selection: product, finish, color, notes…"
                    rows={3}
                    value={it.value}
                    onChange={(e) => setItem({ value: e.target.value })}
                    className={`${quietInputCls} min-h-[4.5rem] w-full resize-y [field-sizing:content] sm:col-span-2`}
                  />
                </div>
                <RemoveButton label={`Remove ${it.label || "item"}`} onClick={() => onChange(items.filter((_, k) => k !== j))} />
              </div>
            );
          })}
        </Card>
      )}
      <Button size="xs" variant="ghost" onClick={() => onChange([...items, blankItem])}>
        + Item
      </Button>
    </>
  );
}

function HouseManualPage() {
  const [jobId] = useJobIdParam();
  const [manual, setManual] = useState<HouseManual | null>(null);
  const [vendors, setVendors] = useState<JobVendor[]>([]);
  const [allVendors, setAllVendors] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useUnsavedChanges(dirty, "This house manual has unsaved changes. Leave without saving?");

  const load = useCallback(
    async (fresh = false) => {
      if (!jobId) return;
      setLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({ jobId, ...(fresh ? { fresh: "1" } : {}) });
        const b = await readJson(await fetch(`/api/house-manual?${q}`, { cache: "no-store" }));
        setManual(b.manual);
        setVendors(b.vendors ?? []);
        if (!fresh) setSaved(b.saved);
        setDirty(fresh);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [jobId],
  );

  useEffect(() => {
    setManual(null);
    setSaved(null);
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/vendors")
      .then(readJson)
      .then((b) => setAllVendors(b.vendors ?? []))
      .catch(() => {});
  }, []);

  const html = useMemo(() => (manual ? manualHtml(manual) : ""), [manual]);

  const edit = (fn: (m: HouseManual) => HouseManual) => {
    setManual((m) => (m ? fn(m) : m));
    setDirty(true);
    setCopied(false);
  };

  async function addVendor(vendorId: string) {
    if (!vendorId) return;
    setError("");
    try {
      const b = await readJson(await fetch(`/api/house-manual?vendorId=${encodeURIComponent(vendorId)}`));
      const trade = vendors.find((v) => v.id === vendorId)?.trade ?? "";
      edit((m) => ({ ...m, contacts: [...m.contacts, { ...b.contact, trade }] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save() {
    if (!manual) return;
    setBusy(true);
    setError("");
    try {
      const b = await readJson(
        await fetch("/api/house-manual", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, manual }),
        }),
      );
      setSaved(b.saved);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(html);
      setCopied(true);
    } catch {
      setError("The browser blocked the copy. Select the code below and copy it by hand.");
    }
  }

  const added = new Set(manual?.contacts.map((c) => c.vendorId).filter(Boolean));
  const jobVendorsLeft = vendors.filter((v) => !added.has(v.id));
  const otherVendors = allVendors.filter((v) => !added.has(v.id) && !vendors.some((j) => j.id === v.id));

  return (
    <main className="px-4 pb-24 pt-6 pad:px-7">
      <JobTabs jobId={jobId} />
      <PageHeader
        title="House Manual"
        description="A homeowner's manual for the job, ready to paste into a Squarespace Code Block."
      />

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <div className="w-full max-w-sm">
          <JobParamPicker includeAll={false} placeholder="Choose a job…" />
        </div>
        {manual && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            <Button variant="secondary" onClick={copy}>
              {copied ? "Copied ✓" : "Copy HTML"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Rebuild the manual from JobTread and the spec list? Your edits are replaced once you save.")) void load(true);
              }}
            >
              Rebuild draft
            </Button>
          </div>
        )}
      </div>
      {manual && (
        <MetaLine
          className="mb-4"
          items={[
            saved ? `Saved ${when(saved.updatedAt)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ""}` : "Not saved yet",
            dirty && "Unsaved changes",
          ]}
        />
      )}

      {!jobId && <EmptyState>Choose a job. The manual starts from the job's vendors and spec list.</EmptyState>}
      {loading && <Loading />}

      {manual && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="min-w-0 space-y-6">
            <JobFiles
              jobId={jobId}
              sources={manual.sources}
              onSources={(sources) => edit((m) => ({ ...m, sources }))}
              onImport={(sections) => edit((m) => ({ ...m, sections: mergeSections(m.sections, sections) }))}
              onAddLink={(l) => edit((m) => ({ ...m, links: [...m.links, l] }))}
              onError={setError}
            />

            <section className="space-y-2">
              <SectionHeading>Heading</SectionHeading>
              <Input
                aria-label="Title"
                placeholder="Title"
                value={manual.title}
                onChange={(e) => edit((m) => ({ ...m, title: e.target.value }))}
              />
              <Textarea
                aria-label="Introduction"
                placeholder="Introduction (optional)"
                rows={2}
                value={manual.intro}
                onChange={(e) => edit((m) => ({ ...m, intro: e.target.value }))}
              />
            </section>

            <section className="space-y-2">
              <SectionHeading>Contacts</SectionHeading>
              {manual.contacts.length > 0 && (
                <Card pad={false} className="divide-y divide-line-soft">
                  {manual.contacts.map((c, i) => {
                    const set = (patch: Partial<ManualContact>) =>
                      edit((m) => ({ ...m, contacts: m.contacts.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
                    return (
                      <div key={i} className="flex items-start gap-2 p-2">
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                          <QuietInput aria-label="Trade" placeholder="Trade (e.g. Plumbing)" value={c.trade} onChange={(e) => set({ trade: e.target.value })} />
                          <QuietInput aria-label="Name" placeholder="Name" value={c.name} onChange={(e) => set({ name: e.target.value })} />
                          <QuietInput aria-label="Phone" placeholder="Phone" value={c.phone} onChange={(e) => set({ phone: e.target.value })} />
                          <QuietInput aria-label="Email" placeholder="Email" value={c.email} onChange={(e) => set({ email: e.target.value })} />
                          <QuietInput aria-label="Website" placeholder="Website" value={c.url} onChange={(e) => set({ url: e.target.value })} className="col-span-2" />
                        </div>
                        <RemoveButton
                          label={`Remove ${c.name || "contact"}`}
                          onClick={() => edit((m) => ({ ...m, contacts: m.contacts.filter((_, k) => k !== i) }))}
                        />
                      </div>
                    );
                  })}
                </Card>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <Select aria-label="Add a vendor from this job" value="" onChange={(e) => void addVendor(e.target.value)}>
                  <option value="">
                    {jobVendorsLeft.length ? "Add a vendor from this job…" : "Every job vendor is added"}
                  </option>
                  {jobVendorsLeft.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.trade ? ` · ${v.trade}` : ""}
                    </option>
                  ))}
                </Select>
                <Select aria-label="Add another vendor" value="" onChange={(e) => void addVendor(e.target.value)}>
                  <option value="">Add another vendor…</option>
                  {otherVendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button size="xs" variant="ghost" onClick={() => edit((m) => ({ ...m, contacts: [...m.contacts, blankContact] }))}>
                + Contact not in JobTread
              </Button>
            </section>

            {manual.sections.map((s, i) => {
              const setSection = (patch: Partial<typeof s>) =>
                edit((m) => ({ ...m, sections: m.sections.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
              return (
                <section key={i} className="space-y-2">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label="Section title"
                      placeholder="Section title"
                      value={s.title}
                      onChange={(e) => setSection({ title: e.target.value })}
                      className="font-semibold uppercase tracking-wide"
                    />
                    <Button size="xs" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => edit((m) => ({ ...m, sections: move(m.sections, i, -1) }))}>
                      ↑
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={i === manual.sections.length - 1}
                      onClick={() => edit((m) => ({ ...m, sections: move(m.sections, i, 1) }))}
                    >
                      ↓
                    </Button>
                    <RemoveButton
                      label={`Remove section ${s.title}`}
                      onClick={() => edit((m) => ({ ...m, sections: m.sections.filter((_, k) => k !== i) }))}
                    />
                  </div>
                  <ItemsEditor items={s.items} onChange={(items) => setSection({ items })} />
                  {s.subsections.map((sub, j) => {
                    const setSub = (patch: Partial<typeof sub>) =>
                      setSection({ subsections: s.subsections.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
                    return (
                      <div key={j} className="ml-3 space-y-2 border-l-2 border-line-soft pl-3">
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label="Sub-section title"
                            placeholder="Sub-section title (e.g. Laundry)"
                            value={sub.title}
                            onChange={(e) => setSub({ title: e.target.value })}
                            className="font-semibold"
                          />
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label="Move up"
                            disabled={j === 0}
                            onClick={() => setSection({ subsections: move(s.subsections, j, -1) })}
                          >
                            ↑
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            aria-label="Move down"
                            disabled={j === s.subsections.length - 1}
                            onClick={() => setSection({ subsections: move(s.subsections, j, 1) })}
                          >
                            ↓
                          </Button>
                          <RemoveButton
                            label={`Remove sub-section ${sub.title}`}
                            onClick={() => setSection({ subsections: s.subsections.filter((_, k) => k !== j) })}
                          />
                        </div>
                        <ItemsEditor items={sub.items} onChange={(items) => setSub({ items })} />
                      </div>
                    );
                  })}
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => setSection({ subsections: [...s.subsections, { title: "", items: [blankItem] }] })}
                  >
                    + Sub-section
                  </Button>
                </section>
              );
            })}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => edit((m) => ({ ...m, sections: [...m.sections, { title: "", items: [blankItem], subsections: [] }] }))}
            >
              + Section
            </Button>

            <section className="space-y-2">
              <SectionHeading>Links</SectionHeading>
              {manual.links.length > 0 && (
                <Card pad={false} className="divide-y divide-line-soft">
                  {manual.links.map((l, i) => {
                    const set = (patch: Partial<typeof l>) =>
                      edit((m) => ({ ...m, links: m.links.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
                    return (
                      <div key={i} className="flex items-start gap-2 p-2">
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                          <QuietInput aria-label="Link text" placeholder="Text (e.g. Pre-cover photos)" value={l.text} onChange={(e) => set({ text: e.target.value })} />
                          <QuietInput aria-label="Link address" placeholder="https://…" value={l.url} onChange={(e) => set({ url: e.target.value })} />
                        </div>
                        <RemoveButton label={`Remove ${l.text || "link"}`} onClick={() => edit((m) => ({ ...m, links: m.links.filter((_, k) => k !== i) }))} />
                      </div>
                    );
                  })}
                </Card>
              )}
              <Button size="xs" variant="ghost" onClick={() => edit((m) => ({ ...m, links: [...m.links, { text: "", url: "" }] }))}>
                + Link
              </Button>
            </section>
          </div>

          <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
            <SectionHeading>Preview</SectionHeading>
            {/* The block as Squarespace will render it, in a page's default type. */}
            <iframe
              title="House manual preview"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:24px;font:16px/1.6 Helvetica,Arial,sans-serif;color:#111;background:#fff">${html}</body>`}
              className="h-[70vh] w-full rounded-lg border border-line bg-white"
            />
            <details>
              <summary className="cursor-pointer text-sm text-neutral-500 dark:text-neutral-400">
                Show the code · paste it into a Squarespace Code Block
              </summary>
              <Textarea readOnly rows={8} value={html} onFocus={(e) => e.target.select()} className="mt-2 font-mono text-xs" />
            </details>
          </div>
        </div>
      )}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <HouseManualPage />
    </Suspense>
  );
}
