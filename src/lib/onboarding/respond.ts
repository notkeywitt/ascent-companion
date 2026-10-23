/**
 * New-hire paperwork — the route helpers both audiences share: who is asking,
 * and how a PDF goes back to the browser. SERVER ONLY.
 */
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";

/** The signed-in email, lower-cased, or "" with no session. */
export async function sessionEmail(): Promise<string> {
  const session = await auth();
  return (session?.user?.email ?? "").trim().toLowerCase();
}

/** The caller's IP as the edge saw it — for the signature record. */
export function clientIp(req: NextRequest): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim().slice(0, 64);
}

/**
 * A PDF back to the browser. These PDFs can hold an SSN or a bank account
 * number, so nothing may cache them.
 */
export function pdfResponse(bytes: Uint8Array, fileName: string, download = false): NextResponse {
  const name = (fileName || "form.pdf").replace(/[^\w .()-]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
