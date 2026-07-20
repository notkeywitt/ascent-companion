import { NextRequest, NextResponse } from "next/server";

import { ocrSerialWithGemini } from "@/lib/gemini";

// Read a tool's serial number off a phone photo. The browser sends a downscaled
// image (data URL); we hand the bytes to Gemini vision (same engine the invoice
// OCR uses) and return the extracted string for the /tools edit modal to fill in.
// The user always reviews/edits the value before saving, so this is best-effort.
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const dataUrl = String(body.imageBase64 || "");
  if (!dataUrl) return NextResponse.json({ error: "imageBase64 is required." }, { status: 400 });

  const sniff = dataUrl.match(/^data:([^;,]+)[;,]/i);
  const mimeType = String(body.mimeType || (sniff ? sniff[1] : "image/jpeg"));
  const b64 = dataUrl.includes("base64,") ? dataUrl.split("base64,")[1] : dataUrl;
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) return NextResponse.json({ error: "Empty image." }, { status: 400 });

  try {
    const serial = await ocrSerialWithGemini(bytes, mimeType);
    return NextResponse.json({ ok: true, serial: serial ?? "" }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "OCR failed." },
      { status: 502 },
    );
  }
}
