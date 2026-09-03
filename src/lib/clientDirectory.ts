/**
 * THE CLIENT DIRECTORY — every customer, their jobs, and the JobTread record
 * behind each one, readable and editable from a phone.
 *
 * This is the one place in the app that treats a JobTread **account** and
 * **job** as records to maintain rather than as figures to report. `/jobs` reads
 * a job's cost; `/leads` reads the accounts that are still leads; this reads the
 * whole customer list with the details the office keeps re-opening JobTread to
 * fix — a misspelled name, a missing job number, the Phase, the site address.
 *
 * ── READS ARE TWO-PHASE, AND THAT IS NOT A CHOICE ───────────────────────────
 * Nesting `jobs` inside a paged `organization.accounts` connection returns HTTP
 * 413 (confirmed live 2026-09-03 at accounts size 100 / jobs size 50 — the 413
 * rule in JT_API_REFERENCE.md). So the directory pages the two flat connections
 * separately and joins on `job.location.account.id`. Custom-field VALUES are the
 * same trap, so the list carries only Phase and Status (paged per FIELD, the
 * `getJobPhaseMap` shape) and the rest are read per record on demand.
 *
 * ── WRITES ARE AN ALLOWLIST, NOT A PASSTHROUGH ──────────────────────────────
 * `JOB_WRITABLE` / `ACCOUNT_WRITABLE` / `CONTACT_WRITABLE` / `LOCATION_WRITABLE`
 * below are the complete set of scalars this app will change, and everything
 * else JobTread exposes is deliberately read-only. Two kinds are held back on
 * purpose:
 *
 *   1. **Two numeric fields, for two different reasons.** A job's
 *      `defaultRetainagePercentage` introspects as a bare "number" with no
 *      bounds, so whether 5% is `5` or `0.05` is not stated anywhere — that one
 *      needs a probe. A location's `customTaxRate` IS stated (0..1), and is held
 *      back by choice: it decides what a client is taxed, and this page exists
 *      for the clerical fields, not for that decision. Change it in JobTread.
 *   2. **Multi-value custom fields** (`maxValuesAllowed` null — the job's Job
 *      Type and Status, today). One job legitimately carries two Job Type
 *      values, so the write payload has to be an array, and JobTread's
 *      whole-array-replace behavior on custom fields is not probe-confirmed.
 *      `isEditableField` is what enforces this, and the page says why on screen.
 *
 * Single-value custom fields ARE written, as the keyed `customFieldValues` map
 * (`customFieldId → value`) that `leadPush.ts` already uses in production.
 *
 * Every write here re-reads the record afterwards, because `updateJob`,
 * `updateAccount`, `updateContact` and `updateLocation` all return a bare `root`
 * (the mutation convention in JT_API_REFERENCE.md) — so the value the route
 * journals and the page redraws is JobTread's, never the browser's guess.
 */

import { pave, type PaveConfig } from "./jobtread";

// ---------------------------------------------------------------------------
// CUSTOM FIELDS
// ---------------------------------------------------------------------------

/** Which record a custom field hangs off. Mirrors Pave's `customFieldTargetType`. */
export type CfTarget = "job" | "customer" | "customerContact" | "location";

export interface CustomFieldDef {
  id: string;
  name: string;
  /** `option` | `text` | `date` | `boolean` | `emailAddress` | `phoneNumber` | … */
  type: string;
  /** Allowed values when `type` is "option"; empty otherwise. */
  options: string[];
  /** null = unlimited. Only `1` is editable here — see the header. */
  maxValuesAllowed: number | null;
  editable: boolean;
}

/** One field's value(s) on one record. `values` is empty when nothing is set. */
export interface CustomFieldValue {
  fieldId: string;
  name: string;
  type: string;
  options: string[];
  values: string[];
  editable: boolean;
}

/**
 * A field this app will write: exactly one value allowed, so the payload is a
 * scalar and there is no array-replace question to get wrong.
 */
export function isEditableField(f: { maxValuesAllowed: number | null }): boolean {
  return f.maxValuesAllowed === 1;
}

interface RawCustomField {
  id?: string;
  name?: string;
  type?: string;
  targetType?: string;
  options?: unknown;
  maxValuesAllowed?: number | null;
}

