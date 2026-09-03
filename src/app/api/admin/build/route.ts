/**
 * Admin → the build footer's "check" button.
 *
 * GET → what the Apps Script back end says it is serving, read from the live
 * `/exec` URL's `doGet` health check (`{ ok, service, build, … }`). That
 * endpoint is ANONYMOUS by design and returns no data beyond its build stamp
 * and action names, so this passes no secret.
 *
 * The Assistant's OWN build needs no route: it is inlined at build time by
 * next.config.mjs and rendered straight from `process.env` (BuildFooter.tsx).
 * Only the other half of the system costs a network hop, which is why it sits
 * behind a button instead of loading with the page.
 *
 * Admin-only, same `requireAdmin()` shape as /api/admin/copy. Reads only.
 */
import { NextResponse } from "next/server";

import { auth, envAllowed } from "@/auth";

/** An Apps Script GET is a 302 to googleusercontent plus a cold start. Long
 *  enough for that, short enough to stay under a default route's budget. */
const TIMEOUT_MS = 15_000;

async function requireAdmin(): Promise<boolean> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return session?.user?.role === "admin" || envAllowed().includes(email);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = process.env.APPS_SCRIPT_SYNC_URL;
  if (!url) {
    return NextResponse.json({ error: "APPS_SCRIPT_SYNC_URL is not set." });
  }

  try {
    const res = await fetch(url, {
      // The health check must never be answered from a cache: the whole point
      // is what the deployment is serving right now.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    let parsed: { build?: string; service?: string };
    try {
      parsed = JSON.parse(text) as { build?: string; service?: string };
    } catch {
      // A login page instead of JSON means the deployment is no longer
      // anonymous — a real answer, not a parse bug, so say which it is.
      return NextResponse.json({
        error:
          res.status === 200
            ? "The /exec URL answered with something other than JSON. Check the deployment is still shared with 'Anyone'."
            : `The /exec URL returned HTTP ${res.status}.`,
      });
    }
    return NextResponse.json({
      build: parsed.build ?? "",
      service: parsed.service ?? "",
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = msg.includes("timed out") || msg.toLowerCase().includes("abort");
    return NextResponse.json({
      error: timedOut ? "The Apps Script endpoint did not answer in time." : msg,
    });
  }
}
