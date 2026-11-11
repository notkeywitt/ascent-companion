"use client";

import { useEffect, useState } from "react";

import { Banner, Button } from "@/components/ui";
import { isNewBuildLive } from "@/lib/versionCheck";

/**
 * "A new version is live" — a banner for admins, under the header.
 *
 * WHY: after a push, Vercel takes a minute or two to build. Until it lands,
 * a refresh shows the old app, and after a burst of pushes it is unclear which
 * one is on screen. This tab knows its own build (frozen in by next.config.mjs);
 * it asks /api/version what the server runs now, and says so when they differ.
 *
 * HOW: one check on mount, every 45 s while the tab is visible, and when the tab
 * returns to the front. Errors stay silent — a missed poll only delays the banner.
 * Static `process.env.X` read, as in BuildFooter.tsx: a computed key is not replaced.
 */
const RUNNING = process.env.APP_BUILD_SHA || "";
const POLL_MS = 45_000;

export function NewVersionNotice() {
  const [live, setLive] = useState<{ sha: string; message: string } | null>(null);

  useEffect(() => {
    if (!RUNNING) return;
    let stopped = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { sha?: unknown; message?: unknown };
        if (stopped) return;
        if (isNewBuildLive(RUNNING, body.sha)) {
          setLive({
            sha: String(body.sha),
            message: typeof body.message === "string" ? body.message : "",
          });
        } else {
          setLive(null);
        }
      } catch {
        /* offline or mid-deploy: try again next time */
      }
    }

    void check();
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (!live) return null;
  return (
    <div className="px-3 pt-2">
      <Banner tone="info" className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <strong>New version live</strong> —{" "}
          <span className="font-mono">{live.sha.slice(0, 7)}</span>
          {live.message ? ` ${live.message}` : ""}. This tab runs{" "}
          <span className="font-mono">{RUNNING.slice(0, 7)}</span>.
        </span>
        <Button size="sm" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </Banner>
    </div>
  );
}
