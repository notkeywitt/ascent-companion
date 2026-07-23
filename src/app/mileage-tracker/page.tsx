"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { JobPicker } from "@/components/JobPicker";
import {
  Banner,
  Card,
  EmptyState,
  Input,
  Label,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

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
  email?: string;
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

interface Waypoint {
  lat: number;
  lng: number;
  time: string; // ISO
}

interface Summary {
  miles: number | null;
  startAddress: string;
  endAddress: string;
  via: string;
  stops: number;
  durationMin: number;
  jobLabel: string;
  purpose: string;
  startLatLng: string; // "lat,lng" for the route map
  endLatLng: string;
  polyline: string;
  warning?: string;
}

interface TripResult {
  ok?: boolean;
  tripId?: string;
  miles?: number | null;
  date?: string;
  startAddress?: string;
  endAddress?: string;
  via?: string;
  stops?: number;
  polyline?: string;
  warning?: string;
  error?: string;
}

const LS_TRIP = "mileage.activeTrip";
const LS_DRIVER = "mileage.driver";

// Auto-tracking: drop a breadcrumb only when it's this far from the last one (km)
// — filters GPS jitter and idling. The Routes API caps intermediates at 25, so
// we downsample the trail to this many before requesting the route.
const TRAIL_MIN_GAP_KM = 0.08;
const MAX_INTERMEDIATES = 23;

// Evenly reduce an ordered list to at most `max` items, keeping first and last.
function downsample<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const out: T[] = [];
  const step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

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

const LATLNG_RE = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/;
const isLatLng = (s: string) => LATLNG_RE.test(s);

// Static route map for a trip, served through our key-hiding proxy. Renders null
// unless both endpoints are valid coordinates (so manual entries show no map).
function TripMap({
  start,
  end,
  polyline,
  className = "",
}: {
  start: string;
  end: string;
  polyline?: string;
  className?: string;
}) {
  if (!isLatLng(start) || !isLatLng(end)) return null;
  const p = new URLSearchParams({ start, end, size: "600x280" });
  if (polyline) p.set("path", polyline);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/mileage/map?${p.toString()}`}
      alt="Trip route map"
      loading="lazy"
      className={className}
    />
  );
}

// Local date as YYYY-MM-DD for the manual-entry <input type="date"> default.
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Current month as YYYY-MM for the history <input type="month"> default.
function thisMonth(): string {
  return today().slice(0, 7);
}

// A stable per-trip key so a save that's retried (e.g. after a dropped signal)
// doesn't create a duplicate — the server dedupes on it.
function genKey(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {}
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function MileageTrackerPage() {
  const [phase, setPhase] = useState<"idle" | "active" | "done" | "manual" | "history">("idle");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reference data.
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [jobs, setJobs] = useState<JobRef[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionUser, setSessionUser] = useState<{ name?: string; email?: string } | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  // Trip fields (kept across idle/active so a mid-trip edit sticks).
  const [driver, setDriver] = useState("");
  const [jobId, setJobId] = useState("");
  const [jobLabel, setJobLabel] = useState("");
  const [purpose, setPurpose] = useState("");

  const [start, setStart] = useState<StartFix | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]); // stops the driver marked
  const [trail, setTrail] = useState<Waypoint[]>([]); // auto-tracked breadcrumbs
  const trackWatchRef = useRef<number | null>(null);
  const [addingStop, setAddingStop] = useState(false);
  const [tripKey, setTripKey] = useState(""); // idempotency key for the active GPS trip
  const [nowMs, setNowMs] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null);

  // Manual entry (no GPS — a forgotten or after-the-fact trip).
  const [miles, setMiles] = useState("");
  const [manualDate, setManualDate] = useState(today());
  const [manualKey, setManualKey] = useState(""); // idempotency key for a manual save

  // History view. isAdmin/users come from the server (which enforces access).
  const [trips, setTrips] = useState<Record<string, string>[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState<string[]>([]);
  const [filterUser, setFilterUser] = useState("");
  const [filterMonth, setFilterMonth] = useState(thisMonth());
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyErr, setHistoryErr] = useState("");

  // Admin-only monthly PDF report.
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfErr, setPdfErr] = useState("");

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
      .catch(() => {})
      .finally(() => setSessionLoaded(true));

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
          setWaypoints(Array.isArray(t.waypoints) ? t.waypoints : []);
          setTrail(Array.isArray(t.trail) ? t.trail : []);
          setTripKey(t.tripKey ?? genKey());
          setPhase("active");
        }
      }
    } catch {}
  }, []);

  // Default the driver to whoever is signed in, matched to the roster by email
  // (reliable) then name. Only if that fails do we fall back to the last driver
  // used on this device. We wait for the session fetch to settle so the
  // signed-in user always gets first pick over a stale remembered choice.
  useEffect(() => {
    if (driver || !employees.length || !sessionLoaded) return;
    const email = sessionUser?.email?.trim().toLowerCase();
    const name = sessionUser?.name?.trim().toLowerCase();
    const signedIn =
      (email && employees.find((e) => (e.email ?? "").trim().toLowerCase() === email)) ||
      (name && employees.find((e) => e.name.trim().toLowerCase() === name));
    if (signedIn) {
      setDriver(signedIn.name);
      return;
    }
    let remembered = "";
    try {
      remembered = localStorage.getItem(LS_DRIVER) ?? "";
    } catch {}
    if (remembered && employees.some((e) => e.name === remembered)) setDriver(remembered);
  }, [employees, sessionUser, sessionLoaded, driver]);

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
      localStorage.setItem(LS_TRIP, JSON.stringify({ ...start, driver, jobId, jobLabel, purpose, waypoints, trail, tripKey }));
    } catch {}
  }, [phase, start, driver, jobId, jobLabel, purpose, waypoints, trail, tripKey]);

  // Tick the elapsed clock while a trip is active.
  useEffect(() => {
    if (phase !== "active") return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Auto-track the route: record breadcrumbs continuously while the app is open
  // and the screen is on. The browser suspends this when the phone locks / the
  // app is backgrounded (pausing the trail), and resumes when it's reopened —
  // and each time the app becomes visible we also grab a fresh point, so simply
  // reopening the app updates the route without tapping "Add a stop."
  useEffect(() => {
    if (phase !== "active") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    const append = (lat: number, lng: number) => {
      setTrail((prev) => {
        const last = prev[prev.length - 1];
        const anchor = last ?? (start ? { lat: start.startLat, lng: start.startLng } : null);
        if (anchor && haversineKm(anchor, { lat, lng }) < TRAIL_MIN_GAP_KM) return prev;
        return [...prev, { lat, lng, time: new Date().toISOString() }];
      });
    };

    trackWatchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (document.visibilityState === "visible") append(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 },
    );

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      navigator.geolocation.getCurrentPosition(
        (pos) => append(pos.coords.latitude, pos.coords.longitude),
        () => {},
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (trackWatchRef.current != null) navigator.geolocation.clearWatch(trackWatchRef.current);
      trackWatchRef.current = null;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [phase, start]);

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
      setWaypoints([]);
      setTrail([]);
      setTripKey(genKey());
      setPhase("active");
    } catch (e) {
      setErr(geoError(e));
    } finally {
      setBusy(false);
    }
  }

  // Mark a stop mid-trip. Captures the current point; the whole route
  // (start → stops → end) is computed as one trip when you tap End.
  async function addWaypoint() {
    setErr("");
    setAddingStop(true);
    setBusy(true);
    try {
      const pos = await getPosition();
      setWaypoints((w) => [
        ...w,
        { lat: pos.coords.latitude, lng: pos.coords.longitude, time: new Date().toISOString() },
      ]);
    } catch (e) {
      setErr(geoError(e));
    } finally {
      setBusy(false);
      setAddingStop(false);
    }
  }

  async function endTrip() {
    if (!start) return;
    setErr("");
    setBusy(true);
    try {
      const pos = await getPosition();
      const endTime = new Date().toISOString();
      // Route-shaping points = marked stops + auto trail, in travel (time) order,
      // downsampled to fit the Routes API's intermediate cap.
      const routePoints = downsample(
        [...waypoints, ...trail].sort((a, b) => a.time.localeCompare(b.time)),
        MAX_INTERMEDIATES,
      ).map((w) => ({ lat: w.lat, lng: w.lng }));
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
          waypoints: routePoints,
          stopPoints: waypoints.map((w) => ({ lat: w.lat, lng: w.lng })), // marked stops → Via
          stops: waypoints.length, // only explicitly-marked stops count as "stops"
          driver,
          jobId,
          jobLabel,
          purpose: purpose.trim(),
          clientKey: tripKey,
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
        via: json.via ?? "",
        stops: json.stops ?? waypoints.length,
        durationMin,
        jobLabel,
        purpose: purpose.trim(),
        startLatLng: `${start.startLat},${start.startLng}`,
        endLatLng: `${pos.coords.latitude},${pos.coords.longitude}`,
        polyline: json.polyline ?? "",
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

  async function saveManual() {
    setErr("");
    const m = Number(miles);
    if (!Number.isFinite(m) || m <= 0) {
      setErr("Enter the miles driven (a number greater than 0).");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/mileage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manual: true,
          miles: m,
          date: manualDate,
          driver,
          jobId,
          jobLabel,
          purpose: purpose.trim(),
          clientKey: manualKey,
        }),
      });
      const json: TripResult = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not save the trip.");
        return;
      }
      setSummary({
        miles: json.miles ?? m,
        startAddress: "",
        endAddress: "",
        via: "",
        stops: 0,
        durationMin: 0,
        jobLabel,
        purpose: purpose.trim(),
        startLatLng: "",
        endLatLng: "",
        polyline: "",
      });
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the trip.");
    } finally {
      setBusy(false);
    }
  }

  function logAnother() {
    setSummary(null);
    setPurpose("");
    setJobId("");
    setJobLabel("");
    setMiles("");
    setManualDate(today());
    setWaypoints([]);
    setTrail([]);
    setErr("");
    setPhase("idle");
  }

  function cancelTrip() {
    try {
      localStorage.removeItem(LS_TRIP);
    } catch {}
    setStart(null);
    setWaypoints([]);
    setTrail([]);
    setErr("");
    setPhase("idle");
  }

  // Load the logged miles. The server scopes the result to the signed-in user
  // (or all trips for an admin) and honors the month/user filters.
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    setHistoryErr("");
    try {
      const params = new URLSearchParams();
      if (filterMonth) params.set("month", filterMonth);
      if (filterUser) params.set("user", filterUser);
      const res = await fetch(`/api/mileage?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setHistoryErr(json.error || "Could not load miles.");
        return;
      }
      setIsAdmin(!!json.isAdmin);
      setUsers(json.users ?? []);
      setTrips(json.trips ?? []);
    } catch (e) {
      setHistoryErr(e instanceof Error ? e.message : "Could not load miles.");
    } finally {
      setLoadingHistory(false);
    }
  }, [filterMonth, filterUser]);

  useEffect(() => {
    if (phase === "history") loadHistory();
  }, [phase, loadHistory]);

  const totalMiles = useMemo(() => {
    const sum = trips.reduce((s, t) => s + (Number(t["Miles"]) || 0), 0);
    return Math.round(sum * 10) / 10;
  }, [trips]);

  // Admin: render the whole selected month (all drivers) to a PDF in Drive.
  async function createPdf() {
    if (!filterMonth) {
      setPdfErr("Pick a month first.");
      setPdfUrl("");
      return;
    }
    setPdfBusy(true);
    setPdfErr("");
    setPdfUrl("");
    try {
      const res = await fetch("/api/mileage/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: filterMonth }),
      });
      const json = await res.json();
      if (!res.ok || json.ok === false) {
        setPdfErr(json.error || "Could not create the PDF.");
        return;
      }
      setPdfUrl(json.pdfUrl || "");
    } catch (e) {
      setPdfErr(e instanceof Error ? e.message : "Could not create the PDF.");
    } finally {
      setPdfBusy(false);
    }
  }

  // A new month/driver makes any generated PDF stale — clear it.
  function clearPdf() {
    setPdfUrl("");
    setPdfErr("");
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
            Tap Start when you leave. The app records your route while it&apos;s open, and picks it
            back up each time you reopen it — so just reopening updates the route. Lock the phone
            freely; tap End when you arrive. Miles cover the whole route.
          </p>

          <div className="flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => {
                setErr("");
                setManualKey(genKey());
                setPhase("manual");
              }}
              className="text-sm font-semibold text-accent underline-offset-2 hover:underline dark:text-accent-soft"
            >
              Add miles manually
            </button>
            <span className="text-neutral-300 dark:text-neutral-600" aria-hidden>
              ·
            </span>
            <button
              type="button"
              onClick={() => {
                setErr("");
                setPhase("history");
              }}
              className="text-sm font-semibold text-accent underline-offset-2 hover:underline dark:text-accent-soft"
            >
              View logged miles
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------- MANUAL */}
      {phase === "manual" && (
        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <Label htmlFor="mlg-miles">Miles</Label>
              <Input
                id="mlg-miles"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="e.g. 24.5"
              />
            </div>

            <div>
              <Label htmlFor="mlg-date">Date</Label>
              <Input
                id="mlg-date"
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="mlg-driver-m">Driver</Label>
              <Select id="mlg-driver-m" value={driver} onChange={(e) => setDriver(e.target.value)}>
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
              <Label htmlFor="mlg-purpose-m">Purpose (optional)</Label>
              <Textarea
                id="mlg-purpose-m"
                rows={2}
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. material pickup, client meeting"
              />
            </div>
          </Card>

          <button
            type="button"
            onClick={saveManual}
            disabled={busy}
            className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Saving…" : "Save miles"}
          </button>

          <button
            type="button"
            onClick={() => {
              setErr("");
              setPhase("idle");
            }}
            disabled={busy}
            className="mx-auto block text-xs text-neutral-500 underline-offset-2 hover:text-accent hover:underline disabled:opacity-40 dark:hover:text-accent-soft"
          >
            Back
          </button>
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
            <p className="mt-1 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
              Auto-tracking route{trail.length > 0 ? ` · ${trail.length} point${trail.length === 1 ? "" : "s"}` : ""}
            </p>
            {waypoints.length > 0 && (
              <p className="mt-1 text-xs font-semibold text-accent dark:text-accent-soft">
                {waypoints.length} stop{waypoints.length === 1 ? "" : "s"} marked
              </p>
            )}
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
            onClick={addWaypoint}
            disabled={busy}
            className="w-full rounded-2xl border border-accent px-4 py-4 text-base font-semibold text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-accent-soft"
          >
            {addingStop ? "Marking stop…" : waypoints.length ? "Add another stop" : "Add a stop"}
          </button>

          <button
            type="button"
            onClick={endTrip}
            disabled={busy}
            className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && !addingStop ? "Saving trip…" : "End trip"}
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
              <p className="mt-1 text-sm text-neutral-500">
                {fmtDuration(summary.durationMin)} driving
                {summary.stops > 0 ? ` · ${summary.stops} stop${summary.stops === 1 ? "" : "s"}` : ""}
              </p>
            )}
          </Card>

          {summary.warning && (
            <Banner tone="warning">{summary.warning}</Banner>
          )}

          {isLatLng(summary.startLatLng) && isLatLng(summary.endLatLng) && (
            <TripMap
              start={summary.startLatLng}
              end={summary.endLatLng}
              polyline={summary.polyline}
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-700/60"
            />
          )}

          <Card className="space-y-2 text-sm">
            {summary.startAddress && (
              <Row label="From" value={summary.startAddress} />
            )}
            {summary.via && <Row label="Via" value={summary.via} />}
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

          <button
            type="button"
            onClick={() => {
              setErr("");
              setPhase("history");
            }}
            className="mx-auto block text-sm font-semibold text-accent underline-offset-2 hover:underline dark:text-accent-soft"
          >
            View logged miles
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ HISTORY */}
      {phase === "history" && (
        <div className="space-y-4">
          <Card className="space-y-3">
            {isAdmin && (
              <div>
                <Label htmlFor="mlg-filter-user">Driver</Label>
                <Select
                  id="mlg-filter-user"
                  value={filterUser}
                  onChange={(e) => {
                    setFilterUser(e.target.value);
                    clearPdf();
                  }}
                >
                  <option value="">All drivers</option>
                  {users.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor="mlg-filter-month">Month</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="mlg-filter-month"
                  type="month"
                  value={filterMonth}
                  onChange={(e) => {
                    setFilterMonth(e.target.value);
                    clearPdf();
                  }}
                />
                {filterMonth && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilterMonth("");
                      clearPdf();
                    }}
                    className="shrink-0 text-xs text-neutral-500 underline-offset-2 hover:text-accent hover:underline dark:hover:text-accent-soft"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card className="text-center">
            <div className="text-3xl font-bold tabular-nums">
              {totalMiles} <span className="text-base font-semibold">mi</span>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {trips.length} trip{trips.length === 1 ? "" : "s"}
              {isAdmin ? (filterUser ? ` · ${filterUser}` : " · all drivers") : " · you"}
            </p>
          </Card>

          {isAdmin && (
            <Card className="space-y-2">
              <button
                type="button"
                onClick={createPdf}
                disabled={pdfBusy || !filterMonth}
                className="w-full rounded-xl border border-accent px-4 py-3 text-sm font-semibold text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40 dark:text-accent-soft"
              >
                {pdfBusy ? "Creating PDF…" : "Create PDF — all drivers, this month"}
              </button>
              {!filterMonth && (
                <p className="text-center text-xs text-neutral-500">
                  Pick a month above to export the full report.
                </p>
              )}
              {pdfErr && <Banner tone="error">{pdfErr}</Banner>}
              {pdfUrl && (
                <Banner tone="success">
                  Report ready —{" "}
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                  >
                    open the PDF
                  </a>
                  .
                </Banner>
              )}
            </Card>
          )}

          {historyErr && <Banner tone="error">{historyErr}</Banner>}

          {loadingHistory ? (
            <Loading label="Loading miles…" />
          ) : trips.length === 0 ? (
            <EmptyState>
              No miles logged{filterMonth || filterUser ? " for this filter" : " yet"}.
            </EmptyState>
          ) : (
            <ul className="space-y-2">
              {trips.map((t, i) => (
                <TripRow key={t["TripID"] || i} t={t} showDriver={isAdmin} />
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => {
              setErr("");
              setPhase("idle");
            }}
            className="mx-auto block text-xs text-neutral-500 underline-offset-2 hover:text-accent hover:underline dark:hover:text-accent-soft"
          >
            Back
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

// One row in the logged-miles list.
function TripRow({ t, showDriver }: { t: Record<string, string>; showDriver: boolean }) {
  const [showMap, setShowMap] = useState(false);
  const manual = (t["Distance Source"] || "").toLowerCase() === "manual";
  const stops = Number(t["Stops"]) || 0;
  // Route incl. any marked stops: start → via → end.
  const fromTo = [t["Start Address"], t["Via"], t["End Address"]].filter(Boolean).join(" → ");
  const start = `${t["Start Lat"]},${t["Start Lng"]}`;
  const end = `${t["End Lat"]},${t["End Lng"]}`;
  const hasRoute = isLatLng(start) && isLatLng(end);
  return (
    <li className="rounded-xl border border-neutral-200 bg-white p-3 dark:border-neutral-700/60 dark:bg-ink-raised">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">
            {t["Date"] || "—"}
            {showDriver && t["Driver"] ? ` · ${t["Driver"]}` : ""}
          </div>
          {t["Job"] && <div className="truncate text-xs text-neutral-500">{t["Job"]}</div>}
          {t["Purpose"] && <div className="truncate text-xs text-neutral-500">{t["Purpose"]}</div>}
          {fromTo && <div className="mt-0.5 truncate text-xs text-neutral-400">{fromTo}</div>}
          {hasRoute && (
            <button
              type="button"
              onClick={() => setShowMap((v) => !v)}
              className="mt-1 text-xs font-semibold text-accent underline-offset-2 hover:underline dark:text-accent-soft"
            >
              {showMap ? "Hide map" : "View map"}
            </button>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-bold tabular-nums">{t["Miles"] || "—"} mi</div>
          {stops > 0 && (
            <div className="text-[10px] text-neutral-400">
              {stops} stop{stops === 1 ? "" : "s"}
            </div>
          )}
          {manual && (
            <div className="text-[10px] uppercase tracking-wide text-neutral-400">manual</div>
          )}
        </div>
      </div>
      {hasRoute && showMap && (
        <TripMap
          start={start}
          end={end}
          polyline={t["Polyline"]}
          className="mt-3 w-full rounded-lg border border-neutral-200 dark:border-neutral-700/60"
        />
      )}
    </li>
  );
}
