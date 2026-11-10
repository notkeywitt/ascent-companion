"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BillStatusBadge } from "@/components/BillStatusBadge";
import {
  Banner,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  FileDrop,
  FilterChip,
  Input,
  Label,
  ListCard,
  ListRow,
  Loading,
  PageHeader,
  QuietInput,
  SectionHeading,
  SplitView,
  btn,
} from "@/components/ui";
import { money } from "@/lib/money";
import { setUrlParam } from "@/lib/urlParam";
import { coiKey, gmailComposeUrl, type VendorCoiRow } from "@/lib/vendorCoi";
import { CoiDot } from "@/components/CoiDot";

/**
 * Vendor bill search — job, date, amount, status, per vendor or per bill
 * number. JobTread's own vendor search only lists a bill's number; this
 * shows the rest without leaving the phone.
 *
 * Two independent lookups on one page rather than one input that guesses
 * intent from keystrokes: name search filters the already-cached vendor
 * list instantly (no network per keystroke), while the bill-number lookup is
 * org-wide and only fires on submit — bill numbers repeat across vendors
 * (confirmed live: #98 matches three different vendors/jobs), so it always
 * shows every match rather than assuming one.
 *
 * Gated by the "vendors" view in src/lib/views.ts (office + admin).
 */

interface VendorRef {
  id: string;
  name: string;
}
interface VendorBillRow {
  id: string;
  number: number | null;
  jobId: string | null;
  jobName: string;
  cost: number;
  status: string;
  issueDate: string | null;
}
/** A pre-JobTread bill from the Expenditure sheet, via the bill search index. */
interface ArchiveBill {
  id: number;
  invoiceId: string;
  jobName: string;
  amount: number;
  status: string;
  issueDate: string;
  pdfFileId: string;
}
interface VendorBillMatch extends VendorBillRow {
  vendorName: string;
}
interface VendorContact {
  name: string;
  title: string;
  email: string;
  phone: string;
}
interface VendorDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  billType: "Bill" | "Expense";
  coiExpires: string;
  vendorType: string;
  addresses: string[];
  contacts: VendorContact[];
}

