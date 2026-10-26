"use client";

import { useState } from "react";
import { Button, Card, Input, MetaLine, SectionHeading } from "@/components/ui";
import { galleryFrom, isReadable, type DriveItem, type ManualGallery, type ManualSection, type ManualSource } from "@/lib/houseManual";

/**
 * The job's Drive files and folders, linked to the manual. Paste a link to add
 * one; open a folder to browse it. A PDF or Google file can be read in as
 * selections (the Specifications reader, so /specs gets the import too) or
 * added to the manual's Links; a folder of photos can become a gallery. All
 * reads go through /api/house-manual/drive.
 */

async function readJson(r: Response) {
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

/** Read a Drive folder as a gallery of its photos. Throws when it holds none. */
export async function fetchGallery(folderId: string, title?: string): Promise<ManualGallery> {
  const b = await readJson(await fetch(`/api/house-manual/drive?id=${encodeURIComponent(folderId)}`, { cache: "no-store" }));
  const g = galleryFrom(b.item, b.children, title);
  if (g.photos.length === 0) throw new Error(`No photos in ${b.item.name}.`);
  return g;
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const textLink = "text-[12px] font-semibold text-accent hover:underline disabled:opacity-50 dark:text-accent-soft";

interface Props {
  jobId: string;
  sources: ManualSource[];
  onSources: (next: ManualSource[]) => void;
  onImport: (sections: ManualSection[]) => void;
  onAddLink: (link: { text: string; url: string }) => void;
  onAddGallery: (gallery: ManualGallery) => void;
  onError: (message: string) => void;
}

/** A folder's "Add as photos" action. */
function AddPhotos({
  folder,
  onAddGallery,
  onError,
}: {
  folder: { id: string };
  onAddGallery: (g: ManualGallery) => void;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={textLink}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          onAddGallery(await fetchGallery(folder.id));
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Reading…" : "Add as photos"}
    </button>
  );
}

/** One file's two actions. */
function FileActions({
  item,
  importing,
  onImport,
  onAddLink,
}: {
  item: { id: string; name: string; url: string; mimeType?: string };
  importing: string;
  onImport: (id: string, name: string) => void;
  onAddLink: () => void;
}) {
  return (
    <span className="flex shrink-0 gap-3">
      {(!item.mimeType || isReadable(item.mimeType)) && (
        <button type="button" className={textLink} disabled={!!importing} onClick={() => onImport(item.id, item.name)}>
          {importing === item.id ? "Reading…" : "Import selections"}
        </button>
      )}
      <button type="button" className={textLink} onClick={onAddLink}>
        Add to links
      </button>
    </span>
  );
}

/** A folder's contents, with a trail back up the folders opened inside it. */
function FolderBrowser({
  root,
  importing,
  onImport,
  onAddLink,
  onAddGallery,
  onError,
}: {
  root: ManualSource;
  importing: string;
  onImport: (id: string, name: string) => void;
  onAddLink: (link: { text: string; url: string }) => void;
  onAddGallery: (g: ManualGallery) => void;
  onError: (message: string) => void;
}) {
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [children, setChildren] = useState<DriveItem[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);

  async function open(id: string, name: string, depth: number) {
    setLoading(true);
    try {
      const b = await readJson(await fetch(`/api/house-manual/drive?id=${encodeURIComponent(id)}`, { cache: "no-store" }));
      setChildren(b.children);
      setTruncated(b.truncated);
      setTrail((t) => [...t.slice(0, depth), { id, name }]);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (!children) {
    return (
      <button type="button" className={textLink} disabled={loading} onClick={() => void open(root.id, root.name, 0)}>
        {loading ? "Opening…" : "Browse"}
      </button>
    );
  }
  return (
    <div className="mt-2 w-full">
      {trail.length > 1 && (
        <div className="mb-1 flex flex-wrap gap-1 text-[12px] text-neutral-500">
          {trail.map((t, i) => (
            <button key={t.id} type="button" className="hover:text-accent" onClick={() => void open(t.id, t.name, i)}>
              {i > 0 && "› "}
              {t.name}
            </button>
          ))}
        </div>
      )}
      <div className="divide-y divide-line-soft rounded-lg bg-neutral-100/60 dark:bg-white/5">
        {children.length === 0 && <p className="px-2.5 py-2 text-[12px] text-neutral-500">This folder is empty.</p>}
        {children.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2">
            {c.isFolder ? (
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:text-accent"
                onClick={() => void open(c.id, c.name, trail.length)}
              >
                {c.name} ›
              </button>
            ) : (
              <a href={c.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                {c.name} ↗
              </a>
            )}
            <span className="text-[11px] text-neutral-500">{when(c.modified)}</span>
            {c.isFolder && <AddPhotos folder={c} onAddGallery={onAddGallery} onError={onError} />}
            {!c.isFolder && (
              <FileActions item={c} importing={importing} onImport={onImport} onAddLink={() => onAddLink({ text: c.name, url: c.url })} />
            )}
          </div>
        ))}
      </div>
      {truncated && <MetaLine className="mt-1" items={["Showing the first 200 items"]} />}
    </div>
  );
}

export function JobFiles({ jobId, sources, onSources, onImport, onAddLink, onAddGallery, onError }: Props) {
  const [link, setLink] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState("");
  const [notice, setNotice] = useState("");

  async function add() {
    setAdding(true);
    try {
      const b = await readJson(await fetch(`/api/house-manual/drive?id=${encodeURIComponent(link)}`, { cache: "no-store" }));
      const it: DriveItem = b.item;
      if (!sources.some((s) => s.id === it.id)) {
        onSources([...sources, { id: it.id, name: it.name, url: it.url, isFolder: it.isFolder }]);
      }
      setLink("");
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  async function importFile(fileId: string, name: string) {
    setImporting(fileId);
    setNotice("");
    try {
      const b = await readJson(
        await fetch("/api/house-manual/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, fileId }),
        }),
      );
      onImport(b.sections);
      setNotice(`Read ${b.rows} rows from ${name}. New items were added to the sections below.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting("");
    }
  }

  return (
    <section className="space-y-2">
      <SectionHeading>Job files</SectionHeading>
      <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
        Link the job&apos;s Google Drive folders and files. These stay in the app; they are not printed on the page.
      </p>
      {sources.length > 0 && (
        <Card pad={false} className="divide-y divide-line-soft">
          {sources.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2.5">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-accent">
                {s.isFolder ? "Folder · " : ""}
                {s.name} ↗
              </a>
              {s.isFolder ? (
                <>
                  <AddPhotos folder={s} onAddGallery={onAddGallery} onError={onError} />
                  <FolderBrowser
                    root={s}
                    importing={importing}
                    onImport={importFile}
                    onAddLink={onAddLink}
                    onAddGallery={onAddGallery}
                    onError={onError}
                  />
                </>
              ) : (
                <FileActions item={s} importing={importing} onImport={importFile} onAddLink={() => onAddLink({ text: s.name, url: s.url })} />
              )}
              <button
                type="button"
                aria-label={`Unlink ${s.name}`}
                title={`Unlink ${s.name}`}
                onClick={() => onSources(sources.filter((x) => x.id !== s.id))}
                className="shrink-0 px-1 text-neutral-400 hover:text-danger"
              >
                ✕
              </button>
            </div>
          ))}
        </Card>
      )}
      {notice && <p className="text-[12px] text-ok">{notice}</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (link.trim()) void add();
        }}
      >
        <Input
          aria-label="Google Drive link"
          placeholder="Paste a Google Drive file or folder link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={adding || !link.trim()}>
          {adding ? "Adding…" : "Link"}
        </Button>
      </form>
    </section>
  );
}
