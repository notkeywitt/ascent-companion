/**
 * Push a Companion-logged lead into JobTread as a customer.
 *
 * This is the ONE write in the leads feature, and it is deliberately in its own
 * module: `lib/leads.ts` (the board's reader) stays read-only, and everything
 * that can change JobTread is in this file, behind `writesEnabled()` at the
 * route.
 *
 * WHAT IT CREATES, in order — four calls, not one, because Pave has no "create a
 * customer with its contact and address" mutation:
 *   1. `createAccount`   type "customer", with the customer custom fields set in
 *      the same call (Status = "New Lead", Lead Source, Type, and the whole
 *      intake questionnaire rendered into Notes).
 *   2. `createContact`   the person, carrying Email + Phone.
 *   3. `createLocation`  the project address (`parseAddress` lets JobTread
 *      normalize it, the same as typing it into the UI).
 *   4. `updateAccount`   points `primaryContactId`/`primaryLocationId` at what
 *      2 and 3 made, which is what makes the phone number and address show up on
 *      the customer (and on our own board, which reads primaryLocation).
 *
 * PARTIAL FAILURE IS THE INTERESTING CASE. Step 1 is the irreversible one: once
 * the account exists it must never be created twice, so the caller records the
 * new id the moment step 1 returns and steps 2–4 only ever add WARNINGS. A lead
 * whose contact failed to attach is a customer in JobTread missing a phone
 * number — annoying, fixable by hand. A retried step 1 is a duplicate customer,
 * which is not.
 *
 * `customFieldValues` is a keyed map (customFieldId → value) on every one of
 * these mutations, and the option fields (Status/Lead Source/Type) only accept
 * values from their own JobTread option list — see JT_LEAD_SOURCES /
 * JT_CUSTOMER_TYPES in lib/leadInquiry.ts.
 */

import { getCustomerFieldIds, LEAD_STATUS, type CustomerFieldIds } from "./leads";
import { inquirySummary, type InquiryFields } from "./leadInquiry";
import { pave, type PaveConfig } from "./jobtread";

/** Stand-in for the not-yet-created account id in a dry-run plan. */
const NEW_ACCOUNT = "<new account id>";

export interface LeadPushResult {
  accountId: string;
  contactId: string;
  locationId: string;
  /** Non-fatal problems: the customer exists, but something didn't attach. */
  warnings: string[];
}

/** An existing JobTread customer with the same name — the duplicate guard. */
export interface NameMatch {
  id: string;
  name: string;
  type: string;
}

/**
 * Customers already called `name`. A manual intake list makes double-entry easy
 * (the same lead phoned in twice, or came in through the website as well), so the
 * route refuses to push over a match unless it's told to go ahead.
 *
 * Vendors are filtered out client-side: an exact name collision with a vendor
 * account is not a duplicate customer, and the `where` here is on name only —
 * the same shape the appscript suite proved for account lookups.
 */
export async function findCustomersByName(cfg: PaveConfig, name: string): Promise<NameMatch[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      accounts: {
        $: {
          size: 20,
          where: { and: [{ "=": [{ field: "name" }, { value: trimmed }] }] },
        },
        nodes: { id: {}, name: {}, type: {}, archivedAt: {} },
      },
    },
  });
  const nodes: { id?: string; name?: string; type?: string; archivedAt?: string | null }[] =
    r?.organization?.accounts?.nodes ?? [];
  return nodes
    .filter((n) => n?.id && n.type === "customer" && !n.archivedAt)
    .map((n) => ({ id: n.id as string, name: n.name ?? "", type: n.type ?? "" }));
}

/* ------------------------------------------------------------- query builders */

/** Drop empty values — writing "" into an option field is not the same as
 *  leaving it unset, and JobTread rejects "" as an option value. */
function definedOnly(map: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(map)) {
    if (k && v) out[k] = v;
  }
  return out;
}

function accountQuery(
  cfg: PaveConfig,
  fields: InquiryFields,
  ids: CustomerFieldIds,
  meta: { loggedAt?: string; loggedBy?: string },
): Record<string, unknown> {
  return {
    createAccount: {
      $: {
        organizationId: cfg.orgId,
        name: fields.name.trim(),
        type: "customer",
        customFieldValues: definedOnly({
          // Status is what puts the new customer on the leads board at all.
          [ids.status]: LEAD_STATUS,
          [ids.leadSource]: fields.leadSource,
          [ids.type]: fields.customerType,
          [ids.notes]: inquirySummary(fields, meta),
        }),
      },
      createdAccount: { id: {}, name: {} },
    },
  };
}

