import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * The office Mac's bearer token, REVIEW_AGENT_TOKEN. Claude Code on that Mac
 * calls /api/invoice-review/agent (the monthly check) and its /tools sub-route
 * (batch add) with it. Both paths are public in src/middleware.ts for that
 * reason, so this check is their only gate. Unset = 503.
 */
function secretMatches(provided: string, expected: string): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** null when the request carries the token; otherwise the response to send. */
export function authorizeAgent(req: NextRequest): NextResponse | null {
  const expected = (process.env.REVIEW_AGENT_TOKEN ?? "").trim();
  if (!expected) {
    return NextResponse.json({ error: "REVIEW_AGENT_TOKEN is not set on this deployment." }, { status: 503 });
  }
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  return secretMatches(bearer, expected) ? null : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
