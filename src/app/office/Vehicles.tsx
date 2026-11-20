"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Banner, Button, btn, Card, Input, ListCard, ListRow, MetaLine, Textarea } from "@/components/ui";
import {
  EMPTY_VEHICLE,
  VEHICLE_FIELDS,
  dayLabel,
  insuranceState,
  type VehicleValues,
} from "@/lib/vehicleRules";
import type { Vehicle } from "@/lib/vehicles";

/**
 * The Vehicles card on the Office dashboard: each company vehicle with its
 * photo, plate, VIN, insurance, notes and documents. Stored in the companion
 * database; the server page reads the list, writes go to /api/office/vehicles
 * and /api/office/vehicles/files, then router.refresh() re-reads.
 */

const FILE_ACCEPT = "application/pdf,image/jpeg,image/png,image/heic,image/webp";

const sizeLabel = (b: number) =>
  b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

async function errorOf(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (j?.error) return String(j.error);
  } catch {}
  return `Failed (${res.status}).`;
}

/** Today in the browser's own zone, "YYYY-MM-DD". */
const today = () => new Date().toLocaleDateString("en-CA");

export function Vehicles({ vehicles }: { vehicles: Vehicle[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The vehicle being edited: its id, "new", or none.
  const [editing, setEditing] = useState<number | "new" | null>(null);

  async function send(run: () => Promise<Response>): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const res = await run();
      if (!res.ok) {
        setError(await errorOf(res));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const json = (method: string, body: unknown) => () =>
    fetch("/api/office/vehicles", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  async function upload(vehicleId: number, kind: "photo" | "doc", file: File, name = "") {
    const form = new FormData();
    form.set("vehicleId", String(vehicleId));
    form.set("kind", kind);
    form.set("name", name);
    form.set("file", file);
    return send(() => fetch("/api/office/vehicles/files", { method: "POST", body: form }));
  }

  return (
    <div className="space-y-4">
      {error && <Banner tone="error">{error}</Banner>}

      {vehicles.length === 0 && editing !== "new" && (
        <p className="px-1 text-[13px] text-neutral-500 dark:text-neutral-400">No vehicles yet.</p>
      )}

      {vehicles.map((v) =>
        editing === v.id ? (
          <VehicleForm
            key={v.id}
            initial={v.values}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={async (values) => {
              if (await send(json("PUT", { id: v.id, ...values }))) setEditing(null);
            }}
          />
        ) : (
          <VehicleCard
            key={v.id}
            v={v}
            busy={busy}
            onEdit={() => {
              setError("");
              setEditing(v.id);
            }}
            onDelete={() => {
              if (window.confirm(`Delete "${v.values.name}" and its documents? This cannot be undone.`))
                void send(() => fetch(`/api/office/vehicles?id=${v.id}`, { method: "DELETE" }));
            }}
            onPhoto={(file) => void upload(v.id, "photo", file)}
            onRemovePhoto={() =>
              void send(() => fetch(`/api/office/vehicles/files?photo=${v.id}`, { method: "DELETE" }))
            }
            onAddFile={(file, name) => upload(v.id, "doc", file, name)}
            onDeleteFile={(id, name) => {
              if (window.confirm(`Delete "${name}"? This cannot be undone.`))
                void send(() => fetch(`/api/office/vehicles/files?id=${id}`, { method: "DELETE" }));
            }}
          />
        ),
      )}

      {editing === "new" ? (
        <VehicleForm
          initial={EMPTY_VEHICLE}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={async (values) => {
            if (await send(json("POST", values))) setEditing(null);
          }}
        />
      ) : (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setError("");
            setEditing("new");
          }}
        >
          Add vehicle
        </Button>
      )}
    </div>
  );
}

function VehicleForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial: VehicleValues;
  busy: boolean;
  onSave: (v: VehicleValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<VehicleValues>(initial);
  return (
    <Card className="space-y-3">
      {VEHICLE_FIELDS.map((f) => (
        <label key={f.key} className="block text-sm">
          <span className="mb-1 block font-semibold">{f.label}</span>
          {f.kind === "long" ? (
            <Textarea
              rows={3}
              value={draft[f.key]}
              maxLength={f.max}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          ) : (
            <Input
              type={f.kind === "date" ? "date" : "text"}
              value={draft[f.key]}
              maxLength={f.max}
              placeholder={f.key === "name" ? "2019 F-250 (white)" : undefined}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          )}
        </label>
      ))}
      <div className="flex gap-2">
        <Button onClick={() => onSave(draft)} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

function VehicleCard({
  v,
  busy,
  onEdit,
  onDelete,
  onPhoto,
  onRemovePhoto,
  onAddFile,
  onDeleteFile,
}: {
  v: Vehicle;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPhoto: (f: File) => void;
  onRemovePhoto: () => void;
  onAddFile: (f: File, name: string) => Promise<boolean>;
  onDeleteFile: (id: number, name: string) => void;
}) {
  const [docName, setDocName] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const x = v.values;
  const state = insuranceState(x.insurance_expiry, today());
  const photoUrl = `/api/office/vehicles/files?photo=${v.id}&v=${encodeURIComponent(v.updatedAt)}`;

  return (
    <Card className="space-y-3">
      <div className="flex gap-3">
        {v.hasPhoto ? (
          <a href={photoUrl} target="_blank" rel="noopener noreferrer" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- a private DB blob, not a static asset */}
            <img src={photoUrl} alt={x.name} className="h-20 w-28 rounded object-cover" />
          </a>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold tracking-tight">{x.name}</div>
          <MetaLine items={[x.plate && `Plate ${x.plate}`, x.vin && `VIN ${x.vin}`]} />
          {(x.insurance_carrier || x.insurance_policy || x.insurance_expiry) && (
            <div className="mt-1 text-[13px]">
              <MetaLine
                items={[
                  x.insurance_carrier,
                  x.insurance_policy && `Policy ${x.insurance_policy}`,
                  x.insurance_expiry && (
                    <span
                      className={state === "expired" ? "text-danger" : state === "soon" ? "text-warn" : undefined}
                    >
                      {state === "expired" ? "Expired" : "Expires"} {dayLabel(x.insurance_expiry)}
                    </span>
                  ),
                ]}
              />
            </div>
          )}
        </div>
      </div>

      {x.notes && <p className="whitespace-pre-wrap text-[13px]">{x.notes}</p>}

      {v.files.length > 0 && (
        <ListCard>
          {v.files.map((f) => (
            <ListRow
              key={f.id}
              href={`/api/office/vehicles/files?id=${f.id}`}
              external
              wrap
              label={f.name}
              desc={`${f.fileName || "file"} · ${sizeLabel(f.size)} · ${dayLabel(f.uploadedAt.slice(0, 10))}`}
              trailing={
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={(e) => {
                    // The row is a link; the delete must not open the file.
                    e.preventDefault();
                    e.stopPropagation();
                    onDeleteFile(f.id, f.name);
                  }}
                >
                  Delete
                </Button>
              }
            />
          ))}
        </ListCard>
      )}

      <div className="space-y-2">
        <Input
          value={docName}
          placeholder="Document name (registration…)"
          maxLength={120}
          onChange={(e) => setDocName(e.target.value)}
        />
        <input
          key={inputKey}
          type="file"
          accept={FILE_ACCEPT}
          className="block w-full text-sm"
          onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !docFile}
          onClick={async () => {
            if (docFile && (await onAddFile(docFile, docName))) {
              setDocName("");
              setDocFile(null);
              setInputKey((k) => k + 1);
            }
          }}
        >
          Upload document
        </Button>
        <p className="text-[12px] text-neutral-500 dark:text-neutral-400">PDF or photo, 4 MB at most.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onEdit} disabled={busy}>
          Edit
        </Button>
        <label className={btn("outline", "sm", `ui-btn cursor-pointer ${busy ? "pointer-events-none opacity-50" : ""}`)}>
          {v.hasPhoto ? "Replace photo" : "Add photo"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onPhoto(f);
            }}
          />
        </label>
        {v.hasPhoto && (
          <Button variant="ghost" size="sm" onClick={onRemovePhoto} disabled={busy}>
            Remove photo
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy}>
          Delete vehicle
        </Button>
      </div>
    </Card>
  );
}