function toFieldDef(f: RawCustomField): CustomFieldDef {
  const max = typeof f.maxValuesAllowed === "number" ? f.maxValuesAllowed : null;
  return {
    id: String(f.id ?? ""),
    name: String(f.name ?? ""),
    type: String(f.type ?? "text"),
    options: Array.isArray(f.options) ? f.options.map((o) => String(o)) : [],
    maxValuesAllowed: max,
    editable: isEditableField({ maxValuesAllowed: max }),
  };
}

/** The org's custom fields, grouped by target. Read once per request tree. */
export async function getCustomFields(
  cfg: PaveConfig,
): Promise<Record<CfTarget, CustomFieldDef[]>> {
  const r = await pave(cfg, {
    organization: {
      $: { id: cfg.orgId },
      id: {},
      customFields: {
        $: { size: 100 },
        nodes: {
          id: {},
          name: {},
          type: {},
          targetType: {},
          options: {},
          maxValuesAllowed: {},
          position: {},
        },
      },
    },
  });
  const out: Record<CfTarget, CustomFieldDef[]> = {
    job: [],
    customer: [],
    customerContact: [],
    location: [],
  };
  for (const raw of (r?.organization?.customFields?.nodes ?? []) as RawCustomField[]) {
    const target = String(raw?.targetType ?? "");
    if (target === "job" || target === "customer" || target === "customerContact" || target === "location") {
      out[target].push(toFieldDef(raw));
    }
  }
  for (const key of Object.keys(out) as CfTarget[]) {
    out[key].sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

/**
 * Pair a record's `customFieldValues` connection against the org's field list,
 * so a field with nothing set still comes back (with `values: []`) and the page
 * can offer an input for it. A multi-value field yields one NODE PER VALUE with
 * the same field id, which is why `values` is an array rather than a string.
 */
export function pairFieldValues(conn: unknown, defs: CustomFieldDef[]): CustomFieldValue[] {
  const byId = new Map<string, string[]>();
  const nodes = (conn as { nodes?: unknown[] } | undefined)?.nodes ?? [];
  for (const raw of nodes) {
    const n = raw as { value?: unknown; customField?: { id?: string } };
    const id = n?.customField?.id;
    if (!id || n.value == null) continue;
    const text = typeof n.value === "string" ? n.value : String(n.value);
    if (!text.trim()) continue;
    const list = byId.get(id) ?? [];
    list.push(text);
    byId.set(id, list);
  }
  return defs.map((d) => ({
    fieldId: d.id,
    name: d.name,
    type: d.type,
    options: d.options,
    values: byId.get(d.id) ?? [],
    editable: d.editable,
  }));
}

/** The `customFieldValues` selection every detail read uses. */
const CF_SELECTION = {
  $: { size: 50 },
  nodes: { id: {}, value: {}, customField: { id: {}, name: {} } },
} as const;

// ---------------------------------------------------------------------------
// THE DIRECTORY — every customer + every job, joined
// ---------------------------------------------------------------------------

export interface DirectoryJob {
  id: string;
  name: string;
  number: string;
  createdAt: string;
  closedOn: string | null;
  priceType: string | null;
  locationId: string;
  address: string;
  accountId: string;
  customer: string;
  /** The two list-level custom fields, read per FIELD (413-safe). */
  phase: string;
  status: string;
}

export interface DirectoryCustomer {
  id: string;
  name: string;
  isTaxable: boolean;
  archivedAt: string | null;
  createdAt: string;
  contactName: string;
  contactTitle: string;
  address: string;
  jobs: DirectoryJob[];
}

export interface ClientDirectory {
  customers: DirectoryCustomer[];
  /**
   * Jobs whose location belongs to no customer account in the list — an
   * archived or vendor-owned account. Surfaced rather than dropped: a job that
   * silently vanishes from a directory is worse than one filed under "No
   * customer".
   */
  orphanJobs: DirectoryJob[];
}

/** One page of a connection, or the whole thing when it fits. */
async function pageAll<T>(
  cfg: PaveConfig,
  build: (args: Record<string, unknown>) => Record<string, unknown>,
  pick: (r: any) => { nodes?: T[]; nextPage?: string | null } | undefined,
  maxPages = 25,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const args: Record<string, unknown> = { size: 100 };
    if (cursor) args.page = cursor;
    const conn = pick(await pave(cfg, build(args)));
    for (const n of conn?.nodes ?? []) out.push(n);
    cursor = conn?.nextPage ?? null;
    if (!cursor) break;
  }
  return out;
}

/**
 * jobId → value for ONE job custom field, by field name.
 *
 * Same two-phase shape as `getJobPhaseMap` in jobtread.ts and for the same
 * reason: the values cannot ride along inside the paged jobs connection. Takes
 * the field list rather than re-reading it, so the directory costs one
 * customFields read no matter how many maps it builds.
 */
async function jobFieldMap(
  cfg: PaveConfig,
  field: CustomFieldDef | undefined,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!field?.id) return out;
  const nodes = await pageAll<{ value?: unknown; job?: { id?: string } }>(
    cfg,
    (args) => ({
      customField: {
        $: { id: field.id },
        id: {},
        customFieldValues: { $: args, nextPage: {}, nodes: { value: {}, job: { id: {} } } },
      },
    }),
    (r) => r?.customField?.customFieldValues,
    20,
  );
  for (const n of nodes) {
    const jobId = n?.job?.id;
    if (!jobId || n?.value == null) continue;
    const v = typeof n.value === "string" ? n.value : String(n.value);
    if (v.trim()) out[jobId] = v.trim();
  }
  return out;
}

