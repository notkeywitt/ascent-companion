import { NextResponse } from "next/server";
import { resolveShopJobId } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: the JobTread id of the "Ascent - Shop" overhead job.
 *
 * The coding card's buyback dialog offers "move the whole bill to Shop", which
 * is a job reassignment and therefore needs a job id in the browser. Buyback
 * itself resolves Shop server-side (see resolveShopJobId — matched by name, not
 * hardcoded), so this route exists to hand the SAME answer to the client rather
 * than let a second definition of "which job is Shop" grow in the UI.
 */
export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    return NextResponse.json({ id: await resolveShopJobId(getPaveConfig()) });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
