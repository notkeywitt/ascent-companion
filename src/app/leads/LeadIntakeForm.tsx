"use client";

/**
 * The new-lead intake form — the Companion's copy of the public inquiry form at
 * ascentbuildingco.com/new-inquiry, for a lead that came in by phone, in person,
 * or through Casey rather than through the website.
 *
 * It writes NOTHING to JobTread. Saving stores the answers in the companion DB
 * and the lead appears on the board immediately; creating the JobTread customer
 * is a separate, deliberate step on the lead's card.
 *
 * The questions, their labels and the option lists all come from
 * `lib/leadInquiry.ts`, which the API route shares — this file is only how they
 * are laid out. Serves both "log a new lead" and "correct one", which is why it
 * takes `initial` and hands the finished answers back rather than fetching.
 */

import { useState } from "react";

import {
  Banner,
  Button,
  Input,
  Label,
  Select,
  Textarea,
  SectionHeading,
} from "@/components/ui";
import {
  BLANK_INQUIRY,
  BUDGETS,
  CONTACT_METHODS,
  INQUIRY_ROWS,
  JT_CUSTOMER_TYPES,
  JT_LEAD_SOURCES,
  RESIDENCY,
  SERVICES,
  splitMulti,
  toggleMulti,
  type InquiryFields,
} from "@/lib/leadInquiry";

/** The website form's label for a question, so the two always read the same. */
const labelFor = (key: keyof InquiryFields) =>
  INQUIRY_ROWS.find((r) => r.key === key)?.label ?? key;

/**
 * Multi-answer question, as a row of toggle pills — the website field is
 * multi-select and people do pick two budget bands.
 */
function MultiChips({
  id,
  label,
  options,
  value,
  onChange,
}: {
  id: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
}) {
  const on = new Set(splitMulti(value));
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div id={id} className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={on.has(option)}
            onClick={() => onChange(toggleMulti(value, option, options))}
            className={`inline-flex min-h-11 items-center rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
              on.has(option)
                ? "border-accent bg-accent text-accent-fg"
                : "border-line bg-white text-neutral-500 hover:border-accent dark:bg-ink-raised dark:text-neutral-400"
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A select with a blank first option — "not asked" is a real answer here. */
function OptionSelect({
  id,
  label,
  options,
  value,
  onChange,
  blank = "—",
}: {
  id: string;
  label: string;
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  blank?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{blank}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function LeadIntakeForm({
  initial,
  submitLabel = "Save lead",
  onSave,
  onCancel,
}: {
  initial?: Partial<InquiryFields>;
  submitLabel?: string;
  /** Returns an error message, or null when the save worked. */
  onSave: (fields: InquiryFields) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<InquiryFields>({ ...BLANK_INQUIRY, ...initial });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const set = <K extends keyof InquiryFields>(key: K, value: InquiryFields[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!form.name.trim()) {
      setErr("A name is required.");
      return;
    }
    setSaving(true);
    setErr("");
    const message = await onSave({ ...form, name: form.name.trim() });
    setSaving(false);
    if (message) setErr(message);
  }

  return (
    <div className="space-y-4">
      {err && <Banner tone="error">{err}</Banner>}

      {/* ------------------------------------------------------ who they are */}
      <section className="space-y-2">
        <SectionHeading>Contact</SectionHeading>
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <Label htmlFor="lead-name">Name</Label>
            <Input
              id="lead-name"
              value={form.name}
              placeholder="Who got in touch"
              autoComplete="off"
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead-email">{labelFor("email")}</Label>
            <Input
              id="lead-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead-phone">{labelFor("phone")}</Label>
            <Input
              id="lead-phone"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
          <OptionSelect
            id="lead-contact-method"
            label={labelFor("contactMethod")}
            options={CONTACT_METHODS}
            value={form.contactMethod}
            onChange={(v) => set("contactMethod", v)}
          />
          <OptionSelect
            id="lead-residency"
            label={labelFor("residency")}
            options={RESIDENCY}
            value={form.residency}
            onChange={(v) => set("residency", v)}
          />
          <div className="col-span-2">
            <Label htmlFor="lead-address">{labelFor("address")}</Label>
            <Textarea
              id="lead-address"
              rows={2}
              placeholder="Address, or the parcel number if there's no address yet"
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- the project */}
      <section className="space-y-2">
        <SectionHeading>Project</SectionHeading>
        <div className="space-y-2">
          <MultiChips
            id="lead-services"
            label={labelFor("services")}
            options={SERVICES}
            value={form.services}
            onChange={(v) => set("services", v)}
          />
          <div>
            <Label htmlFor="lead-details">{labelFor("projectDetails")}</Label>
            <Textarea
              id="lead-details"
              rows={3}
              placeholder="What they want built"
              value={form.projectDetails}
              onChange={(e) => set("projectDetails", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="lead-design">{labelFor("designStatus")}</Label>
            <Textarea
              id="lead-design"
              rows={2}
              placeholder="Plans, architect, permits — where the design has got to"
              value={form.designStatus}
              onChange={(e) => set("designStatus", e.target.value)}
            />
          </div>
          <MultiChips
            id="lead-budget"
            label={labelFor("budget")}
            options={BUDGETS}
            value={form.budget}
            onChange={(v) => set("budget", v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor="lead-start">{labelFor("startDate")}</Label>
              <Input
                id="lead-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="lead-target">{labelFor("targetDate")}</Label>
              <Input
                id="lead-target"
                type="date"
                value={form.targetDate}
                onChange={(e) => set("targetDate", e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ filing */}
      <section className="space-y-2">
        <SectionHeading>Filing</SectionHeading>
        <p className="text-xs text-neutral-500">
          These two are JobTread&apos;s own customer fields — they get set if this lead is pushed
          across.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <OptionSelect
            id="lead-source"
            label="Lead source"
            options={JT_LEAD_SOURCES}
            value={form.leadSource}
            onChange={(v) => set("leadSource", v)}
          />
          <OptionSelect
            id="lead-type"
            label="Type"
            options={JT_CUSTOMER_TYPES}
            value={form.customerType}
            onChange={(v) => set("customerType", v)}
          />
          <div className="col-span-2">
            <Label htmlFor="lead-notes">Our notes</Label>
            <Textarea
              id="lead-notes"
              rows={2}
              placeholder="Anything else worth remembering about the call"
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
