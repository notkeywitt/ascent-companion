import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/auth";
import { docProblem } from "@/lib/companyDetailsRules";
import { openJournal } from "@/lib/financialJournal";
import {
  addVehicleFile,
  deleteVehicleFile,
  getVehicle,
  getVehicleFile,
  getVehiclePhoto,
  setVehiclePhoto,
} from "@/lib/vehicles";

/**
 * A vehicle's photo and documents, kept in the companion database. Gated by
 * the "office" view: office + admin. Never cached.
 *
 * GET ?id=  → one document, inline      GET ?photo=<vehicleId> → its photo
 * POST multipart (vehicleId, kind = "photo" | "doc", name, file) → { ok }
 *   PDF or photo, 4 MB at most; a vehicle photo must be an image.
 * DELETE ?id= → { ok }                   DELETE ?photo=<vehicleId> → { ok }
 */
export const dynamic = "force-dynamic";

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status });
const SOURCE = "/api/office/vehicles/files";

function inline(bytes: Buffer, mime: string, name: string) {
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `inline; filename="${name.replace(/[^\w .()-]/g, "_")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (q.has("photo")) {
    const photo = await getVehiclePhoto(Number(q.get("photo")));
    return photo ? inline(photo.bytes, photo.mime, "vehicle") : fail("No photo.", 404);
  }
  const found = await getVehicleFile(Number(q.get("id")));
  if (!found) return fail("No such file.", 404);
  return inline(found.bytes, found.file.mime, found.file.fileName || found.file.name);
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Send the file as a form upload.");
  }
  const vehicleId = Number(form.get("vehicleId"));
  const vehicle = Number.isInteger(vehicleId) ? await getVehicle(vehicleId) : null;
  if (!vehicle) return fail("No such vehicle.", 404);
  const file = form.get("file");
  if (!(file instanceof File)) return fail("Choose a file.");
  const problem = docProblem(file);
  if (problem) return fail(problem);
  const by = (await auth())?.user?.email ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const journal = await openJournal(SOURCE);

  if (form.get("kind") === "photo") {
    if (!file.type.startsWith("image/")) return fail("The vehicle photo must be a photo.");
    await setVehiclePhoto(vehicleId, { bytes, mime: file.type }, by);
    await journal.record([{ action: "vehicle.photo", entity: "vehicle", entityId: String(vehicleId), after: file.name }]);
    return NextResponse.json({ ok: true });
  }

  const name =
    String(form.get("name") ?? "").trim().slice(0, 120) || file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Document";
  const id = await addVehicleFile({ vehicleId, name, fileName: file.name.slice(0, 200), mime: file.type, bytes, by });
  await journal.record([
    { action: "vehicle-file.add", entity: "vehicle-file", entityId: String(id), after: name, meta: { vehicleId } },
  ]);
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const journal = await openJournal(SOURCE);
  if (q.has("photo")) {
    const vehicleId = Number(q.get("photo"));
    if (!(await getVehicle(vehicleId))) return fail("No such vehicle.", 404);
    await setVehiclePhoto(vehicleId, null, (await auth())?.user?.email ?? "");
    await journal.record([{ action: "vehicle.photo-remove", entity: "vehicle", entityId: String(vehicleId) }]);
    return NextResponse.json({ ok: true });
  }
  const id = Number(q.get("id"));
  const found = Number.isInteger(id) ? await getVehicleFile(id) : null;
  if (!found) return fail("No such file.", 404);
  await deleteVehicleFile(id);
  await journal.record([
    {
      action: "vehicle-file.delete",
      entity: "vehicle-file",
      entityId: String(id),
      before: found.file.name,
      beforeSource: "read",
      meta: { vehicleId: found.file.vehicleId },
    },
  ]);
  return NextResponse.json({ ok: true });
}