interface RawAccount {
  id?: string;
  name?: string;
  isTaxable?: boolean;
  archivedAt?: string | null;
  createdAt?: string;
  primaryContact?: { name?: string; title?: string | null } | null;
  primaryLocation?: { formattedAddress?: string | null; name?: string | null } | null;
}

interface RawJob {
  id?: string;
  name?: string;
  number?: string | null;
  createdAt?: string;
  closedOn?: string | null;
  priceType?: string | null;
  location?: {
    id?: string;
    formattedAddress?: string | null;
    account?: { id?: string; name?: string } | null;
  } | null;
}

/**
 * Every customer and every job in one payload.
 *
 * Deliberately NOT cached in `jobtread.ts`'s reference cache: this page is the
 * surface that edits these records, and a five-minute stale read after a save
 * is exactly the confusion the edit was meant to remove. The route caches it
 * for a few seconds instead, and clears on write.
 */
export async function getClientDirectory(
  cfg: PaveConfig,
  fields?: Record<CfTarget, CustomFieldDef[]>,
): Promise<ClientDirectory> {
  const defs = fields ?? (await getCustomFields(cfg));
  const jobFields = defs.job;

  const [accounts, jobs, phaseMap, statusMap] = await Promise.all([
    pageAll<RawAccount>(
      cfg,
      (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          accounts: {
            // Same 2-element `where` form `getVendors` uses in production —
            // field, then value, meaning equality.
            $: { ...args, where: { and: [["type", "customer"]] }, sortBy: [{ field: "name" }] },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              isTaxable: {},
              archivedAt: {},
              createdAt: {},
              primaryContact: { name: {}, title: {} },
              primaryLocation: { name: {}, formattedAddress: {} },
            },
          },
        },
      }),
      (r) => r?.organization?.accounts,
    ),
    pageAll<RawJob>(
      cfg,
      (args) => ({
        organization: {
          $: { id: cfg.orgId },
          id: {},
          jobs: {
            $: { ...args, sortBy: [{ field: "name" }] },
            nextPage: {},
            nodes: {
              id: {},
              name: {},
              number: {},
              createdAt: {},
              closedOn: {},
              priceType: {},
              location: { id: {}, formattedAddress: {}, account: { id: {}, name: {} } },
            },
          },
        },
      }),
      (r) => r?.organization?.jobs,
    ),
    jobFieldMap(cfg, jobFields.find((f) => f.name === "Phase")),
    jobFieldMap(cfg, jobFields.find((f) => f.name === "Status")),
  ]);

  const customers: DirectoryCustomer[] = accounts.map((a) => ({
    id: String(a.id ?? ""),
    name: String(a.name ?? ""),
    isTaxable: a.isTaxable !== false,
    archivedAt: a.archivedAt ?? null,
    createdAt: String(a.createdAt ?? ""),
    contactName: String(a.primaryContact?.name ?? ""),
    contactTitle: String(a.primaryContact?.title ?? ""),
    address: String(a.primaryLocation?.formattedAddress ?? a.primaryLocation?.name ?? ""),
    jobs: [],
  }));
  const byId = new Map(customers.map((c) => [c.id, c]));

  const orphanJobs: DirectoryJob[] = [];
  for (const j of jobs) {
    const accountId = String(j.location?.account?.id ?? "");
    const row: DirectoryJob = {
      id: String(j.id ?? ""),
      name: String(j.name ?? ""),
      number: String(j.number ?? ""),
      createdAt: String(j.createdAt ?? ""),
      closedOn: j.closedOn ?? null,
      priceType: j.priceType ?? null,
      locationId: String(j.location?.id ?? ""),
      address: String(j.location?.formattedAddress ?? ""),
      accountId,
      customer: String(j.location?.account?.name ?? ""),
      phase: phaseMap[String(j.id ?? "")] ?? "",
      status: statusMap[String(j.id ?? "")] ?? "",
    };
    const owner = byId.get(accountId);
    if (owner) owner.jobs.push(row);
    else orphanJobs.push(row);
  }
  for (const c of customers) {
    c.jobs.sort((a, b) => a.name.localeCompare(b.name));
  }
  return { customers, orphanJobs };
}

