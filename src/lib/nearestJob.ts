"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * "Which job am I standing on?" — the shared location-aware part of every job
 * picker (the header/mileage `JobPicker`, Employee Time's job sheet).
 *
 * A crew member opens a picker at a job site, so the job they want is almost
 * always the one under their feet. This hook turns the device's GPS fix plus
 * each job's stored coordinates into a distance per job and a single nearest
 * job, which a picker then surfaces at the top of its list.
 *
 * The fix is asked for ONLY when a picker opens (`enabled`), never on mount: a
 * page that merely renders a picker must not trip the browser's location prompt.
 * A denial is remembered for `FIX_TTL_MS`, so re-opening the list does not nag.
 */

export interface Coords {
  lat: number;
  lng: number;
}

/** The shape a picker's job list has to provide. Coordinates may be missing. */
export interface JobLike {
  id: string;
  lat?: number | null;
  lng?: number | null;
}

export type GeoStatus =
  /** Not asked yet — the picker has never been opened. */
  | "idle"
  /** Waiting on the device. */
  | "locating"
  /** We have a fix. */
  | "ready"
  /** No permission, no hardware, or the fix timed out. */
  | "unavailable";

/**
 * How long one fix is good for. A picker re-opened inside this window reuses the
 * fix it already has; after it, the next open asks again — the crew drove.
 */
const FIX_TTL_MS = 2 * 60_000;

/** Great-circle distance in MILES — the unit the field reads and bills in. */
export function haversineMiles(a: Coords, b: Coords): number {
  const R = 3958.8; // Earth radius, miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * A distance, as short as it can be said. Under 500 ft is "here" — a phone's
 * fix is not accurate enough to claim a tenth of a mile at a job site.
 */
export function fmtMiles(mi: number): string {
  if (!Number.isFinite(mi)) return "";
  if (mi < 0.1) return "here";
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
}

export interface NearestJobs<T extends JobLike> {
  status: GeoStatus;
  here: Coords | null;
  /** jobId → miles from the current fix. Only jobs that carry coordinates. */
  milesById: Record<string, number>;
  /** The closest job with coordinates, or null until a fix lands. */
  nearest: T | null;
  nearestMiles: number | null;
}

export function useNearestJobs<T extends JobLike>(jobs: T[], enabled: boolean): NearestJobs<T> {
  const [here, setHere] = useState<Coords | null>(null);
  const [status, setStatus] = useState<GeoStatus>("idle");
  // When we last ASKED the device — set before the call, and on a failure too,
  // which is what keeps a denied picker from re-prompting on every open.
  const askedAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      return;
    }
    if (Date.now() - askedAt.current < FIX_TTL_MS) return; // the fix we hold is fresh enough
    askedAt.current = Date.now();
    // Keep showing the old fix while a new one lands — a list that empties its
    // "Nearest" row on every re-open reads as broken.
    setStatus((s) => (s === "ready" ? s : "locating"));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("ready");
      },
      () => setStatus((s) => (s === "ready" ? s : "unavailable")),
      // Coarse and cheap on purpose: this only has to tell one job site from the
      // next, and a high-accuracy fix costs seconds the picker does not have.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  }, [enabled]);

  return useMemo(() => {
    if (!here) return { status, here, milesById: {}, nearest: null, nearestMiles: null };
    const milesById: Record<string, number> = {};
    let nearest: T | null = null;
    let nearestMiles = Infinity;
    for (const j of jobs) {
      if (typeof j.lat !== "number" || typeof j.lng !== "number") continue;
      const mi = haversineMiles(here, { lat: j.lat, lng: j.lng });
      milesById[j.id] = mi;
      if (mi < nearestMiles) {
        nearest = j;
        nearestMiles = mi;
      }
    }
    return {
      status,
      here,
      milesById,
      nearest,
      nearestMiles: nearest ? nearestMiles : null,
    };
  }, [here, status, jobs]);
}
