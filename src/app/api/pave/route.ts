import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { pave } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled, gatewayWritesEnabled } from "@/lib/config";
import type { Role } from "@/lib/views";
import { findMutations, sanitizeQuery, isMutationAllowed } from "@/lib/paveGateway";

/**
 * Generic guarded Pave gateway.
 *
 * POST /api/pave  { query: <Pave query object, WITHOUT $.grantKey> }
 *   → 200 { data: <Pave result tree> }
 *
 * The browser composes any query it needs from JT_API_REFERENCE.md; this route
 * injects the server-only grantKey and runs it through pave(). Authorization:
 *  - Requires a signed-in Google identity (a role). Shared-password sessions
 *    carry no role and are refused (they can't reach role-gated data anyway).
 *  - READS (no mutation at the query root): allowed for any signed-in role.
 *  - WRITES (any create / update / delete / … root field): allowed only when
 *    writesEnabled() AND gatewayWritesEnabled() are both on AND every mutation
 *    in the query is on the caller's per-role allowlist (src/lib/paveGateway.ts).
 *
 * NOTE (v1 limitation): reads are not yet gated per entity by role — any signed-in
 * user can read any entity through this route. The role-gated *views* are what
 * issue these queries, so the UI already scopes what each role fetches; add a
 * per-role read policy here if that ever needs hard enforcement.
 *
 * This route is intentionally NOT registered in src/lib/views.ts (it serves many
 * views/roles), so middleware treats it as ungated — all authorization is done
 * here, in-handler.
 */

const MAX_BODY_BYTES = 100_000; // guard against absurd payloads

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }

  // --- Resolve the caller's role ------------------------------------------
  const session = await auth();
  let role: Role | null = (session?.user?.role as Role | undefined) ?? null;
  // Local dev with no auth configured at all → treat as admin (matches the
  // middleware's "open" branch). In prod (Google and/or password configured),
  // a caller with no Google role is refused below.
  const noAuthConfigured = !process.env.AUTH_GOOGLE_ID && !process.env.APP_PASSWORD;
  if (!role && noAuthConfigured) role = "admin";
  if (!role) {
    return NextResponse.json(
      { error: "The API gateway requires a signed-in Google account." },
      { status: 403 },
    );
  }

  // --- Parse + validate the body ------------------------------------------
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Query too large." }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const query = (parsed as { query?: unknown })?.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return NextResponse.json(
      { error: "Body must be { query: <object> }." },
      { status: 400 },
    );
  }

  const safeQuery = sanitizeQuery(query as Record<string, unknown>);
  if (Object.keys(safeQuery).length === 0) {
    return NextResponse.json({ error: "Empty query." }, { status: 400 });
  }

  // --- Write guard ---------------------------------------------------------
  const mutations = findMutations(safeQuery);
  if (mutations.length > 0) {
    if (!writesEnabled()) {
      return NextResponse.json(
        { error: "Writes are disabled (COMPANION_WRITES_ENABLED is off).", mutations },
        { status: 403 },
      );
    }
    if (!gatewayWritesEnabled()) {
      return NextResponse.json(
        {
          error:
            "Gateway writes are disabled (COMPANION_GATEWAY_WRITES_ENABLED is off). Reads are allowed.",
          mutations,
        },
        { status: 403 },
      );
    }
    const denied = mutations.filter((m) => !isMutationAllowed(role, m));
    if (denied.length > 0) {
      return NextResponse.json(
        { error: `Role "${role}" is not allowed to run: ${denied.join(", ")}`, denied },
        { status: 403 },
      );
    }
  }

  // --- Execute -------------------------------------------------------------
  try {
    const data = await pave(getPaveConfig(), safeQuery);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown Pave error" },
      { status: 502 },
    );
  }
}
