import { NextRequest, NextResponse, after } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { auth, envAllowed } from "@/auth";
import { runDigest } from "@/lib/digest/run";

/** Runs the digest and logs the outcome — shared by the synchronous scheduler
 *  path and the detached admin-button path below. */
async function runAndLog(ranBy: string) {
  const digest = await runDigest();
  console.log(`[digest] run by ${ranBy}:\n${digest.log.join("\n")}`);
  return digest;
}

/**
 * POST /api/digest/run — build today's digest and store it.
 *
 * TWO CALLERS, TWO CREDENTIALS. This is the one route in the feature that is
 * listed as PUBLIC in `src/middleware.ts`, because the scheduler that calls it
 * has no Google session — so it does its OWN authentication, and refuses
 * anything that isn't one of:
 *
 *   1. THE SCHEDULER — `Authorization: Bearer <secret>` matching
 *      DIGEST_CRON_SECRET (or Vercel's own CRON_SECRET). Vercel Cron sends that
 *      header automatically when CRON_SECRET is set on the project. Compared in
 *      constant time, and a missing/blank secret rejects rather than allows.
 *   2. AN ADMIN — a signed-in Google session whose role is admin (or an env
 *      founder), which is what the home screen's "Refresh now" button uses.
 *
 * Nothing else gets in. Being in the middleware PUBLIC list removes the session
 * requirement, not the authorization — do not relax the checks below without
 * also thinking about who can then trigger an org-wide JobTread sweep.
 *
 * GET is accepted as well, because some schedulers only issue GETs; it is the
 * same code path with the same credentials.
 *
 * TWO RESPONSE SHAPES, ON PURPOSE. The scheduler gets a synchronous, fully
 * awaited run — its invocation has nothing to "close", and its execution log
 * is more useful with the real outcome in it. The admin button instead
 * detaches the run via `after()` and responds immediately: a run reads
 * several external sources plus two Claude calls, easily tens of seconds, and
 * this button is tapped from a phone — without `after()`, closing the tab or
 * backgrounding the app mid-run would abort the underlying request before it
 * finished. `after()` keeps the function alive for the run's own maxDuration
 * regardless of what the client does next.
 */
export const dynamic = "force-dynamic";
// The full sweep — Gmail scans, an org-wide draft-bill query, one rollup per open
// job, and one Gemini call. Give it room; the per-check timeout in the aggregator
// is what actually stops any single source from hanging the run.
export const maxDuration = 300;

/** Constant-time string compare that tolerates different lengths. */
function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function authorize(req: NextRequest): Promise<{ ok: true; who: string } | { ok: false; status: number }> {
  // 1. Scheduler credential.
  const expected = (process.env.DIGEST_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (bearer) {
    return secretMatches(bearer, expected)
      ? { ok: true, who: "scheduler" }
      : { ok: false, status: 401 };
  }

  // 2. Admin session (the "Refresh now" button).
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  if (session?.user?.role === "admin" || (email && envAllowed().includes(email))) {
    return { ok: true, who: email || "admin" };
  }

  // 3. Local dev with no auth configured at all — matches the middleware's own
  //    "neither auth configured => open" branch, so `npm run dev` works.
  if (!process.env.AUTH_GOOGLE_ID && !process.env.APP_PASSWORD) {
    return { ok: true, who: "local-dev" };
  }
  return { ok: false, status: session?.user ? 403 : 401 };
}

async function handle(req: NextRequest) {
  const authorized = await authorize(req);
  if (!authorized.ok) {
    return NextResponse.json(
      { error: authorized.status === 403 ? "Forbidden" : "Unauthorized" },
      { status: authorized.status },
    );
  }

  // The scheduler waits for the real result — Vercel Cron's own invocation
  // stays open regardless, and its execution log is more useful with the full
  // per-check outcome in it.
  if (authorized.who === "scheduler") {
    try {
      const digest = await runAndLog(authorized.who);
      return NextResponse.json({
        ok: true,
        ranBy: authorized.who,
        date: digest.date,
        status: digest.status,
        durationMs: digest.durationMs,
        checks: digest.results.map((r) => ({
          id: r.id,
          status: r.status,
          items: r.items.length,
          durationMs: r.durationMs,
        })),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error("[digest] run failed:", message);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  }

  // The "Refresh now" button: detach the run via `after()` so it keeps going
  // on the server for its full maxDuration even if the tab/app closes right
  // after this responds — a real risk here since a run can take a while
  // (several external reads plus two Claude calls) and this is tapped from a
  // phone. The client polls GET /api/digest afterward to pick up the result
  // if it's still around; if not, the next normal load shows it anyway.
  after(() => runAndLog(authorized.who).catch((e) => console.error("[digest] run failed:", e)));
  return NextResponse.json({ ok: true, started: true });
}

export async function POST(req: NextRequest) {
  return handle(req);
}

/** Same path, for schedulers that only issue GETs (Vercel Cron among them). */
export async function GET(req: NextRequest) {
  return handle(req);
}
