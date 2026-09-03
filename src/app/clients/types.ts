/**
 * The shapes `/api/clients*` returns, restated for the browser.
 *
 * Deliberately NOT imported from `src/lib/clientDirectory.ts`: that module
 * imports the Pave client, which reads the grant key from env, and a client
 * component must never pull a server module into its bundle. Same convention as
 * `JobsBrowser.tsx`, which restates the cost-detail shapes for the same reason.
 */

export interface CustomFieldValue {
  fieldId: string;
  name: string;
  type: string;
  options: string[];
  values: string[];
  /** False for a multi-value field — read-only here. See `clientDirectory.ts`. */
  editable: boolean;
}

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
  orphanJobs: DirectoryJob[];
}

export interface JobLocation {
  id: string;
  name: string;
  address: string;
  formattedAddress: string;
  city: string;
  state: string;
  postalCode: string;
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
  actualCost: number | null;
  projectedCost: number | null;
  projectedPrice: number | null;
  areas: string[];
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

/** One job's invoice capture tag, as `listInvoiceTags` reports it. */
export interface InvoiceTag {
  jobId: string;
  projectId: string;
  label: string;
  tag: string;
  exists: boolean;
}

export interface InvoiceTagList {
  prefix: string;
  tags: InvoiceTag[];
  /** Labels in Gmail that resolve to no project — a tag the scan leaves stuck. */
  unresolved: string[];
}