const dateLabel = (d: string | null) => {
  if (!d) return "No date";
  const dt = new Date(d + "T00:00:00");
  return Number.isNaN(dt.getTime())
    ? d
    : dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const isDigits = (s: string) => /^\d+$/.test(s.trim());

/** "+13604683952" → "(360) 468-3952". Anything else is shown as stored. */
const phoneLabel = (p: string) => {
  const d = p.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
};

/**
 * Email, phone, address, bill type and COI for one vendor — every field is an
 * input, filled or not.
 *
 * JobTread keeps email and phone as custom fields on the account ("vendor") and
 * the address on its first location; most of the 235 vendor accounts carry none
 * of them. The office fills or corrects them here instead of opening JobTread.
 * Save sends only the fields that changed; an emptied field clears it. A
 * contact's own details are JobTread's job — they stay read-only.
 */
const FIELD_DEFS = [
  { key: "email", label: "Email", type: "email", placeholder: "name@vendor.com" },
  { key: "phone", label: "Phone", type: "tel", placeholder: "(360) 555-0134" },
  { key: "address", label: "Address", type: "text", placeholder: "Street, city, state ZIP" },
  { key: "coiExpires", label: "COI expires", type: "date", placeholder: "" },
] as const;

/** The COI status read for every vendor (/api/vendor-coi/status). */
interface CoiStatus {
  today: string;
  byId: Record<string, VendorCoiRow>;
  request: string[];
}

const rowCls =
  "flex min-h-[56px] items-center gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0";
const rowLabelCls =
  "w-16 shrink-0 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400";

function VendorDetailCard({
  detail,
  onSaved,
  coi,
  onCoiChanged,
}: {
  detail: VendorDetail;
  onSaved: (d: VendorDetail) => void;
  coi: VendorCoiRow | undefined;
  onCoiChanged: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // A fresh vendor is a fresh form — otherwise a half-typed phone number
  // follows you to the next vendor.
  useEffect(() => {
    setDraft({});
    setError("");
  }, [detail.id]);

  const contacts = detail.contacts.filter((c) => c.name || c.email || c.phone);
  const stored: Record<string, string> = {
    email: detail.email,
    phone: detail.phone,
    address: detail.addresses[0] ?? "",
    coiExpires: detail.coiExpires,
  };
  const valueOf = (k: string) => draft[k] ?? stored[k];
  const changed = Object.fromEntries(
    FIELD_DEFS.map((f) => f.key)
      .filter((k) => draft[k] !== undefined && draft[k].trim() !== stored[k])
      .map((k) => [k, draft[k].trim()]),
  );
  const changedCount = Object.keys(changed).length;

  function save(fields: Record<string, string> = changed) {
    if (Object.keys(fields).length === 0) return;
    setSaving(true);
    setError("");
    fetch("/api/vendor-details", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: detail.id, ...fields }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setError(String(j.error));
          return;
        }
        if (j.previewed) {
          setError("Writes are switched off — nothing was saved.");
          return;
        }
        setDraft({});
        if (j.detail) onSaved(j.detail as VendorDetail);
        if ("coiExpires" in fields) onCoiChanged();
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setSaving(false));
  }

  return (
    <div className="space-y-2">
      <ListCard>
        {FIELD_DEFS.map((f) => {
          const v = stored[f.key];
          // A filled email or phone keeps its one-tap way out.
          const out = !v
            ? ""
            : f.key === "email"
              ? `mailto:${v}`
              : f.key === "phone"
                ? `tel:${v}`
                : "";
          return (
            <div key={f.key} className={rowCls}>
              <label htmlFor={`vendor-${f.key}`} className={rowLabelCls}>
                {f.label}
              </label>
              <QuietInput
                id={`vendor-${f.key}`}
                type={f.type}
                value={
                  f.key === "phone" && draft.phone === undefined ? phoneLabel(v) : valueOf(f.key)
                }
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                disabled={saving}
              />
              {out && (
                <a
                  href={out}
                  className="shrink-0 text-xs font-semibold text-accent hover:underline"
                >
                  {f.key === "email" ? "Email" : "Call"}
                </a>
              )}
            </div>
          );
        })}
        {/* Only the first address is editable — it is the one the route writes. */}
        {detail.addresses.slice(1).map((a) => (
          <ListRow key={a} label={a} desc="Address" />
        ))}

        {/* What /add-bill files this vendor's bills as. Saves on tap. */}
        <div className={rowCls}>
          <span className={rowLabelCls}>Bill type</span>
          <div className="flex gap-2">
            {(["Bill", "Expense"] as const).map((t) => (
              <FilterChip
                key={t}
                on={detail.billType === t}
                onClick={() => !saving && detail.billType !== t && save({ billType: t })}
                title={t === "Expense" ? "Already paid when it arrives" : "Paid later, on terms"}
              >
                {t}
              </FilterChip>
            ))}
          </div>
        </div>

        <VendorCoiRow vendor={detail.name} />
        <CoiRequestRow accountId={detail.id} coi={coi} onChanged={onCoiChanged} />

        {contacts.map((c) => (
          <ListRow
            key={`${c.name}-${c.email}-${c.phone}`}
            label={c.name || "Contact"}
            desc={
              [c.title, c.email, c.phone && phoneLabel(c.phone)].filter(Boolean).join(" · ") ||
              "Contact"
            }
          />
        ))}
      </ListCard>

      {error && <p className="text-sm text-danger">{error}</p>}

      {changedCount > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            className={btn("primary", "md")}
            onClick={() => save()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save to JobTread"}
          </button>
          <button
            type="button"
            className={btn("secondary", "md")}
            onClick={() => setDraft({})}
            disabled={saving}
          >
            Discard
          </button>
        </div>
      )}
    </div>
  );
}

/** "2026-10-23" → "Oct 23, 2026". */
const isoLabel = (d: string) => (d ? dateLabel(d) : "");

/**
 * The vendor's COI request state: when a COI was last requested, and whether
 * this vendor needs one at all. Saved in the companion table, not JobTread
 * (/api/vendor-coi/status). The expiry date is the "COI expires" field above.
 */
