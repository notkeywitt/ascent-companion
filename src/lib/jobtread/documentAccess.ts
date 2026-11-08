// Part of the JobTread Pave client. Import from "@/lib/jobtread", not from this
// file: jobtread.ts re-exports the public names of every part.

import { pageAll, pave, type PaveConfig } from "./core";
// ---------------------------------------------------------------------------
// DOCUMENT ACCESS  (the "Document Access" list on a JobTread document)
// ---------------------------------------------------------------------------

/**
 * One person who can be given access to a document — a CUSTOMER-role membership
 * on the account behind the job's location. JobTread calls the list on a
 * document "Document Access"; each row there is an `ace` (access-control entry)
 * naming a membership. Granting one is `createAce` with `targetType: "document"`.
 */
export interface CustomerContact {
  membershipId: string;
  name: string;
  emailAddress: string;
  /** The JobTread role behind the membership — "Customer", "Customer (Pre JT)". */
  roleName: string;
}

/**
 * The job's customer contacts. `membership.account` is not filterable in a
 * `where` (confirmed live 2026-09-16: "The field account does not exist at
 * membership" as a where-path, though it reads fine as a field), so this reads
 * every customer-role membership in the org — 12 of them today — and matches on
 * the account behind the job's location in script.
 */
export async function getJobCustomerContacts(
  cfg: PaveConfig,
  jobId: string,
): Promise<CustomerContact[]> {
  const j = await pave(cfg, {
    job: { $: { id: jobId }, id: {}, location: { account: { id: {} } } },
  });
  const accountId = j?.job?.location?.account?.id;
  if (!accountId) return [];

  const rows = await pageAll(cfg, {
    label: "organization.memberships (customer)",
    query: (args) => ({
      organization: {
        $: { id: cfg.orgId },
        id: {},
        memberships: {
          $: { ...args, where: { and: [[["role", "type"], "=", "customer"]] } },
          nextPage: {},
          nodes: {
            id: {},
            account: { id: {} },
            user: { name: {}, emailAddress: {} },
            role: { name: {} },
          },
        },
      },
    }),
    pick: (a) => a?.organization?.memberships,
  });

  return rows
    .filter((m: any) => m?.account?.id === accountId)
    .map((m: any) => ({
      membershipId: String(m.id),
      name: m?.user?.name ?? "",
      emailAddress: m?.user?.emailAddress ?? "",
      roleName: m?.role?.name ?? "",
    }));
}

/** One of the month's bills, with the memberships already on its access list. */
export interface DocAccessRow {
  id: string;
  label: string;
  membershipIds: string[];
}

/**
 * Every vendor bill this job issued in one month, each carrying its current
 * Document Access list. Invoiced bills are INCLUDED — access is about what the
 * client may read, not about what may still be recoded.
 *
 * Page size 25, same as the board's bill reads: `aces` is a nested connection
 * and a paged connection carrying one 413s above that.
 */
export async function getMonthBillAccess(
  cfg: PaveConfig,
  jobId: string,
  year: number,
  month: number,
): Promise<DocAccessRow[]> {
  const mm = String(month).padStart(2, "0");
  const first = `${year}-${mm}-01`;
  const last = `${year}-${mm}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;

  const rows = await pageAll(cfg, {
    label: "job.documents (month bills)",
    size: 25,
    query: (args) => ({
      job: {
        $: { id: jobId },
        id: {},
        documents: {
          $: {
            ...args,
            where: {
              and: [
                ["type", "vendorBill"],
                [["issueDate"], ">=", first],
                [["issueDate"], "<=", last],
              ],
            },
          },
          nextPage: {},
          nodes: {
            id: {},
            fullName: {},
            aces: { nodes: { id: {}, membership: { id: {} } } },
          },
        },
      },
    }),
    pick: (a) => a?.job?.documents,
  });

  return rows.map((d: any) => ({
    id: String(d.id),
    label: d?.fullName ?? String(d.id),
    membershipIds: (d?.aces?.nodes ?? [])
      .map((a: any) => a?.membership?.id)
      .filter(Boolean)
      .map(String),
  }));
}

/**
 * Add one membership to one document's Document Access list.
 *
 * `notify: false` on purpose — a month is dozens of bills, and the default
 * would send the client one email per document. The office tells the client
 * once; JobTread does not need to.
 */
export async function grantDocumentAccess(
  cfg: PaveConfig,
  docId: string,
  membershipId: string,
): Promise<void> {
  await pave(cfg, {
    createAce: {
      $: {
        // `assignee` is an untagged oneOf: Pave picks the variant by its keys,
        // so the membership branch is a bare `{ membershipId }`. Nesting it
        // under `membership` matches nothing and Pave reports the user branch's
        // missing `emailAddress` (probed live 2026-10-15).
        assignee: { membershipId },
        targetId: docId,
        targetType: "document",
        notify: false,
      },
    },
  });
}

/**
 * ONE document's access list, plus the job it belongs to. The job is read from
 * the document rather than taken from the caller: it is what decides which
 * customer contacts may be named, so the server must not be told it.
 */
export async function getDocumentAccess(
  cfg: PaveConfig,
  docId: string,
): Promise<{ jobId: string; row: DocAccessRow }> {
  const r = await pave(cfg, {
    document: {
      $: { id: docId },
      id: {},
      fullName: {},
      job: { id: {} },
      aces: { nodes: { id: {}, membership: { id: {} } } },
    },
  });
  const d = r?.document;
  if (!d) throw new Error("That document does not exist in JobTread.");
  return {
    jobId: String(d?.job?.id ?? ""),
    row: {
      id: String(d.id),
      label: d?.fullName ?? String(d.id),
      membershipIds: (d?.aces?.nodes ?? [])
        .map((a: any) => a?.membership?.id)
        .filter(Boolean)
        .map(String),
    },
  };
}
