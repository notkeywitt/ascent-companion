// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pave, type PaveConfig } from "./core";

// ── Lead research (src/lib/leadResearch.ts) ─────────────────────────────────

/** One record's custom field values, by custom field id. */
export type FieldValues = Record<string, string>;

/**
 * What lead research needs to know about one customer: who it is, the
 * property (its primary location), its newest job, and the custom field values
 * each of those three already holds — so the run pencils in only what is new.
 */
export interface ResearchSubject {
  accountId: string;
  name: string;
  createdAt: string;
  contact: { name: string; title: string; email: string; phone: string } | null;
  location: {
    id: string;
    address: string;
    formattedAddress: string;
    city: string;
    county: string;
    state: string;
    postalCode: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  /** The newest job, which takes the job fields and the Background files. */
  job: { id: string; name: string; number: string; createdAt: string } | null;
  jobCount: number;
  values: { account: FieldValues; location: FieldValues; job: FieldValues };
}

const CF = { $: { size: 50 }, nodes: { value: {}, customField: { id: {}, name: {} } } } as const;

function valuesOf(conn: unknown): FieldValues {
  const out: FieldValues = {};
  for (const raw of (conn as { nodes?: unknown[] } | undefined)?.nodes ?? []) {
    const n = raw as { value?: unknown; customField?: { id?: string } };
    const id = n?.customField?.id;
    if (!id || n.value == null) continue;
    const v = typeof n.value === "string" ? n.value : String(n.value);
    if (!v.trim()) continue;
    out[id] = out[id] ? `${out[id]}, ${v.trim()}` : v.trim();
  }
  return out;
}

/**
 * READ — one customer for lead research. Two calls: the account (its primary
 * contact and location are single references, so their custom fields ride
 * along without the 413 risk of a paged connection), then the newest job's
 * custom fields on their own.
 */
export async function getResearchSubject(cfg: PaveConfig, accountId: string): Promise<ResearchSubject | null> {
  const r = await pave(cfg, {
    account: {
      $: { id: accountId },
      id: {},
      name: {},
      createdAt: {},
      customFieldValues: CF,
      primaryContact: { id: {}, name: {}, title: {}, customFieldValues: CF },
      primaryLocation: {
        id: {},
        address: {},
        formattedAddress: {},
        city: {},
        county: {},
        state: {},
        postalCode: {},
        latitude: {},
        longitude: {},
        customFieldValues: CF,
      },
      jobs: { $: { size: 50 }, nodes: { id: {}, name: {}, number: {}, createdAt: {} } },
    },
  });
  const a = r?.account;
  if (!a?.id) return null;

  const jobs = ((a.jobs?.nodes ?? []) as { id: string; name?: string; number?: string; createdAt?: string }[])
    .slice()
    .sort((x, y) => String(y.createdAt ?? "").localeCompare(String(x.createdAt ?? "")));
  const newest = jobs[0] ?? null;
  let jobValues: FieldValues = {};
  if (newest) {
    const j = await pave(cfg, { job: { $: { id: newest.id }, id: {}, customFieldValues: CF } });
    jobValues = valuesOf(j?.job?.customFieldValues);
  }

  // A contact's email and phone are custom fields by NAME on customerContact.
  const contactByName: Record<string, string> = {};
  for (const raw of a.primaryContact?.customFieldValues?.nodes ?? []) {
    const name = raw?.customField?.name;
    if (name && raw.value != null) contactByName[name] = String(raw.value);
  }
  const loc = a.primaryLocation;
  return {
    accountId: a.id,
    name: a.name ?? "",
    createdAt: a.createdAt ?? "",
    contact: a.primaryContact?.id
      ? {
          name: a.primaryContact.name ?? "",
          title: a.primaryContact.title ?? "",
          email: contactByName.Email ?? "",
          phone: contactByName.Phone ?? "",
        }
      : null,
    location: loc?.id
      ? {
          id: loc.id,
          address: loc.address ?? "",
          formattedAddress: loc.formattedAddress ?? "",
          city: loc.city ?? "",
          county: loc.county ?? "",
          state: loc.state ?? "",
          postalCode: loc.postalCode ?? "",
          latitude: typeof loc.latitude === "number" ? loc.latitude : null,
          longitude: typeof loc.longitude === "number" ? loc.longitude : null,
        }
      : null,
    job: newest
      ? { id: newest.id, name: newest.name ?? "", number: newest.number ?? "", createdAt: newest.createdAt ?? "" }
      : null,
    jobCount: jobs.length,
    values: {
      account: valuesOf(a.customFieldValues),
      location: valuesOf(loc?.customFieldValues),
      job: jobValues,
    },
  };
}
