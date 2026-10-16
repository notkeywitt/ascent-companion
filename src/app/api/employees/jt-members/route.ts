import { NextResponse } from "next/server";
import { getMembersByEmail, getOrgUsers } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Internal JobTread members with the email each one signs in with — the source
 * of the "In JobTread, not on the roster" suggestions in /employees' Add
 * employee form. /api/jt-users carries no email because field phones read it;
 * this route is gated on the `employees` view (lib/views.ts), so the addresses
 * stay with office + admin. Both reads are the 30-minute cached ones.
 *
 *   GET → { members: [{ id, name, email }] }
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const [users, byEmail] = await Promise.all([getOrgUsers(cfg), getMembersByEmail(cfg)]);
    const emailOf = new Map<string, string>();
    for (const m of byEmail.values()) if (!emailOf.has(m.userId)) emailOf.set(m.userId, m.email);
    const members = users
      .filter((u) => u.isInternal)
      .map((u) => ({ id: u.id, name: u.name, email: emailOf.get(u.id) ?? "" }));
    return NextResponse.json({ members });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not read JobTread members." },
      { status: 502 },
    );
  }
}
