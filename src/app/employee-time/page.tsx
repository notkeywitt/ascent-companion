"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { JobPicker } from "@/components/JobPicker";
import {
  Banner,
  Card,
  Input,
  Label,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";

/**
 * /employee-time — an employee logs a chunk of time to a JobTread job.
 *
 * Job + cost code + start/stop + a required note + optional photos. The signed-in
 * user is resolved to their linked JobTread user (via the Employee roster), the
 * times default to now, and GPS pre-selects the nearest job site. Submitting
 * creates the JobTread time entry (createTimeEntry, gated by writes-enabled) and
 * always records the entry + photos to the Project Database "Time Entries" tab.
 */

interface Me {
  name: string;
  email: string;
  jtUserId: string;
  jtUserName: string;
}
interface Site {
  label: string;
  lat: number;
  lng: number;
  jtJobId: string;
}
interface PayType {
  name: string;
  hourlyRate?: number;
}
interface UserRef {
  id: string;
  name: string;
  isInternal: boolean;
  types?: PayType[];
}
interface JobRef {
  id: string;
  name: string;
  customer?: string;
}
interface CostItem {
  id: string;
  number: string;
  name: string;
}
interface Photo {
  base64: string; // data URL
  mimeType: string;
  name: string;
}
interface SubmitResult {
  ok?: boolean;
  error?: string;
  previewed?: boolean;
  wrote?: boolean;
  jtStatus?: string;
  jtError?: string;
  entryId?: string;
  photoCount?: number;
}

const MAX_PHOTOS = 8;
const NEAR_KM = 1.2; // within this of a job site → treat you as "at" that job
const LS_JT_USER = "employeeTime.jtUser."; // + email → remembered JobTread user id

const jobRefLabel = (j: JobRef) => (j.customer ? `${j.customer} - ${j.name}` : j.name);

// Great-circle distance in km — to label the nearest job site.
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
      maximumAge: 60000,
    });
  });
}