function CoiRequestRow({
  accountId,
  coi,
  onChanged,
}: {
  accountId: string;
  coi: VendorCoiRow | undefined;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function post(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    fetch("/api/vendor-coi/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(String(j.error)) : onChanged()))
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setBusy(false));
  }

  const today = new Date().toLocaleDateString("en-CA");
  const override = coi?.override ?? null;
  const choices: { label: string; value: boolean | null; title: string }[] = [
    { label: "Auto", value: null, title: "Decided from JobTread's Type field and the store list" },
    { label: "Yes", value: true, title: "Always include in COI requests" },
    { label: "No", value: false, title: "Never include in COI requests" },
  ];

  return (
    <>
      <div className={`${rowCls} flex-wrap`}>
        <label htmlFor={`coi-asked-${accountId}`} className={rowLabelCls}>
          COI asked
        </label>
        <QuietInput
          id={`coi-asked-${accountId}`}
          type="date"
          value={coi?.lastRequestedOn ?? ""}
          onChange={(e) => post({ accountIds: [accountId], requestedOn: e.target.value })}
          disabled={busy}
        />
        <button
          type="button"
          className="shrink-0 text-xs font-semibold text-accent hover:underline disabled:opacity-40"
          onClick={() => post({ accountIds: [accountId], requestedOn: today })}
          disabled={busy || coi?.lastRequestedOn === today}
        >
          Today
        </button>
      </div>
      <div className={`${rowCls} flex-wrap`}>
        <span className={rowLabelCls}>COI needed</span>
        <div className="flex flex-wrap items-center gap-2">
          {choices.map((c) => (
            <FilterChip
              key={c.label}
              on={override === c.value}
              onClick={() => !busy && override !== c.value && post({ accountId, coiNeeded: c.value })}
              title={c.title}
            >
              {c.label}
            </FilterChip>
          ))}
          {coi && override === null && (
            <span className="text-xs text-neutral-500">{coi.needed ? "Needs one" : "Not needed"}</span>
          )}
        </div>
        {error && <p className="w-full text-xs text-danger">{error}</p>}
      </div>
    </>
  );
}

/**
 * "Request COIs" — every vendor billed in the past year whose COI has expired
 * or has no expiry recorded, minus vendors that need none (lib/vendorCoi.ts).
 * Opens one Gmail compose window in the office account, every vendor in BCC.
 * Gmail keeps it as a draft until it is sent. A second button then records
 * today as each vendor's last request.
 */
function RequestCoisDialog({
  status,
  onClose,
  onMarked,
}: {
  status: CoiStatus;
  onClose: () => void;
  onMarked: () => void;
}) {
  const rows = status.request.map((id) => status.byId[id]).filter(Boolean);
  const withEmail = rows.filter((r) => r.emails.length > 0);
  const noEmail = rows.filter((r) => r.emails.length === 0);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(withEmail.map((r) => r.id)));
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [marked, setMarked] = useState(0);

  const chosen = withEmail.filter((r) => picked.has(r.id));
  const href = gmailComposeUrl(chosen.flatMap((r) => r.emails));

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function markRequested() {
    setBusy(true);
    setError("");
    fetch("/api/vendor-coi/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountIds: chosen.map((r) => r.id), requestedOn: status.today }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) setError(String(j.error));
        else {
          setMarked(chosen.length);
          onMarked();
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setBusy(false));
  }

  const why = (r: VendorCoiRow) =>
    [
      r.coiExpires ? `Expired ${isoLabel(r.coiExpires)}` : "No expiry on record",
      r.lastRequestedOn ? `asked ${isoLabel(r.lastRequestedOn)}` : "never asked",
      `last bill ${isoLabel(r.lastBillOn)}`,
    ].join(" · ");

  return (
    <Dialog
      onClose={onClose}
      busy={busy}
      size="lg"
      title="Request COIs"
      description="Vendors billed in the past year whose COI has expired or has no expiry date. Stores, software and utilities are left out."
      footer={
        <>
          <button type="button" className={btn("secondary", "md")} onClick={onClose} disabled={busy}>
            {marked ? "Done" : "Close"}
          </button>
          {opened && !marked ? (
            <button
              type="button"
              className={btn("primary", "md")}
              onClick={markRequested}
              disabled={busy || chosen.length === 0}
              title="Set today as the last COI request for each vendor in the email"
            >
              {busy ? "Saving…" : `Mark ${chosen.length} as asked today`}
            </button>
          ) : (
            !marked && (
              <a
                href={chosen.length ? href : undefined}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => chosen.length && setOpened(true)}
                aria-disabled={chosen.length === 0}
                className={`${btn("primary", "md")} ${chosen.length ? "" : "pointer-events-none opacity-40"}`}
              >
                Open Gmail draft ({chosen.length})
              </a>
            )
          )}
        </>
      }
    >
      <div className="space-y-4">
        {rows.length === 0 && <EmptyState>Every vendor billed this year has a current COI.</EmptyState>}
        {opened && !marked && (
          <Banner tone="info">
            Gmail opened in a new tab. Send it from there, then mark these vendors as asked.
          </Banner>
        )}
        {marked > 0 && <Banner tone="success">Recorded {marked} requests for today.</Banner>}
        {error && <Banner tone="error">{error}</Banner>}

        {withEmail.length > 0 && (
          <div className="space-y-2">
            <SectionHeading
              trailing={
                <button
                  type="button"
                  className="text-xs font-semibold text-accent hover:underline"
                  onClick={() =>
                    setPicked(
                      picked.size === withEmail.length
                        ? new Set()
                        : new Set(withEmail.map((r) => r.id)),
                    )
                  }
                >
                  {picked.size === withEmail.length ? "Clear all" : "Select all"}
                </button>
              }
            >
              {`In the email · ${chosen.length} of ${withEmail.length}`}
            </SectionHeading>
            <ListCard>
              {withEmail.map((r) => (
                <label
                  key={r.id}
                  className="flex min-h-[56px] cursor-pointer items-start gap-3 border-b border-line-soft px-3 py-2.5 last:border-b-0"
                >
                  <Checkbox
                    checked={picked.has(r.id)}
                    onChange={() => toggle(r.id)}
                    disabled={opened}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{r.name}</span>
                    <span className="block truncate text-xs text-neutral-500">{r.emails.join(", ")}</span>
                    <span className="block text-xs text-neutral-500">{why(r)}</span>
                  </span>
                </label>
              ))}
            </ListCard>
          </div>
        )}

        {noEmail.length > 0 && (
          <div className="space-y-2">
            <SectionHeading>{`No email on file · ${noEmail.length}`}</SectionHeading>
            <p className="text-xs text-neutral-500">
              Add an email on the vendor&apos;s card to include them, or set COI needed to No.
            </p>
            <ListCard>
              {noEmail.map((r) => (
                <ListRow key={r.id} label={r.name} desc={why(r)} />
              ))}
            </ListCard>
          </div>
        )}
      </div>
    </Dialog>
  );
}

