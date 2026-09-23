import { NextResponse, type NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import { callAppsScript } from "@/lib/appsScript";
import { getCustomFields } from "@/lib/clientDirectory";
import { getPaveConfig, hasGrant, writesEnabled } from "@/lib/config";
import { clearJtRefCache, getVendors, pave } from "@/lib/jobtread";
import { openJournal } from "@/lib/financialJournal";
import { normalizeAddress } from "@/lib/vendorMail";

/**
 * CREATE A VENDOR IN JOBTREAD, WITH THE ADDRESS ITS BILL ARRIVED FROM.
 *
 * The unmatched-vendor alert names a vendor whose bills wrote a sheet row and
 * then failed to push because no JobTread account matches. The fix was always
 * "go to JobTread, create the vendor, come back" — three context switches for
 * one name. This does it in place, and files the sender address on the new
 * account at the same time, so the vendor-mail check can see them from day one.
 *
 * ## Creating twice is the failure that matters
 *
 * An account is not reversible from here: a duplicate vendor has to be merged by
 * hand in JobTread, and bills may already point at either copy. So the name is
 * checked against every existing vendor account FIRST, case- and
 * punctuation-insensitively, and a match refuses rather than creating. The
 * caller is told which account it matched, because that usually means the real
 * problem is the sheet's "JT Account ID" column, not a missing vendor.
 *
 * ## Why it syncs afterwards
 *
 * Creating the account alone does not unstick the bill. The push resolves a
 * vendor through the Vendors SHEET, so the sheet has to learn the new account id
 * before the next retry can succeed — that is what the alert's "then run Sync
 * Vendors" line has always meant. Running it here is the difference between
 * "created" and "fixed". A sync failure is reported as a warning, not an error:
 * the account exists either way, and re-running the task is safe.
 *
 * POST { name, email?, syncVendors? } → { ok, vendor:{id,name}, synced, warning? }
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Compare vendor names the way a human would: case, spacing and punctuation
 *  are not a difference. Mirrors _vendorNormName on the Apps Script side. */
function normName(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[.,'"&]/g, "")
    .replace(/\b(inc|llc|ltd|co|corp|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  if (!hasGrant()) {
    return NextResponse.json({ error: "JT_GRANT_KEY is not set." }, { status: 400 });
  }
  if (!writesEnabled()) {
    return NextResponse.json({ error: "Writes are disabled." }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "A vendor name is required." }, { status: 400 });
  const email = normalizeAddress(String(body.email ?? ""));
  if (body.email && !email) {
    return NextResponse.json({ error: "That email address isn't valid." }, { status: 400 });
  }

  try {
    const cfg = getPaveConfig();

    // Refuse a duplicate. Read fresh rather than from the 30-minute ref cache,
    // because a vendor created a minute ago must not be created again.
    clearJtRefCache();
    const existing = await getVendors(cfg);
    const clash = existing.find((v) => normName(v.name) === normName(name));
    if (clash) {
      return NextResponse.json(
        {
          error:
            `JobTread already has a vendor called "${clash.name}". ` +
            `Nothing was created — the bill is most likely stuck because the Vendors sheet ` +
            `row has no "JT Account ID", which Sync Vendors fixes.`,
          existing: { id: clash.id, name: clash.name },
        },
        { status: 409 },
      );
    }

    // The org's own Email field for vendors — the same one /api/vendor-details
    // writes and the vendor-mail index reads.
    const fields = await getCustomFields(cfg);
    const emailFieldId = fields.vendor.find((f) => f.name === "Email")?.id;

    const created = await pave(cfg, {
      createAccount: {
        $: {
          organizationId: cfg.orgId,
          name,
          type: "vendor",
          ...(email && emailFieldId ? { customFieldValues: { [emailFieldId]: email } } : {}),
        },
        createdAccount: { id: {}, name: {} },
      },
    });
    const account = created?.createAccount?.createdAccount;
    if (!account?.id) {
      return NextResponse.json({ error: "JobTread did not return the new vendor." }, { status: 502 });
    }

    const j = await openJournal("/api/vendor-create");
    await j.record([
      {
        action: "vendor.create",
        entity: "vendor",
        entityId: String(account.id),
        jobId: "",
        field: "name",
        before: "",
        after: name,
      },
      ...(email
        ? [
            {
              action: "vendor.create",
              entity: "vendor",
              entityId: String(account.id),
              jobId: "",
              field: "email",
              before: "",
              after: email,
            },
          ]
        : []),
    ]);
    clearJtRefCache();

    // The sheet has to learn the account id before the stuck bill can push.
    let synced = false;
    let warning = "";
    if (body.syncVendors !== false) {
      const r = await callAppsScript(
        { action: "runTask", task: "syncVendorsFromJobTread" },
        { timeoutMs: 280_000 },
      );
      if (r.error) {
        warning =
          `The vendor was created, but Sync Vendors failed (${r.error}). ` +
          `Run it from Actions — the bill stays stuck until the sheet has the account id.`;
      } else {
        synced = true;
      }
    }
    revalidateTag("stuck-vendors");

    return NextResponse.json({
      ok: true,
      vendor: { id: String(account.id), name: String(account.name ?? name) },
      email,
      synced,
      ...(warning ? { warning } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 502 },
    );
  }
}
