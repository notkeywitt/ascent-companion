"use client";

import { useEffect, useState } from "react";

import { Banner, Button } from "@/components/ui";
import { useAccess } from "@/components/AccessProvider";
import { isNewBuildLive } from "@/lib/versionCheck";

/**
 * "A new version is live" — a banner for admins, under the header.
 *
 * WHY: after a push, Vercel takes a minute or two to build. Until it lands,
 * a refresh shows the old app, and after a burst of pushes it is unclear which
 * one is on screen. This tab knows its own build (frozen in by next.config.mjs);
 * it asks /api/version what the server runs now, and says so when they differ.
 *
 * REFRESH: opens the page with the most edited lines in the deploy (`page` from
 * /api/version), so the change is on screen. With no such page (the deploy only
 * touched shared components) it reloads in place. In the desktop widget the
 * button reloads the widget and a link opens that page in the browser.
 *
 * HOW: one check on mount, every 45 s while the tab is visible, and when the tab
 * returns to the front. Errors stay silent — a missed poll only delays the banner.
 * Static `process.env.X` read, as in BuildFooter.tsx: a computed key is not replaced.
 */
const RUNNING = process.env.APP_BUILD_SHA || "";
const POLL_MS = 45_000;

export function NewVersionNotice({ inWidget = false }: { inWidget?: boolean }) {
  const [live, setLive] = useState<{ sha: string; message: string; page: string } | null>(null);

  useEffect(() => {
    if (!RUNNING) return;
    let stopped = false;

    async function check() {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/version?since=${encodeURIComponent(RUNNING)}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { sha?: unknown; message?: unknown; page?: unknown };
        if (stopped) return;
        if (isNewBuildLive(RUNNING, body.sha)) {
          setLive({
            sha: String(body.sha),
            message: typeof body.message === "string" ? body.message : "",
            // Only a same-site path: it goes straight into location.assign.
            page: typeof body.page === "string" && /^\/[\w\-/]*$/.test(body.page) ? body.page : "",
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
  // In the widget, links open in the browser (WidgetView's click handler).
  const openPage = live.page && live.page !== "/";
  return (
    <div className={inWidget ? "pb-2" : "px-3 pt-2"}>
      <Banner tone="info" className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <strong>New version live</strong> —{" "}
          <span className="font-mono">{live.sha.slice(0, 7)}</span>
          {live.message ? ` ${live.message}` : ""}. This tab runs{" "}
          <span className="font-mono">{RUNNING.slice(0, 7)}</span>.
          {live.page && inWidget && openPage ? (
            <>
              {" "}
              Most edited: <a href={live.page} className="underline">{live.page}</a>.
            </>
          ) : null}
          {live.page && !inWidget ? ` Refresh opens ${live.page}, the most edited page.` : ""}
        </span>
        <Button
          size="sm"
          onClick={() =>
            live.page && !inWidget ? window.location.assign(live.page) : window.location.reload()
          }
        >
          Refresh
        </Button>
      </Banner>
    </div>
  );
}
