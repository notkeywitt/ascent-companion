import { NextRequest, NextResponse } from "next/server";

import { BOT_AREAS, cleanAreas } from "@/lib/botAccess";
import { requireBotAdmin } from "@/lib/botAdmin";
import {
  deleteBotRole,
  deleteBotUser,
  listBotRoles,
  listBotUsers,
  saveBotRole,
  saveBotUser,
} from "@/lib/botUsers";

/**
 * The AscentBot page's data: roles (named sets of areas) and the people who
 * may ask the bot. Companion-DB writes only, never JobTread.
 *
 * Gated by the `ascentbot` view (admin only by default, lib/views.ts).
 * Middleware already refuses this path to anyone without it; the check repeats
 * here so the route is safe on its own (lib/botAdmin.ts).
 */

const FORBIDDEN = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function snapshot() {
  const [roles, users] = await Promise.all([listBotRoles(), listBotUsers()]);
  return { areas: BOT_AREAS, roles, users };
}

export async function GET() {
  if (!(await requireBotAdmin()).ok) return FORBIDDEN();
  return NextResponse.json(await snapshot());
}

/**
 * { kind: "user", email, name, roleId, active }  add or change one person.
 * { kind: "role", id?, name, areas }              add a role, or edit one.
 */
export async function POST(req: NextRequest) {
  const me = await requireBotAdmin();
  if (!me.ok) return FORBIDDEN();
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return bad("Send JSON.");
  try {
    if (body.kind === "user") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) return bad("Enter a full email address.");
      const roleId = String(body.roleId ?? "");
      if (!roleId) return bad("Pick a role.");
      await saveBotUser({ email, name: String(body.name ?? ""), roleId, active: body.active !== false }, me.email);
    } else if (body.kind === "role") {
      const name = String(body.name ?? "").trim();
      if (!name) return bad("Name the role.");
      await saveBotRole({ id: body.id ? String(body.id) : undefined, name, areas: cleanAreas(body.areas) });
    } else {
      return bad("Unknown kind.");
    }
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  return NextResponse.json(await snapshot());
}

/** ?email=… removes a person; ?role=… removes a role nobody is on. */
export async function DELETE(req: NextRequest) {
  if (!(await requireBotAdmin()).ok) return FORBIDDEN();
  const email = req.nextUrl.searchParams.get("email");
  const role = req.nextUrl.searchParams.get("role");
  try {
    if (email) await deleteBotUser(email);
    else if (role) await deleteBotRole(role);
    else return bad("Say what to remove.");
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  return NextResponse.json(await snapshot());
}
