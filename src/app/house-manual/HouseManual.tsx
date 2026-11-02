"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Checkbox,
  Segmented,
  SectionHeading,
  Select,
  Textarea,
  btn,
} from "@/components/ui";
import { JobParamPicker, useJobIdParam } from "@/components/JobPicker";
import { JobTabs } from "@/components/JobTabs";
import { useUnsavedChanges } from "@/lib/useUnsavedChanges";
import {
  DEFAULT_TITLE_STYLE,
  asManual,
  driveIdFromLink,
  embedSnippet,
  manualHtml,
  mergeSections,
  galleryPhotos,
  photoUrl,
  type HouseManual,
  type JobVendor,
  type ManualContact,
  type ManualGallery,
  type ManualItem,
  type ManualItemPdf,
  type TitleStyle,
} from "@/lib/houseManual";
import { JobFiles, fetchGallery, type SpecListRef } from "./JobFiles";

/**
 * House Manual — a job's homeowner's manual, built from what the app already
 * knows and published to Squarespace.
 *
 * The first draft comes from /api/house-manual: one section per room of the
 * job's imported spec list (or its JobTread Specifications). Job files links the
 * job's Drive folders and reads a file in as more selections. The office picks
 * which of the job's vendors go under Contacts, edits anything, and saves.
 *
 * Squarespace has no API for page content, so the app cannot write the page.
 * Instead the page reads the app: Publish puts the block at /m/<token>, and a
 * one-time embed snippet in a Squarespace Code Block loads it on every visit.
 * Save keeps a draft private; only Publish changes the live page. Copy HTML
 * stays as the by-hand fallback.
 */

interface Saved {
  updatedAt: string;
  updatedBy: string;
}