// ---------------------------------------------------------------------------
// ONE JOB, IN FULL
// ---------------------------------------------------------------------------

export interface JobLocation {
  id: string;
  name: string;
  address: string;
  formattedAddress: string;
  city: string;
  state: string;
  postalCode: string;
  /** JobTread's resolved rate for the site (read-only here — see the header). */
  taxRate: number | null;
  customTaxRate: number | null;
  timeZone: string;
  contactId: string;
  contactName: string;
}

export interface JobDetail {
  id: string;
  name: string;
  number: string;
  description: string;
  priceType: string | null;
  closedOn: string | null;
  defaultRetainagePercentage: number | null;
  createdAt: string;
  scheduleIsPublished: boolean;
  useSimpleSelections: boolean;
  qboNextBillIsBillable: boolean;
  qboId: string;
  qboName: string;
  qboClassId: string;
  qbdId: string;
  companycamName: string;
  /** JobTread's own figures. Never recomputed here. */
  actualCost: number | null;
  projectedCost: number | null;
  projectedPrice: number | null;
  areas: string[];
  /** Folder paths, with JobTread's 0x1F separator turned into " / ". */
  folders: string[];
  counts: {
    documents: number;
    tasks: number;
    files: number;
    comments: number;
    dailyLogs: number;
    timeEntries: number;
  };
  customer: { id: string; name: string };
  location: JobLocation | null;
  fields: CustomFieldValue[];
}

/** JobTread packs a nested folder path with a unit separator, not a slash. */
const readableFolder = (s: string) => s.split("\u001f").join(" / ");

