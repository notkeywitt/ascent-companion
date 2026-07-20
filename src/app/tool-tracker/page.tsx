"use client";

import { useEffect, useMemo, useState } from "react";

import { QrScanner } from "@/components/QrScanner";
import { Banner, Button, Label, Loading, PageHeader, Select } from "@/components/ui";

interface Tool {
  id: string;
  name: string;
  type: string;
  condition: string;
  location: string; // ProjectID
  locationLabel: string; // "Customer - Project"
  photoUrl: string;
}

interface Project {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

interface SaveResult {
  ok: boolean;
  locationLabel?: string;
  error?: string;
}

// Great-circle distance in km between two lat/lng points.
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

export default function ToolTrackerPage() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState("");

  const [tool, setTool] = useState<Tool | null>(null);
  const [projectId, setProjectId] = useState("");
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [geoMsg, setGeoMsg] = useState("");

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [saved, setSaved] = useState<SaveResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/tool-tracker");
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

  // Projects ordered nearest-first when we have a fix, else alphabetical.
  const orderedProjects = useMemo(() => {
    if (!here) return projects;
    const withD = projects.map((p) => ({
      p,
      d: p.lat != null && p.lng != null ? haversineKm(here, { lat: p.lat, lng: p.lng }) : Infinity,
    }));
    withD.sort((a, b) => a.d - b.d);
    return withD.map((x) => x.p);
  }, [projects, here]);

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
      setProjectId(best.id);
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
    setTool(found);
    setProjectId(found.location || "");

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

  async function save() {
    if (!tool || !projectId) return;
    setSaving(true);
    setSaveErr("");
    try {
      const res = await fetch("/api/tool-tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId: tool.id, projectId }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setSaveErr(json.error || "Save failed.");
        return;
      }
      setSaved(json);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setTool(null);
    setProjectId("");
    setHere(null);
    setGeoMsg("");
    setScanErr("");
    setSaveErr("");
    setSaved(null);
  }

  const cardCls =
    "rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised";

  // ---- Success screen -------------------------------------------------------
  if (saved?.ok && tool) {
    return (
      <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
        <PageHeader title="Tool Tracker" className="!mb-0" />
        <div className={"mt-4 " + cardCls}>
          <div className="text-lg font-semibold text-green-700 dark:text-green-400">Updated ✓</div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            <span className="font-medium">{tool.name}</span> → {saved.locationLabel}
          </p>
          <Button variant="primary" className="mt-4 w-full" onClick={reset}>
            Scan another tool
          </Button>
        </div>
      </main>
    );
  }

  // ---- Confirm screen -------------------------------------------------------
  if (tool) {
    return (
      <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
        <PageHeader title="Tool Tracker" className="!mb-4" />
        <div className={cardCls}>
          <div className="flex items-center gap-3">
            {tool.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={tool.photoUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-lg object-cover"
              />
            ) : null}
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{tool.name}</div>
              <div className="text-sm text-neutral-500">
                {tool.type}
                {tool.id ? ` · ${tool.id}` : ""}
              </div>
              <div className="mt-0.5 text-sm text-neutral-500">
                Currently: {tool.locationLabel || "—"}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="tt-job">Set location to</Label>
            <Select id="tt-job" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Select a job site…</option>
              {orderedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            {geoMsg && <p className="mt-1.5 text-xs text-neutral-500">{geoMsg}</p>}
          </div>

          {saveErr && (
            <Banner tone="error" className="mt-3">
              {saveErr}
            </Banner>
          )}

          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              className="flex-1"
              disabled={!projectId || saving}
              onClick={save}
            >
              {saving ? "Saving…" : "Update location"}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </main>
    );
  }

  // ---- Scan screen ----------------------------------------------------------
  return (
    <main className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <PageHeader
        title="Tool Tracker"
        description="Scan a tool's QR sticker to set its location to the nearest job site."
        className="!mb-4"
      />

      {loadErr && (
        <Banner tone="error" className="mb-3">
          {loadErr}
        </Banner>
      )}
      {scanErr && (
        <Banner tone="warning" className="mb-3">
          {scanErr}
        </Banner>
      )}

      {loading ? (
        <Loading label="Loading tools…" />
      ) : scanning ? (
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
      ) : (
        <div className={cardCls}>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {tools.length} tools loaded. Point your camera at the sticker on the tool.
          </p>
          <Button
            variant="primary"
            className="mt-3 w-full"
            disabled={!!loadErr}
            onClick={() => {
              setScanErr("");
              setScanning(true);
            }}
          >
            Start scanning
          </Button>
        </div>
      )}
    </main>
  );
}
