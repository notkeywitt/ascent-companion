import { NextResponse } from "next/server";

// GET /api/bank-details — Ascent's ACH routing + account numbers, for the copy
// chips on /payments (the TSYS form asks for them on every statement).
//
// Storage: server-only Vercel env vars. Deliberately NOT the companion DB and
// NOT a NEXT_PUBLIC_* var — the numbers never enter the client bundle, git, or a
// DB backup; they exist only in Vercel's encrypted env store and in the JSON
// body of this response, which only an admin can request.
//
// Access: gated by middleware on the admin-only `bank-details` view (lib/views.ts).
// /payments is a LEAD view, so it can't gate these; the client fetches this route
// and simply renders no chips when it 403s.
//
// Env:
//   ASCENT_BANK_ROUTING   9-digit ACH routing number
//   ASCENT_BANK_ACCOUNT   checking account number
//   ASCENT_BANK_LABEL     optional bank/account nickname shown next to the chips
export const dynamic = "force-dynamic"; // never cached, never prerendered

export async function GET() {
  const routing = (process.env.ASCENT_BANK_ROUTING ?? "").trim();
  const account = (process.env.ASCENT_BANK_ACCOUNT ?? "").trim();
  const label = (process.env.ASCENT_BANK_LABEL ?? "").trim();

  if (!routing && !account) {
    return NextResponse.json(
      { ok: false, error: "Bank numbers are not configured (ASCENT_BANK_ROUTING / ASCENT_BANK_ACCOUNT)." },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, routing, account, label },
    { headers: { "Cache-Control": "no-store" } },
  );
}