export async function getJobDetail(
  cfg: PaveConfig,
  jobId: string,
  fields?: Record<CfTarget, CustomFieldDef[]>,
): Promise<JobDetail> {
  const defs = fields ?? (await getCustomFields(cfg));
  const r = await pave(cfg, {
    job: {
      $: { id: jobId },
      id: {},
      name: {},
      number: {},
      description: {},
      priceType: {},
      closedOn: {},
      defaultRetainagePercentage: {},
      createdAt: {},
      scheduleIsPublished: {},
      useSimpleSelections: {},
      qboNextBillIsBillable: {},
      qboId: {},
      qboName: {},
      qboClassId: {},
      qbdId: {},
      companycamName: {},
      actualCost: {},
      projectedCost: {},
      projectedPrice: {},
      areas: {},
      folders: {},
      customFieldValues: CF_SELECTION,
      location: {
        id: {},
        name: {},
        address: {},
        formattedAddress: {},
        city: {},
        state: {},
        postalCode: {},
        taxRate: {},
        customTaxRate: {},
        timeZone: {},
        contact: { id: {}, name: {} },
        account: { id: {}, name: {} },
      },
      documents: { $: { size: 1 }, count: {} },
      tasks: { $: { size: 1 }, count: {} },
      files: { $: { size: 1 }, count: {} },
      comments: { $: { size: 1 }, count: {} },
      dailyLogs: { $: { size: 1 }, count: {} },
      timeEntries: { $: { size: 1 }, count: {} },
    },
  });
  const j = r?.job;
  if (!j?.id) throw new Error(`Job ${jobId} not found in JobTread.`);
  const loc = j.location;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const count = (c: unknown) => Number((c as { count?: number } | undefined)?.count ?? 0);

  return {
    id: String(j.id),
    name: String(j.name ?? ""),
    number: String(j.number ?? ""),
    description: String(j.description ?? ""),
    priceType: j.priceType ?? null,
    closedOn: j.closedOn ?? null,
    defaultRetainagePercentage: num(j.defaultRetainagePercentage),
    createdAt: String(j.createdAt ?? ""),
    scheduleIsPublished: j.scheduleIsPublished === true,
    useSimpleSelections: j.useSimpleSelections === true,
    qboNextBillIsBillable: j.qboNextBillIsBillable === true,
    qboId: String(j.qboId ?? ""),
    qboName: String(j.qboName ?? ""),
    qboClassId: String(j.qboClassId ?? ""),
    qbdId: String(j.qbdId ?? ""),
    companycamName: String(j.companycamName ?? ""),
    actualCost: num(j.actualCost),
    projectedCost: num(j.projectedCost),
    projectedPrice: num(j.projectedPrice),
    areas: Array.isArray(j.areas) ? j.areas.map((a: unknown) => String(a)) : [],
    folders: Array.isArray(j.folders) ? j.folders.map((f: unknown) => readableFolder(String(f))) : [],
    counts: {
      documents: count(j.documents),
      tasks: count(j.tasks),
      files: count(j.files),
      comments: count(j.comments),
      dailyLogs: count(j.dailyLogs),
      timeEntries: count(j.timeEntries),
    },
    customer: { id: String(loc?.account?.id ?? ""), name: String(loc?.account?.name ?? "") },
    location: loc
      ? {
          id: String(loc.id ?? ""),
          name: String(loc.name ?? ""),
          address: String(loc.address ?? ""),
          formattedAddress: String(loc.formattedAddress ?? ""),
          city: String(loc.city ?? ""),
          state: String(loc.state ?? ""),
          postalCode: String(loc.postalCode ?? ""),
          taxRate: num(loc.taxRate),
          customTaxRate: num(loc.customTaxRate),
          timeZone: String(loc.timeZone ?? ""),
          contactId: String(loc.contact?.id ?? ""),
          contactName: String(loc.contact?.name ?? ""),
        }
      : null,
    fields: pairFieldValues(j.customFieldValues, defs.job),
  };
}

// ---------------------------------------------------------------------------
// ONE CUSTOMER, IN FULL
// ---------------------------------------------------------------------------

export interface CustomerContact {
  id: string;
  name: string;
  title: string;
  createdAt: string;
  fields: CustomFieldValue[];
}

export interface CustomerLocation extends JobLocation {
  createdAt: string;
  fields: CustomFieldValue[];
}

export interface CustomerDetail {
  id: string;
  name: string;
  isTaxable: boolean;
  archivedAt: string | null;
  createdAt: string;
  qboId: string;
  primaryContactId: string;
  primaryLocationId: string;
  fields: CustomFieldValue[];
  contacts: CustomerContact[];
  locations: CustomerLocation[];
}

