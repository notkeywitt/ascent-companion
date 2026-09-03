import { NextResponse } from "next/server";
import { getPaveConfig, hasGrant } from "@/lib/config";
import { getClientDirectory, getCustomFields } from "@/lib/clientDirectory";

/**
 * GET — the whole client directory: every customer, their jobs, and the org's
 * custom-field definitions the page renders inputs from.
 *
 * Not cached. Every other JobTread list route here caches for minutes because
 * nothing in the app edits it; this one is read by the page that DOES the
 * editing, and a customer renamed on this screen reappearing under its old name
 * is the confusion the screen exists to remove. The whole payload is two paged
 * connections plus two custom-field walks against an org of ~21 customers and
 * ~25 jobs, so it is cheap enough to just be true.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const fields = await getCustomFields(cfg);
    const directory = await getClientDirectory(cfg, fields);
    return NextResponse.json({ ...directory, fields });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
