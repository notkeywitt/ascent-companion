import { NextRequest, NextResponse } from "next/server";

import { getDocument } from "@/lib/companyDetails";

/** GET ?id= → one company document, inline. Gated by the "office" view. Never cached. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Bad document id." }, { status: 400 });
  const found = await getDocument(id);
  if (!found) return NextResponse.json({ error: "No such document." }, { status: 404 });
  const name = (found.doc.fileName || found.doc.name).replace(/[^\w .()-]/g, "_");
  return new NextResponse(new Uint8Array(found.bytes), {
    headers: {
      "Content-Type": found.doc.mime,
      "Content-Disposition": `inline; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
