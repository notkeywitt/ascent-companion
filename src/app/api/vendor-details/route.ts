import { NextRequest, NextResponse } from "next/server";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { clearJtRefCache, getVendorDetail, pave } from "@/lib/jobtread";
import { getCustomFields } from "@/lib/clientDirectory";
import { diffFields, openJournal } from "@/lib/financialJournal";

/**
 * POST — save a vendor's contact details: `{ accountId, email?, phone?, address?, billType? }`.
 * `billType` ("Bill" | "Expense") is the vendor's "Bill Type" custom field — the
 * default /add-bill files that vendor's bills as.
 * Only the keys present are touched; "" clears a field.
 *
 * WHY THIS ROUTE EXISTS RATHER THAN /api/clients/update: a vendor's Email and
 * Phone are custom fields on the `vendor` target, not the `customer` one that
 * route writes, and an address needs a LOCATION record that most vendors do not
 * have yet (235 vendor accounts, almost none with a location). So this route
 * does two things that route cannot:
 *
 *   - `updateAccount` with `customFieldValues` keyed by the org's own Email /
 *     Phone field ids for `targetType: "vendor"`.
 *   - the address onto the vendor's FIRST location, creating one when there is
 *     none. `createLocation` parses the free text into city/state/ZIP itself
 *     (`parseAddress` defaults true), which is why the response re-reads rather
 *     than echoing what was sent.
 *
 * Same three guards every other purpose-built write here carries: the view gate
 * in middleware (this path rides the "vendors" view — office + admin),
 * `writesEnabled()`, and a journal row per changed field with its prior value.
 */
export const dynamic = "force-dynamic";

/** The only fields this route will write. Anything else in the body is ignored. */
const FIELDS = ["email", "phone", "address", "billType"] as const;
type Field = (typeof FIELDS)[number];

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const accountId = String(body.accountId ?? "").trim();
  if (!accountId) return NextResponse.json({ error: "accountId required" }, { status: 400 });

  // Only what was sent. `undefined` = leave alone; "" = clear.
  const patch: Partial<Record<Field, string>> = {};
  for (const f of FIELDS) {
    if (body[f] !== undefined) patch[f] = String(body[f] ?? "").trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  const tooLong = Object.entries(patch).find(([, v]) => v.length > 500);
  if (tooLong) {
    return NextResponse.json({ error: `${tooLong[0]} is too long.` }, { status: 400 });
  }
  if (patch.billType !== undefined && !["Bill", "Expense", ""].includes(patch.billType)) {
    return NextResponse.json({ error: "billType must be Bill or Expense." }, { status: 400 });
  }

  const cfg = getPaveConfig();

  if (!writesEnabled()) {
    return NextResponse.json({ previewed: true, wrote: false, accountId, patch });
  }

  try {
    const [fields, before] = await Promise.all([
      getCustomFields(cfg),
      getVendorDetail(cfg, accountId),
    ]);
    const idOf = (name: string) => fields.vendor.find((f) => f.name === name)?.id ?? "";

    // 1. Email + phone — the account's own custom fields. null clears one.
    const cfv: Record<string, string | null> = {};
    if (patch.email !== undefined && idOf("Email")) cfv[idOf("Email")] = patch.email || null;
    if (patch.phone !== undefined && idOf("Phone")) cfv[idOf("Phone")] = patch.phone || null;
    if (patch.billType !== undefined) {
      // The grant cannot create custom fields, so the owner adds this one in
      // JobTread (Settings → Custom Fields → Vendors: "Bill Type", options Bill,
      // Expense). Say so rather than silently dropping the choice.
      if (!idOf("Bill Type")) {
        return NextResponse.json(
          { error: 'JobTread has no vendor custom field "Bill Type" (options Bill, Expense). Add it in JobTread settings first.' },
          { status: 409 },
        );
      }
      cfv[idOf("Bill Type")] = patch.billType || null;
    }
    if (Object.keys(cfv).length > 0) {
      // `notify` defaults to TRUE on updateAccount — filing a vendor's phone
      // number must not mail the vendor. Same reason /api/clients/update sends
      // it off on every account write.
      await pave(cfg, {
        updateAccount: {
          $: { id: accountId, notify: false, customFieldValues: cfv },
          // `account`, NOT `root`. Introspected live 2026-09-23: updateAccount
          // answers "The field \"root\" does not exist" and the whole write
          // fails, which is why this route never once saved an email or phone.
          account: { id: {} },
        },
      });
    }

    // 2. The address, onto the first location — or a new one when the vendor has
    //    none. An empty address clears the text; the location record stays,
    //    because deleting it would take its name and any job link with it.
    if (patch.address !== undefined) {
      const locId = await firstLocationId(cfg, accountId);
      if (locId) {
        await pave(cfg, {
          // `location`, not `root` — same introspection, same bug as above.
          updateLocation: { $: { id: locId, address: patch.address || null }, location: { id: {} } },
        });
      } else if (patch.address) {
        await pave(cfg, {
          createLocation: {
            $: { accountId, address: patch.address, parseAddress: true },
            createdLocation: { id: {} },
          },
        });
      }
    }

    // Re-read, because a mutation's own return carries only the id, and JobTread
    // derives the tidied address from the text it was given.
    const detail = await getVendorDetail(cfg, accountId);
    const j = await openJournal("/api/vendor-details");
    await j.record(
      diffFields(flat(before), flat(detail), {
        action: "vendor.details.set",
        entity: "vendor",
        entityId: accountId,
        jobId: "",
        beforeSource: "read",
      }),
    );
    clearJtRefCache();
    return NextResponse.json({ wrote: true, detail });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** The journal's view of a vendor: the fields this route writes. */
function flat(d: { email: string; phone: string; billType: string; addresses: string[] }) {
  return { Email: d.email, Phone: d.phone, "Bill Type": d.billType, Address: d.addresses.join(" | ") };
}

/** The vendor's first location, or "" when it has none. */
async function firstLocationId(
  cfg: Parameters<typeof pave>[0],
  accountId: string,
): Promise<string> {
  const r = await pave(cfg, {
    account: { $: { id: accountId }, id: {}, locations: { $: { size: 1 }, nodes: { id: {} } } },
  });
  return String(r?.account?.locations?.nodes?.[0]?.id ?? "");
}