function contactQuery(
  accountId: string,
  fields: InquiryFields,
  ids: CustomerFieldIds,
): Record<string, unknown> {
  return {
    createContact: {
      $: {
        accountId,
        name: fields.name.trim(),
        customFieldValues: definedOnly({
          [ids.contactEmail]: fields.email,
          [ids.contactPhone]: fields.phone,
        }),
      },
      createdContact: { id: {} },
    },
  };
}

function locationQuery(accountId: string, fields: InquiryFields): Record<string, unknown> {
  return {
    createLocation: {
      $: {
        accountId,
        name: fields.address.trim(),
        address: fields.address.trim(),
        parseAddress: true,
      },
      createdLocation: { id: {} },
    },
  };
}

function primaryQuery(
  accountId: string,
  contactId: string,
  locationId: string,
): Record<string, unknown> {
  const $: Record<string, unknown> = { id: accountId };
  if (contactId) $.primaryContactId = contactId;
  if (locationId) $.primaryLocationId = locationId;
  return { updateAccount: { $, account: { $: { id: accountId }, id: {} } } };
}

/**
 * Exactly what would be sent, without sending it — what the route returns for a
 * dry run (and when the write gate is closed), so the office can see the push
 * before arming it. The account-dependent steps show a placeholder id because
 * their real one doesn't exist until step 1 has run.
 */
export async function buildLeadPushPlan(
  cfg: PaveConfig,
  fields: InquiryFields,
  meta: { loggedAt?: string; loggedBy?: string } = {},
): Promise<{ label: string; query: Record<string, unknown> }[]> {
  const ids = await getCustomerFieldIds(cfg);
  const plan = [{ label: "createAccount", query: accountQuery(cfg, fields, ids, meta) }];
  if (fields.email || fields.phone) {
    plan.push({ label: "createContact", query: contactQuery(NEW_ACCOUNT, fields, ids) });
  }
  if (fields.address.trim()) {
    plan.push({ label: "createLocation", query: locationQuery(NEW_ACCOUNT, fields) });
  }
  plan.push({
    label: "updateAccount (primary contact + location)",
    query: primaryQuery(NEW_ACCOUNT, "<new contact id>", "<new location id>"),
  });
  return plan;
}

/* -------------------------------------------------------------------- write */

/**
 * Create the customer. `onAccountCreated` is called the instant step 1 succeeds
 * and BEFORE steps 2–4 run — that callback is where the caller records the id, so
 * a failure later can never leave an account in JobTread that the Companion has
 * forgotten about (which would let a retry create a second one).
 */
export async function pushLeadToJobTread(
  cfg: PaveConfig,
  fields: InquiryFields,
  meta: { loggedAt?: string; loggedBy?: string } = {},
  onAccountCreated?: (accountId: string) => Promise<void>,
): Promise<LeadPushResult> {
  const name = fields.name.trim();
  if (!name) throw new Error("A lead needs a name before it can go to JobTread.");
  const ids = await getCustomerFieldIds(cfg);
  if (!ids.status) {
    throw new Error(
      'JobTread has no customer "Status" custom field — without it the new customer would not appear as a lead.',
    );
  }

  const created = await pave(cfg, accountQuery(cfg, fields, ids, meta));
  const accountId: string = created?.createAccount?.createdAccount?.id ?? "";
  if (!accountId) throw new Error("JobTread did not return an id for the new customer.");
  if (onAccountCreated) await onAccountCreated(accountId);

  const warnings: string[] = [];
  const step = async (what: string, run: () => Promise<string>): Promise<string> => {
    try {
      return await run();
    } catch (e) {
      warnings.push(`${what}: ${e instanceof Error ? e.message : "failed"}`);
      return "";
    }
  };

  let contactId = "";
  if (fields.email || fields.phone) {
    contactId = await step("Contact not added", async () => {
      const r = await pave(cfg, contactQuery(accountId, fields, ids));
      return r?.createContact?.createdContact?.id ?? "";
    });
  }

  let locationId = "";
  if (fields.address.trim()) {
    locationId = await step("Address not added", async () => {
      const r = await pave(cfg, locationQuery(accountId, fields));
      return r?.createLocation?.createdLocation?.id ?? "";
    });
  }

  if (contactId || locationId) {
    await step("Primary contact/address not set", async () => {
      await pave(cfg, primaryQuery(accountId, contactId, locationId));
      return "";
    });
  }

  return { accountId, contactId, locationId, warnings };
}
