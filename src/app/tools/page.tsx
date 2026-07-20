"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { QrScanner } from "@/components/QrScanner";
import { Banner, Button, Label, Loading, PageHeader, inputCls } from "@/components/ui";

interface Tool {
  id: string;
  name: string;
  type: string;
  condition: string;
  toolGroup: string;
  serial: string;
  accessories: string;
  location: string; // ProjectID
  locationLabel: string; // "Customer - Project"
  lastscan: string;
  lastScanEmail: string;
  photoLink: string; // raw Drive share URL
  photoUrl: string; // renderable thumbnail
}

interface Project {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

type EditableKey =
  | "name"
  | "type"
  | "condition"
  | "toolGroup"
  | "serial"
  | "accessories"
  | "location";

const TEXT_FIELDS: { key: Exclude<EditableKey, "location">; label: string; wide?: boolean }[] = [
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
  { key: "condition", label: "Condition" },
  { key: "toolGroup", label: "Tool group" },
  { key: "serial", label: "Serial number" },
  { key: "accessories", label: "Related accessories", wide: true },
];

const conditionClass = (c: string) => {
  const k = c.toLowerCase();
  if (k === "new" || k === "good")
    return "text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-950/50";
  if (k === "fair") return "text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950/50";
  if (k === "poor" || k === "broken" || k === "retired")
    return "text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-950/50";
  return "text-neutral-600 bg-neutral-200 dark:text-neutral-300 dark:bg-neutral-800";
};

// Great-circle distance in km between two lat/lng points — used to pre-select the
// nearest job site after a scan.
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Downscale a picked image to <= maxDim on its long edge and return a JPEG data
// URL — keeps phone photos small so the base64 upload through Apps Script is fast.
function downscaleToDataUrl(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not decode the image."));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable."));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function ToolPhoto({ url, className }: { url: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        className={
          className +
          " flex items-center justify-center bg-neutral-100 text-[10px] text-neutral-400 dark:bg-white/5"
        }
      >
        no photo
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className + " object-cover"}
    />
  );
}

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  // ---- Inventory list: search / filter / edit --------------------------------
  const [q, setQ] = useState("");
  const [conditionFilter, setConditionFilter] = useState("All");
  const [jobFilter, setJobFilter] = useState("All");

  const [editing, setEditing] = useState<Tool | null>(null);
  const [form, setForm] = useState<Tool | null>(null);
  const [newPhoto, setNewPhoto] = useState<string>(""); // downscaled data URL, if replacing
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // ---- Scan → relocate flow (the former Tool Tracker page) --------------------
  const [scanning, setScanning] = useState(false); // camera overlay open
  const [scanErr, setScanErr] = useState("");
  const [scanTool, setScanTool] = useState<Tool | null>(null); // relocate target
  const [scanProjectId, setScanProjectId] = useState("");
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState("");
  const [relocating, setRelocating] = useState(false);
  const [relocErr, setRelocErr] = useState("");
  const [relocDone, setRelocDone] = useState<{ tool: Tool; locationLabel: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tools");
        const json = await res.json();
        if (!res.ok || json.ok === false) {
          setLoadErr(json.error || "Could not load tools.");
          return;
        }
        setTools(json.tools ?? []);
        setProjects(json.projects ?? []);
      } catch (e) {
        setLoadErr(e instanceof Error ? e.message : "Could not load tools.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const conditions = useMemo(() => {
    const set = new Set<string>();
    tools.forEach((t) => t.condition && set.add(t.condition));
    return Array.from(set).sort();
  }, [tools]);

  // Distinct job sites present on tools → dropdown of {id, label}, plus Unassigned.
  const jobOptions = useMemo(() => {
    const m = new Map<string, string>();
    let hasUnassigned = false;
    tools.forEach((t) => {
      if (t.location) m.set(t.location, t.locationLabel || t.location);
      else hasUnassigned = true;
    });
    const opts = Array.from(m, ([id, label]) => ({ id, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    return { opts, hasUnassigned };
  }, [tools]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tools.filter((t) => {
      if (conditionFilter !== "All" && t.condition !== conditionFilter) return false;
      if (jobFilter !== "All") {
        if (jobFilter === "__none__" ? t.location : t.location !== jobFilter) return false;
      }
      if (!needle) return true;
      return `${t.id} ${t.name} ${t.type} ${t.toolGroup} ${t.serial} ${t.locationLabel}`
        .toLowerCase()
        .includes(needle);
    });
  }, [tools, q, conditionFilter, jobFilter]);

  // Group the filtered tools by ToolType, sorted; tools within a group by name.
  const groups = useMemo(() => {
    const m = new Map<string, Tool[]>();
    view.forEach((t) => {
      const key = t.type || "Uncategorized";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(t);
    });
    return Array.from(m, ([type, list]) => ({
      type,
      list: list.slice().sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.type.localeCompare(b.type));
  }, [view]);

  // Projects ordered nearest-first when we have a GPS fix, else alphabetical.
  const orderedProjects = useMemo(() => {
    if (!here) return projects;
    const withD = projects.map((p) => ({
      p,
      d: p.lat != null && p.lng != null ? haversineKm(here, { lat: p.lat, lng: p.lng }) : Infinity,
    }));
    withD.sort((a, b) => a.d - b.d);
    return withD.map((x) => x.p);
  }, [projects, here]);

  function mergeTool(updated: Tool) {
    setTools((list) => list.map((t) => (t.id === updated.id ? updated : t)));
  }

  // ---- Edit modal ------------------------------------------------------------
  function openEdit(t: Tool) {
    setEditing(t);
    setForm({ ...t });
    setNewPhoto("");
    setSaveErr("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function closeEdit() {
    setEditing(null);
    setForm(null);
    setNewPhoto("");
  }

  async function onPickPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setNewPhoto(await downscaleToDataUrl(file));
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : "Could not read the image.");
    }
  }

  async function save() {
    if (!form || !editing) return;
    setSaving(true);
    setSaveErr("");
    try {
      // 1. Changed text/location fields only (keeps untouched cells' formatting).
      const changes: Record<string, string> = {};
      (["name", "type", "condition", "toolGroup", "serial", "accessories", "location"] as EditableKey[]).forEach(
        (k) => {
          if (form[k] !== editing[k]) changes[k] = form[k];
        },
      );
      let latest: Tool | null = null;
      if (Object.keys(changes).length > 0) {
        const res = await fetch("/api/tools", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolId: editing.id, fields: changes }),
        });
        const json = await res.json();
        if (!res.ok || json.ok === false) throw new Error(json.error || "Save failed.");
        latest = json.tool as Tool;
      }
      // 2. New photo, if one was picked.
      if (newPhoto) {
        const res = await fetch("/api/tools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toolId: editing.id, imageBase64: newPhoto, mimeType: "image/jpeg" }),
        });
        const json = await res.json();
        if (!res.ok || json.ok === false) throw new Error(json.error || "Photo upload failed.");
        latest = json.tool as Tool;
      }
      if (latest) mergeTool(latest);
      closeEdit();
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // ---- Scan → relocate -------------------------------------------------------
  function startScan() {
    setScanErr("");
    setScanTool(null);
    setScanProjectId("");
    setHere(null);
    setGeoMsg("");
    setRelocErr("");
    setRelocDone(null);
    setScanning(true);
  }

  function closeScan() {
    setScanning(false);
    setScanTool(null);
    setScanProjectId("");
    setHere(null);
    setGeoMsg("");
    setRelocErr("");
    setRelocDone(null);
  }

  function pickNearest(fix: { lat: number; lng: number }) {
    let best: Project | null = null;
    let bestD = Infinity;
    for (const p of projects) {
      if (p.lat == null || p.lng == null) continue;
      const d = haversineKm(fix, { lat: p.lat, lng: p.lng });
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      setScanProjectId(best.id);
      setGeoMsg(`Nearest job site: ${best.label} (${bestD.toFixed(1)} km away).`);
    } else {
      setGeoMsg("Got your location, but no job site has coordinates — pick one below.");
    }
  }

  function onScan(text: string) {
    setScanning(false);
    const raw = text.trim();
    // The sticker may encode the bare id or a URL like ?tool=tool087.
    const id = (raw.match(/tool=([^&\s]+)/i)?.[1] ?? raw).trim();
    const found = tools.find((t) => t.id.toLowerCase() === id.toLowerCase());
    if (!found) {
      setScanErr(`Scanned "${id}", which isn't a known tool. Try again.`);
      return;
    }
    setScanErr("");
    setScanTool(found);
    setScanProjectId(found.location || "");

    // Ask for GPS to pre-select the nearest job site (best-effort).
    if (navigator.geolocation) {
      setGeoMsg("Finding your location…");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setHere(fix);
          pickNearest(fix);
        },
        () => setGeoMsg("Location unavailable — pick the job site below."),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    } else {
      setGeoMsg("This device can't share location — pick the job site below.");
    }
  }

  async function saveRelocation() {
    if (!scanTool || !scanProjectId) return;
    setRelocating(true);
    setRelocErr("");
    try {
      // Scans go through /api/tool-tracker so the move is attributed to the
      // signed-in user (Lastscan / LastScanEmail) — unlike a plain edit-modal save.
      const res = await fetch("/api/tool-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: scanTool.id, projectId: scanProjectId }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setRelocErr(json.error || "Save failed.");
        return;
      }
      const updated = (json.tool as Tool) ?? null;
      if (updated) mergeTool(updated);
      setRelocDone({
        tool: updated ?? scanTool,
        locationLabel: json.locationLabel ?? updated?.locationLabel ?? "",
      });
    } catch (e) {
      setRelocErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setRelocating(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-6">
      <PageHeader
        title="Tools"
        description="The tool inventory — search, edit, or scan a tool's QR sticker to relocate it."
        actions={
          <Button variant="primary" size="sm" onClick={startScan} disabled={loading || !!loadErr}>
            Scan tool
          </Button>
        }
        className="!mb-3"
      />

      {/* Controls */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, id, type, serial, location…"
          className={inputCls + " min-w-[12rem] flex-1"}
        />
        <select
          value={conditionFilter}
          onChange={(e) => setConditionFilter(e.target.value)}
          className={inputCls + " w-auto"}
        >
          <option value="All">All conditions</option>
          {conditions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={jobFilter}
          onChange={(e) => setJobFilter(e.target.value)}
          className={inputCls + " w-auto"}
        >
          <option value="All">All job sites</option>
          {jobOptions.hasUnassigned && <option value="__none__">Unassigned</option>}
          {jobOptions.opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {loadErr && (
        <Banner tone="error" className="mb-4">
          {loadErr}
        </Banner>
      )}
      {scanErr && (
        <Banner tone="warning" className="mb-4">
          {scanErr}
        </Banner>
      )}
      {loading && <Loading label="Loading tools…" />}

      {!loading && !loadErr && (
        <>
          <div className="mb-2 text-xs text-neutral-500">
            {view.length} of {tools.length} tools
          </div>

          {groups.length === 0 && (
            <div className="rounded-xl border border-dashed border-neutral-300 px-6 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
              No matching tools.
            </div>
          )}

          <div className="space-y-5">
            {groups.map((g) => (
              <section key={g.type}>
                <h2 className="mb-1.5 flex items-baseline gap-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                  {g.type}
                  <span className="text-xs font-normal text-neutral-400">{g.list.length}</span>
                </h2>
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-700/60 dark:bg-ink-raised">
                  {g.list.map((t, i) => (
                    <div
                      key={t.id}
                      className={
                        "flex items-center gap-3 px-3 py-2.5 " +
                        (i > 0 ? "border-t border-neutral-100 dark:border-neutral-800/70" : "")
                      }
                    >
                      <ToolPhoto url={t.photoUrl} className="h-11 w-11 shrink-0 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.name || t.id}</div>
                        <div className="truncate text-xs text-neutral-500">
                          {t.locationLabel || "Unassigned"}
                        </div>
                      </div>
                      {t.condition && (
                        <span
                          className={`hidden rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${conditionClass(
                            t.condition,
                          )}`}
                        >
                          {t.condition}
                        </span>
                      )}
                      <button
                        onClick={() => openEdit(t)}
                        className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold transition hover:border-accent hover:text-accent dark:border-neutral-600"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {/* Scan camera overlay */}
      {scanning && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setScanning(false)}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-4 dark:bg-ink-overlay sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h2 className="mb-3 text-lg font-bold">Scan a tool</h2>
            <div className="space-y-3">
              <QrScanner
                onDetect={onScan}
                onError={(m) => {
                  setScanErr(m);
                  setScanning(false);
                }}
              />
              <Button variant="secondary" className="w-full" onClick={() => setScanning(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Relocate confirm / success overlay (after a scan) */}
      {scanTool && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => !relocating && closeScan()}
        >
          <div
            className="w-full max-w-lg rounded-t-2xl bg-white p-4 dark:bg-ink-overlay sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            {relocDone ? (
              <>
                <div className="text-lg font-semibold text-green-700 dark:text-green-400">
                  Updated ✓
                </div>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  <span className="font-medium">{relocDone.tool.name || relocDone.tool.id}</span> →{" "}
                  {relocDone.locationLabel || "—"}
                </p>
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={closeScan}>
                    Done
                  </Button>
                  <Button variant="primary" className="flex-1" onClick={startScan}>
                    Scan another
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <ToolPhoto url={scanTool.photoUrl} className="h-14 w-14 shrink-0 rounded-lg" />
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">
                      {scanTool.name || scanTool.id}
                    </div>
                    <div className="text-sm text-neutral-500">
                      {scanTool.type}
                      {scanTool.id ? ` · ${scanTool.id}` : ""}
                    </div>
                    <div className="mt-0.5 text-sm text-neutral-500">
                      Currently: {scanTool.locationLabel || "—"}
                    </div>
                  </div>
                </div>

                <Label htmlFor="reloc-job">Set location to</Label>
                <select
                  id="reloc-job"
                  value={scanProjectId}
                  onChange={(ev) => setScanProjectId(ev.target.value)}
                  className={inputCls}
                >
                  <option value="">Select a job site…</option>
                  {/* Keep the current value selectable even if it isn't in the project list. */}
                  {scanProjectId && !orderedProjects.some((p) => p.id === scanProjectId) && (
                    <option value={scanProjectId}>{scanTool.locationLabel || scanProjectId}</option>
                  )}
                  {orderedProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {geoMsg && <p className="mt-1.5 text-xs text-neutral-500">{geoMsg}</p>}

                {relocErr && (
                  <Banner tone="error" className="mt-3">
                    {relocErr}
                  </Banner>
                )}

                <div className="mt-4 flex gap-2">
                  <Button
                    variant="primary"
                    className="flex-1"
                    disabled={!scanProjectId || relocating}
                    onClick={saveRelocation}
                  >
                    {relocating ? "Saving…" : "Update location"}
                  </Button>
                  <Button variant="secondary" onClick={closeScan} disabled={relocating}>
                    Cancel
                  </Button>
                </div>

                <button
                  onClick={() => {
                    const t = scanTool;
                    closeScan();
                    openEdit(t);
                  }}
                  disabled={relocating}
                  className="mt-3 w-full text-center text-xs font-semibold text-neutral-500 underline-offset-2 transition hover:text-accent hover:underline disabled:opacity-50"
                >
                  Edit full details instead
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editing && form && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onClick={() => !saving && closeEdit()}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 dark:bg-ink-overlay sm:rounded-2xl"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-bold">{editing.name || editing.id}</h2>
              <span className="text-xs text-neutral-500">ID: {editing.id}</span>
            </div>

            {/* Photo */}
            <div className="mb-4 flex items-center gap-3">
              <ToolPhoto
                url={newPhoto || form.photoUrl}
                className="h-20 w-20 shrink-0 rounded-lg border border-neutral-200 dark:border-neutral-700"
              />
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPickPhoto}
                  className="hidden"
                />
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  {newPhoto ? "Choose a different photo" : "Replace photo"}
                </Button>
                {newPhoto && (
                  <p className="mt-1 text-xs text-neutral-500">New photo ready — saves on “Save”.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TEXT_FIELDS.map((f) => (
                <div key={f.key} className={f.wide ? "sm:col-span-2" : ""}>
                  <Label>{f.label}</Label>
                  <input
                    value={form[f.key]}
                    onChange={(ev) => setForm({ ...form, [f.key]: ev.target.value })}
                    className={inputCls}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <Label>Location (job site)</Label>
                <select
                  value={form.location}
                  onChange={(ev) => setForm({ ...form, location: ev.target.value })}
                  className={inputCls}
                >
                  <option value="">— Unassigned —</option>
                  {/* Keep the current value selectable even if not in the project list. */}
                  {form.location && !projects.some((p) => p.id === form.location) && (
                    <option value={form.location}>{editing.locationLabel || form.location}</option>
                  )}
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {saveErr && (
              <Banner tone="error" className="mt-3">
                {saveErr}
              </Banner>
            )}

            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={closeEdit} disabled={saving}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
