import { NextResponse } from "next/server";
import { getJobFiles, getJobPlans } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: one job's Plans (JobTread's plan sheets) and Photos (the image
 * files uploaded to the job — bill and receipt scans, which arrive on a
 * document, stay out) for the Jobs page's bottom tabs.
 */
export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required." }, { status: 400 });
  }
  try {
    const cfg = getPaveConfig();
    const [plans, files] = await Promise.all([getJobPlans(cfg, jobId), getJobFiles(cfg, jobId)]);
    const photos = files.filter((f) => f.type.startsWith("image/") && !f.document);
    return NextResponse.json({ plans, photos });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
