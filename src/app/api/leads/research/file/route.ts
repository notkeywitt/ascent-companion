import { NextRequest, NextResponse } from "next/server";

import { readFile } from "@/lib/leadResearch";

/**
 * GET ?id=… — one staged research file, inline, so the review page can show a
 * photo or open a PDF before it goes to JobTread. Gated by the "leads" view.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const got = await readFile(req.nextUrl.searchParams.get("id") ?? "");
  if (!got) return NextResponse.json({ error: "Not staged, or not all of it arrived." }, { status: 404 });
  return new NextResponse(new Uint8Array(got.bytes), {
    status: 200,
    headers: {
      "content-type": got.file.mime,
      "content-disposition": `inline; filename="${encodeURIComponent(got.file.name)}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
