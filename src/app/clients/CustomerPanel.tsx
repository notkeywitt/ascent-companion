"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Banner,
  Chip,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  SectionHeading,
} from "@/components/ui";
import { RecordEditor, type ReadOnlyRow, type ScalarSpec } from "./RecordEditor";
import type { CustomerDetail, DirectoryJob } from "./types";

/**
 * ONE CUSTOMER, in full — the account, every contact on it, every site, and the
 * list of their jobs.
 *
 * In JobTread a customer is three records, not one: the **account** carries the
 * name and the lead fields, a **contact** carries the person and their email and
 * phone (both custom fields), and a **location** carries the address the job
 * inherits and the tax rate that follows from it. The office thinks of that as
 * "the client", so all three are edited on this one screen — each through its
 * own save, because each is its own JobTread mutation.
 *
 * The primary contact and primary location are marked rather than reordered: a
 * job inherits the location it was created against, so which one is primary
 * matters and hiding it would make an address edit look like it applied to a job
 * it did not.
 */

const ACCOUNT_SCALARS: ScalarSpec[] = [
  { name: "name", label: "Customer name", kind: "text" },
  {
    name: "isTaxable",
    label: "Taxable",
    kind: "toggle",
    help: "Off means JobTread charges this customer no sales tax at all.",
  },
];

const CONTACT_SCALARS: ScalarSpec[] = [
  { name: "name", label: "Name", kind: "text" },
  { name: "title", label: "Title", kind: "text" },
];

const LOCATION_SCALARS: ScalarSpec[] = [
  { name: "name", label: "Site name", kind: "text" },
  {
    name: "address",
    label: "Address",
    kind: "text",
    help: "Free text. The tidied address, city, state and ZIP below are JobTread's, derived from this — the panel redraws them from JobTread after every save.",
  },
];

const dateLabel = (iso: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(2)}%`);

export function CustomerPanel({
  accountId,
  jobs,
  onOpenJob,
  onSaved,
}: {
  accountId: string;
  /** The customer's jobs from the directory — already loaded, so no second read. */
  jobs: DirectoryJob[];
  onOpenJob: (jobId: string) => void;
  /** Lets the list behind this panel redraw a renamed customer. */
  onSaved?: (accountId: string, saved: Record<string, unknown>) => void;
}) {
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/clients/customer?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.json())
      .then((j: { customer?: CustomerDetail; error?: string }) => {
        if (j.error) throw new Error(j.error);
        setCustomer(j.customer ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(load, [load]);

  if (loading && !customer) return <Loading label="Loading the customer…" />;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!customer) return null;

  const accountReadOnly: ReadOnlyRow[] = [
    { label: "Created", value: dateLabel(customer.createdAt) },
    { label: "QuickBooks id", value: customer.qboId || "Not linked" },
    { label: "Archived", value: customer.archivedAt ? dateLabel(customer.archivedAt) : "No" },
    { label: "Jobs", value: String(jobs.length) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold tracking-tight">{customer.name}</h2>
        <MetaLine
          items={[
            `${jobs.length} job${jobs.length === 1 ? "" : "s"}`,
            `${customer.contacts.length} contact${customer.contacts.length === 1 ? "" : "s"}`,
            `${customer.locations.length} site${customer.locations.length === 1 ? "" : "s"}`,
          ]}
          className="mt-1"
        />
      </div>

      <RecordEditor
        key={`account-${customer.id}`}
        kind="account"
        id={customer.id}
        heading="Customer"
        scalars={ACCOUNT_SCALARS}
        values={{ name: customer.name, isTaxable: customer.isTaxable }}
        fields={customer.fields}
        readOnly={accountReadOnly}
        onSaved={(saved) => {
          onSaved?.(customer.id, saved);
          load();
        }}
      />

      {customer.contacts.map((c) => (
        <RecordEditor
          key={`contact-${c.id}`}
          kind="contact"
          id={c.id}
          heading={
            c.id === customer.primaryContactId ? "Contact · primary" : "Contact"
          }
          scalars={CONTACT_SCALARS}
          values={{ name: c.name, title: c.title }}
          fields={c.fields}
          readOnly={[{ label: "Added", value: dateLabel(c.createdAt) }]}
          onSaved={load}
        />
      ))}

      {customer.locations.map((l) => (
        <RecordEditor
          key={`location-${l.id}`}
          kind="location"
          id={l.id}
          heading={l.id === customer.primaryLocationId ? "Site · primary" : "Site"}
          scalars={LOCATION_SCALARS}
          values={{ name: l.name, address: l.address }}
          fields={l.fields}
          readOnly={[
            { label: "As JobTread parsed it", value: l.formattedAddress },
            { label: "City / state / ZIP", value: [l.city, l.state, l.postalCode].filter(Boolean).join(", ") },
            {
              label: "Tax rate",
              value: l.customTaxRate != null ? pct(l.customTaxRate) : pct(l.taxRate),
              note:
                l.customTaxRate != null
                  ? "A custom rate is set, overriding the address lookup. Change it in JobTread."
                  : "From the address. A job on this site inherits it.",
            },
            { label: "Site contact", value: l.contactName },
            { label: "Time zone", value: l.timeZone },
          ]}
          onSaved={load}
        />
      ))}

      <section className="space-y-3">
        <SectionHeading trailing={<span className="text-[11px] tabular-nums text-neutral-500">{jobs.length}</span>}>
          Jobs
        </SectionHeading>
        {jobs.length === 0 ? (
          <MetaLine items={["This customer has no jobs in JobTread."]} />
        ) : (
          <ListCard>
            {jobs.map((j) => (
              <ListRow
                key={j.id}
                onClick={() => onOpenJob(j.id)}
                label={j.name}
                desc={[j.number ? `#${j.number}` : "No number", j.address].filter(Boolean).join(" · ")}
                trailing={j.closedOn ? <Chip>Closed</Chip> : undefined}
              />
            ))}
          </ListCard>
        )}
      </section>
    </div>
  );
}
