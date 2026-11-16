import { NextResponse } from "next/server";
import { hasGrant } from "@/lib/config";
import { isCloudSet, readCloud } from "@/lib/art/cloudRead";

/**
 * Read-only: one Cost Cloud data set (?set=bills|labor|budget) as PCA points.
 * Gated by middleware on the `art` view (admin): it carries every bill line's
 * cost and every crew member's hours.
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
    return NextResponse.json(await readCloud(set));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unknown error" }, { status: 502 });
  }
}
