import { NextRequest, NextResponse } from "next/server";
import { setBillStatus } from "@/lib/jobtread";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";

const ALLOWED = ["draft", "pending", "approved"] as const;
type Status = (typeof ALLOWED)[number];

// Set a bill's status. "approved" = Approve for payment / Record payment (pushes
// to QuickBooks). Gated by the writes flag.
export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: { docId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const docId = (body.docId ?? "").trim();
  const status = body.status as Status;
  if (!docId || !ALLOWED.includes(status)) {
    return NextResponse.json(
      { error: `docId and status (${ALLOWED.join("|")}) required` },
      { status: 400 },
    );
  }
  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, status });
  }
  try {
    const saved = await setBillStatus(getPaveConfig(), docId, status);
    return NextResponse.json({ wrote: true, status: saved });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
