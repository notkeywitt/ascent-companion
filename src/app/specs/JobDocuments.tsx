"use client";

import { useCallback, useEffect, useState } from "react";
import { Banner, Button, Input, ListCard, ListRow, MetaLine, SectionHeading } from "@/components/ui";

/**
 * The job's Drive documents for AscentBot. Paste a Drive file or folder link:
 * /api/specs/docs lists every file under it, then this reads them three at a
 * time, one request each, skipping files already read and unchanged. The bot
 * searches the kept text (search_job_documents) — no Drive or model call per
 * question.
 */

interface Doc {
  id: number;
  name: string;
  folder: string;
  url: string;
  pages: number;
  chars: number;
  note: string;
}
interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modified: string;
  folder: string;
  done: boolean;
}

async function readJson(r: Response) {
  const b = await r.json().catch(() => ({}));
  if (!r.ok || b.error) throw new Error(b.error || `HTTP ${r.status}`);
  return b;
}

const AT_ONCE = 3;

export function JobDocuments({ jobId }: { jobId: string }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await readJson(await fetch(`/api/specs/docs?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" }));
      setDocs(b.docs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [jobId]);

  useEffect(() => {
    setDocs([]);
    setStatus("");
    setError("");
    void load();
  }, [load]);

  async function read() {
    setBusy(true);
    setError("");
    try {
      setStatus("Listing the files…");
      const q = new URLSearchParams({ jobId, link: link.trim() });
      const w = await readJson(await fetch(`/api/specs/docs?${q}`, { cache: "no-store" }));
      const files = w.files as DriveFile[];
      const todo = files.filter((f) => !f.done);
      const total = todo.length;
      let n = 0;
      let failed = 0;
      const worker = async () => {
        for (let f = todo.shift(); f; f = todo.shift()) {
          setStatus(`Reading ${++n} of ${total} — ${f.name}`);
          try {
            await readJson(
              await fetch("/api/specs/docs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jobId, file: f }),
              }),
            );
          } catch {
            failed++;
          }
        }
      };
      await Promise.all(Array.from({ length: AT_ONCE }, worker));
      setStatus(
        [
          `${w.root}: ${total - failed} read`,
          files.length > total && `${files.length - total} unchanged`,
          failed && `${failed} failed — read the link again to retry`,
          w.truncated && "the folder is too big, so some files were left out",
        ]
          .filter(Boolean)
          .join(" · "),
      );
      setLink("");
      setOpen(true);
      await load();
    } catch (e) {
      setStatus("");
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    setError("");
    try {
      await readJson(await fetch(`/api/specs/docs?jobId=${encodeURIComponent(jobId)}&id=${id}`, { method: "DELETE" }));
      setDocs((ds) => ds.filter((d) => d.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pages = docs.reduce((s, d) => s + d.pages, 0);
  const noText = docs.filter((d) => !d.chars).length;

  return (
    <section className="mb-6 space-y-2">
      <SectionHeading onToggle={docs.length ? () => setOpen(!open) : undefined} open={open}>
        Documents for AscentBot
      </SectionHeading>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Google Drive file or folder link"
          placeholder="Paste a Google Drive file or folder link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && link.trim() && !busy && void read()}
          className="max-w-md"
        />
        <Button onClick={read} disabled={!link.trim() || busy}>
          {busy ? "Reading…" : "Read link"}
        </Button>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {status && <p className="text-[12px] text-neutral-500 dark:text-neutral-400">{status}</p>}
      <MetaLine
        items={[
          docs.length ? `${docs.length} documents` : "No documents yet. AscentBot searches every file read here.",
          pages > 0 && `${pages} pages`,
          noText > 0 && <span className="text-warn">{noText} without text</span>,
        ]}
      />
      {open && docs.length > 0 && (
        <ListCard>
          {docs.map((d) => (
            <ListRow
              key={d.id}
              wrap
              label={
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
                  {d.name} ↗
                </a>
              }
              desc={[d.folder, d.pages > 0 && `${d.pages} pages`, d.note].filter(Boolean).join(" · ")}
              trailing={
                <Button size="xs" variant="ghost" onClick={() => void remove(d.id)}>
                  Remove
                </Button>
              }
            />
          ))}
        </ListCard>
      )}
    </section>
  );
}
