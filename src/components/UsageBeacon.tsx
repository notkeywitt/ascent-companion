"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Fire-and-forget page-view tracker. Lives in the root layout (outside the
 * refresh boundary, so it persists across in-app navigations) and POSTs the
 * current pathname to /api/usage-track whenever the route changes. The server
 * attributes it to the signed-in user; this component knows nothing about who
 * they are. Rendered only when there's a session (see layout).
 *
 * Guarded so it sends at most one beacon per distinct path — a remount or a
 * strict-mode double-effect won't double-count, and the API route further
 * ignores anything with no session.
 */
export function UsageBeacon() {
  const pathname = usePathname();
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    // Don't track the auth/legal pages (only reachable while signed out anyway).
    if (pathname === "/login" || pathname === "/privacy") return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    // keepalive lets the request outlive a fast navigation/unload.
    fetch("/api/usage-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      keepalive: true,
    }).catch(() => {
      /* tracking is best-effort */
    });
  }, [pathname]);

  return null;
}
