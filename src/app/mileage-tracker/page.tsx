"use client";

import { useEffect, useMemo, useState } from "react";

import { JobPicker } from "@/components/JobPicker";
import { Banner, Card, Label, Loading, PageHeader, Select, Textarea } from "@/components/ui";

/**
 * /mileage-tracker — one tap to start a trip, one tap to end it.
 *
 * A browser PWA can't track GPS in the background (the page is suspended once
 * the phone locks), so this captures the START point + time on the first tap and
 * the END point + time on the second; /api/mileage turns the two endpoints into
 * driving miles + street addresses via Google Directions and logs the trip to
 * the Project Database "Mileage" tab. The in-progress trip is mirrored to
 * localStorage, so the driver can lock the phone / close the app between taps and
 * reopen it at the destination to tap "End."
 */

interface Employee {
  name: string;
  position: string;
  id: string;
}

interface JobRef {
  id: string;
  name: string;
  customer?: string;
}

interface Project {
  id: string;
  label: string;
  lat: number | null;
  lng: number | null;
}

interface StartFix {
  startLat: number;
  startLng: number;
  startTime: string; // ISO
}

interface Summary {
  miles: number | null;
  startAddress: string;
  endAddress: string;
  durationMin: number;
  jobLabel: string;
  purpose: string;
  warning?: string;
}

interface TripResult {
  ok?: boolean;
  tripId?: string;
  miles?: number | null;
  date?: string;
  startAddress?: string;
  endAddress?: string;
  warning?: string;
  error?: string;
}

const LS_TRIP = "mileage.activeTrip";
const LS_DRIVER = "mileage.driver";

// Great-circle distance in km — reused from the tools page to label the nearest
// job site (display only; the billed miles come from Google Directions).
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

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This device can't share its location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0, // a fresh fix — never a stale cached location for mileage
    });
  });
}

function geoError(e: unknown): string {
  const err = e as GeolocationPositionError | Error | undefined;
  if (err && "code" in err) {
    if (err.code === 1) return "Location permission was denied. Allow location for this site, then try again.";
    if (err.code === 2) return "Location is unavailable right now — move to open sky and try again.";
    if (err.code === 3) return "Getting your location timed out — try again.";
  }
  return err instanceof Error ? err.message : "Could not get your location.";
}

