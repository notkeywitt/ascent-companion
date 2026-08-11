/**
 * Leads — reading the org's "New Lead" customers out of JobTread.
 *
 * A lead in JobTread is just a customer `account` whose **Status** custom field
 * reads "New Lead" (probe-confirmed live 2026-08-10: field id 22PXGFXPG2sw,
 * targetType `customer`; the org's only other value in use is "Customer").
 * There is no lead object in the Pave schema, so this module is the whole
 * definition of "what is a lead".
 *
 * READ-ONLY. Nothing here writes to JobTread — the Companion's own tracking
 * (stage, next action, contact log) lives in the companion DB and is joined on
 * top in /api/leads. Advancing a lead out of "New Lead" is still done in
 * JobTread, and this list follows it automatically.
 *
 * Two phases on purpose, same reason as `getJobPhaseMap` in jobtread.ts:
 * nesting `customFieldValues` inside a paged `organization.accounts` connection
 * risks HTTP 413, so we page the Status FIELD's values (each node carries its
 * account) to find WHICH accounts are leads, then fetch each lead's detail on
 * its own. The lead set is small by nature (7 at time of writing), so the
 * per-lead fan-out is a handful of parallel calls, not a scan of the org.
 */

import { pave, type PaveConfig } from "./jobtread";

/** The Status custom-field value that marks an account as a lead. */
export const LEAD_STATUS = "New Lead";

/** Account-level custom fields we surface. Probe-confirmed to exist on `customer`. */
const ACCOUNT_CF = ["Lead Source", "Type", "Notes", "Status"] as const;

export interface LeadContact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
}

export interface LeadJob {
  id: string;
  name: string;
  createdAt: string;
}

export interface LeadTask {
  id: string;
  name: string;
  endDate: string;
  completed: boolean;
}

/** One JobTread lead, flattened for the UI. */
export interface LeadJt {
  id: string; // JT account id
  name: string;
  createdAt: string; // ISO
  /** Custom fields, by field name. */
  source: string;
  customerType: string;
  notes: string;
  address: string;
  primaryContact: LeadContact | null;
  contacts: LeadContact[];
  jobs: LeadJob[];
  tasks: LeadTask[];
}

/** Pull `{ name: value }` out of a customFieldValues connection. */
function cfMap(conn: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const nodes = (conn as { nodes?: unknown[] } | undefined)?.nodes ?? [];
  for (const raw of nodes) {
    const n = raw as { value?: unknown; customField?: { name?: string } };
    const name = n?.customField?.name;
    if (!name || n.value == null) continue;
    out[name] = typeof n.value === "string" ? n.value : String(n.value);
  }
  return out;
}

function toContact(raw: unknown): LeadContact | null {
  const c = raw as
    | { id?: string; name?: string; title?: string | null; customFieldValues?: unknown }
    | null;
  if (!c?.id) return null;
  const cf = cfMap(c.customFieldValues);
  return {
    id: c.id,
    name: c.name ?? "",
    title: c.title ?? "",
    email: cf.Email ?? "",
    phone: cf.Phone ?? "",
  };
}

interface CustomFieldNode {
  id?: string;
  name?: string;
  targetType?: string;
}

/** The org's custom-field definitions (one page — the org has ~30). */
async function loadCustomFields(cfg: PaveConfig): Promise<CustomFieldNode[]> {
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {} } },
    },
  });
  return r?.organization?.customFields?.nodes ?? [];
}

/**
 * The ids of the customer (and customer-contact) fields the Companion reads and
 * writes, looked up BY NAME rather than hardcoded — same reasoning as
 * `statusFieldId`: renaming one in JobTread should break loudly, not silently
 * write into the void. A field that isn't found comes back "" and its caller
 * skips it.
 *
 * `targetType` matters: the org has THREE fields called "Status" (customer, job)
 * and "Email"/"Phone" exist on customerContact, vendor and vendorContact alike.
 */
export interface CustomerFieldIds {
  status: string;
  leadSource: string;
  type: string;
  notes: string;
  contactEmail: string;
  contactPhone: string;
}

export async function getCustomerFieldIds(cfg: PaveConfig): Promise<CustomerFieldIds> {
  const fields = await loadCustomFields(cfg);
  const find = (name: string, targetType: string) =>
    fields.find((f) => f?.name === name && f?.targetType === targetType)?.id ?? "";
  return {
    status: find("Status", "customer"),
    leadSource: find("Lead Source", "customer"),
    type: find("Type", "customer"),
    notes: find("Notes", "customer"),
    contactEmail: find("Email", "customerContact"),
    contactPhone: find("Phone", "customerContact"),
  };
}

