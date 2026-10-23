import { NextRequest, NextResponse } from "next/server";

import { auth, envAllowed } from "@/auth";
import { db, ensureDb } from "@/db";
import { allowedUsers } from "@/db/schema";
import { clearJtUserLink } from "@/lib/jtUserLink";
import { bad, sessionEmail } from "@/lib/onboarding/respond";
import {
  addRosterEmployee,
  createIntake,
  deleteIntake,
  deleteSubmission,
  findRosterByEmail,
  listForms,
  listIntakes,
  listSubmissions,
  markIntakeSent,
} from "@/lib/onboarding/store";

// The office side of new-hire paperwork, /onboarding/office. Gated by the
// `employees` view (office + admin) with the rest of the roster, because the
// profiles and filled forms are personal data of the same kind.
//
//   GET → { intakes:[…with submissions], forms:[…], isAdmin }
//   POST { action: "invite", firstName, lastName, email, position?, hireDate? }
//        ADMIN ONLY — it adds a sign-in, which only /admin may otherwise do.
//        Adds the Employee tab row (or reuses the one with this email), the
//        sign-in as role "field", and the paperwork.
//   POST { action: "reopen", email, formId } → delete one filled form so it can be redone
//   POST { action: "sent", email }           → stamp "sent to bookkeeper", delete the filled PDFs
//   POST { action: "remove", email }         → delete the paperwork (roster row and sign-in stay)
export const dynamic = "force-dynamic";

async function isAdmin(): Promise<boolean> {
  const session = await auth();
  const email = (session?.user?.email ?? "").toLowerCase();
  return session?.user?.role === "admin" || envAllowed().includes(email);
}

export async function GET() {
  const [intakes, forms, subs, admin] = await Promise.all([listIntakes(), listForms(), listSubmissions(), isAdmin()]);
  return NextResponse.json({
    isAdmin: admin,
    forms,
    intakes: intakes.map((i) => ({
      email: i.email,
      firstName: i.firstName,
      lastName: i.lastName,
      position: i.position,
      hireDate: i.hireDate,
      employeeId: i.employeeId,
      profile: i.profile,
      profileAt: i.profileAt,
      invitedAt: i.invitedAt,
      invitedBy: i.invitedBy,
      sentAt: i.sentAt,
      sentBy: i.sentBy,
      submissions: subs.filter((s) => s.email === i.email),
    })),
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  const me = await sessionEmail();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return bad("Body must be JSON.");
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email.includes("@")) return bad("A valid email is required.");

  switch (body.action) {
    case "invite": {
      if (!(await isAdmin())) return bad("Only an admin can invite a new hire — it adds a sign-in.", 403);
      const firstName = String(body.firstName ?? "").trim().slice(0, 80);
      const lastName = String(body.lastName ?? "").trim().slice(0, 80);
      const position = String(body.position ?? "").trim().slice(0, 80);
      const hireDate = String(body.hireDate ?? "").trim();
      if (!firstName || !lastName) return bad("First and last name are required.");
      if (hireDate && !DATE_RE.test(hireDate)) return bad("Hire date must be a date.");

      // 1. The roster row. An email already on the roster keeps its row.
      let employeeId: string;
      try {
        const row = await findRosterByEmail(email);
        employeeId = row ? row.id : await addRosterEmployee({ firstName, lastName, email, position, hireDate });
      } catch (e) {
        return bad(`The roster row could not be added: ${e instanceof Error ? e.message : String(e)}`, 502);
      }
      await clearJtUserLink(email);

      // 2. The sign-in. Someone who can already sign in keeps their role.
      if (!envAllowed().includes(email)) {
        await ensureDb();
        await db
          .insert(allowedUsers)
          .values({ email, addedBy: me, createdAt: new Date().toISOString(), role: "field", viewsAllow: "[]", viewsDeny: "[]" })
          .onConflictDoNothing();
      }

      // 3. The paperwork.
      await createIntake({ email, firstName, lastName, position, hireDate, employeeId, by: me });
      return NextResponse.json({ ok: true, employeeId });
    }
    case "reopen": {
      const formId = Number(body.formId);
      if (!Number.isInteger(formId)) return bad("Bad form id.");
      await deleteSubmission(email, formId);
      return NextResponse.json({ ok: true });
    }
    case "sent":
      await markIntakeSent(email, me);
      return NextResponse.json({ ok: true });
    case "remove":
      await deleteIntake(email);
      return NextResponse.json({ ok: true });
    default:
      return bad("Unknown action.");
  }
}