export async function getCustomerDetail(
  cfg: PaveConfig,
  accountId: string,
  fields?: Record<CfTarget, CustomFieldDef[]>,
): Promise<CustomerDetail> {
  const defs = fields ?? (await getCustomFields(cfg));
  const r = await pave(cfg, {
    account: {
      $: { id: accountId },
      id: {},
      name: {},
      type: {},
      isTaxable: {},
      archivedAt: {},
      createdAt: {},
      qboId: {},
      primaryContact: { id: {} },
      primaryLocation: { id: {} },
      customFieldValues: CF_SELECTION,
      contacts: {
        $: { size: 50 },
        nodes: { id: {}, name: {}, title: {}, createdAt: {}, customFieldValues: CF_SELECTION },
      },
      locations: {
        $: { size: 50 },
        nodes: {
          id: {},
          name: {},
          address: {},
          formattedAddress: {},
          city: {},
          state: {},
          postalCode: {},
          taxRate: {},
          customTaxRate: {},
          timeZone: {},
          createdAt: {},
          contact: { id: {}, name: {} },
          customFieldValues: CF_SELECTION,
        },
      },
    },
  });
  const a = r?.account;
  if (!a?.id) throw new Error(`Customer ${accountId} not found in JobTread.`);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  return {
    id: String(a.id),
    name: String(a.name ?? ""),
    isTaxable: a.isTaxable !== false,
    archivedAt: a.archivedAt ?? null,
    createdAt: String(a.createdAt ?? ""),
    qboId: String(a.qboId ?? ""),
    primaryContactId: String(a.primaryContact?.id ?? ""),
    primaryLocationId: String(a.primaryLocation?.id ?? ""),
    fields: pairFieldValues(a.customFieldValues, defs.customer),
    contacts: ((a.contacts?.nodes ?? []) as any[]).map((c) => ({
      id: String(c.id ?? ""),
      name: String(c.name ?? ""),
      title: String(c.title ?? ""),
      createdAt: String(c.createdAt ?? ""),
      fields: pairFieldValues(c.customFieldValues, defs.customerContact),
    })),
    locations: ((a.locations?.nodes ?? []) as any[]).map((l) => ({
      id: String(l.id ?? ""),
      name: String(l.name ?? ""),
      address: String(l.address ?? ""),
      formattedAddress: String(l.formattedAddress ?? ""),
      city: String(l.city ?? ""),
      state: String(l.state ?? ""),
      postalCode: String(l.postalCode ?? ""),
      taxRate: num(l.taxRate),
      customTaxRate: num(l.customTaxRate),
      timeZone: String(l.timeZone ?? ""),
      contactId: String(l.contact?.id ?? ""),
      contactName: String(l.contact?.name ?? ""),
      createdAt: String(l.createdAt ?? ""),
      fields: pairFieldValues(l.customFieldValues, defs.location),
    })),
  };
}

// ---------------------------------------------------------------------------
// WRITES — the allowlist, and one function per record kind
// ---------------------------------------------------------------------------

export type WriteKind = "job" | "account" | "contact" | "location";

/** A scalar this app will change: its JobTread name, and how to validate it. */
interface WritableField {
  /** "text" trims; "date" wants YYYY-MM-DD or empty; "enum" checks `values`. */
  kind: "text" | "date" | "boolean" | "enum";
  /** Longest accepted string, per the Pave input schema. */
  maxLength?: number;
  /** Accepted values for "enum". Empty string clears the field. */
  values?: string[];
  /** An empty string is sent as JSON null (JobTread's "unset") rather than "". */
  nullable?: boolean;
  /** Refuse an empty value — JobTread requires the field to hold something. */
  required?: boolean;
  label: string;
}

/**
 * Job scalars. `name` is capped at 30 and `number` at 16 by Pave itself
 * (`root.updateJob.$`, introspected 2026-09-03) — validating here turns a 400
 * from JobTread into a message the office can act on.
 */
export const JOB_WRITABLE: Record<string, WritableField> = {
  name: { kind: "text", maxLength: 30, required: true, label: "Job name" },
  number: { kind: "text", maxLength: 16, label: "Job number" },
  description: { kind: "text", maxLength: 32768, nullable: true, label: "Description" },
  priceType: {
    kind: "enum",
    values: ["fixed", "costPlus"],
    nullable: true,
    label: "Price type",
  },
  closedOn: { kind: "date", nullable: true, label: "Closed on" },
};

export const ACCOUNT_WRITABLE: Record<string, WritableField> = {
  name: { kind: "text", required: true, label: "Customer name" },
  isTaxable: { kind: "boolean", label: "Taxable" },
};

