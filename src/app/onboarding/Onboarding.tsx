"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import {
  Banner,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Label,
  ListCard,
  ListRow,
  Loading,
  MetaLine,
  PageHeader,
  SectionHeading,
  Select,
  btn,
} from "@/components/ui";
import {
  EMPTY_PROFILE,
  PROFILE_REQUIRED,
  groupKey,
  missingAnswers,
  prefillValues,
  questionsFor,
  shortDay,
  type Answers,
  type FieldConfig,
  type Profile,
} from "@/lib/onboarding/fields";

interface FormRow {
  id: number;
  name: string;
  pages: number;
  fields: FieldConfig[];
  submitted: { at: string; signedName: string } | null;
}

interface Data {
  intake: {
    firstName: string;
    lastName: string;
    position: string;
    hireDate: string;
    profile: Profile;
    profileAt: string | null;
    sentAt: string | null;
  } | null;
  forms?: FormRow[];
}

const todayIso = () => new Date().toLocaleDateString("en-CA");

/**
 * The new hire's side: the profile first, then each form in the office's
 * order — fill, sign, done. Everything here is the signed-in person's own.
 * The SSN lives only in this component's memory: it fills the forms that ask
 * for it and is never saved by the app.
 */
export function Onboarding() {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [step, setStep] = useState<"list" | "profile" | number>("list");
  const [ssn, setSsn] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const r = await fetch("/api/onboarding/me");
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not load your paperwork.");
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (err) return <Shell><Banner tone="error">{err}</Banner></Shell>;
  if (!data) return <Shell><Loading /></Shell>;
  const intake = data.intake;
  if (!intake) {
    return (
      <Shell>
        <EmptyState>No new-hire paperwork is waiting for you.</EmptyState>
        <p className="mt-4 text-center">
          <Link href="/" className={btn("secondary")}>Go to Today</Link>
        </p>
      </Shell>
    );
  }
  const forms = data.forms ?? [];
  const profileDone = !!intake.profileAt;

  if (step === "profile") {
    return (
      <Shell>
        <ProfileStep
          initial={intake.profile}
          ssn={ssn}
          onSsn={setSsn}
          onCancel={() => setStep("list")}
          onSaved={async () => {
            await load();
            setStep("list");
          }}
        />
      </Shell>
    );
  }
  const form = typeof step === "number" ? forms.find((f) => f.id === step) : undefined;
  if (form) {
    return (
      <Shell>
        <FormStep
          form={form}
          profile={intake.profile}
          ssn={ssn}
          onCancel={() => setStep("list")}
          onSigned={async () => {
            await load();
            setStep("list");
          }}
        />
      </Shell>
    );
  }

  const left = (profileDone ? 0 : 1) + forms.filter((f) => !f.submitted).length;
  return (
    <Shell>
      {intake.sentAt ? (
        <Banner tone="success" className="mb-4">
          The office has your paperwork. Thank you. To change something, ask the office.
        </Banner>
      ) : left === 0 ? (
        <Banner tone="success" className="mb-4">
          All done. The office has your signed forms. To change one, ask the office to reopen it.
        </Banner>
      ) : (
        <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">
          Welcome to Ascent{intake.firstName ? `, ${intake.firstName}` : ""}. Do these {left === 1 ? "step" : "steps"} in
          order. Each takes a few minutes.
        </p>
      )}
      {!intake.sentAt && (
        <ListCard>
          <ListRow
            label="1. Your profile"
            desc={profileDone ? `Saved ${shortDay(intake.profileAt)}` : "Your name, address, phone and an emergency contact"}
            trailing={profileDone ? <span className="text-sm text-ok">✓</span> : undefined}
            onClick={() => setStep("profile")}
          />
          {forms.map((f, i) => (
            <ListRow
              key={f.id}
              label={`${i + 2}. ${f.name}`}
              desc={
                f.submitted
                  ? `Signed ${shortDay(f.submitted.at)}`
                  : !profileDone
                    ? "Opens after your profile"
                    : f.fields.length === 0
                      ? "Read only — the office gives you a paper copy"
                      : "To fill and sign"
              }
              trailing={f.submitted ? <span className="text-sm text-ok">✓</span> : undefined}
              onClick={profileDone ? () => setStep(f.id) : undefined}
            />
          ))}
        </ListCard>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-3">
      <PageHeader title="New Hire Paperwork" description="Your profile and the forms payroll needs." />
      {children}
    </main>
  );
}

/* ---------------------------------------------------------------- profile */

const PROFILE_FIELDS: { key: keyof Profile; label: string; type?: string; inputMode?: "numeric" | "tel" | "email"; wide?: boolean; hint?: string }[] = [
  { key: "firstName", label: "Legal first name" },
  { key: "middleInitial", label: "Middle initial" },
  { key: "lastName", label: "Legal last name", wide: true },
  { key: "street", label: "Street address", wide: true },
  { key: "apt", label: "Apt / unit" },
  { key: "city", label: "City" },
  { key: "state", label: "State", hint: "WA" },
  { key: "zip", label: "ZIP", inputMode: "numeric" },
  { key: "phone", label: "Mobile phone", type: "tel", inputMode: "tel" },
  { key: "birthday", label: "Date of birth", type: "date" },
  { key: "dl", label: "Driver's license number", wide: true },
];

const EMERGENCY_FIELDS: { key: keyof Profile; label: string; type?: string }[] = [
  { key: "emergencyName", label: "Name" },
  { key: "emergencyRelation", label: "Relationship" },
  { key: "emergencyPhone", label: "Phone", type: "tel" },
];

function ProfileStep({
  initial,
  ssn,
  onSsn,
  onCancel,
  onSaved,
}: {
  initial: Profile;
  ssn: string;
  onSsn: (v: string) => void;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [p, setP] = useState<Profile>({ ...EMPTY_PROFILE, ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof Profile, v: string) => setP((x) => ({ ...x, [k]: v }));
  const missing = PROFILE_REQUIRED.filter((k) => !p[k].trim());

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const r = await fetch("/api/onboarding/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: p }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not save.");
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeading>Your profile</SectionHeading>
      <Card className="grid grid-cols-2 gap-3 !p-4">
        {PROFILE_FIELDS.map((f) => (
          <div key={f.key} className={f.wide ? "col-span-2" : ""}>
            <Label htmlFor={`p-${f.key}`}>
              {f.label}
              {PROFILE_REQUIRED.includes(f.key) ? " *" : ""}
            </Label>
            <Input
              id={`p-${f.key}`}
              type={f.type ?? "text"}
              inputMode={f.inputMode}
              placeholder={f.hint}
              value={p[f.key]}
              maxLength={f.key === "state" ? 2 : f.key === "middleInitial" ? 1 : undefined}
              onChange={(e) => set(f.key, e.target.value)}
            />
          </div>
        ))}
      </Card>

      <SectionHeading>Emergency contact</SectionHeading>
      <Card className="grid grid-cols-2 gap-3 !p-4">
        {EMERGENCY_FIELDS.map((f) => (
          <div key={f.key} className={f.key === "emergencyName" ? "col-span-2" : ""}>
            <Label htmlFor={`p-${f.key}`}>{f.label}</Label>
            <Input id={`p-${f.key}`} type={f.type ?? "text"} value={p[f.key]} onChange={(e) => set(f.key, e.target.value)} />
          </div>
        ))}
      </Card>

      <SectionHeading>Social Security number</SectionHeading>
      <Card className="!p-4">
        <Label htmlFor="p-ssn">SSN (optional here)</Label>
        <Input
          id="p-ssn"
          inputMode="numeric"
          autoComplete="off"
          placeholder="123-45-6789"
          value={ssn}
          onChange={(e) => onSsn(e.target.value.replace(/[^\d-]/g, "").slice(0, 11))}
        />
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          The app does not save this. It fills your forms on this screen only. If you leave the page, type it again on
          each form.
        </p>
      </Card>

      {err && <Banner tone="error">{err}</Banner>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>Back</Button>
        <Button className="flex-1" onClick={save} disabled={saving || missing.length > 0}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
      {missing.length > 0 && <p className="text-xs text-neutral-500">* Required.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------- form */

function FormStep({
  form,
  profile,
  ssn,
  onCancel,
  onSigned,
}: {
  form: FormRow;
  profile: Profile;
  ssn: string;
  onCancel: () => void;
  onSigned: () => void;
}) {
  const questions = useMemo(() => questionsFor(form.fields), [form.fields]);
  const pre = useMemo(() => prefillValues(profile, todayIso(), ssn), [profile, ssn]);
  const [answers, setAnswers] = useState<Answers>(() => {
    const a: Answers = {};
    for (const f of form.fields) {
      if (f.role !== "employee" || !f.prefill) continue;
      if (f.kind === "text") a[f.name] = pre[f.prefill];
      if (f.kind === "choice" && f.options?.some((o) => o.value === pre[f.prefill!])) a[f.name] = pre[f.prefill];
    }
    return a;
  });
  const fullName = pre.fullName;
  const [signedName, setSignedName] = useState(fullName);
  const [agree, setAgree] = useState(false);
  const [hasInk, setHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pad = useRef<SignaturePadHandle>(null);
  const set = (k: string, v: string | boolean) => setAnswers((a) => ({ ...a, [k]: v }));
  const blank = `/api/onboarding/me/forms/${form.id}?blank=1`;

  if (form.submitted) {
    return (
      <div className="space-y-4">
        <SectionHeading>{form.name}</SectionHeading>
        <Banner tone="success">
          You signed this on {shortDay(form.submitted.at)}. To change it, ask the office to reopen it.
        </Banner>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>Back</Button>
          <a href={`/api/onboarding/me/forms/${form.id}`} target="_blank" rel="noreferrer" className={btn("outline")}>
            View your signed copy ↗
          </a>
        </div>
      </div>
    );
  }

  if (form.fields.length === 0) {
    return (
      <div className="space-y-4">
        <SectionHeading>{form.name}</SectionHeading>
        <Banner tone="info">This form cannot be filled in the app. Read it here. The office gives you a paper copy to sign.</Banner>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>Back</Button>
          <a href={blank} target="_blank" rel="noreferrer" className={btn("outline")}>Open the form ↗</a>
        </div>
      </div>
    );
  }

  const missing = missingAnswers(form.fields, answers);
  const ready = missing.length === 0 && hasInk && agree && signedName.trim().length > 1;

  async function submit() {
    const signature = pad.current?.toDataURL();
    if (!signature) return setErr("Draw your signature.");
    setBusy(true);
    setErr("");
    try {
      const r = await fetch(`/api/onboarding/me/forms/${form.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, ssn, signature, signedName, agree }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Could not sign the form.");
      onSigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <SectionHeading
        trailing={
          <a href={blank} target="_blank" rel="noreferrer" className="text-sm font-semibold text-accent">
            Read the form ↗
          </a>
        }
      >
        {form.name}
      </SectionHeading>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">
        Your answers from the profile are filled in. Check each one. Leave a box empty if it does not apply to you.
      </p>
      <Card className="space-y-4 !p-4">
        {questions.map((q) =>
          q.type === "group" ? (
            <div key={q.title}>
              <Label htmlFor={`q-${q.title}`}>{q.title}{q.members.some((m) => m.required) ? " *" : ""}</Label>
              <Select
                id={`q-${q.title}`}
                value={String(answers[groupKey(q.title)] ?? "")}
                onChange={(e) => set(groupKey(q.title), e.target.value)}
              >
                <option value="">Choose…</option>
                {q.members.map((m) => (
                  <option key={m.name} value={m.name}>{m.label}</option>
                ))}
              </Select>
            </div>
          ) : (
            <Question key={q.field.name} field={q.field} value={answers[q.field.name]} onChange={(v) => set(q.field.name, v)} />
          ),
        )}
      </Card>

      <SectionHeading>Sign</SectionHeading>
      <Card className="space-y-3 !p-4">
        <div>
          <Label htmlFor="sig-name">Type your full legal name</Label>
          <Input id="sig-name" value={signedName} onChange={(e) => setSignedName(e.target.value)} />
        </div>
        <div>
          <Label>Draw your signature</Label>
          <SignaturePad ref={pad} height={150} onChange={(empty) => setHasInk(!empty)} />
          <div className="mt-1 text-right">
            <Button size="xs" variant="ghost" onClick={() => { pad.current?.clear(); setHasInk(false); }}>
              Clear
            </Button>
          </div>
        </div>
        <Checkbox
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          label="I agree that my electronic signature is the legal equivalent of my handwritten signature, and that the information I gave is true and correct."
          className="!items-start"
        />
      </Card>

      {missing.length > 0 && (
        <p className="text-xs text-warn">Still needed: {missing.join(", ")}</p>
      )}
      {err && <Banner tone="error">{err}</Banner>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Back</Button>
        <Button className="flex-1" onClick={submit} disabled={busy || !ready}>
          {busy ? "Signing…" : "Sign and send to the office"}
        </Button>
      </div>
    </div>
  );
}

function Question({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string | boolean | undefined;
  onChange: (v: string | boolean) => void;
}) {
  const id = `q-${field.name}`;
  const req = field.required ? " *" : "";
  if (field.kind === "check") {
    return <Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked)} label={field.label + req} className="!items-start" />;
  }
  if (field.kind === "choice") {
    return (
      <div>
        <Label htmlFor={id}>{field.label}{req}</Label>
        <Select id={id} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      </div>
    );
  }
  if (field.prefill === "today") {
    return (
      <div>
        <Label>{field.label}</Label>
        <MetaLine items={["Filled with today's date when you sign"]} />
      </div>
    );
  }
  const numeric = field.prefill === "ssn" || field.prefill === "zip" || /routing|account|amount|percent|\$|%/i.test(field.label);
  return (
    <div>
      <Label htmlFor={id}>{field.label}{req}</Label>
      <Input
        id={id}
        inputMode={numeric ? "decimal" : undefined}
        autoComplete="off"
        maxLength={field.maxLength}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
