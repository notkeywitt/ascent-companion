"use client";

import { useEffect, useState } from "react";
import { useAccess } from "@/components/AccessProvider";

/**
 * The "time records JobTread doesn't have right" count, for the launcher badge.
 *
 * The queue it counts is invisible from every other direction: the employee's
 * phone said "saved" before JobTread was ever contacted, the sheet holds the
 * record whether or not the push landed, and JobTread just shows fewer hours
 * than were worked. Nothing announces it, so it would sit until payroll — which
 * is the same reason /needs-project grew a badge, and this mirrors that hook.
 *
 * SHEET ONLY (`?count=1`). It runs on every home page load, so it must never
 * cost a JobTread read; the deep cross-check belongs to the Time Sync page and
 * the twice-daily digest check. So the badge counts what the record itself
 * knows — a push that never happened, or one JobTread refused.
 *
 * Gated on the `time-sync` view, the same gate as the page and the API route:
 * nobody is nagged about a queue they can't open.
 */
export function useTimeSyncCount(): number {
  const access = useAccess();
  const canSee = access.can("time-sync");
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!canSee) return;
    let alive = true;
    // Uncached on purpose: a retry on /time-sync empties the queue immediately,
    // and a badge that kept claiming work was waiting would train the office to
    // ignore it.
    fetch("/api/time-sync?count=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (alive && typeof j?.count === "number") setCount(j.count);
      })
      // A failed count must never break the launcher it's mounted on. No badge
      // is the honest answer to "couldn't check".
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canSee]);

  return canSee ? count : 0;
}