export const CONTACT_WRITABLE: Record<string, WritableField> = {
  name: { kind: "text", required: true, label: "Contact name" },
  title: { kind: "text", nullable: true, label: "Title" },
};

/**
 * Location scalars. `address` is free text and `formattedAddress`, city, state
 * and postal code are DERIVED from it — `createLocation` takes a `parseAddress`
 * flag, `updateLocation` takes none, so which of the derived fields an update
 * refreshes is not something the schema states. That is exactly why every write
 * here re-reads the record: the page draws what JobTread ended up holding
 * rather than asserting what the save should have done.
 */
export const LOCATION_WRITABLE: Record<string, WritableField> = {
  name: { kind: "text", nullable: true, label: "Site name" },
  address: { kind: "text", nullable: true, label: "Address" },
};

export const WRITABLE_BY_KIND: Record<WriteKind, Record<string, WritableField>> = {
  job: JOB_WRITABLE,
  account: ACCOUNT_WRITABLE,
  contact: CONTACT_WRITABLE,
  location: LOCATION_WRITABLE,
};

/** Which custom-field target belongs to which record kind. */
export const CF_TARGET_BY_KIND: Record<WriteKind, CfTarget> = {
  job: "job",
  account: "customer",
  contact: "customerContact",
  location: "location",
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Coerce one submitted scalar to what Pave wants, or explain the refusal.
 *
 * Returns `{ value }` on success — `value` may be `null`, which is how a
 * nullable field is cleared. Returns `{ error }` otherwise. Never throws, so a
 * caller can collect every complaint about a form in one pass.
 */
export function coerceField(
  spec: WritableField,
  raw: unknown,
): { value: string | boolean | null } | { error: string } {
  if (spec.kind === "boolean") {
    if (typeof raw === "boolean") return { value: raw };
    if (raw === "true" || raw === "false") return { value: raw === "true" };
    return { error: `${spec.label} must be true or false.` };
  }

  const text = raw == null ? "" : String(raw).trim();

  if (!text) {
    if (spec.required) return { error: `${spec.label} cannot be empty.` };
    return { value: spec.nullable ? null : "" };
  }
  if (spec.maxLength && text.length > spec.maxLength) {
    return { error: `${spec.label} is limited to ${spec.maxLength} characters.` };
  }
  if (spec.kind === "date" && !DATE_RE.test(text)) {
    return { error: `${spec.label} must be a date (YYYY-MM-DD).` };
  }
  if (spec.kind === "enum" && !(spec.values ?? []).includes(text)) {
    return { error: `${spec.label} must be one of: ${(spec.values ?? []).join(", ")}.` };
  }
  return { value: text };
}

export interface RecordPatch {
  /** Scalars, keyed by their JobTread field name. */
  fields?: Record<string, unknown>;
  /** Custom fields, keyed by custom-field ID. */
  customFieldValues?: Record<string, unknown>;
}

export interface ValidatedPatch {
  fields: Record<string, string | boolean | null>;
  customFieldValues: Record<string, string | null>;
  errors: string[];
}

/**
 * Validate a whole patch against one kind's allowlist.
 *
 * Anything not on the allowlist is DROPPED silently rather than refused — the
 * page sends the form it rendered, and a field this build made read-only is a
 * field the office cannot have meant to change. A value that IS on the
 * allowlist but fails its rule is an error, because that one was typed.
 */
export function validatePatch(
  kind: WriteKind,
  patch: RecordPatch,
  fieldDefs: CustomFieldDef[],
): ValidatedPatch {
  const spec = WRITABLE_BY_KIND[kind];
  const out: ValidatedPatch = { fields: {}, customFieldValues: {}, errors: [] };

  for (const [name, raw] of Object.entries(patch.fields ?? {})) {
    const rule = spec[name];
    if (!rule) continue;
    const res = coerceField(rule, raw);
    if ("error" in res) out.errors.push(res.error);
    else out.fields[name] = res.value;
  }

  const byId = new Map(fieldDefs.map((f) => [f.id, f]));
  for (const [id, raw] of Object.entries(patch.customFieldValues ?? {})) {
    const def = byId.get(id);
    if (!def || !def.editable) continue; // read-only or not a field of this record
    const text = raw == null ? "" : String(raw).trim();
    if (!text) {
      out.customFieldValues[id] = null; // clear it
      continue;
    }
    if (def.type === "option" && def.options.length && !def.options.includes(text)) {
      out.errors.push(`${def.name} must be one of: ${def.options.join(", ")}.`);
      continue;
    }
    out.customFieldValues[id] = text;
  }
  return out;
}

/** The mutation + re-read selection for each kind. */
const MUTATION: Record<
  WriteKind,
  {
    mutation: string;
    getter: string;
    selection: Record<string, unknown>;
    /** Extra mutation args this kind always sends. */
    always?: Record<string, unknown>;
  }
> = {
  job: {
    mutation: "updateJob",
    getter: "job",
    selection: { id: {}, name: {}, number: {}, description: {}, priceType: {}, closedOn: {} },
  },
  account: {
    mutation: "updateAccount",
    getter: "account",
    selection: { id: {}, name: {}, isTaxable: {} },
    // `updateAccount` is the one mutation here that carries `notify`, and it
    // DEFAULTS TO TRUE (introspected 2026-09-03). Fixing a customer's spelling
    // must not mail the customer, so this always sends it off. The other three
    // update mutations have no such field.
    always: { notify: false },
  },
  contact: {
    mutation: "updateContact",
    getter: "contact",
    selection: { id: {}, name: {}, title: {} },
  },
  location: {
    mutation: "updateLocation",
    getter: "location",
    selection: {
      id: {},
      name: {},
      address: {},
      formattedAddress: {},
      city: {},
      state: {},
      postalCode: {},
    },
  },
};

/**
 * One record's scalars and custom fields, flat, as JobTread holds them.
 *
 * Scalars keep their JobTread field names; custom fields are keyed by their
 * human NAME ("Phase", "Customer PO"), because this shape is what the financial
 * journal stores and a journal row reading `22PZqYNc2drh: Active` answers
 * nothing. A multi-value field joins its values with ", " — the journal records
 * what changed, not a structure to parse back.
 */
export async function readRecordFlat(
  cfg: PaveConfig,
  kind: WriteKind,
  id: string,
  fieldDefs: CustomFieldDef[],
): Promise<Record<string, unknown>> {
  const m = MUTATION[kind];
  const r = await pave(cfg, {
    [m.getter]: { $: { id }, ...m.selection, customFieldValues: CF_SELECTION },
  });
  const rec = r?.[m.getter];
  if (!rec?.id) throw new Error(`${kind} ${id} not found in JobTread.`);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(m.selection)) {
    if (key === "id") continue;
    out[key] = rec[key] ?? null;
  }
  for (const v of pairFieldValues(rec.customFieldValues, fieldDefs)) {
    out[v.name] = v.values.join(", ");
  }
  return out;
}

/**
 * Apply a validated patch to one record, then read it back flat.
 *
 * The re-read is not belt-and-braces: `update*` returns a bare `root`, so
 * without it the only "after" value available is the one the browser sent. It
 * also picks up whatever JobTread DERIVES from a write — a location's tidied
 * address, city, state and postal code all follow from the text that was saved.
 */
export async function applyPatch(
  cfg: PaveConfig,
  kind: WriteKind,
  id: string,
  patch: ValidatedPatch,
  fieldDefs: CustomFieldDef[],
): Promise<Record<string, unknown>> {
  const m = MUTATION[kind];
  const args: Record<string, unknown> = { id, ...(m.always ?? {}), ...patch.fields };
  if (Object.keys(patch.customFieldValues).length > 0) {
    args.customFieldValues = patch.customFieldValues;
  }
  await pave(cfg, { [m.mutation]: { $: args, root: { id: {} } } });
  return readRecordFlat(cfg, kind, id, fieldDefs);
}

/** True when the patch would change nothing — no scalar and no custom field. */
export function patchIsEmpty(patch: ValidatedPatch): boolean {
  return (
    Object.keys(patch.fields).length === 0 &&
    Object.keys(patch.customFieldValues).length === 0
  );
}
