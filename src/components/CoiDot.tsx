"use client";

import { useEffect, useState } from "react";
import { coiKey } from "@/lib/vendorCoi";

/**
 * A green dot beside a vendor's name when their certificate of insurance is on
 * file in the Vendor COIs folder (owner, 2026-11-02). Every bill list draws it.
 *
 * One read per page load, shared by every dot on the page (and cached ten
 * minutes on the server — /api/vendor-coi?all=1). A failed read, or a role
 * without the Vendors view, draws no dots rather than a wrong one.
 */
let years: Promise<Record<string, number> | null> | null = null;
function loadYears() {
  years ??= fetch("/api/vendor-coi?all=1")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && !j.error ? (j.years as Record<string, number>) : null))
    .catch(() => null);
  return years;
}

/** Expiry state by vendor key; only vendors with a recorded expiry appear. */
let states: Promise<Record<string, string> | null> | null = null;
function loadStates() {
  states ??= fetch("/api/vendor-coi/status?dots=1")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && !j.error ? (j.states as Record<string, string>) : null))
    .catch(() => null);
  return states;
}

export function useCoiYears(): Record<string, number> | null {
  const [y, setY] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadYears().then((v) => alive && setY(v));
    return () => {
      alive = false;
    };
  }, []);
  return y;
}

export function CoiDot({ vendor, className = "" }: { vendor: string | null | undefined; className?: string }) {
  const y = useCoiYears();
  const [st, setSt] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadStates().then((v) => alive && setSt(v));
    return () => {
      alive = false;
    };
  }, []);
  const year = vendor && y ? y[coiKey(vendor)] : undefined;
  if (!year) return null;
  const expiring = vendor && st?.[coiKey(vendor)] === "expiring";
  if (expiring) {
    return (
      <span
        role="img"
        aria-label="COI expires within 30 days"
        title="COI expires within 30 days"
        className={`ml-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-amber-500 align-middle ${className}`}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={`COI on file (${year})`}
      title={`COI on file (${year})`}
      className={`ml-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 align-middle ${className}`}
    />
  );
}