/**
 * The Status custom field's id, looked up by name (not hardcoded, so renaming
 * the field in JobTread doesn't silently return an empty lead list — it fails
 * loudly instead). Returns null when the org has no such field.
 */
async function statusFieldId(cfg: PaveConfig): Promise<string | null> {
  const fields = await loadCustomFields(cfg);
  const f =
    fields.find((x) => x?.name === "Status" && x?.targetType === "customer") ??
    fields.find((x) => x?.name === "Status");
  return f?.id ?? null;
}

/** Ids (and names) of every account currently sitting at Status = "New Lead". */
export async function getLeadAccountIds(cfg: PaveConfig): Promise<{ id: string; name: string }[]> {
  const fieldId = await statusFieldId(cfg);
  if (!fieldId) throw new Error('No customer "Status" custom field found in JobTread.');

  const out: { id: string; name: string }[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const r = await pave(cfg, {
      customField: {
        $: { id: fieldId },
        id: {},
        customFieldValues: {
          $: args,
          nextPage: {},
          nodes: { value: {}, account: { id: {}, name: {}, archivedAt: {} } },
        },
      },
    });
    const conn = r?.customField?.customFieldValues ?? {};
    for (const n of conn.nodes ?? []) {
      // Archived accounts are dead leads — JobTread keeps their Status value.
      if (String(n?.value ?? "") !== LEAD_STATUS) continue;
      if (!n?.account?.id || n.account.archivedAt) continue;
      out.push({ id: n.account.id, name: n.account.name ?? "" });
    }
    cursor = conn.nextPage ?? null;
    if (!cursor) break;
  }
  return out;
}

/** Everything the page shows about one lead account. */
export async function getLeadDetail(cfg: PaveConfig, accountId: string): Promise<LeadJt | null> {
  const contactSel = {
    id: {},
    name: {},
    title: {},
    customFieldValues: { $: { size: 20 }, nodes: { value: {}, customField: { name: {} } } },
  };
  const r = await pave(cfg, {
    account: {
      $: { id: accountId },
      id: {},
      name: {},
      createdAt: {},
      primaryContact: contactSel,
      primaryLocation: { id: {}, name: {}, formattedAddress: {} },
      contacts: { $: { size: 20 }, nodes: contactSel },
      customFieldValues: { $: { size: 25 }, nodes: { value: {}, customField: { name: {} } } },
      jobs: { $: { size: 20 }, nodes: { id: {}, name: {}, createdAt: {} } },
      tasks: { $: { size: 25 }, nodes: { id: {}, name: {}, endDate: {}, completed: {} } },
    },
  });
  const a = r?.account;
  if (!a?.id) return null;
  const cf = cfMap(a.customFieldValues);
  const contacts = (a.contacts?.nodes ?? [])
    .map(toContact)
    .filter((c: LeadContact | null): c is LeadContact => c !== null);
  return {
    id: a.id,
    name: a.name ?? "",
    createdAt: a.createdAt ?? "",
    source: cf[ACCOUNT_CF[0]] ?? "",
    customerType: cf[ACCOUNT_CF[1]] ?? "",
    notes: cf[ACCOUNT_CF[2]] ?? "",
    address: a.primaryLocation?.formattedAddress ?? a.primaryLocation?.name ?? "",
    primaryContact: toContact(a.primaryContact),
    contacts,
    jobs: (a.jobs?.nodes ?? []).map((j: { id: string; name?: string; createdAt?: string }) => ({
      id: j.id,
      name: j.name ?? "",
      createdAt: j.createdAt ?? "",
    })),
    tasks: (a.tasks?.nodes ?? []).map(
      (t: { id: string; name?: string; endDate?: string; completed?: unknown }) => ({
        id: t.id,
        name: t.name ?? "",
        endDate: t.endDate ?? "",
        // JT returns completed as 0/1, not a boolean.
        completed: Boolean(t.completed),
      }),
    ),
  };
}

/**
 * Every "New Lead" customer with its detail, newest first.
 *
 * The per-lead detail calls run in parallel; one failing lead is dropped rather
 * than failing the whole page (a single bad account shouldn't hide the pipeline).
 */
export async function getLeads(cfg: PaveConfig): Promise<LeadJt[]> {
  const ids = await getLeadAccountIds(cfg);
  const settled = await Promise.allSettled(ids.map((x) => getLeadDetail(cfg, x.id)));
  const leads: LeadJt[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value) leads.push(s.value);
  }
  return leads.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
