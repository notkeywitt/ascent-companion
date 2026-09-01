import { NextResponse } from "next/server";

import { auth, envAllowed } from "@/auth";
import { proposeChecks } from "@/lib/invoiceReview/learn";
import { listMisses } from "@/lib/invoiceReview/misses";

/**
 * POST /api/invoice-review/learn — "what checks would have caught these?"
 *
 * Hands the miss log and the current check list to Claude and returns PROPOSALS
 * (see learn.ts). This is the loop that makes the review gain a sense it does
 * not have, rather than merely getting quieter.
 *
 * ## It changes nothing, on purpose
 *
 * The response is prose for a person to read, argue with, and implement. No
 * check is written, no setting moved, no finding suppressed. A check is a claim
 * about how Ascent's money works, and a wrong one either cries wolf every month
 * or quietly reassures the office about something it got wrong — so a human
 * stays in the loop by design, not by caution.
 *
 * ## Admin-only, and why
 *
 * It is the most expensive call in the feature (the frontier model, thinking,
 * a large ceiling) and it exists to inform a development decision rather than a
 * billing one. Same credential shape as the scheduled run, minus the scheduler:
 * nothing calls this on a timer, because there is nobody to read the answer.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  const isAdmin = session?.user?.role === "admin" || (email && envAllowed().includes(email));
  // Local dev with no auth configured at all — matches the middleware's own
  // "neither auth configured => open" branch.
  const localDev = !process.env.AUTH_GOOGLE_ID && !process.env.APP_PASSWORD;
  if (!isAdmin && !localDev) {
    return NextResponse.json(
      { error: session?.user ? "Forbidden" : "Unauthorized" },
      { status: session?.user ? 403 : 401 },
    );
  }

  try {
    const result = await proposeChecks(await listMisses());
    return NextResponse.json(result);
  } catch (e) {
    // Never silent: an empty proposal list and a failed call must not look the
    // same, or the office concludes there is nothing to learn when in fact
    // nothing was asked.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