/** `at` is empty when unpublished; the token, and so the snippet, is kept. */
interface Published {
  token: string;
  at: string;
  by: string;
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

const FONT_SUGGESTIONS = [
  "Helvetica Neue, Helvetica, Arial, sans-serif",
  "Georgia, serif",
  "Times New Roman, serif",
  "Futura, Century Gothic, sans-serif",
  "Gill Sans, Gill Sans MT, sans-serif",
];

const WEIGHTS = [
  ["", "Site weight"],
  ["300", "Light"],
  ["400", "Regular"],
  ["500", "Medium"],
  ["600", "Semibold"],
  ["700", "Bold"],
  ["800", "Heavy"],
] as const;

/** A number field where blank means 0 ("the site's value"). */
function NumberField({
  label,
  value,
  onChange,
  step,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  placeholder?: string;
}) {
  return (
    <label className="block text-[12px] text-neutral-500 dark:text-neutral-400">
      {label}
      <QuietInput
        type="number"
        inputMode="decimal"
        step={step}
        placeholder={placeholder}
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="mt-0.5"
      />
    </label>
  );
}

/**
 * The title's look. A blank field follows the Squarespace site; a font only
 * shows if the site loads it.
 */
function TitleStyleEditor({
  value: t,
  onChange,
  onReset,
}: {
  value: TitleStyle;
  onChange: (patch: Partial<TitleStyle>) => void;
  onReset: () => void;
}) {
  return (
    <details className="rounded-lg border border-line px-3 py-2">
      <summary className="cursor-pointer text-sm font-semibold">Title style</summary>
      <div className="mt-3 space-y-3">
        <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
          Press Enter in the title to break the line where you want it. A blank field uses the site&apos;s own style.
        </p>
        <label className="block text-[12px] text-neutral-500 dark:text-neutral-400">
          Font
          <QuietInput
            list="title-fonts"
            placeholder="Site heading font"
            value={t.font}
            onChange={(e) => onChange({ font: e.target.value })}
            className="mt-0.5"
          />
          <datalist id="title-fonts">
            {FONT_SUGGESTIONS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <NumberField label="Size (px)" value={t.size} step={1} placeholder="Site" onChange={(size) => onChange({ size })} />
          <label className="block text-[12px] text-neutral-500 dark:text-neutral-400">
            Weight
            <Select value={t.weight} onChange={(e) => onChange({ weight: e.target.value })} className="mt-0.5">
              {WEIGHTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
          <NumberField label="Letter spacing (em)" value={t.spacing} step={0.01} placeholder="0" onChange={(spacing) => onChange({ spacing })} />
          <NumberField label="Line height" value={t.lineHeight} step={0.05} placeholder="Site" onChange={(lineHeight) => onChange({ lineHeight })} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Wrapping"
            value={t.wrap}
            onChange={(wrap) => onChange({ wrap })}
            options={[
              { value: "balance", label: "Even lines" },
              { value: "normal", label: "Normal" },
              { value: "nowrap", label: "One line" },
            ]}
          />
          <Segmented
            label="Alignment"
            value={t.align}
            onChange={(align) => onChange({ align })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
              { value: "right", label: "Right" },
            ]}
          />
          <Checkbox label="Uppercase" checked={t.upper} onChange={(e) => onChange({ upper: e.target.checked })} />
          <Checkbox label="Italic" checked={t.italic} onChange={(e) => onChange({ italic: e.target.checked })} />
        </div>
        <Button size="xs" variant="ghost" onClick={onReset}>
          Reset title style
        </Button>
      </div>
    </details>
  );
}

/**
 * One gallery: its title, its photos, and which of them the public cannot see.
 * Only shared photos reach the page; Drive sharing is the office's call, so
 * the app never changes it.
 */
function GalleryEditor({
  gallery: g,
  at,
  onChange,
  onMove,
  onRemove,
  onError,
}: {
  gallery: ManualGallery;
  /** The preview's key for this gallery (see `manualHtml`'s marks). */
  at: string;
  onChange: (g: ManualGallery) => void;
  /** Up (-1) or down (1); absent at that end of the list. */
  onMove: { up?: () => void; down?: () => void };
  onRemove: () => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const all = galleryPhotos(g);
  const hidden = all.filter((p) => !p.shared).length;
  const groups = g.groups ?? [];
  return (
    <Card className="space-y-2" data-edit={at}>
      <div className="flex items-center gap-1">
        <QuietInput aria-label="Gallery title" placeholder="Gallery title" value={g.title} onChange={(e) => onChange({ ...g, title: e.target.value })} />
        <Button size="xs" variant="ghost" aria-label={`Move ${g.title || "gallery"} up`} disabled={!onMove.up} onClick={onMove.up}>
          ↑
        </Button>
        <Button size="xs" variant="ghost" aria-label={`Move ${g.title || "gallery"} down`} disabled={!onMove.down} onClick={onMove.down}>
          ↓
        </Button>
        <RemoveButton label={`Remove ${g.title || "gallery"}`} onClick={onRemove} />
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {all.slice(0, 12).map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- a Drive photo, not a bundled asset
          <img
            key={p.id}
            src={photoUrl(p.id, 200)}
            alt={p.name}
            loading="lazy"
            className={`h-16 w-20 shrink-0 rounded object-cover ${p.shared ? "" : "opacity-40"}`}
          />
        ))}
      </div>
      <MetaLine
        items={[
          `${all.length} photo${all.length === 1 ? "" : "s"}`,
          groups.length > 0 && `${groups.length} subfolder${groups.length === 1 ? "" : "s"}`,
          hidden > 0 && `${hidden} not shared`,
        ]}
      />
      {/* Each subfolder is a heading in the gallery; its title is editable and
          survives Refresh. Add or remove one in Drive, then Refresh. */}
      {groups.map((x, k) => (
        <div key={x.folderId} data-edit={`${at}.u${k}`} className="flex items-center gap-2 border-l-2 border-line-soft pl-3">
          <QuietInput
            aria-label="Subfolder heading"
            placeholder="Subfolder heading"
            value={x.title}
            onChange={(e) => onChange({ ...g, groups: groups.map((y, n) => (n === k ? { ...y, title: e.target.value } : y)) })}
            className="min-w-0 flex-1"
          />
          <span className="shrink-0 text-[12px] text-neutral-500 dark:text-neutral-400">
            {x.photos.length} photo{x.photos.length === 1 ? "" : "s"}
          </span>
        </div>
      ))}
      {hidden > 0 && (
        <Banner tone="warning">
          {hidden === all.length ? "None of these photos are" : `${hidden} of these photos are not`} shared, so the
          page leaves them out. In Drive, share the folder as &ldquo;Anyone with the link&rdquo; (Viewer), then press
          Refresh.
        </Banner>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy}
          className="text-[12px] font-semibold text-accent hover:underline disabled:opacity-50 dark:text-accent-soft"
          onClick={async () => {
            setBusy(true);
            try {
              onChange(await fetchGallery(g.folderId, g));
            } catch (e) {
              onError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        <a
          href={g.folderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12px] font-semibold text-accent hover:underline dark:text-accent-soft"
        >
          Open folder ↗
        </a>
      </div>
    </Card>
  );
}

/**
 * A list of items: the item's name, its selection as a paragraph that grows
 * with its text (and drags taller), and the product link.
 */
function ItemsEditor({
  items,
  at,
  onChange,
  onUpload,
}: {
  items: ManualItem[];
  /** The preview's key prefix for these items, e.g. "s0" (see `manualHtml`'s marks). */
  at: string;
  onChange: (items: ManualItem[]) => void;
  /** Files a PDF in Drive and returns its link (the page's uploadToDrive). */
  onUpload?: (file: File) => Promise<string | null>;
}) {
  const [uploading, setUploading] = useState<number | null>(null);
  return (
    <>
      {items.length > 0 && (
        <Card pad={false} className="divide-y divide-line-soft">
          {items.map((it, j) => {
            const setItem = (patch: Partial<ManualItem>) => onChange(items.map((x, k) => (k === j ? { ...x, ...patch } : x)));
            return (
              <div key={j} data-edit={`${at}.i${j}`} className="flex items-start gap-2 p-2">
                <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-2">
                  <QuietInput aria-label="Item" placeholder="Item (e.g. Dishwasher)" value={it.label} onChange={(e) => setItem({ label: e.target.value })} />
                  <QuietInput aria-label="Link" placeholder="Product link" value={it.url} onChange={(e) => setItem({ url: e.target.value })} />
                  <textarea
                    aria-label="Selection"
                    data-field="value"
                    placeholder="Selection: product, finish, color, notes…"
                    rows={3}
                    value={it.value}
                    onChange={(e) => setItem({ value: e.target.value })}
                    className={`${quietInputCls} min-h-[4.5rem] w-full resize-y [field-sizing:content] sm:col-span-2`}
                  />
                  {/* The item's PDFs (owner, 2026-11-02): Drive links, or files
                      uploaded to Drive. The page serves each with no login. */}
                  {(it.pdfs ?? []).map((p, k) => {
                    const setPdf = (patch: Partial<ManualItemPdf>) =>
                      setItem({ pdfs: (it.pdfs ?? []).map((x, n) => (n === k ? { ...x, ...patch } : x)) });
                    return (
                      <div key={k} className="flex min-w-0 items-center gap-1.5 sm:col-span-2">
                        <QuietInput
                          aria-label="PDF name"
                          placeholder="Name (PDF)"
                          value={p.text}
                          onChange={(e) => setPdf({ text: e.target.value })}
                          className="w-36 shrink-0"
                        />
                        <QuietInput
                          aria-label="PDF link"
                          placeholder="Google Drive file link"
                          value={p.url}
                          onChange={(e) => setPdf({ url: e.target.value })}
                          className="min-w-0 flex-1"
                        />
                        <RemoveButton
                          label={`Remove ${p.text || "PDF"}`}
                          onClick={() => setItem({ pdfs: (it.pdfs ?? []).filter((_, n) => n !== k) })}
                        />
                      </div>
                    );
                  })}
                  <div className="flex flex-wrap gap-1 sm:col-span-2">
                    <Button size="xs" variant="ghost" onClick={() => setItem({ pdfs: [...(it.pdfs ?? []), { text: "", url: "" }] })}>
                      + PDF link
                    </Button>
                    {onUpload && (
                      <label
                        className={`${btn("ghost", "xs")} cursor-pointer ${uploading === j ? "pointer-events-none opacity-40" : ""}`}
                      >
                        {uploading === j ? "Uploading…" : "+ Upload PDFs"}
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          multiple
                          className="sr-only"
                          disabled={uploading !== null}
                          onChange={async (e) => {
                            const files = [...(e.target.files ?? [])];
                            e.target.value = "";
                            if (!files.length) return;
                            setUploading(j);
                            const added: ManualItemPdf[] = [];
                            // One at a time: each is its own request, under the upload cap.
                            for (const f of files) {
                              const url = await onUpload(f);
                              if (url) added.push({ text: f.name.replace(/\.pdf$/i, ""), url });
                            }
                            setUploading(null);
                            if (added.length) setItem({ pdfs: [...(it.pdfs ?? []), ...added] });
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
                {/* Reorder an item within its section (owner, 2026-11-02). */}
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Move ${it.label || "item"} up`}
                  disabled={j === 0}
                  onClick={() => onChange(move(items, j, -1))}
                >
                  ↑
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Move ${it.label || "item"} down`}
                  disabled={j === items.length - 1}
                  onClick={() => onChange(move(items, j, 1))}
                >
                  ↓
                </Button>
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

/** `embedJobId`: drawn inside the Jobs page for that job — no tab row, header
 *  or job picker (owner, 2026-11-02). */
export function HouseManualPage({ embedJobId }: { embedJobId?: string } = {}) {
  const [paramJobId] = useJobIdParam();
  const jobId = embedJobId ?? paramJobId;
  const [manual, setManual] = useState<HouseManual | null>(null);
  const [vendors, setVendors] = useState<JobVendor[]>([]);
  const [specLists, setSpecLists] = useState<SpecListRef[]>([]);
  const [allVendors, setAllVendors] = useState<{ id: string; name: string }[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<"" | "embed" | "html">("");
  const [published, setPublished] = useState<Published | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

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
        setSpecLists(b.specLists ?? []);
        if (!fresh) setSaved(b.saved);
        setPublished(b.published ?? null);
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
    setPublished(null);
    void load();
  }, [load]);

  useEffect(() => {
    fetch("/api/vendors")
      .then(readJson)
      .then((b) => setAllVendors(b.vendors ?? []))
      .catch(() => {});
  }, []);

  // Through asManual first, so the preview and the copy are exactly what Save stores.
  // PDF links need the page's token; before a first publish they preview as text.
  const html = useMemo(
    () =>
      manual
        ? manualHtml(asManual(manual)!, published ? { origin: window.location.origin, token: published.token } : undefined)
        : "",
    [manual, published],
  );
  // The same block, marked so a click in the preview finds its editor field.
  const previewHtml = useMemo(
    () =>
      manual
        ? manualHtml(asManual(manual)!, published ? { origin: window.location.origin, token: published.token } : undefined, { marks: true })
        : "",
    [manual, published],
  );

  /** Scroll the editor to the field a preview click came from, focus it, and flash its row. */
  const jumpTo = useCallback((mark: string) => {
    const [key, field] = mark.split("~");
    const row = editorRef.current?.querySelector<HTMLElement>(`[data-edit="${CSS.escape(key)}"]`);
    if (!row) return;
    const target =
      (field && row.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"]`)) ||
      (row.matches("input, textarea") ? row : row.querySelector<HTMLElement>("input, textarea")) ||
      row;
    row.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
    const flash = ["ring-2", "ring-accent", "rounded-lg"];
    row.classList.add(...flash);
    window.setTimeout(() => row.classList.remove(...flash), 1200);
  }, []);

  const snippet = published && typeof window !== "undefined" ? embedSnippet(window.location.origin, published.token) : "";
  const live = !!published?.at;
  const behind = live && !!saved && saved.updatedAt > published!.at;

  const edit = (fn: (m: HouseManual) => HouseManual) => {
    setManual((m) => (m ? fn(m) : m));
    setDirty(true);
    setCopied("");
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

  async function publish() {
    if (!manual) return;
    setBusy(true);
    setError("");
    try {
      const b = await readJson(
        await fetch("/api/house-manual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, manual }),
        }),
      );
      setSaved(b.saved);
      setPublished(b.published);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!window.confirm("Take the manual off the live Squarespace page? The embed code stays, so Publish puts it back.")) return;
    setBusy(true);
    setError("");
    try {
      const b = await readJson(await fetch(`/api/house-manual?jobId=${encodeURIComponent(jobId)}`, { method: "DELETE" }));
      setPublished(b.published);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: "embed" | "html") {
    try {
      await navigator.clipboard.writeText(what === "embed" ? snippet : html);
      setCopied(what);
    } catch {
      setError("The browser blocked the copy. Select the code below and copy it by hand.");
    }
  }

  const added = new Set(manual?.contacts.map((c) => c.vendorId).filter(Boolean));
  // A PDF from this computer: filed in Drive, then linked as a PDF link (owner,
  // 2026-11-02). See /api/house-manual/upload.
  const [uploadingPdf, setUploadingPdf] = useState(false);
  /** Files a PDF in Drive and hands back its link, or null when it failed (the
   *  error banner says why). The Links list and each item's PDF both use it. */
  async function uploadToDrive(file: File): Promise<string | null> {
    if (!manual) return null;
    setError("");
    try {
      const pdfBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split("base64,")[1] ?? "");
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const b = await readJson(
        await fetch("/api/house-manual/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobName: manual.title, fileName: file.name, pdfBase64 }),
        }),
      );
      return String(b.file.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }
  async function uploadPdf(file: File | undefined) {
    if (!file) return;
    setUploadingPdf(true);
    const url = await uploadToDrive(file);
    setUploadingPdf(false);
    if (!url) return;
    const text = file.name.replace(/\.pdf$/i, "");
    edit((m) => ({ ...m, links: [...m.links, { text, url, pdf: true }] }));
  }
  /** A gallery already in the manual (same folder) is refreshed in place. */
  const addGallery = (g: ManualGallery) =>
    edit((m) => ({
      ...m,
      galleries: m.galleries.some((x) => x.folderId === g.folderId)
        ? m.galleries.map((x) => (x.folderId === g.folderId ? g : x))
        : [...m.galleries, g],
    }));
  // A photo folder pasted straight into Photos, without linking it under Job files.
  const [folderLink, setFolderLink] = useState("");
  const [addingFolder, setAddingFolder] = useState(false);
  async function addFolder() {
    const id = driveIdFromLink(folderLink);
    if (!id) {
      setError("Paste a Google Drive folder link.");
      return;
    }
    setAddingFolder(true);
    setError("");
    try {
      addGallery(await fetchGallery(id));
      setFolderLink("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingFolder(false);
    }
  }
  const jobVendorsLeft = vendors.filter((v) => !added.has(v.id));
  const otherVendors = allVendors.filter((v) => !added.has(v.id) && !vendors.some((j) => j.id === v.id));

  // Inside the Jobs page, which already holds the <main>.
  const Shell = embedJobId ? "div" : "main";
  return (
    <Shell className={embedJobId ? "" : "px-4 pb-24 pt-6 pad:px-7"}>
      {!embedJobId && (
        <>
          <JobTabs jobId={jobId} />
          <PageHeader
            title="House Manual"
            description="A homeowner's manual for the job. Publish updates the Squarespace page that embeds it."
          />
        </>
      )}

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        {!embedJobId && (
          <div className="w-full max-w-sm">
            <JobParamPicker includeAll={false} placeholder="Choose a job…" />
          </div>
        )}
        {manual && (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={busy || !dirty}>
              {busy ? "Saving…" : dirty ? "Save" : "Saved"}
            </Button>
            <Button variant="secondary" onClick={publish} disabled={busy || (live && !dirty && !behind)}>
              {busy ? "Working…" : live && !dirty && !behind ? "Published" : "Publish"}
            </Button>
            {published && (
              <Button variant="secondary" onClick={() => copy("embed")}>
                {copied === "embed" ? "Copied ✓" : "Copy embed code"}
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm("Rebuild the manual from JobTread and the spec list? Your edits are replaced once you save.")) void load(true);
              }}
            >
              Rebuild draft
            </Button>
            {live && (
              <Button variant="ghost" onClick={unpublish} disabled={busy}>
                Unpublish
              </Button>
            )}
          </div>
        )}
      </div>
      {manual && (
        <MetaLine
          className="mb-4"
          items={[
            saved ? `Saved ${when(saved.updatedAt)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ""}` : "Not saved yet",
            live ? `Live since ${when(published!.at)}${published!.by ? ` by ${published!.by}` : ""}` : "Not published",
            behind && "Saved changes not published",
            dirty && "Unsaved changes",
          ]}
        />
      )}

      {!jobId && <EmptyState>Choose a job. The manual starts from the job&apos;s vendors and spec list.</EmptyState>}
      {loading && <Loading />}

      {manual && !loading && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div ref={editorRef} className="min-w-0 space-y-6">
            <JobFiles
              jobId={jobId}
              specLists={specLists}
              sources={manual.sources}
              // Saved on the server as they change (the shared job_sources list), so not "unsaved".
              onSources={(sources) => setManual((m) => (m ? { ...m, sources } : m))}
              onImport={(sections) => edit((m) => ({ ...m, sections: mergeSections(m.sections, sections) }))}
              onAddLink={(l) => edit((m) => ({ ...m, links: [...m.links, l] }))}
              onAddGallery={addGallery}
              onError={setError}
            />

            <section className="space-y-2">
              <SectionHeading>Heading</SectionHeading>
              <Textarea
                aria-label="Title"
                data-edit="title"
                placeholder="Title"
                rows={1}
                value={manual.title}
                onChange={(e) => edit((m) => ({ ...m, title: e.target.value }))}
                className="resize-y [field-sizing:content]"
              />
              <TitleStyleEditor
                value={manual.titleStyle}
                onChange={(patch) => edit((m) => ({ ...m, titleStyle: { ...m.titleStyle, ...patch } }))}
                onReset={() => edit((m) => ({ ...m, titleStyle: DEFAULT_TITLE_STYLE }))}
              />
              <Textarea
                aria-label="Introduction"
                data-edit="intro"
                placeholder="Introduction (optional)"
                rows={2}
                value={manual.intro}
                onChange={(e) => edit((m) => ({ ...m, intro: e.target.value }))}
              />
            </section>

            <section className="space-y-2" data-edit="contacts">
              <SectionHeading>Contacts</SectionHeading>
              {manual.contacts.length > 0 && (
                <Card pad={false} className="divide-y divide-line-soft">
                  {manual.contacts.map((c, i) => {
                    const set = (patch: Partial<ManualContact>) =>
                      edit((m) => ({ ...m, contacts: m.contacts.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
                    return (
                      <div key={i} data-edit={`c${i}`} className="flex items-start gap-2 p-2">
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                          <QuietInput aria-label="Trade" placeholder="Trade (e.g. Plumbing)" value={c.trade} onChange={(e) => set({ trade: e.target.value })} />
                          <QuietInput aria-label="Name" placeholder="Name" value={c.name} onChange={(e) => set({ name: e.target.value })} />
                          <QuietInput aria-label="Phone" placeholder="Phone" value={c.phone} onChange={(e) => set({ phone: e.target.value })} />
                          <QuietInput aria-label="Email" placeholder="Email" value={c.email} onChange={(e) => set({ email: e.target.value })} />
                          <QuietInput aria-label="Website" placeholder="Website" value={c.url} onChange={(e) => set({ url: e.target.value })} className="col-span-2" />
                        </div>
                        {/* Reorder a contact (owner, 2026-11-02). */}
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Move ${c.name || "contact"} up`}
                          disabled={i === 0}
                          onClick={() => edit((m) => ({ ...m, contacts: move(m.contacts, i, -1) }))}
                        >
                          ↑
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          aria-label={`Move ${c.name || "contact"} down`}
                          disabled={i === manual.contacts.length - 1}
                          onClick={() => edit((m) => ({ ...m, contacts: move(m.contacts, i, 1) }))}
                        >
                          ↓
                        </Button>
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
                      data-edit={`s${i}`}
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
                  <ItemsEditor items={s.items} at={`s${i}`} onChange={(items) => setSection({ items })} onUpload={uploadToDrive} />
                  {s.subsections.map((sub, j) => {
                    const setSub = (patch: Partial<typeof sub>) =>
                      setSection({ subsections: s.subsections.map((x, k) => (k === j ? { ...x, ...patch } : x)) });
                    return (
                      <div key={j} className="ml-3 space-y-2 border-l-2 border-line-soft pl-3">
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label="Sub-section title"
                            data-edit={`s${i}.u${j}`}
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
                        <ItemsEditor items={sub.items} at={`s${i}.u${j}`} onChange={(items) => setSub({ items })} onUpload={uploadToDrive} />
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
              <SectionHeading>Photos</SectionHeading>
              {manual.galleries.length === 0 && (
                <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
                  Paste a Drive folder of photos below, or choose Add as photos under Job files. Each folder is its own section.
                </p>
              )}
              {manual.galleries.map((g, i) => (
                <GalleryEditor
                  key={g.folderId}
                  gallery={g}
                  at={`g${i}`}
                  onChange={(next) => edit((m) => ({ ...m, galleries: m.galleries.map((x, k) => (k === i ? next : x)) }))}
                  onMove={{
                    up: i > 0 ? () => edit((m) => ({ ...m, galleries: move(m.galleries, i, -1) })) : undefined,
                    down: i < manual.galleries.length - 1 ? () => edit((m) => ({ ...m, galleries: move(m.galleries, i, 1) })) : undefined,
                  }}
                  onRemove={() => edit((m) => ({ ...m, galleries: m.galleries.filter((_, k) => k !== i) }))}
                  onError={setError}
                />
              ))}
              {/* More than one photo section (owner, 2026-11-02): one per Drive folder. */}
              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void addFolder();
                }}
              >
                <QuietInput
                  aria-label="Photo folder link"
                  placeholder="Google Drive folder link"
                  value={folderLink}
                  onChange={(e) => setFolderLink(e.target.value)}
                  className="min-w-0 flex-1"
                />
                <Button size="xs" variant="ghost" type="submit" disabled={addingFolder || !folderLink.trim()}>
                  {addingFolder ? "Reading…" : "+ Photo folder"}
                </Button>
              </form>
            </section>

            <section className="space-y-2">
              <SectionHeading>Links</SectionHeading>
              {manual.links.length > 0 && (
                <Card pad={false} className="divide-y divide-line-soft">
                  {manual.links.map((l, i) => {
                    const set = (patch: Partial<typeof l>) =>
                      edit((m) => ({ ...m, links: m.links.map((x, k) => (k === i ? { ...x, ...patch } : x)) }));
                    return (
                      <div key={i} data-edit={`l${i}`} className="flex items-start gap-2 p-2">
                        <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                          <QuietInput aria-label="Link text" placeholder={l.pdf ? "Text (e.g. Dishwasher manual)" : "Text (e.g. Pre-cover photos)"} value={l.text} onChange={(e) => set({ text: e.target.value })} />
                          <QuietInput
                            aria-label={l.pdf ? "Drive file link" : "Link address"}
                            placeholder={l.pdf ? "Google Drive file link" : "https://…"}
                            value={l.url}
                            onChange={(e) => set({ url: e.target.value })}
                          />
                          {l.pdf && (
                            <p className="col-span-2 px-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                              PDF · opens with no Google login. The file needs no sharing. Over about 4.5 MB it will not open.
                            </p>
                          )}
                        </div>
                        <RemoveButton label={`Remove ${l.text || "link"}`} onClick={() => edit((m) => ({ ...m, links: m.links.filter((_, k) => k !== i) }))} />
                      </div>
                    );
                  })}
                </Card>
              )}
              <div className="flex flex-wrap gap-1">
                <Button size="xs" variant="ghost" onClick={() => edit((m) => ({ ...m, links: [...m.links, { text: "", url: "" }] }))}>
                  + Link
                </Button>
                {/* A Drive PDF the page serves itself (owner, 2026-11-02). */}
                <Button size="xs" variant="ghost" onClick={() => edit((m) => ({ ...m, links: [...m.links, { text: "", url: "", pdf: true }] }))}>
                  + PDF from Drive
                </Button>
                {/* A label, so the click opens the file picker. Up to 3 MB. */}
                <label className={`${btn("ghost", "xs")} cursor-pointer ${uploadingPdf ? "pointer-events-none opacity-40" : ""}`}>
                  {uploadingPdf ? "Uploading…" : "+ Upload PDF"}
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="sr-only"
                    disabled={uploadingPdf}
                    onChange={(e) => {
                      void uploadPdf(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </section>
          </div>

          <div className="min-w-0 space-y-3 lg:sticky lg:top-4 lg:self-start">
            <SectionHeading>Preview</SectionHeading>
            {/* The block as Squarespace will render it, in a page's default type.
                Click a part to jump to its field (owner, 2026-11-02). The frame
                runs no script; same-origin only lets this page hear the click. */}
            <iframe
              title="House manual preview"
              sandbox="allow-same-origin"
              srcDoc={`<!doctype html><meta charset="utf-8"><style>[data-at]{cursor:pointer}[data-at]:hover{background:#f4f1ea}</style><body style="margin:24px;font:16px/1.6 Helvetica,Arial,sans-serif;color:#111;background:#fff">${previewHtml}</body>`}
              onLoad={(e) => {
                e.currentTarget.contentDocument?.addEventListener("click", (ev) => {
                  const t = ev.target as Element | null;
                  const el = t?.closest?.("[data-at]");
                  if (!el) return;
                  // A summary still opens its section; a link no longer navigates.
                  if (!t?.closest("summary")) ev.preventDefault();
                  jumpTo(el.getAttribute("data-at") ?? "");
                });
              }}
              className="h-[70vh] w-full rounded-lg border border-line bg-white"
            />
            {published && (
              <details>
                <summary className="cursor-pointer text-sm text-neutral-500 dark:text-neutral-400">
                  Embed code · paste it once into a Squarespace Code Block
                </summary>
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                  The page then shows whatever you last published, within a minute. JavaScript in a Code Block needs a
                  Squarespace plan that allows it.
                </p>
                <Textarea readOnly rows={3} value={snippet} onFocus={(e) => e.target.select()} className="mt-2 font-mono text-xs" />
              </details>
            )}
            <details>
              <summary className="cursor-pointer text-sm text-neutral-500 dark:text-neutral-400">
                Show the HTML · paste it by hand instead
              </summary>
              <Button size="xs" variant="ghost" className="mt-2" onClick={() => copy("html")}>
                {copied === "html" ? "Copied ✓" : "Copy HTML"}
              </Button>
              <Textarea readOnly rows={8} value={html} onFocus={(e) => e.target.select()} className="mt-2 font-mono text-xs" />
            </details>
          </div>
        </div>
      )}
    </Shell>
  );
}