function fmtDuration(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

const jobRefLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

export default function MileageTrackerPage() {
  const [phase, setPhase] = useState<"idle" | "active" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reference data.
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionUser, setSessionUser] = useState<{ name?: string; email?: string } | null>(null);

  // Trip fields (kept across idle/active so a mid-trip edit sticks).
  const [driver, setDriver] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobLabel, setJobLabel] = useState("");
  const [purpose, setPurpose] = useState("");

  const [start, setStart] = useState<StartFix | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  // --- Load reference data + restore an in-progress trip on mount. ----------
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/employees");
        const json = await res.json();
        if (res.ok && json.ok !== false) setEmployees(json.employees ?? []);
      } catch {}
    })();
    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
    fetch("/api/tool-tracker")
      .then((r) => r.json())
      .then((j) => setProjects(j.projects ?? []))
      .catch(() => {});
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((s) => setSessionUser(s?.user ?? null))
      .catch(() => {});

    try {
      const raw = localStorage.getItem(LS_TRIP);
      if (raw) {
        const t = JSON.parse(raw);
        if (Number.isFinite(t.startLat) && Number.isFinite(t.startLng) && t.startTime) {
          setStart({ startLat: t.startLat, startLng: t.startLng, startTime: t.startTime });
          setDriver(t.driver ?? "");
          setJobId(t.jobId ?? "");
          setJobLabel(t.jobLabel ?? "");
          setPurpose(t.purpose ?? "");
          setPhase("active");
        }
      }
    } catch {}
  }, []);

  // Auto-fill the driver once (device memory wins, then the signed-in user).
  useEffect(() => {
    if (driver || !employees.length) return;
    let remembered = "";
    try {
      remembered = localStorage.getItem(LS_DRIVER) ?? "";
    } catch {}
    if (remembered && employees.some((e) => e.name === remembered)) {
      setDriver(remembered);
      return;
    }
    const n = sessionUser?.name?.trim().toLowerCase();
    const local = sessionUser?.email?.split("@")[0]?.toLowerCase();
    const match =
      (n && employees.find((e) => e.name.toLowerCase() === n)) ||
      (local && employees.find((e) => e.name.toLowerCase().replace(/\s+/g, ".").includes(local)));
    if (match) setDriver(match.name);
  }, [employees, sessionUser, driver]);

  // Persist the driver choice for next time.
  useEffect(() => {
    if (!driver) return;
    try {
      localStorage.setItem(LS_DRIVER, driver);
    } catch {}
  }, [driver]);

  // Mirror the in-progress trip to localStorage so a lock/reopen can resume it.
  useEffect(() => {
    if (phase !== "active" || !start) return;
    try {
      localStorage.setItem(LS_TRIP, JSON.stringify({ ...start, driver, jobId, jobLabel, purpose }));
    } catch {}
  }, [phase, start, driver, jobId, jobLabel, purpose]);

  // Tick the elapsed clock while a trip is active.
  useEffect(() => {
    if (phase !== "active") return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const nearestToStart = useMemo(() => {
    if (!start) return null;
    const scored = projects
      .filter((p) => p.lat != null && p.lng != null)
      .map((p) => ({ p, d: haversineKm({ lat: start.startLat, lng: start.startLng }, { lat: p.lat as number, lng: p.lng as number }) }))
      .sort((a, b) => a.d - b.d);
    return scored.length && scored[0].d < 2 ? scored[0].p.label : null;
  }, [start, projects]);

  const elapsed = start ? fmtDuration(Math.max(0, Math.round((nowMs - new Date(start.startTime).getTime()) / 60000))) : "";

  function onPickJob(id: string) {
    setJobId(id);
    const j = jobs.find((x) => x.id === id);
    setJobLabel(j ? jobRefLabel(j) : "");
  }

  async function startTrip() {
    setErr("");
    setBusy(true);
    try {
      const pos = await getPosition();
      setStart({
        startLat: pos.coords.latitude,
        startLng: pos.coords.longitude,
        startTime: new Date().toISOString(),
      });
      setPhase("active");
    } catch (e) {
      setErr(geoError(e));
    } finally {
      setBusy(false);
    }
  }

  async function endTrip() {
    if (!start) return;
    setErr("");
    setBusy(true);
    try {
      const pos = await getPosition();
      const endTime = new Date().toISOString();
      const res = await fetch("/api/mileage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startLat: start.startLat,
          startLng: start.startLng,
          startTime: start.startTime,
          endLat: pos.coords.latitude,
          endLng: pos.coords.longitude,
          endTime,
          driver,
          jobId,
          jobLabel,
          purpose: purpose.trim(),
        }),
      });
      const json: TripResult = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not save the trip. Your start point is still saved — try End again.");
        return;
      }
      const durationMin = Math.max(0, Math.round((new Date(endTime).getTime() - new Date(start.startTime).getTime()) / 60000));
      setSummary({
        miles: json.miles ?? null,
        startAddress: json.startAddress ?? "",
        endAddress: json.endAddress ?? "",
        durationMin,
        jobLabel,
        purpose: purpose.trim(),
        warning: json.warning,
      });
      try {
        localStorage.removeItem(LS_TRIP);
      } catch {}
      setStart(null);
      setPhase("done");
    } catch (e) {
      setErr(geoError(e));
    } finally {
      setBusy(false);
    }
  }

  function logAnother() {
    setSummary(null);
    setPurpose("");
    setJobId("");
    setJobLabel("");
    setErr("");
    setPhase("idle");
  }

  function cancelTrip() {
    try {
      localStorage.removeItem(LS_TRIP);
    } catch {}
    setStart(null);
    setErr("");
    setPhase("idle");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Mileage"
        description="One tap to start, one tap to end. Miles are figured from where you start and stop."
      />

      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      {/* --------------------------------------------------------------- IDLE */}
      {phase === "idle" && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <Label htmlFor="mlg-driver">Driver</Label>
              <Select id="mlg-driver" value={driver} onChange={(e) => setDriver(e.target.value)}>
                <option value="">Select driver…</option>
                {employees.map((e) => (
                  <option key={e.id || e.name} value={e.name}>
                    {e.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label>Job (optional)</Label>
              <div className="flex">
                <JobPicker value={jobId} onChange={onPickJob} />
              </div>
            </div>

            <div>
              <Label htmlFor="mlg-purpose">Purpose (optional)</Label>
              <Textarea
                id="mlg-purpose"
                rows={2}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. material pickup, client meeting"
              />
            </div>
          </Card>

          <button
            type="button"
            onClick={startTrip}
            disabled={busy}
            className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Getting your location…" : "Start trip"}
          </button>

          <p className="text-center text-xs text-neutral-500">
            Tap Start when you leave — you can lock your phone. Reopen and tap End when you arrive.
            Log each stop of a multi-stop trip as its own leg.
          </p>
        </div>
      )}

      {/* ------------------------------------------------------------- ACTIVE */}
      {phase === "active" && start && (
        <div className="space-y-4">
          <Card className="text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-accent dark:text-accent-soft">
              <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-accent" aria-hidden />
              Trip in progress
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums">{elapsed || "0 min"}</div>
            <p className="mt-1 text-xs text-neutral-500">
              Started {new Date(start.startTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {nearestToStart ? ` · near ${nearestToStart}` : ""}
            </p>
          </Card>

          <Card className="space-y-3">
            <div>
              <Label>Job (optional)</Label>
              <div className="flex">
                <JobPicker value={jobId} onChange={onPickJob} />
              </div>
            </div>
            <div>
              <Label htmlFor="mlg-purpose-a">Purpose (optional)</Label>
              <Textarea
                id="mlg-purpose-a"
                rows={2}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. material pickup, client meeting"
              />
            </div>
          </Card>

          <button
            type="button"
            onClick={endTrip}
            disabled={busy}
            className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving trip…" : "End trip"}
          </button>

          <button
            type="button"
            onClick={cancelTrip}
            disabled={busy}
            className="mx-auto block text-xs text-neutral-500 underline-offset-2 hover:text-red-600 hover:underline disabled:opacity-40"
          >
            Cancel this trip
          </button>
        </div>
      )}

      {/* --------------------------------------------------------------- DONE */}
      {phase === "done" && summary && (
        <div className="space-y-4">
          <Card className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Trip logged</p>
            <div className="mt-1 text-4xl font-bold tabular-nums">
              {summary.miles == null ? "—" : summary.miles} <span className="text-lg font-semibold">mi</span>
            </div>
            {summary.durationMin > 0 && (
              <p className="mt-1 text-sm text-neutral-500">{fmtDuration(summary.durationMin)} driving</p>
            )}
          </Card>

          {summary.warning && (
            <Banner tone="warning">{summary.warning}</Banner>
          )}

          <Card className="space-y-2 text-sm">
            {summary.startAddress && (
              <Row label="From" value={summary.startAddress} />
            )}
            {summary.endAddress && <Row label="To" value={summary.endAddress} />}
            {summary.jobLabel && <Row label="Job" value={summary.jobLabel} />}
            {summary.purpose && <Row label="Purpose" value={summary.purpose} />}
          </Card>

          <button
            type="button"
            onClick={logAnother}
            className="w-full rounded-2xl bg-accent px-4 py-5 text-base font-bold text-white shadow-sm transition hover:bg-accent-hover"
          >
            Log another trip
          </button>
        </div>
      )}

      {phase === "idle" && !employees.length && !err && (
        <div className="mt-4">
          <Loading label="Loading drivers…" />
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}
