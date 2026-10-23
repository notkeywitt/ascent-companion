"use client";

import { useCallback, useEffect, useState } from "react";

import { CopyButton } from "@/components/CopyButton";
import {
  Banner,
  Button,
  Card,
  Dialog,
  EmptyState,
  FileDrop,
  Input,
  Label,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  btn,
} from "@/components/ui";
import { shortDay, type FieldConfig, type Profile } from "@/lib/onboarding/fields";

import { FormEditor } from "./FormEditor";

export interface OfficeForm {
  id: number;
  name: string;
  fileName: string;
  pages: number;
  active: boolean;
  fields: FieldConfig[];
}

interface Submission {
  formId: number;
  formName: string;
  signedName: string;
  submittedAt: string;
}

interface Hire {
  email: string;
  firstName: string;
  lastName: string;
  position: string;
  hireDate: string;
  profile: Profile;
  profileAt: string | null;
  invitedAt: string;
  sentAt: string | null;
  submissions: Submission[];
}

interface Data {
  isAdmin: boolean;
  forms: OfficeForm[];
  intakes: Hire[];
}

async function post(url: string, body: unknown, method = "POST") {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Failed (${r.status}).`);
  return j;
}

/**
 * The office side of new-hire paperwork.
 *
 * 1. Invite: name + email adds the Employee tab row, a field sign-in and the
 *    paperwork. The office sends the link; the hire signs in with that email.
 * 2. The hire fills their profile and signs each active form on /onboarding.
 * 3. Download the packet, send it to the bookkeeper, then "Sent to
 *    bookkeeper" deletes the signed copies from the app.
 */
export function OnboardingOffice() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/onboarding/office");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load.");
      setData(j);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <Shell>
        {err ? <Banner tone="error">{err}</Banner> : <Loading />}
      </Shell>
    );
  }
  const active = data.forms.filter((f) => f.active);
  const hire = data.intakes.find((h) => h.email === open) ?? null;
  const form = data.forms.find((f) => f.id === editing) ?? null;

  return (
    <Shell>
      {err && <Banner tone="error" className="mb-4">{err}</Banner>}
      {data.isAdmin ? (
        <Invite onDone={load} />
      ) : (
        <p className="mb-6 text-sm text-neutral-500">Only an admin can invite a new hire, because an invite adds a sign-in.</p>
      )}

      <SectionHeading className="mb-2">New hires</SectionHeading>
      {data.intakes.length === 0 ? (
        <EmptyState className="mb-6">No one invited yet.</EmptyState>
      ) : (
        <ListCard className="mb-6">
          {data.intakes.map((h) => {
            const signed = h.submissions.length;
            return (
              <ListRow
                key={h.email}
                onClick={() => setOpen(h.email)}
                label={`${h.firstName} ${h.lastName}`}
                desc={
                  <MetaLine
                    items={[
                      h.email,
                      h.sentAt
                        ? `sent to bookkeeper ${shortDay(h.sentAt)}`
                        : h.profileAt
                          ? `${signed} of ${active.length} forms signed`
                          : `invited ${shortDay(h.invitedAt)}`,
                    ]}
                  />
                }
                trailing={
                  !h.sentAt && h.profileAt && signed >= active.length ? (
                    <span className="text-sm font-semibold text-ok">Ready</span>
                  ) : undefined
                }
              />
            );
          })}
        </ListCard>
      )}

      <Forms forms={data.forms} onEdit={setEditing} onChanged={load} />

      {hire && <HireDialog hire={hire} forms={data.forms} onClose={() => setOpen(null)} onChanged={load} />}
      {form && (
        <FormEditor
          form={form}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-3">
      <PageHeader title="New Hires" description="Invite a new hire. They sign in, fill their profile and sign each form." />
      {children}
    </main>
  );
}

/* ----------------------------------------------------------------- invite */

function Invite({ onDone }: { onDone: () => void }) {
  const blank = { firstName: "", lastName: "", email: "", position: "", hireDate: "" };
  const [v, setV] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [sent, setSent] = useState<{ name: string; email: string } | null>(null);
  const ok = v.firstName.trim() && v.lastName.trim() && v.email.includes("@");
  const link = typeof window === "undefined" ? "/onboarding" : `${window.location.origin}/onboarding`;

  async function invite() {
    setBusy(true);
    setErr("");
    try {
      await post("/api/onboarding/office", { action: "invite", ...v });
      setSent({ name: v.firstName.trim(), email: v.email.trim().toLowerCase() });
      setV(blank);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const mail = sent
    ? `mailto:${sent.email}?subject=${encodeURIComponent("Your Ascent new-hire paperwork")}&body=${encodeURIComponent(
        `Hi ${sent.name},\n\nWelcome to Ascent Building Co. Open this link and sign in with Google using ${sent.email}:\n\n${link}\n\nThe app walks you through your profile and the forms payroll needs.\n`,
      )}`
    : "";

  return (
    <div className="mb-6">
      <SectionHeading className="mb-2">Invite a new hire</SectionHeading>
      <Card className="grid grid-cols-2 gap-3 !p-4">
        {(
          [
            ["firstName", "First name", "text"],
            ["lastName", "Last name", "text"],
            ["email", "Google email they sign in with", "email"],
            ["position", "Position", "text"],
            ["hireDate", "Hire date", "date"],
          ] as const
        ).map(([k, label, type]) => (
          <div key={k} className={k === "email" ? "col-span-2" : ""}>
            <Label htmlFor={`inv-${k}`}>{label}</Label>
            <Input id={`inv-${k}`} type={type} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
          </div>
        ))}
        <div className="col-span-2 flex items-end">
          <Button className="w-full" onClick={invite} disabled={!ok || busy}>
            {busy ? "Inviting…" : "Invite"}
          </Button>
        </div>
      </Card>
      {err && <Banner tone="error" className="mt-3">{err}</Banner>}
      {sent && (
        <Banner tone="success" className="mt-3">
          <p>
            {sent.name} is on the roster and can sign in as <b>{sent.email}</b>. Send them this link:
          </p>
          <p className="mt-2 break-all font-mono text-xs">{link}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton value={link} label="Copy link" />
            <a href={mail} className={btn("outline", "sm")}>Email the link</a>
          </div>
        </Banner>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- one hire */

function HireDialog({
  hire,
  forms,
  onClose,
  onChanged,
}: {
  hire: Hire;
  forms: OfficeForm[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const q = (extra: string) => `/api/onboarding/office/file?email=${encodeURIComponent(hire.email)}${extra}`;
  const subs = new Map(hire.submissions.map((s) => [s.formId, s]));
  const p = hire.profile;
  // Every active form, plus any signed form that has since been hidden.
  const rows = forms.filter((f) => f.active || subs.has(f.id));

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr("");
    try {
      await post("/api/onboarding/office", { email: hire.email, ...body });
      onChanged();
      if (body.action === "remove") onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      onClose={onClose}
      busy={busy}
      size="lg"
      title={`${hire.firstName} ${hire.lastName}`}
      description={<MetaLine items={[hire.email, hire.position, hire.hireDate && `starts ${shortDay(hire.hireDate)}`]} />}
      footer={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={() =>
              act({ action: "remove" }, "Remove this paperwork? The roster row and the sign-in stay.")
            }
          >
            Remove
          </Button>
          <div className="ml-auto flex flex-wrap gap-2">
            {!hire.sentAt && (
              <a href={q("&packet=1")} className={btn("outline", "sm")}>
                Download packet
              </a>
            )}
            {!hire.sentAt && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  act(
                    { action: "sent" },
                    "Mark as sent to the bookkeeper? This deletes the signed forms from the app (they hold SSNs and bank numbers). Download the packet first.",
                  )
                }
              >
                Sent to bookkeeper
              </Button>
            )}
          </div>
        </div>
      }
    >
      {hire.sentAt && (
        <Banner tone="success" className="mb-3">
          Sent to the bookkeeper {shortDay(hire.sentAt)}. The signed copies are deleted from the app.
        </Banner>
      )}
      {err && <Banner tone="error" className="mb-3">{err}</Banner>}

      <SectionHeading className="mb-1">Profile</SectionHeading>
      {hire.profileAt ? (
        <dl className="mb-4 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-neutral-500">Address</dt>
          <dd>{[p.street, p.apt].filter(Boolean).join(" ")}, {p.city}, {p.state} {p.zip}</dd>
          <dt className="text-neutral-500">Phone</dt>
          <dd>{p.phone}</dd>
          <dt className="text-neutral-500">Date of birth</dt>
          <dd>{shortDay(p.birthday)}</dd>
          <dt className="text-neutral-500">Driver&apos;s license</dt>
          <dd>{p.dl || "—"}</dd>
          <dt className="text-neutral-500">Emergency</dt>
          <dd>
            {[p.emergencyName, p.emergencyRelation && `(${p.emergencyRelation})`, p.emergencyPhone].filter(Boolean).join(" ") || "—"}
          </dd>
        </dl>
      ) : (
        <p className="mb-4 text-sm text-neutral-500">Not filled yet.</p>
      )}

      {!hire.sentAt && (
        <>
          <SectionHeading className="mb-1">Forms</SectionHeading>
          <ListCard>
            {rows.map((f) => {
              const s = subs.get(f.id);
              return (
                <ListRow
                  key={f.id}
                  label={f.name}
                  desc={s ? `Signed ${shortDay(s.submittedAt)} by ${s.signedName}` : "Not signed yet"}
                  chevron={false}
                  trailing={
                    s ? (
                      <span className="flex gap-1">
                        <a href={q(`&formId=${f.id}`)} target="_blank" rel="noreferrer" className={btn("ghost", "xs")}>
                          Open ↗
                        </a>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            act({ action: "reopen", formId: f.id }, `Reopen ${f.name}? The signed copy is deleted and ${hire.firstName} signs it again.`)
                          }
                        >
                          Reopen
                        </Button>
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </ListCard>
          <p className="mt-2 text-xs text-neutral-500">
            Office fields (the I-9&apos;s Section 2, the W-4&apos;s employer box) stay blank and fillable in each form&apos;s own PDF.
          </p>
        </>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ forms */

function Forms({
  forms,
  onEdit,
  onChanged,
}: {
  forms: OfficeForm[];
  onEdit: (id: number) => void;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState(0);

  async function upload() {
    if (!file) return;
    setBusy(true);
    setErr("");
    setNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("name", name);
      const r = await fetch("/api/onboarding/office/forms", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Upload failed.");
      if (!j.fillable) setNote("That PDF has no fill-in fields. New hires can only read it. Upload a fillable copy to collect it in the app.");
      setFile(null);
      setName("");
      setKey((k) => k + 1);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(body: Record<string, unknown>) {
    setErr("");
    try {
      await post("/api/onboarding/office/forms", body, "PATCH");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(f: OfficeForm) {
    if (!window.confirm(`Delete the blank ${f.name}? Forms already signed keep their copy.`)) return;
    const r = await fetch(`/api/onboarding/office/forms?id=${f.id}`, { method: "DELETE" });
    if (!r.ok) setErr("Could not delete.");
    onChanged();
  }

  return (
    <div>
      <SectionHeading className="mb-2">Forms new hires fill</SectionHeading>
      {err && <Banner tone="error" className="mb-3">{err}</Banner>}
      {note && <Banner tone="warning" className="mb-3">{note}</Banner>}
      {forms.length === 0 ? (
        <EmptyState className="mb-3">No forms yet. Upload the W-4, the I-9 and your Direct Deposit form.</EmptyState>
      ) : (
        <ListCard className="mb-3">
          {forms.map((f, i) => {
            const mine = f.fields.filter((x) => x.role === "employee").length;
            const office = f.fields.filter((x) => x.role === "office").length;
            return (
              <ListRow
                key={f.id}
                label={f.name}
                chevron={false}
                desc={
                  <MetaLine
                    items={[
                      `${f.pages} ${f.pages === 1 ? "page" : "pages"}`,
                      f.fields.length === 0 ? <span className="text-warn">no fill-in fields</span> : `${mine} for the hire`,
                      office > 0 && `${office} for the office`,
                      !f.active && <span className="text-warn">hidden</span>,
                    ]}
                  />
                }
                trailing={
                  <span className="flex flex-wrap justify-end gap-1">
                    <Button size="xs" variant="ghost" disabled={i === 0} onClick={() => act({ id: f.id, move: -1 })} aria-label="Move up">↑</Button>
                    <Button size="xs" variant="ghost" disabled={i === forms.length - 1} onClick={() => act({ id: f.id, move: 1 })} aria-label="Move down">↓</Button>
                    <a href={`/api/onboarding/office/file?formId=${f.id}`} target="_blank" rel="noreferrer" className={btn("ghost", "xs")}>View ↗</a>
                    {f.fields.length > 0 && <Button size="xs" variant="ghost" onClick={() => onEdit(f.id)}>Fields</Button>}
                    <Button size="xs" variant="ghost" onClick={() => act({ id: f.id, active: !f.active })}>{f.active ? "Hide" : "Show"}</Button>
                    <Button size="xs" variant="ghost" onClick={() => remove(f)}>Delete</Button>
                  </span>
                }
              />
            );
          })}
        </ListCard>
      )}
      <Card className="space-y-3 !p-4">
        <FileDrop
          key={key}
          label="Add a blank form (PDF)"
          hint="A fillable PDF, under 4 MB. Use the current W-4 from irs.gov and the current I-9 from uscis.gov."
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div>
          <Label htmlFor="form-name">Name new hires see</Label>
          <Input id="form-name" placeholder="W-4 (2026)" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button onClick={upload} disabled={!file || busy}>{busy ? "Uploading…" : "Upload"}</Button>
      </Card>
    </div>
  );
}
