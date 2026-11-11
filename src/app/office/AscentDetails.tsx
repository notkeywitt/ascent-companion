"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Banner, Button, Card, Input, ListCard, ListRow, SectionHeading } from "@/components/ui";
import {
  DETAIL_FIELDS,
  rateLabel,
  rateToPercentText,
  type DetailValues,
} from "@/lib/companyDetailsRules";
import type { CompanyDocument } from "@/lib/companyDetails";

/**
 * The Ascent Details card (tax rate, P&O, the numbers on our permits) and the
 * company documents under it. Stored in the companion database; the server
 * page reads both and passes them in, the writes go to /api/office/details and
 * /api/office/documents, then router.refresh() re-reads.
 */

const sizeLabel = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

async function errorOf(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (j?.error) return String(j.error);
  } catch {}
  return `Failed (${res.status}).`;
}

export function AscentDetails({
  values,
  documents,
}: {
  values: DetailValues;
  documents: CompanyDocument[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [docName, setDocName] = useState("");

  const startEdit = () => {
    const d: Record<string, string> = {};
    for (const f of DETAIL_FIELDS) d[f.key] = f.kind === "rate" ? rateToPercentText(values[f.key]) : values[f.key];
    setDraft(d);
    setError("");
    setEditing(true);
  };

  async function save() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/office/details", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        setError(await errorOf(res));
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", docName);
      const res = await fetch("/api/office/documents", { method: "POST", body: form });
      if (!res.ok) {
        setError(await errorOf(res));
        return;
      }
      if (fileRef.current) fileRef.current.value = "";
      setDocName("");
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: CompanyDocument) {
    if (!window.confirm(`Delete "${d.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/office/documents?id=${d.id}`, { method: "DELETE" });
      if (!res.ok) setError(await errorOf(res));
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}

      {editing ? (
        <Card className="space-y-3">
          {DETAIL_FIELDS.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="mb-1 block font-semibold">
                {f.label}
                {f.kind === "rate" ? " (%)" : ""}
              </span>
              <Input
                value={draft[f.key] ?? ""}
                inputMode={f.kind === "rate" ? "decimal" : "text"}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
              />
            </label>
          ))}
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : (
        <>
          <ListCard>
            {DETAIL_FIELDS.map((f) => {
              const v = f.kind === "rate" ? rateLabel(values[f.key]) : values[f.key];
              return (
                <ListRow
                  key={f.key}
                  label={f.label}
                  trailing={
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{v || "—"}</span>
                  }
                />
              );
            })}
          </ListCard>
          <Button variant="outline" size="sm" onClick={startEdit}>
            Edit details
          </Button>
        </>
      )}

      <div>
        <SectionHeading>Documents</SectionHeading>
        {documents.length === 0 ? (
          <p className="px-1 pb-2 text-[13px] text-neutral-500 dark:text-neutral-400">
            No documents yet. Upload the reseller permit and the rest below.
          </p>
        ) : (
          <ListCard>
            {documents.map((d) => (
              <ListRow
                key={d.id}
                href={`/api/office/documents/file?id=${d.id}`}
                external
                wrap
                label={d.name}
                desc={`${d.fileName || "file"} · ${sizeLabel(d.size)} · ${d.uploadedAt.slice(0, 10)}`}
                trailing={
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busy}
                    onClick={(e) => {
                      // The row is a link; the delete must not open the file.
                      e.preventDefault();
                      e.stopPropagation();
                      void remove(d);
                    }}
                  >
                    Delete
                  </Button>
                }
              />
            ))}
          </ListCard>
        )}
        <Card className="mt-3 space-y-2">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Name</span>
            <Input
              value={docName}
              placeholder="Reseller permit"
              maxLength={120}
              onChange={(e) => setDocName(e.target.value)}
            />
          </label>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
            className="block w-full text-sm"
          />
          <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
            PDF or photo, 4 MB at most.
          </p>
          <Button size="sm" onClick={upload} disabled={busy}>
            {busy ? "Working…" : "Upload"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