interface CoiFile {
  name: string;
  url: string;
  updated: string;
}

/**
 * The vendor's certificate of insurance: the newest PDF on file in the Vendor
 * COIs Drive folder, and a picker to file a new one as "<Vendor> COI - <year>".
 * See /api/vendor-coi.
 */
function VendorCoiRow({ vendor }: { vendor: string }) {
  const [file, setFile] = useState<CoiFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setFile(null);
    setError("");
    setLoading(true);
    fetch(`/api/vendor-coi?vendor=${encodeURIComponent(vendor)}`)
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error || j.ok === false) setError(String(j.error ?? "Could not check Drive."));
        else setFile(j.file ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Network error"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [vendor]);

  function upload(f: File | undefined) {
    if (!f) return;
    if (f.type !== "application/pdf") {
      setError("Pick a PDF.");
      return;
    }
    if (f.size > 3 * 1024 * 1024) {
      setError("The PDF is over 3 MB.");
      return;
    }
    setUploading(true);
    setError("");
    const reader = new FileReader();
    reader.onerror = () => {
      setError("Could not read the file.");
      setUploading(false);
    };
    reader.onload = () => {
      fetch("/api/vendor-coi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor, pdfBase64: String(reader.result) }),
      })
        .then((r) => r.json())
        .then((j) => {
          if (j.error || j.ok === false) setError(String(j.error ?? "Upload failed."));
          else setFile(j.file ?? null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Network error"))
        .finally(() => setUploading(false));
    };
    reader.readAsDataURL(f);
  }

  return (
    <div className={`${rowCls} flex-wrap`}>
      <span className={rowLabelCls}>COI</span>
      <div className="min-w-0 flex-1 space-y-2">
        {loading ? (
          <span className="text-xs text-neutral-500">Checking Drive…</span>
        ) : file ? (
          <a
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-semibold text-accent hover:underline"
          >
            {file.name} ↗
          </a>
        ) : (
          <span className="text-sm text-neutral-500">None on file</span>
        )}
        <FileDrop
          accept="application/pdf"
          label={uploading ? "Uploading…" : file ? "Replace with a new PDF" : "Add the COI PDF"}
          hint={`Filed in Drive as “${vendor} COI - ${new Date().getFullYear()}”`}
          disabled={uploading}
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}

/**
 * ADD VENDOR — a name, and the address its invoices come from.
 *
 * It posts to /api/vendor-create, which the stuck-vendor popup already uses:
 * that route refuses a name JobTread has under any spelling, files the email on
 * the new account, and runs Sync Vendors so the Vendors SHEET learns the account
 * id (without which a Gmail-captured bill for this vendor still cannot push).
 *
 * Creating an account is NOT reversible from this app — a duplicate has to be
 * merged by hand in JobTread — so the dialog asks for the two fields the route
 * writes and nothing else. Phone, address and bill type are filled in on the
 * vendor's own card, which opens as soon as this closes.
 */
function AddVendorDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (v: VendorRef) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The vendor was created but Sync Vendors failed. The account exists, so the
  // dialog reports it and still hands the vendor back when it closes.
  const [warned, setWarned] = useState<{ vendor: VendorRef; warning: string } | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || busy) return;
      if (warned) onCreated(warned.vendor);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, warned, onClose, onCreated]);

  async function create() {
    if (busy || !name.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/vendor-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json?.error) throw new Error(json?.error || "Could not create the vendor.");
      const vendor = {
        id: String(json.vendor?.id ?? ""),
        name: String(json.vendor?.name ?? name.trim()),
      };
      // A Sync Vendors failure is a warning, not a failure: the account exists.
      if (json.warning) {
        setWarned({ vendor, warning: String(json.warning) });
        setBusy(false);
        return;
      }
      onCreated(vendor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={() => (warned ? onCreated(warned.vendor) : onClose())}
      busy={busy}
      title="Add vendor"
      footer={
        <>
          <button
            type="button"
            className={btn("secondary", "md")}
            onClick={() => (warned ? onCreated(warned.vendor) : onClose())}
            disabled={busy}
          >
            {warned ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            className={btn("primary", "md")}
            onClick={create}
            disabled={busy || !name.trim() || warned !== null}
          >
            {busy ? "Creating…" : "Create in JobTread"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="add-vendor-name">Vendor name</Label>
          <Input
            id="add-vendor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Supply"
            autoFocus
            disabled={busy}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="add-vendor-email">Email (optional)</Label>
          <Input
            id="add-vendor-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="billing@acmesupply.com"
            disabled={busy}
          />
          <p className="text-xs text-neutral-500">
            The address their invoices arrive from. Phone, address and bill type come next, on the
            vendor&apos;s own card.
          </p>
        </div>

        {error && <Banner tone="error">{error}</Banner>}
        {warned && <Banner tone="warning">{warned.warning}</Banner>}
      </div>
    </Dialog>
  );
}

/** Amount + status, stacked — the trailing slot every bill row shares. */
function BillTrailing({ cost, status }: { cost: number; status: string }) {
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="text-sm font-semibold tabular-nums">{money(cost)}</span>
      <BillStatusBadge status={status} />
    </span>
  );
}

function billHref(b: { id: string; jobId: string | null }) {
  return b.jobId ? `/bill/${b.id}?jobId=${encodeURIComponent(b.jobId)}` : undefined;
}

function Vendors() {
  const search = useSearchParams();
  const initialAccountId = (search.get("accountId") ?? "").trim();
  const initialNumber = (search.get("number") ?? "").trim();
  const initialVendorName = (search.get("vendor") ?? "").trim();

  const [query, setQuery] = useState("");
  const [vendors, setVendors] = useState<VendorRef[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(true);
  const [vendorsError, setVendorsError] = useState("");

  const [selected, setSelected] = useState<VendorRef | null>(null);
  const [bills, setBills] = useState<VendorBillRow[]>([]);
  const [archive, setArchive] = useState<ArchiveBill[]>([]);
  const [detail, setDetail] = useState<VendorDetail | null>(null);
  const [billsLoading, setBillsLoading] = useState(false);
  const [billsError, setBillsError] = useState("");

  const [adding, setAdding] = useState(false);
  /** Each vendor's newest COI year (coiKey → year); null until read. */
  const [coiYears, setCoiYears] = useState<Record<string, number> | null>(null);
  /** COI expiry, last request and the request list; null until read. */
  const [coiStatus, setCoiStatus] = useState<CoiStatus | null>(null);
  const [coiStatusError, setCoiStatusError] = useState("");
  const [requesting, setRequesting] = useState(false);

  const [numberQuery, setNumberQuery] = useState(initialNumber);
  const [numberMatches, setNumberMatches] = useState<VendorBillMatch[] | null>(null);
  const [numberLoading, setNumberLoading] = useState(false);
  const [numberError, setNumberError] = useState("");

  // The org's vendor list, off the same 30-min shared cache every other page
  // using /api/vendors reads — instant here too.
  useEffect(() => {
    let alive = true;
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j.error) {
          setVendorsError(String(j.error));
          return;
        }
        setVendors(Array.isArray(j.vendors) ? j.vendors : []);
      })
      .catch((e) => alive && setVendorsError(e instanceof Error ? e.message : "Network error"))
      .finally(() => alive && setVendorsLoading(false));
    // The COI marks: one listing of the Vendor COIs folder (owner, 2026-11-02).
    // Best-effort — a failed read leaves the list unmarked, not broken.
    fetch("/api/vendor-coi?all=1")
      .then((r) => r.json())
      .then((j) => alive && !j.error && setCoiYears(j.years ?? {}))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  function loadCoiStatus() {
    fetch("/api/vendor-coi/status")
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setCoiStatusError(String(j.error));
          return;
        }
        setCoiStatusError("");
        setCoiStatus({
          today: String(j.today),
          request: Array.isArray(j.request) ? j.request : [],
          byId: Object.fromEntries(((j.vendors ?? []) as VendorCoiRow[]).map((v) => [v.id, v])),
        });
      })
      .catch((e) => setCoiStatusError(e instanceof Error ? e.message : "Network error"));
  }
  useEffect(loadCoiStatus, []);

  const thisYear = new Date().getFullYear();
  const coiMark = (v: VendorRef) => {
    // A recorded expiry date wins over the Drive file's year.
    const st = coiStatus?.byId[v.id];
    if (st?.coiExpires) {
      const tone =
        st.state === "expired" ? "danger" : st.state === "expiring" ? "warning" : "success";
      const label = st.state === "expired" ? "COI expired" : "COI to";
      return (
        <Chip tone={tone} title={`COI expires ${isoLabel(st.coiExpires)}`}>
          {label} {new Date(st.coiExpires + "T00:00:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" })}
        </Chip>
      );
    }
    const name = v.name;
    if (!coiYears) return undefined;
    const year = coiYears[coiKey(name)];
    if (!year) return <Chip title="No certificate of insurance on file">No COI</Chip>;
    return (
      <Chip tone={year >= thisYear ? "success" : "warning"} title={`Newest COI on file: ${year}`}>
        COI {year}
      </Chip>
    );
  };

  function loadVendorBills(v: VendorRef) {
    setSelected(v);
    // The open vendor lives in the address bar, so the address is a link to it.
    setUrlParam("number", "");
    setUrlParam("vendor", "");
    setUrlParam("accountId", v.id);
    setNumberMatches(null);
    setBills([]);
    setArchive([]);
    setDetail(null);
    setBillsLoading(true);
    setBillsError("");
    fetch(`/api/vendor-bills/${encodeURIComponent(v.id)}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setBillsError(String(j.error));
          return;
        }
        setBills(Array.isArray(j.bills) ? j.bills : []);
        setArchive(Array.isArray(j.archive) ? j.archive : []);
        setDetail(j.detail ?? null);
      })
      .catch((e) => setBillsError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setBillsLoading(false));
  }

  /** The bill number last looked up, so writing it to the address does not look it up twice. */
  const lookedUp = useRef("");
  function runNumberLookup(raw: string) {
    if (!isDigits(raw)) return;
    setSelected(null);
    setUrlParam("accountId", "");
    lookedUp.current = raw.trim();
    setUrlParam("number", raw.trim());
    setBills([]);
    setNumberLoading(true);
    setNumberError("");
    fetch(`/api/vendor-bills/by-number?number=${encodeURIComponent(raw.trim())}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) {
          setNumberError(String(j.error));
          return;
        }
        setNumberMatches(Array.isArray(j.bills) ? j.bills : []);
      })
      .catch((e) => setNumberError(e instanceof Error ? e.message : "Network error"))
      .finally(() => setNumberLoading(false));
  }

  // Deep-link from the Home search box (?accountId=… or ?number=…).
  // The page writes these same params itself as you pick, so each effect acts
  // only when the param names something not already on screen.
  useEffect(() => {
    if (!initialAccountId || vendors.length === 0 || selected?.id === initialAccountId) return;
    const v = vendors.find((x) => x.id === initialAccountId);
    if (v) loadVendorBills(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccountId, vendors]);

  // ?vendor=<name> — from the vendor name on a bill card. Exact name, any case.
  useEffect(() => {
    if (!initialVendorName || vendors.length === 0) return;
    const want = initialVendorName.toLowerCase();
    if (selected?.name.toLowerCase() === want) return;
    const v = vendors.find((x) => x.name.trim().toLowerCase() === want);
    if (v) loadVendorBills(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVendorName, vendors]);

  useEffect(() => {
    if (!initialNumber || lookedUp.current === initialNumber) return;
    lookedUp.current = initialNumber;
    runNumberLookup(initialNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialNumber]);

  const q = query.trim().toLowerCase();
  // No query = every vendor, A–Z. A query narrows the same list.
  const matches = useMemo(
    () =>
      vendors
        .filter((v) => !q || v.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [q, vendors],
  );

  const total = bills.reduce((s, b) => s + b.cost, 0);

  function closeVendor() {
    setSelected(null);
    setUrlParam("accountId", "");
    setBills([]);
    setDetail(null);
    setBillsError("");
  }

  /** A new vendor joins the list and opens straight away, so its email, phone,
   *  address and bill type can be filled in on its own card. */
  function vendorCreated(v: VendorRef) {
    setAdding(false);
    if (!v.id) return;
    setVendors((prev) => [...prev.filter((x) => x.id !== v.id), v]);
    loadVendorBills(v);
  }

  return (
    <main className="w-full max-w-2xl px-4 pad:px-7 lg:max-w-6xl pb-24 pt-6">
      <PageHeader
        title="Vendors"
        description="Pick a vendor to see every bill — job, date, amount, status."
        actions={
          <>
            <button
              type="button"
              className={btn("secondary", "md")}
              onClick={() => setRequesting(true)}
              disabled={!coiStatus}
              title="Draft one email asking every vendor with an expired COI for a new one"
            >
              {coiStatus ? `Request COIs (${coiStatus.request.length})` : "Request COIs"}
            </button>
            <button type="button" className={btn("secondary", "md")} onClick={() => setAdding(true)}>
              Add vendor
            </button>
          </>
        }
      />
      {coiStatusError && (
        <Banner tone="warning" className="mb-3">
          COI status: {coiStatusError}
        </Banner>
      )}
      {requesting && coiStatus && (
        <RequestCoisDialog
          status={coiStatus}
          onClose={() => setRequesting(false)}
          onMarked={loadCoiStatus}
        />
      )}

      {adding && <AddVendorDialog onClose={() => setAdding(false)} onCreated={vendorCreated} />}

      <SplitView
        onClose={closeVendor}
        backLabel="Back to search"
        empty="Pick a vendor to see its details and bills."
        detail={
          selected && (
            <div className="space-y-4">
              <SectionHeading
                trailing={
                  !billsLoading && !billsError ? (
                    <span className="text-[11px] tabular-nums text-neutral-500">
                      {bills.length} bill{bills.length === 1 ? "" : "s"} · {money(total)}
                    </span>
                  ) : undefined
                }
              >
                {selected.name}
              </SectionHeading>

              {detail && (
                <VendorDetailCard
                  detail={detail}
                  onSaved={setDetail}
                  coi={coiStatus?.byId[detail.id]}
                  onCoiChanged={loadCoiStatus}
                />
              )}

              {billsError && <p className="text-sm text-danger">{billsError}</p>}
              {billsLoading && <Loading label="Loading bills…" />}
              {!billsLoading && !billsError && bills.length === 0 && archive.length === 0 && (
                <EmptyState>No bills for {selected.name}.</EmptyState>
              )}
              {!billsLoading && !billsError && bills.length > 0 && (
                <ListCard>
                  {bills.map((b) => (
                    <ListRow
                      key={b.id}
                      href={billHref(b)}
                      label={b.number != null ? `#${b.number} · ${b.jobName}` : b.jobName}
                      desc={dateLabel(b.issueDate)}
                      trailing={<BillTrailing cost={b.cost} status={b.status} />}
                    />
                  ))}
                </ListCard>
              )}
              {/* Pre-JobTread bills have no bill page; each opens its filed PDF. */}
              {!billsLoading && archive.length > 0 && (
                <div className="space-y-2 pt-2">
                  <SectionHeading
                    trailing={
                      <span className="text-[11px] tabular-nums text-neutral-500">
                        {money(archive.reduce((s, b) => s + b.amount, 0))}
                      </span>
                    }
                  >
                    {`Before JobTread · ${archive.length}`}
                  </SectionHeading>
                  <ListCard>
                    {archive.map((b) => (
                      <ListRow
                        key={b.id}
                        href={
                          b.pdfFileId
                            ? `https://drive.google.com/file/d/${b.pdfFileId}/view`
                            : undefined
                        }
                        external={!!b.pdfFileId}
                        label={[b.invoiceId && `#${b.invoiceId}`, b.jobName || "No job"]
                          .filter(Boolean)
                          .join(" · ")}
                        desc={dateLabel(b.issueDate || null)}
                        trailing={
                          <span className="text-sm font-semibold tabular-nums">
                            {money(b.amount)}
                          </span>
                        }
                      />
                    ))}
                  </ListCard>
                </div>
              )}
            </div>
          )
        }
        list={
          <div className="space-y-6">
            <div className="space-y-2">
              <SectionHeading>Look up a bill by number</SectionHeading>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runNumberLookup(numberQuery);
                }}
                className="flex gap-2"
              >
                <Input
                  type="text"
                  inputMode="numeric"
                  value={numberQuery}
                  onChange={(e) => setNumberQuery(e.target.value)}
                  placeholder="Bill #"
                  aria-label="Bill number"
                />
                <button
                  type="submit"
                  className={btn("secondary", "md")}
                  disabled={!isDigits(numberQuery) || numberLoading}
                >
                  Go
                </button>
              </form>
              <p className="text-xs text-neutral-500">
                Org-wide, not per vendor — bill numbers repeat, so this can return more than one.
              </p>

              {numberError && <p className="text-sm text-danger">{numberError}</p>}
              {numberLoading && <Loading label="Looking up bill…" />}
              {numberMatches && (
                <div className="space-y-2 pt-2">
                  <SectionHeading>
                    {numberMatches.length === 0
                      ? `No bills numbered #${numberQuery.trim()}`
                      : `${numberMatches.length} bill${numberMatches.length === 1 ? "" : "s"} numbered #${numberQuery.trim()}`}
                  </SectionHeading>
                  {numberMatches.length > 0 && (
                    <ListCard>
                      {numberMatches.map((b) => (
                        <ListRow
                          key={b.id}
                          href={billHref(b)}
                          label={<>{b.vendorName}<CoiDot vendor={b.vendorName} /></>}
                          desc={`${b.jobName} · ${dateLabel(b.issueDate)}`}
                          trailing={<BillTrailing cost={b.cost} status={b.status} />}
                        />
                      ))}
                    </ListCard>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2 border-t border-line pt-5">
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={
                  vendorsLoading ? "Loading vendors…" : `Search ${vendors.length} vendors`
                }
                aria-label="Search vendors"
                autoFocus
              />
              {vendorsError && <p className="text-sm text-danger">{vendorsError}</p>}

              {!vendorsLoading && !vendorsError && (
                <div className="space-y-2 pt-2">
                  <SectionHeading>
                    {!q
                      ? `All vendors · ${matches.length}`
                      : matches.length === 1
                        ? "1 match"
                        : `${matches.length} matches`}
                  </SectionHeading>
                  {matches.length === 0 ? (
                    <EmptyState>
                      {q ? `Nothing matches “${query.trim()}”.` : "No vendors in JobTread."}
                    </EmptyState>
                  ) : (
                    <ListCard>
                      {matches.map((v) => (
                        <ListRow
                          key={v.id}
                          onClick={() => loadVendorBills(v)}
                          label={v.name}
                          trailing={coiMark(v)}
                          selected={selected?.id === v.id}
                        />
                      ))}
                    </ListCard>
                  )}
                </div>
              )}
            </div>
          </div>
        }
      />
    </main>
  );
}

export default function VendorsPage() {
  return (
    <Suspense fallback={<main className="p-6 text-sm text-neutral-500">Loading…</main>}>
      <Vendors />
    </Suspense>
  );
}
