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
  const year = vendor && y ? y[coiKey(vendor)] : undefined;
  if (!year) return null;
  return (
    <span
      role="img"
      aria-label={`COI on file (${year})`}
      title={`COI on file (${year})`}
      className={`ml-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 align-middle ${className}`}
    />
  );
}
