import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { isCloudSet, readRows } from "@/lib/art/cloudRead";

/**
 * Read-only: the plain rows of one /art data set (?set=bills|labor|budget).
 * The Weave, Rose, River, Fingerprints and Words pieces draw from these.
 * Gated by middleware on the `art` view (admin).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const set = new URL(req.url).searchParams.get("set");
  if (!isCloudSet(set)) {
    return NextResponse.json({ error: "Pick a data set: bills, labor or budget." }, { status: 400 });
  }
  try {
    return NextResponse.json({ set, rows: await readRows(set) });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
