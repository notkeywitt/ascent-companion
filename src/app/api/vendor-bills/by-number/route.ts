import { NextResponse } from "next/server";
import { getBillsByNumber } from "@/lib/jobtread";
import { getPaveConfig, hasGrant } from "@/lib/config";

/**
 * Read-only: every vendor bill with a given number, org-wide. Bill numbers
 * repeat across vendors, so this can return more than one match — see
 * getBillsByNumber's doc comment.
 */
export async function GET(req: Request) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  const raw = new URL(req.url).searchParams.get("number");
  const number = Number(raw);
  if (!raw || !Number.isFinite(number)) {
    return NextResponse.json({ error: "number is required." }, { status: 400 });
  }
  try {
    const bills = await getBillsByNumber(getPaveConfig(), number);
    return NextResponse.json({ bills });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
