import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { openJournal } from "@/lib/financialJournal";
import { cleanVehicleInput } from "@/lib/vehicleRules";
import { addVehicle, deleteVehicle, getVehicle, listVehicles, updateVehicle } from "@/lib/vehicles";

/**
 * Company vehicles — the Office Dashboard's Vehicles card. Companion-only;
 * nothing here touches JobTread. Gated by the "office" view: office + admin.
 *
 * GET                 → { vehicles } (no file bytes)
 * POST { name, … }    → { ok, id }   add a vehicle
 * PUT { id, … }       → { ok }       save the changed fields (each journalled)
 * DELETE ?id=         → { ok }       the vehicle and its files
 *
 * Photo and documents: /api/office/vehicles/files.
 */
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const SOURCE = "/api/office/vehicles";

export async function GET() {
  return NextResponse.json({ vehicles: await listVehicles() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { values, error } = cleanVehicleInput(body, true);
  if (error) return fail(error);
  const id = await addVehicle(values, (await auth())?.user?.email ?? "");
  const journal = await openJournal(SOURCE);
  await journal.record([{ action: "vehicle.add", entity: "vehicle", entityId: String(id), after: values }]);
  return NextResponse.json({ ok: true, id });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return fail("Bad vehicle id.");
  const { values, error } = cleanVehicleInput(body, false);
  if (error) return fail(error);
  const changed = await updateVehicle(id, values, (await auth())?.user?.email ?? "");
  if (!changed) return fail("No such vehicle.", 404);
  if (changed.length > 0) {
    const journal = await openJournal(SOURCE);
    await journal.record(
      changed.map((c) => ({
        action: "vehicle.set",
        entity: "vehicle",
        entityId: String(id),
        field: c.key,
        before: c.before,
        after: c.after,
        beforeSource: "read" as const,
      })),
    );
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return fail("Bad vehicle id.");
  const found = await getVehicle(id);
  if (!found) return fail("No such vehicle.", 404);
  await deleteVehicle(id);
  const journal = await openJournal(SOURCE);
  await journal.record([
    {
      action: "vehicle.delete",
      entity: "vehicle",
      entityId: String(id),
      before: { ...found.values, files: found.files.map((f) => f.name) },
      beforeSource: "read",
    },
  ]);
  return NextResponse.json({ ok: true });
}
