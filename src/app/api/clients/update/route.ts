import { NextRequest, NextResponse } from "next/server";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { clearJtRefCache } from "@/lib/jobtread";
import { diffFields, openJournal } from "@/lib/financialJournal";
import {
  CF_TARGET_BY_KIND,
  applyPatch,
  getCustomFields,
  patchIsEmpty,
  readRecordFlat,
  validatePatch,
  type WriteKind,
} from "@/lib/clientDirectory";

/**
 * POST — save an edit to ONE JobTread record: a job, a customer account, one of
 * its contacts, or one of its locations.
 *
 *   { kind: "job"|"account"|"contact"|"location",
 *     id,                       // the record's JobTread id
 *     jobId?,                   // context for the journal, when kind isn't "job"
 *     fields?: { name, number, … },        // scalars, by JobTread field name
 *     customFieldValues?: { <fieldId>: value } }
 *
 * THE FOUR THINGS THIS ROUTE IS RESPONSIBLE FOR
 *
 * 1. **The allowlist decides**, not the browser. `validatePatch` keeps only the
 *    scalars in `WRITABLE_BY_KIND` and only the single-value custom fields, so a
 *    hand-made POST cannot reach a field this build holds read-only.
 * 2. **Every write is journalled with its prior value**, read live immediately
 *    before the mutation. JobTread attributes all of this app's writes to the
 *    one grant key, so its own history cannot say who renamed a job — this can.
 * 3. **`writesEnabled()` still decides.** With the master switch off the route
 *    answers `{ previewed: true }` and JobTread is untouched, which is what
 *    makes the page safe to open on a dev machine pointed at the live org.
 * 4. **The reference cache is cleared on success**, because a renamed job or
 *    customer is in the job picker's 5-minute cache everywhere else in the app.
 */
export const dynamic = "force-dynamic";

const KINDS: WriteKind[] = ["job", "account", "contact", "location"];

/** The journal verb + entity name per kind. "customer" reads better than "account". */
const JOURNAL: Record<WriteKind, { action: string; entity: string }> = {
  job: { action: "job.details.set", entity: "job" },
  account: { action: "customer.details.set", entity: "customer" },
  contact: { action: "customer-contact.details.set", entity: "contact" },
  location: { action: "customer-location.details.set", entity: "location" },
};

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: {
    kind?: string;
    id?: string;
    jobId?: string;
    fields?: Record<string, unknown>;
    customFieldValues?: Record<string, unknown>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const kind = KINDS.find((k) => k === body.kind);
  if (!kind) {
    return NextResponse.json(
      { error: `kind must be one of: ${KINDS.join(", ")}` },
      { status: 400 },
    );
  }
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const cfg = getPaveConfig();
  let fieldDefs;
  try {
    fieldDefs = (await getCustomFields(cfg))[CF_TARGET_BY_KIND[kind]];
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const patch = validatePatch(
    kind,
    { fields: body.fields, customFieldValues: body.customFieldValues },
    fieldDefs,
  );
  if (patch.errors.length > 0) {
    return NextResponse.json({ error: patch.errors.join(" ") }, { status: 400 });
  }
  if (patchIsEmpty(patch)) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, kind, id, patch });
  }

  const j = await openJournal("/api/clients/update");
  // Read the prior values BEFORE the mutation, so `beforeSource` can honestly
  // say "read". A failure here is not a reason to refuse the edit — the write
  // still happens, journalled with beforeSource "none".
  let prior: Record<string, unknown> | undefined;
  try {
    prior = await readRecordFlat(cfg, kind, id, fieldDefs);
  } catch {
    prior = undefined;
  }
  const base = {
    ...JOURNAL[kind],
    entityId: id,
    jobId: kind === "job" ? id : (body.jobId ?? "").trim(),
    beforeSource: (prior ? "read" : "none") as "read" | "none",
  };

  try {
    const saved = await applyPatch(cfg, kind, id, patch, fieldDefs);
    // Diff the WHOLE record, not the patch: JobTread derives fields from what
    // was saved (a location's tidied address, city, state and ZIP follow from
    // its free-text address), and those belong in the record of what changed.
    await j.record(diffFields(prior, saved, base));
    clearJtRefCache();
    return NextResponse.json({ wrote: true, kind, id, saved });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    await j.record(
      diffFields(prior, { ...patch.fields }, base).map((ev) => ({
        ...ev,
        outcome: "error" as const,
        error: message,
      })),
    );
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
