import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  addInstruction,
  listInstructions,
  retireInstruction,
} from "@/lib/invoiceReview/instructions";

/**
 * Standing instructions for how the month is read out.
 *
 * GET  → every instruction, active and retired.
 * POST { text }              → add one.
 * POST { id, retire: true }  → retire one (the row stays; see instructions.ts).
 *
 * These shape the SUMMARY, never what is found — an instruction cannot hide a
 * finding, which is what makes them safe to add casually. A ruling is the thing
 * that silences, and it goes through the review route with a mandatory reason.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ instructions: await listInstructions() });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const who = session?.user?.email ?? "";

  let body: { text?: string; id?: number; retire?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  try {
    if (body.retire) {
      const id = Number(body.id);
      if (!Number.isFinite(id)) {
        return NextResponse.json({ error: "Pass the instruction's id." }, { status: 400 });
      }
      await retireInstruction(id);
      return NextResponse.json({ ok: true });
    }
    await addInstruction(String(body.text ?? ""), who);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 400 },
    );
  }
}