// Current local time as the "YYYY-MM-DDTHH:MM" an <input type="datetime-local">
// wants — today + now, by default.
function nowLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDuration(startLocal: string, endLocal: string): string {
  const s = new Date(startLocal).getTime();
  const e = new Date(endLocal).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return "";
  const min = Math.round((e - s) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h}h ${m}m` : `${m} min`;
}

// Downscale a picked image to a JPEG data URL (max 1600px, quality 0.85) so a
// handful of phone photos stay a reasonable payload.
function downscale(file: File): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 1600;
      let { width, height } = img;
      if (width > max || height > max) {
        const scale = Math.min(max / width, max / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Couldn't process the image."));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({
        base64: canvas.toDataURL("image/jpeg", 0.85),
        mimeType: "image/jpeg",
        name: (file.name || "photo").replace(/\.[^.]+$/, "") + ".jpg",
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file isn't a readable image."));
    };
    img.src = url;
  });
}

export default function EmployeeTimePage() {
  const [phase, setPhase] = useState<"form" | "done">("form");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Reference data.
  const [me, setMe] = useState<Me | null>(null);
  const [jtUsers, setJtUsers] = useState<UserRef[]>([]);
  const [orgTypes, setOrgTypes] = useState<string[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [jobs, setJobs] = useState<JobRef[]>([]);

  // Who's logging — the roster link, or a one-time manual pick when unlinked.
  const [pickedUserId, setPickedUserId] = useState("");

  // Form fields.
  const [jobId, setJobId] = useState("");
  const [costItems, setCostItems] = useState<CostItem[]>([]);
  const [loadingCosts, setLoadingCosts] = useState(false);
  const [costItemId, setCostItemId] = useState("");
  const [payType, setPayType] = useState("");
  const [startTime, setStartTime] = useState(nowLocal());
  const [endTime, setEndTime] = useState(nowLocal());
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);

  // GPS.
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [nearestJob, setNearestJob] = useState("");
  const [geoNote, setGeoNote] = useState("");
  const [gpsTried, setGpsTried] = useState(false);

  const [result, setResult] = useState<SubmitResult | null>(null);

  // --- Bootstrap: linked JT identity, org users + pay types, job sites, jobs. --
  useEffect(() => {
    fetch("/api/employee-time")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok === false) {
          setErr(j.error || "Couldn't load the page.");
          return;
        }
        setMe(j.me ?? null);
        setJtUsers(j.jtUsers ?? []);
        setOrgTypes(j.orgTypes ?? []);
        setSites(j.sites ?? []);
      })
      .catch(() => setErr("Couldn't reach the server."))
      .finally(() => setLoading(false));

    fetch("/api/jobs")
      .then((r) => r.json())
      .then((j) => setJobs(j.jobs ?? []))
      .catch(() => {});
  }, []);

  // Remembered JobTread-user pick (only used when the roster link is missing).
  useEffect(() => {
    if (!me || me.jtUserId) return;
    try {
      const saved = localStorage.getItem(LS_JT_USER + (me.email || ""));
      if (saved) setPickedUserId(saved);
    } catch {}
  }, [me]);

  const effectiveUserId = (me?.jtUserId || pickedUserId || "").trim();
  const effectiveUser = useMemo(
    () => jtUsers.find((u) => u.id === effectiveUserId) ?? null,
    [jtUsers, effectiveUserId],
  );
  const effectiveName = me?.name || me?.jtUserName || effectiveUser?.name || "";

  function pickUser(id: string) {
    setPickedUserId(id);
    setPayType("");
    try {
      if (me?.email) localStorage.setItem(LS_JT_USER + me.email, id);
    } catch {}
  }

  // GPS → nearest job site, once the sites are loaded. Best-effort: a denied or
  // failed fix just means no pre-fill.
  useEffect(() => {
    if (!sites.length || gpsTried) return;
    setGpsTried(true);
    setGeoNote("Finding the nearest job…");
    getPosition()
      .then((pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGps(here);
        const scored = sites
          .map((s) => ({ s, d: haversineKm(here, { lat: s.lat, lng: s.lng }) }))
          .sort((a, b) => a.d - b.d);
        const near = scored[0];
        if (near && near.d <= NEAR_KM) {
          setJobId(near.s.jtJobId);
          setNearestJob(near.s.label);
          setGeoNote(`Nearest job pre-filled: ${near.s.label}`);
        } else {
          setGeoNote("No job site nearby — pick the job below.");
        }
      })
      .catch(() => setGeoNote(""));
  }, [sites, gpsTried]);

  // A job's cost codes (its budget cost items). Reload on job change.
  useEffect(() => {
    setCostItemId("");
    setCostItems([]);
    if (!jobId) return;
    setLoadingCosts(true);
    fetch(`/api/employee-time?jobId=${encodeURIComponent(jobId)}`)
      .then((r) => r.json())
      .then((j) => setCostItems(j.ok === false ? [] : (j.costItems ?? [])))
      .catch(() => setCostItems([]))
      .finally(() => setLoadingCosts(false));
  }, [jobId]);

  // Pay type: the resolved user's OWN set when the grant can read it, else the
  // org-wide list as a fallback. Auto-set when there's exactly one option; a
  // dropdown shows only when there are several.
  const perMemberTypes = effectiveUser?.types;
  const payTypes: PayType[] = perMemberTypes ?? orgTypes.map((name) => ({ name }));
  const typesAreFallback = !perMemberTypes && orgTypes.length > 0;
  useEffect(() => {
    if (payType) return;
    if (payTypes.length === 1) setPayType(payTypes[0].name);
  }, [payTypes, payType]);

  const jobLabel = useMemo(() => {
    const j = jobs.find((x) => x.id === jobId);
    return j ? jobRefLabel(j) : nearestJob;
  }, [jobs, jobId, nearestJob]);

  const selectedCost = costItems.find((c) => c.id === costItemId) ?? null;
  const duration = fmtDuration(startTime, endTime);

  async function addPhotos(list: FileList | null) {
    if (!list || !list.length) return;
    setErr("");
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setErr(`Up to ${MAX_PHOTOS} photos.`);
      return;
    }
    const picked = Array.from(list).slice(0, room);
    const out: Photo[] = [];
    for (const f of picked) {
      try {
        out.push(await downscale(f));
      } catch {
        /* skip an unreadable file */
      }
    }
    if (out.length) setPhotos((prev) => [...prev, ...out]);
  }

  function removePhoto(i: number) {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  }

  const submit = useCallback(async () => {
    setErr("");
    if (!effectiveUserId) {
      setErr("Pick who you are in JobTread first.");
      return;
    }
    if (!jobId) {
      setErr("Pick a job.");
      return;
    }
    if (!costItemId) {
      setErr("Pick a cost code.");
      return;
    }
    if (!note.trim()) {
      setErr("A note is required.");
      return;
    }
    if (!startTime || !endTime) {
      setErr("Enter a start and stop time.");
      return;
    }
    if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      setErr("Stop time must be after the start time.");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/employee-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: effectiveUserId,
          employee: effectiveName,
          jobId,
          jobLabel,
          costItemId,
          costCode: selectedCost?.number ?? "",
          payType,
          startTime,
          endTime,
          note: note.trim(),
          lat: gps?.lat,
          lng: gps?.lng,
          nearestJob,
          photos,
        }),
      });
      const json: SubmitResult = await res.json();
      if (!res.ok || json.ok === false) {
        setErr(json.error || "Could not save the time entry.");
        return;
      }
      setResult(json);
      setPhase("done");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save the time entry.");
    } finally {
      setBusy(false);
    }
  }, [
    effectiveUserId,
    effectiveName,
    jobId,
    jobLabel,
    costItemId,
    selectedCost,
    payType,
    startTime,
    endTime,
    note,
    gps,
    nearestJob,
    photos,
  ]);

  function logAnother() {
    setResult(null);
    setJobId("");
    setCostItemId("");
    setNote("");
    setPhotos([]);
    setStartTime(nowLocal());
    setEndTime(nowLocal());
    setErr("");
    setPhase("form");
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title="Employee Time" description="Log your hours to a job." />
        <Loading label="Loading…" />
      </main>
    );
  }

  // ---------------------------------------------------------------- DONE ------
  if (phase === "done" && result) {
    return (
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <PageHeader title="Employee Time" description="Log your hours to a job." />
        <div className="space-y-4">
          <Card className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Time logged
            </p>
            <div className="mt-1 text-3xl font-bold tabular-nums">{duration || "—"}</div>
            {jobLabel && <p className="mt-1 text-sm text-neutral-500">{jobLabel}</p>}
          </Card>

          {result.previewed ? (
            <Banner tone="warning">
              Saved to the Time Entries record. JobTread push is OFF
              (COMPANION_WRITES_ENABLED not set) — nothing was written to JobTread.
            </Banner>
          ) : result.wrote ? (
            <Banner tone="success">Pushed to JobTread and saved to the record.</Banner>
          ) : (
            <Banner tone="warning">
              Saved to the record, but the JobTread push failed
              {result.jtError ? `: ${result.jtError}` : ""}. The office can retry it.
            </Banner>
          )}

          <Card className="space-y-2 text-sm">
            {effectiveName && <Row label="Who" value={effectiveName} />}
            {selectedCost && <Row label="Cost" value={`${selectedCost.number} ${selectedCost.name}`} />}
            {payType && <Row label="Type" value={payType} />}
            <Row label="Start" value={startTime.replace("T", " ")} />
            <Row label="Stop" value={endTime.replace("T", " ")} />
            {note.trim() && <Row label="Note" value={note.trim()} />}
            {result.photoCount ? (
              <Row label="Photos" value={`${result.photoCount} saved`} />
            ) : null}
          </Card>

          <button
            type="button"
            onClick={logAnother}
            className="w-full rounded-2xl bg-accent px-4 py-5 text-base font-bold text-white shadow-sm transition hover:bg-accent-hover"
          >
            Log another
          </button>
        </div>
      </main>
    );
  }

  // ---------------------------------------------------------------- FORM ------
  const needsUserPick = !!me && !me.jtUserId;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
      <PageHeader
        title="Employee Time"
        description="Log your hours to a job — with a note and photos."
      />

      {err && (
        <Banner tone="error" className="mb-4">
          {err}
        </Banner>
      )}

      <div className="space-y-4">
        {/* Who — the signed-in user, or a one-time pick when unlinked. */}
        {needsUserPick ? (
          <Card className="space-y-2">
            <Label htmlFor="et-user">Who are you in JobTread?</Label>
            <Select id="et-user" value={pickedUserId} onChange={(e) => pickUser(e.target.value)}>
              <option value="">Select yourself…</option>
              {jtUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {(u.isInternal ? "★ " : "") + u.name}
                </option>
              ))}
            </Select>
            <p className="text-xs text-neutral-500">
              We couldn&apos;t match your login to a JobTread user. Pick yourself once — it&apos;s
              remembered on this device. (An admin can link you on the Employees page to skip this.)
            </p>
          </Card>
        ) : (
          effectiveName && (
            <p className="text-sm text-neutral-500">
              Logging time as <span className="font-semibold text-neutral-700 dark:text-neutral-200">{effectiveName}</span>
            </p>
          )
        )}

        <Card className="space-y-4">
          {/* Job (GPS pre-fills the nearest). */}
          <div>
            <Label>Job</Label>
            <div className="flex">
              <JobPicker value={jobId} onChange={setJobId} />
            </div>
            {geoNote && <p className="mt-1 text-xs text-neutral-500">{geoNote}</p>}
          </div>

          {/* Cost code — the selected job's budget cost items. */}
          <div>
            <Label htmlFor="et-cost">Cost code</Label>
            <Select
              id="et-cost"
              value={costItemId}
              onChange={(e) => setCostItemId(e.target.value)}
              disabled={!jobId || loadingCosts}
            >
              <option value="">
                {!jobId
                  ? "Pick a job first…"
                  : loadingCosts
                    ? "Loading cost codes…"
                    : costItems.length
                      ? "Select a cost code…"
                      : "No cost codes on this job"}
              </option>
              {costItems.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.number}
                  {c.name ? ` — ${c.name}` : ""}
                </option>
              ))}
            </Select>
          </div>

          {/* Pay type — only when the worker has several to choose between. */}
          {payTypes.length > 1 && (
            <div>
              <Label htmlFor="et-type">Pay type</Label>
              <Select id="et-type" value={payType} onChange={(e) => setPayType(e.target.value)}>
                <option value="">Select a pay type…</option>
                {payTypes.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                    {typeof t.hourlyRate === "number" ? ` ($${t.hourlyRate}/hr)` : ""}
                  </option>
                ))}
              </Select>
              {typesAreFallback && (
                <p className="mt-1 text-xs text-neutral-500">
                  Showing all pay types — pick your rate for this job.
                </p>
              )}
            </div>
          )}

          {/* Start / stop — default to now. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="et-start">Start</Label>
              <Input
                id="et-start"
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="et-end">Stop</Label>
              <Input
                id="et-end"
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          {duration && <p className="-mt-1 text-xs text-neutral-500">{duration}</p>}

          {/* Note — required. */}
          <div>
            <Label htmlFor="et-note">Note (required)</Label>
            <Textarea
              id="et-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did you work on?"
            />
          </div>

          {/* Photos. */}
          <div>
            <Label>Photos (optional)</Label>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={i} className="relative h-20 w-20 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.base64} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    aria-label={`Remove photo ${i + 1}`}
                    className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-xs font-bold text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 text-2xl text-neutral-400 transition hover:border-accent hover:text-accent dark:border-neutral-600">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      addPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        </Card>

        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="w-full rounded-2xl bg-accent px-4 py-6 text-lg font-bold text-white shadow-sm transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Saving…" : "Log time"}
        </button>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}
