"use client";

/**
 * Leads — every JobTread customer sitting at Status = "New Lead", PLUS the leads
 * logged here without JobTread, with the Companion's own follow-up tracking on
 * top of both.
 *
 * The point of the page is that a lead cannot go quiet unnoticed. Two signals
 * do that work, and they are what the list sorts by:
 *   • OVERDUE — the lead has a next action whose date has passed (or, worse, no
 *     next action committed at all).
 *   • STALE — days since we last logged a touch (or, with no touch ever, days
 *     since the lead arrived). Amber past 7 days, red past 14.
 *
 * TWO KINDS OF LEAD, one list. A JobTread lead is a mirror: JobTread owns who is
 * a lead, moving someone out of the pipeline is a Status edit there, and this
 * page never writes to it. A LOCAL lead ("New lead" button) is the Companion's
 * own — the website intake form filled in for someone who phoned instead — and
 * lives only here until someone pushes it across, which is the one action on this
 * page that writes to JobTread (it creates the customer, and from then on the
 * lead is a JobTread lead like any other).
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { JtLink } from "@/components/JtLink";
import {
  Banner,
  Button,
  Card,
  CardSkeletonList,
  Chip,
  ChipScroller,
  EmptyState,
  FilterChip,
  Input,
  Label,
  PageHeader,
  SectionHeading,
  Select,
  Textarea,
  type ChipTone,
} from "@/components/ui";
import { BLANK_INQUIRY, INQUIRY_ROWS, type InquiryFields } from "@/lib/leadInquiry";

import { LeadIntakeForm } from "./LeadIntakeForm";

/* ------------------------------------------------------------------- types */

interface Contact {
  id: string;
  name: string;
  title: string;
  email: string;
  phone: string;
}
interface Tracking {
  stage: string;
  nextAction: string;
  nextActionDate: string;
  lastContactDate: string;
  estValue: string;
  notes: string;
  updatedAt: string;
}
/** The intake answers, as logged here. Present on a local lead, and on a
 *  JobTread lead that grew out of one. */
interface Inquiry extends InquiryFields {
  id: string;
  loggedBy: string;
  loggedAt: string;
  jtAccountId: string;
  pushedAt: string;
  /** Arrived by itself from a website form submission, rather than typed in. */
  fromWebsite: boolean;
  sourceForm: string;
  files: { name: string; url: string }[];
  reviewedAt: string;
  reviewedBy: string;
}
interface Lead {
  id: string; // JobTread account id, or "inq_…" for a lead logged here
  name: string;
  createdAt: string;
  source: string;
  customerType: string;
  notes: string;
  address: string;
  primaryContact: Contact | null;
  contacts: Contact[];
  jobs: { id: string; name: string; createdAt: string }[];
  tasks: { id: string; name: string; endDate: string; completed: boolean }[];
  tracking: Tracking;
  /** True while the lead exists only in the Companion — not yet in JobTread. */
  local: boolean;
  inquiry: Inquiry | null;
}
interface Activity {
  id: number;
  accountId: string;
  kind: string;
  note: string;
  occurredAt: string;
  createdBy: string;
  createdAt: string;
}

const STAGES: { id: string; label: string }[] = [
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "site_visit", label: "Site visit" },
  { id: "estimating", label: "Estimating" },
  { id: "proposal_sent", label: "Proposal sent" },
];
const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;

const KINDS: { id: string; label: string }[] = [
  { id: "call", label: "Call" },
  { id: "email", label: "Email" },
  { id: "meeting", label: "Meeting" },
  { id: "site_visit", label: "Site visit" },
  { id: "note", label: "Note (no contact)" },
];
const kindLabel = (id: string) => KINDS.find((k) => k.id === id)?.label ?? id;

/* ------------------------------------------------------------------- dates */

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Whole days between a date and today. Null if unparseable.
 *
 * The date part is taken FIRST, so a full ISO timestamp (JobTread's
 * `createdAt`) is compared midnight-to-midnight like a plain YYYY-MM-DD is —
 * otherwise an account created at 17:22Z reads a day younger than it is.
 */
function daysSince(date: string): number | null {
  if (!date) return null;
  const then = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  const now = Date.parse(`${today()}T00:00:00Z`);
  return Math.round((now - then) / 86_400_000);
}

function fmtDate(date: string): string {
  if (!date) return "—";
  const t = Date.parse(date.length <= 10 ? `${date}T00:00:00Z` : date);
  if (Number.isNaN(t)) return date;
  return new Date(t).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* ---------------------------------------------------------------- sorting */

type SortMode = "attention" | "newest" | "oldest";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "attention", label: "Needs attention" },
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
];

/* -------------------------------------------------------------- derivation */

type Urgency = "overdue" | "due" | "unset" | "ok";

interface Derived {
  /** Days since the last logged touch, falling back to age in JobTread. */
  quietDays: number | null;
  /** True when quietDays is measured from account creation, not a real touch. */
  neverContacted: boolean;
  urgency: Urgency;
  /** Sort weight — biggest number floats to the top. */
  rank: number;
}

function derive(lead: Lead): Derived {
  const t = lead.tracking;
  const contactDays = daysSince(t.lastContactDate);
  const ageDays = daysSince(lead.createdAt);
  const neverContacted = contactDays === null;
  const quietDays = neverContacted ? ageDays : contactDays;

  let urgency: Urgency;
  if (!t.nextAction.trim() && !t.nextActionDate) urgency = "unset";
  else if (t.nextActionDate && t.nextActionDate < today()) urgency = "overdue";
  else if (t.nextActionDate && t.nextActionDate === today()) urgency = "due";
  else urgency = "ok";

  // Overdue outranks everything, then no-plan, then due-today, then quiet time.
  // Adding quietDays inside each band keeps the oldest first within it.
  const band = urgency === "overdue" ? 30_000 : urgency === "unset" ? 20_000 : urgency === "due" ? 10_000 : 0;
  return { quietDays, neverContacted, urgency, rank: band + (quietDays ?? 0) };
}

/**
 * A website submission nobody has acknowledged yet. Only ever true for a lead
 * that arrived on its own — a lead someone typed in has been "reviewed" by
 * definition, and pushing one to JobTread counts as dealing with it.
 */
function needsReview(lead: Lead): boolean {
  const inq = lead.inquiry;
  return Boolean(inq?.fromWebsite && !inq.reviewedAt && !inq.jtAccountId);
}

/** A horizontal rule for the plain-text email — the divider between leads, the
 *  closest a mail body gets to the invoice summary's hairline-ruled rows. */
const EMAIL_RULE = "─".repeat(14);

/** The live leads board, linked at the top of a copied email so the reader can
 *  jump straight to it. */
const LEADS_URL = "https://ascent-companion.vercel.app/leads";

/**
 * Format a phone into "(XXX) XXX-XXXX" when it's a plain 10-digit US number
 * (or 11 digits with a leading country 1). Anything else — an extension, a
 * foreign number, gibberish — is left exactly as entered rather than mangled.
 */
function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw.trim();
}

/** The free-text worth quoting for a lead: the project write-up first, then the
 *  location blurb, then whatever notes we have. `max` trims it (the email caps at
 *  600 so the mail body stays sane); the PDF passes no cap and prints it whole. */
function leadDescription(lead: Lead, max = Infinity): string {
  const inq = lead.inquiry;
  const raw = (inq?.projectDetails || lead.address || inq?.notes || lead.notes || "").trim();
  return raw.length > max ? `${raw.slice(0, max - 3).trimEnd()}…` : raw;
}

/** Where the lead came from, as a one-line caption under the name. */
function leadProvenance(lead: Lead): string {
  if (lead.inquiry?.fromWebsite) return "Website Inquiry";
  if (lead.source) return lead.source;
  return lead.local ? "Logged lead" : "JobTread lead";
}

/**
 * Turn the leads on screen into a list to paste into an email — in BOTH forms:
 * `body` is plain text (rule lines between leads, the invoice summary's hairline
 * rows in ASCII), `html` is the same list with the email as a real mailto link
 * and normalized phones. copyEmailText puts both on the clipboard, so a rich
 * composer (Gmail, Apple Mail) shows the link and a plain box still gets the text.
 *
 * Formats exactly what's VISIBLE — filtered and in the current sort order.
 * One lead per block; a field is left out rather than shown empty.
 */
function buildLeadsEmail(rows: { lead: Lead; d: Derived }[]): {
  subject: string;
  body: string;
  html: string;
} {
  const esc = (s: string) =>
    s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const dateStr = new Date().toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const count = `${rows.length} lead${rows.length === 1 ? "" : "s"}`;

  const text: string[] = [];
  const html: string[] = [];
  // Push one line to both outputs; `asHtml` overrides the HTML when it needs
  // markup (a link) rather than the escaped plain text.
  const push = (line: string, asHtml?: string) => {
    text.push(line);
    html.push(asHtml ?? esc(line));
  };

  push(LEADS_URL, `<a href="${LEADS_URL}">${LEADS_URL}</a>`);
  push("");
  push("Ascent Building Co. — Leads", "<strong>Ascent Building Co. — Leads</strong>");
  push(`${dateStr} · ${count}`);
  push(EMAIL_RULE);
  push("");

  for (const { lead, d } of rows) {
    const contact = lead.primaryContact ?? lead.contacts[0] ?? null;
    const age =
      d.quietDays !== null ? ` (${d.quietDays} day${d.quietDays === 1 ? "" : "s"})` : "";
    push(`${lead.name} — ${stageLabel(lead.tracking.stage)}${age}`);
    push(leadProvenance(lead));

    const desc = leadDescription(lead, 600);
    if (desc) {
      push("");
      push(desc);
    }

    push("");
    push(
      lead.tracking.nextAction
        ? `Next: ${lead.tracking.nextAction}${
            lead.tracking.nextActionDate ? ` (by ${fmtDate(lead.tracking.nextActionDate)})` : ""
          }`
        : "Next: (no next step set)",
    );

    if (contact && (contact.phone || contact.email)) {
      const phone = contact.phone ? normalizePhone(contact.phone) : "";
      const email = contact.email || "";
      const parts = [phone, email].filter(Boolean);
      const htmlParts = [
        phone && esc(phone),
        email && `<a href="mailto:${esc(email)}">${esc(email)}</a>`,
      ].filter(Boolean);
      push("");
      push(parts.join(" · "), htmlParts.join(" · "));
    }
    push("");
    push(EMAIL_RULE);
    push("");
  }

  const body = text.join("\n");
  const htmlBody = `<div style="white-space:pre-wrap;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4">${html.join("<br>")}</div>`;
  return { subject: `Ascent leads — ${dateStr}`, body, html: htmlBody };
}

/**
 * A printable leads sheet — the same self-contained-HTML-then-print trick the
 * invoice summary uses (BillingSummary.printJob), with the same Ascent header,
 * hairline-ruled table and "Save as PDF" flow. Opened in a NEW top-level tab so
 * window.print() works even inside the JobTread side-panel iframe, and so the
 * browser's Save-as-PDF names the file after this tab's <title>.
 *
 * Each lead is one bordered row (name + provenance, stage, age, next step,
 * contact); the project write-up rides a full-width sub-row beneath it, matching
 * the invoice's grouped/sub-row look.
 */
function printLeads(rows: { lead: Lead; d: Derived }[]): void {
  const esc = (s: string) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
  const logoUrl = typeof window !== "undefined" ? `${window.location.origin}/icon-512.png` : "";
  const dateStr = new Date().toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const count = `${rows.length} lead${rows.length === 1 ? "" : "s"}`;

  const rowsHtml = rows
    .map(({ lead, d }) => {
      const age = d.quietDays !== null ? `${d.quietDays}d` : "—";
      const next = lead.tracking.nextAction
        ? esc(lead.tracking.nextAction) +
          (lead.tracking.nextActionDate
            ? ` <span class="dim">(by ${esc(fmtDate(lead.tracking.nextActionDate))})</span>`
            : "")
        : `<span class="dim">No next step set</span>`;
      const contact = lead.primaryContact ?? lead.contacts[0] ?? null;
      const contactStr = contact
        ? [contact.phone ? normalizePhone(contact.phone) : "", contact.email]
            .filter(Boolean)
            .map(esc)
            .join("<br/>")
        : `<span class="dim">—</span>`;
      const desc = leadDescription(lead);
      const descRow = desc ? `<tr class="desc"><td colspan="5">${esc(desc)}</td></tr>` : "";
      return `<tr>
        <td><div class="name">${esc(lead.name)}</div><div class="dim">${esc(leadProvenance(lead))}</div></td>
        <td>${esc(stageLabel(lead.tracking.stage))}</td>
        <td class="num">${esc(age)}</td>
        <td>${next}</td>
        <td>${contactStr}</td>
      </tr>${descRow}`;
    })
    .join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(`Ascent Leads - ${dateStr}`)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0.6in; }
  .head { display: flex; align-items: center; gap: 12px; }
  .logo { width: 48px; height: 48px; border-radius: 8px; flex: none; }
  .brand { font-size: 20px; font-weight: 700; }
  .doc-title { font-size: 16px; font-weight: 600; margin-top: 2px; }
  .meta { font-size: 13px; margin-top: 10px; color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; }
  th, td { padding: 7px 8px; border-bottom: 1px solid #ccc; text-align: left; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #555; border-bottom: 1px solid #000; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .name { font-weight: 600; }
  .dim { color: #888; font-size: 12px; }
  /* The description rides directly under its lead: drop the divider between the
     two, keep it under the description so leads stay separated. Falls back to a
     line under every row where :has() is unsupported — still readable. */
  tr.desc td { padding-top: 2px; padding-left: 8px; color: #444; font-style: italic; }
  tr:has(+ tr.desc) td { border-bottom: none; }
  /* Only shows on the desktop new-tab fallback; hidden when actually printing. */
  .noprint-close { position: fixed; top: 10px; right: 10px; z-index: 9; padding: 8px 14px; font-size: 14px; font-weight: 600; border: 1px solid #ccc; border-radius: 8px; background: #fff; color: #000; cursor: pointer; }
  @media print { .noprint-close { display: none; } }
  @page { margin: 0.6in; }
</style>
</head>
<body onload="window.focus(); window.print();">
  <button type="button" class="noprint-close" onclick="window.close()">Close</button>
  <div class="head">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="Ascent Building Co." />` : ""}
    <div>
      <div class="brand">Ascent Building Co.</div>
      <div class="doc-title">Leads — ${esc(dateStr)}</div>
    </div>
  </div>
  <div class="meta">${esc(count)}</div>
  <table>
    <thead><tr><th>Lead</th><th>Stage</th><th class="num">Quiet</th><th>Next step</th><th>Contact</th></tr></thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>
</body>
</html>`;

  const framed = typeof window !== "undefined" && window.top !== window.self;

  // On a phone (or anywhere the app isn't inside JobTread's side panel), print
  // through a HIDDEN IFRAME rather than a new tab. A second tab on a phone opens
  // an in-app browser view with no close button, stranding the user; an iframe
  // opens nothing — the print/share sheet appears over the app and dismissing it
  // returns straight here. The iframe self-prints via the body's onload.
  if (!framed) {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const fw = frame.contentWindow;
    if (!fw) {
      frame.remove();
      return;
    }
    const remove = () => {
      if (frame.parentNode) frame.remove();
    };
    fw.addEventListener("afterprint", () => setTimeout(remove, 300));
    setTimeout(remove, 60_000); // fallback: some mobile browsers never fire afterprint
    fw.document.open();
    fw.document.write(html);
    fw.document.close();
    return;
  }

  // Inside JobTread's desktop side panel, window.print() is blocked in-frame, so a
  // top-level tab is the only route — and a desktop tab (plus the page's own Close
  // button) can be dismissed normally.
  const win = window.open("", "_blank");
  if (!win) {
    window.print(); // popup blocked — best effort
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/** Amber past a week of silence, red past two. */
function staleTone(days: number | null): ChipTone {
  if (days === null) return "neutral";
  if (days >= 14) return "danger";
  if (days >= 7) return "warning";
  return "neutral";
}

const URGENCY_CHIP: Record<Urgency, { tone: ChipTone; label: string } | null> = {
  overdue: { tone: "danger", label: "Overdue" },
  unset: { tone: "warning", label: "No next step" },
  due: { tone: "info", label: "Due today" },
  ok: null,
};

/* -------------------------------------------------------------------- page */

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "attention" | "stale" | "local" | "review">("all");
  const [stageFilter, setStageFilter] = useState<string>("");
  const [sortMode, setSortMode] = useState<SortMode>("attention");
  const [adding, setAdding] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [scanErr, setScanErr] = useState("");
  const [draftNote, setDraftNote] = useState<{ tone: "info" | "warning"; text: string } | null>(
    null,
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/leads");
      const json = await res.json();
      if (!res.ok) setError(json.error ?? "Failed to load leads");
      else setLeads(json.leads ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * File any website form submission that isn't on the board yet.
   *
   * Runs once when the page opens, and again on Refresh — the ingest is keyed on
   * the Gmail message id, so scanning repeatedly is free and can't duplicate a
   * lead. An automatic scan stays SILENT on failure (a mailbox blip must not put
   * an error across a board that is otherwise working); a scan the user asked
   * for reports what went wrong.
   */
  const scan = useCallback(
    async (manual = false) => {
      setScanning(true);
      if (manual) setScanNote("");
      try {
        const res = await fetch("/api/leads/ingest", { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          if (manual) setScanErr(json.error ?? "Could not check the website inbox");
          return;
        }
        setScanErr("");
        if (json.added > 0) {
          const what = json.added === 1 ? "inquiry" : "inquiries";
          const who = json.names?.length ? `: ${json.names.join(", ")}` : "";
          setScanNote(`${json.added} new website ${what}${who}.`);
          await load();
        } else if (manual) {
          setScanNote("No new website inquiries.");
        }
      } catch (e) {
        if (manual) setScanErr(e instanceof Error ? e.message : "Network error");
      } finally {
        setScanning(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
    void scan();
  }, [load, scan]);

  /** Merge a saved tracking row back into the list without a full reload. */
  const applyTracking = useCallback((accountId: string, tracking: Tracking) => {
    setLeads((prev) => prev.map((l) => (l.id === accountId ? { ...l, tracking } : l)));
  }, []);

  const rows = useMemo(() => {
    const withD = leads.map((l) => ({ lead: l, d: derive(l) }));
    // "attention" is the board's reason for being — most urgent first (default).
    // The date modes let the owner read the pipeline as a plain chronology
    // instead, which is also the order the drafted email comes out in.
    const created = (r: { lead: Lead }) =>
      Date.parse(`${(r.lead.createdAt || "").slice(0, 10)}T00:00:00Z`) || 0;
    if (sortMode === "newest") {
      withD.sort((a, b) => created(b) - created(a) || a.lead.name.localeCompare(b.lead.name));
    } else if (sortMode === "oldest") {
      withD.sort((a, b) => created(a) - created(b) || a.lead.name.localeCompare(b.lead.name));
    } else {
      withD.sort((a, b) => b.d.rank - a.d.rank || a.lead.name.localeCompare(b.lead.name));
    }
    return withD;
  }, [leads, sortMode]);

  const counts = useMemo(() => {
    let attention = 0;
    let stale = 0;
    let local = 0;
    let review = 0;
    for (const { lead, d } of rows) {
      if (d.urgency === "overdue" || d.urgency === "unset") attention++;
      if ((d.quietDays ?? 0) >= 14) stale++;
      if (lead.local) local++;
      if (needsReview(lead)) review++;
    }
    return { total: rows.length, attention, stale, local, review };
  }, [rows]);

  const visible = rows.filter(({ lead, d }) => {
    if (filter === "attention" && d.urgency !== "overdue" && d.urgency !== "unset") return false;
    if (filter === "stale" && (d.quietDays ?? 0) < 14) return false;
    if (filter === "local" && !lead.local) return false;
    if (filter === "review" && !needsReview(lead)) return false;
    if (stageFilter && lead.tracking.stage !== stageFilter) return false;
    return true;
  });

  /**
   * Copy the leads on screen as formatted text, ready to paste into an email.
   *
   * Deliberately NOT a Gmail/mailto link: those open unreliably on a phone (the
   * compose URL 400s past ~2k chars, and the OS handoff often fails), which is
   * the whole reason this is a plain copy. The office pastes the list into a new
   * message in whatever mail app they like. Copies exactly what's VISIBLE, in the
   * current filter and sort.
   */
  const copyEmailText = useCallback(async () => {
    if (visible.length === 0) return;
    const { body, html } = buildLeadsEmail(visible);
    const ok = () =>
      setDraftNote({
        tone: "info",
        text: "Leads copied — paste them into a new email (long-press → Paste on a phone, ⌘/Ctrl-V on a computer).",
      });
    try {
      // Copy BOTH rich HTML (email becomes a clickable link) and plain text
      // (the fallback when pasting into a plain box). Older browsers without the
      // richer write()/ClipboardItem API fall back to plain text only.
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([body], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(body);
      }
      ok();
    } catch {
      try {
        await navigator.clipboard.writeText(body); // rich copy blocked — plain still works
        ok();
      } catch {
        setDraftNote({
          tone: "warning",
          text: "Couldn’t reach the clipboard. Try again, or select the leads on screen and copy them by hand.",
        });
      }
    }
  }, [visible]);

  /** Open the printable leads sheet (Save-as-PDF), same styling as the invoice
   *  summary. Prints exactly what's visible, in the current filter/sort. */
  const printLeadsPdf = useCallback(() => {
    if (visible.length === 0) return;
    printLeads(visible);
  }, [visible]);

  /** Log a brand-new lead. Companion-only — nothing reaches JobTread here. */
  const createLead = useCallback(
    async (fields: InquiryFields): Promise<string | null> => {
      try {
        const res = await fetch("/api/leads/inquiries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fields),
        });
        const json = await res.json();
        if (!res.ok) return json.error ?? "Could not save that lead";
        setAdding(false);
        await load();
        // Open the new lead so its next action can be set straight away.
        if (json.inquiry?.id) setOpenId(json.inquiry.id);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Network error";
      }
    },
    [load],
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <PageHeader
        title="Leads"
        description='Customers marked "New Lead" in JobTread, plus leads logged here, sorted by who needs attention first.'
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setAdding((v) => !v)}>
              {adding ? "Close" : "New lead"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              title="Reload the board and check the office inbox for new website inquiries"
              onClick={() => {
                void load();
                void scan(true);
              }}
              disabled={loading || scanning}
            >
              {scanning ? "Checking…" : "Refresh"}
            </Button>
          </div>
        }
      />

      {scanNote && (
        <Banner tone="info" className="mb-4">
          {scanNote}
        </Banner>
      )}
      {scanErr && (
        <Banner tone="warning" className="mb-4">
          Couldn&apos;t check the website inbox: {scanErr}
        </Banner>
      )}
      {draftNote && (
        <Banner tone={draftNote.tone} className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{draftNote.text}</span>
            {draftNote.tone === "warning" && (
              <Button size="sm" variant="outline" onClick={() => void copyEmailText()}>
                Try again
              </Button>
            )}
          </div>
        </Banner>
      )}

      {adding && (
        <Card className="mb-4">
          <SectionHeading className="mb-3">Log a new lead</SectionHeading>
          <p className="mb-3 text-xs text-neutral-500">
            The same questions as the website inquiry form. Saved here only — use “Push to
            JobTread” on the lead once it&apos;s worth a customer record.
          </p>
          <LeadIntakeForm onSave={createLead} onCancel={() => setAdding(false)} />
        </Card>
      )}

      {error && (
        <Banner tone="error" className="mb-4">
          {error}
        </Banner>
      )}

      {/* The two follow-up signals, as the page's headline numbers. */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Stat label="Leads" value={counts.total} />
        <Stat label="Need action" value={counts.attention} tone={counts.attention ? "danger" : "ok"} />
        <Stat label="Quiet 14d+" value={counts.stale} tone={counts.stale ? "warning" : "ok"} />
      </div>

      <ChipScroller className="mb-4">
        <FilterChip on={filter === "all"} onClick={() => setFilter("all")}>
          All
        </FilterChip>
        <FilterChip
          on={filter === "attention"}
          onClick={() => setFilter("attention")}
          title="Overdue next action, or no next action set"
        >
          Need action
        </FilterChip>
        <FilterChip
          on={filter === "stale"}
          onClick={() => setFilter("stale")}
          title="No contact logged in 14+ days"
        >
          Gone quiet
        </FilterChip>
        {counts.review > 0 && (
          <FilterChip
            on={filter === "review"}
            onClick={() => setFilter("review")}
            title="Came in from the website and nobody has marked it reviewed"
          >
            Needs review ({counts.review})
          </FilterChip>
        )}
        {counts.local > 0 && (
          <FilterChip
            on={filter === "local"}
            onClick={() => setFilter("local")}
            title="Logged here, not yet a customer in JobTread"
          >
            Not in JobTread
          </FilterChip>
        )}
        {STAGES.map((s) => (
          <FilterChip
            key={s.id}
            on={stageFilter === s.id}
            onClick={() => setStageFilter(stageFilter === s.id ? "" : s.id)}
          >
            {s.label}
          </FilterChip>
        ))}
      </ChipScroller>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Label htmlFor="lead-sort" className="mb-0 whitespace-nowrap">
            Sort
          </Label>
          <Select
            id="lead-sort"
            className="w-auto"
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={printLeadsPdf}
            disabled={visible.length === 0}
            title="Open a printable PDF of the leads shown below, styled like the invoice summary"
          >
            PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void copyEmailText()}
            disabled={visible.length === 0}
            title="Copy the leads shown below as text, to paste into an email"
          >
            Copy for email ({visible.length})
          </Button>
        </div>
      </div>

      {loading && leads.length === 0 ? (
        <CardSkeletonList rows={4} />
      ) : visible.length === 0 ? (
        <EmptyState>
          {leads.length === 0
            ? 'No customers are marked "New Lead" in JobTread, and nothing has been logged here — use “New lead” to add one.'
            : "No leads match this filter."}
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map(({ lead, d }) => (
            <li key={lead.id}>
              <LeadCard
                lead={lead}
                derived={d}
                open={openId === lead.id}
                onToggle={() => setOpenId(openId === lead.id ? null : lead.id)}
                onTracking={(t) => applyTracking(lead.id, t)}
                onChanged={() => void load()}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------- stats */

function Stat({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: number;
  tone?: "ok" | "warning" | "danger";
}) {
  const color =
    tone === "danger"
      ? "text-red-600 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-neutral-800 dark:text-neutral-100";
  return (
    <Card className="text-center">
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
    </Card>
  );
}

/* --------------------------------------------------------------- lead card */

function LeadCard({
  lead,
  derived,
  open,
  onToggle,
  onTracking,
  onChanged,
}: {
  lead: Lead;
  derived: Derived;
  open: boolean;
  onToggle: () => void;
  onTracking: (t: Tracking) => void;
  /** Reload the board — a push, edit or delete changes more than one card. */
  onChanged: () => void;
}) {
  const urgency = URGENCY_CHIP[derived.urgency];
  const quiet = derived.quietDays;

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full px-3 py-3 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-semibold">{lead.name}</div>
            <div className="mt-0.5 truncate text-xs text-neutral-500">
              {[lead.source && `via ${lead.source}`, lead.customerType, lead.address]
                .filter(Boolean)
                .join(" · ") ||
                (lead.local ? "No source or address logged" : "No source or address in JobTread")}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {needsReview(lead) && (
              <Chip tone="info" title="Straight from the website form — not reviewed yet">
                New from web
              </Chip>
            )}
            {lead.local && (
              <Chip tone="accent" title="Logged here — no customer in JobTread yet">
                Not in JT
              </Chip>
            )}
            {urgency && <Chip tone={urgency.tone}>{urgency.label}</Chip>}
            {quiet !== null && (
              <Chip
                tone={staleTone(quiet)}
                title={
                  derived.neverContacted
                    ? "No contact ever logged — measured from when JobTread created the account"
                    : "Days since the last logged contact"
                }
              >
                {quiet}d {derived.neverContacted ? "no contact" : "quiet"}
              </Chip>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {stageLabel(lead.tracking.stage)}
          </span>
          <span className="text-neutral-500">
            {lead.tracking.nextAction ? (
              <>
                Next: <span className="text-neutral-700 dark:text-neutral-200">{lead.tracking.nextAction}</span>
                {lead.tracking.nextActionDate && ` · ${fmtDate(lead.tracking.nextActionDate)}`}
              </>
            ) : (
              <span className="italic">No next step set</span>
            )}
          </span>
        </div>
      </button>

      {open && <LeadDetail lead={lead} onTracking={onTracking} onChanged={onChanged} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ detail */

function LeadDetail({
  lead,
  onTracking,
  onChanged,
}: {
  lead: Lead;
  onTracking: (t: Tracking) => void;
  onChanged: () => void;
}) {
  const [form, setForm] = useState<Tracking>(lead.tracking);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingLog, setLoadingLog] = useState(true);
  const [log, setLog] = useState({ kind: "call", note: "", occurredAt: today() });
  const [logging, setLogging] = useState(false);

  // Keep the form in step with a tracking row changed elsewhere (a logged touch
  // stamps last contact server-side).
  useEffect(() => setForm(lead.tracking), [lead.tracking]);

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch(`/api/leads/activities?accountId=${encodeURIComponent(lead.id)}`);
      const json = await res.json();
      if (res.ok) setActivities(json.activities ?? []);
    } finally {
      setLoadingLog(false);
    }
  }, [lead.id]);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  async function saveTracking() {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: lead.id, ...form }),
      });
      const json = await res.json();
      if (!res.ok) setErr(json.error ?? "Save failed");
      else onTracking(json.tracking);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function logTouch() {
    setLogging(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: lead.id, ...log }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Could not log that");
        return;
      }
      setLog({ kind: "call", note: "", occurredAt: today() });
      await loadLog();
      // The POST may have moved last-contact; pull the fresh tracking row.
      if (log.kind !== "note") {
        const r = await fetch("/api/leads", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId: lead.id }) });
        const j = await r.json();
        if (r.ok && j.tracking) onTracking(j.tracking);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setLogging(false);
    }
  }

  const contacts = lead.contacts.length ? lead.contacts : lead.primaryContact ? [lead.primaryContact] : [];
  const openTasks = lead.tasks.filter((t) => !t.completed);

  return (
    <div className="space-y-4 border-t border-line px-3 pb-4 pt-3">
      {err && <Banner tone="error">{err}</Banner>}

      {/* --------------------------------------- where the lead lives today */}
      <section className="space-y-2">
        <SectionHeading
          trailing={
            lead.local ? undefined : (
              <JtLink
                href={`https://app.jobtread.com/customers/${lead.id}`}
                className="text-xs font-semibold text-accent hover:underline"
              >
                Open in JobTread ↗
              </JtLink>
            )
          }
        >
          {lead.local ? "Logged here" : "From JobTread"}
        </SectionHeading>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Field label={lead.local ? "Logged" : "Created"} value={fmtDate(lead.createdAt)} />
          <Field label="Lead source" value={lead.source || "—"} />
          <Field label="Type" value={lead.customerType || "—"} />
          <Field label="Address" value={lead.address || "—"} />
          {lead.inquiry?.loggedBy && <Field label="Logged by" value={lead.inquiry.loggedBy} />}
          {!lead.local && lead.inquiry?.pushedAt && (
            <Field label="Pushed to JT" value={fmtDate(lead.inquiry.pushedAt)} />
          )}
        </dl>

        {contacts.length > 0 && (
          <ul className="space-y-1">
            {contacts.map((c) => (
              <li key={c.id} className="rounded-lg bg-neutral-50 px-2.5 py-2 text-xs dark:bg-white/5">
                <div className="font-semibold">
                  {c.name}
                  {c.title && <span className="ml-1 font-normal text-neutral-500">{c.title}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="font-medium text-accent hover:underline">
                      {c.phone}
                    </a>
                  )}
                  {c.email && (
                    <a href={`mailto:${c.email}`} className="font-medium text-accent hover:underline">
                      {c.email}
                    </a>
                  )}
                  {!c.phone && !c.email && <span className="text-neutral-500">No phone or email</span>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {lead.notes && (
          <details className="text-xs">
            <summary className="cursor-pointer font-semibold text-neutral-600 dark:text-neutral-300">
              {lead.local ? "Our notes" : "JobTread notes"}
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{lead.notes}</p>
          </details>
        )}

        {lead.jobs.length > 0 && (
          <div className="text-xs">
            <span className="font-semibold text-neutral-600 dark:text-neutral-300">Jobs: </span>
            {lead.jobs.map((j, i) => (
              <span key={j.id}>
                {i > 0 && ", "}
                <JtLink
                  href={`https://app.jobtread.com/jobs/${j.id}`}
                  className="text-accent hover:underline"
                >
                  {j.name}
                </JtLink>
              </span>
            ))}
          </div>
        )}

        {openTasks.length > 0 && (
          <div className="text-xs">
            <span className="font-semibold text-neutral-600 dark:text-neutral-300">Open JT tasks: </span>
            <span className="text-neutral-600 dark:text-neutral-400">
              {openTasks.map((t) => `${t.name}${t.endDate ? ` (${fmtDate(t.endDate)})` : ""}`).join(", ")}
            </span>
          </div>
        )}
      </section>

      {/* ----------------------------------------- the intake answers, if any */}
      {lead.inquiry && <InquiryPanel inquiry={lead.inquiry} onChanged={onChanged} />}

      {/* ------------------------- what a local lead can do that a JT one can't */}
      {lead.local && lead.inquiry && (
        <LocalLeadPanel inquiry={lead.inquiry} onChanged={onChanged} />
      )}

      {/* ------------------------------------------------------- tracking */}
      <section className="space-y-2">
        <SectionHeading>Tracking</SectionHeading>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`stage-${lead.id}`}>Stage</Label>
            <Select
              id={`stage-${lead.id}`}
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
            >
              {STAGES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`value-${lead.id}`}>Est. value</Label>
            <Input
              id={`value-${lead.id}`}
              inputMode="decimal"
              placeholder="e.g. 85000"
              value={form.estValue}
              onChange={(e) => setForm({ ...form, estValue: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor={`next-${lead.id}`}>Next action</Label>
            <Input
              id={`next-${lead.id}`}
              placeholder="e.g. Send siding scope + ballpark"
              value={form.nextAction}
              onChange={(e) => setForm({ ...form, nextAction: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`nextdate-${lead.id}`}>By</Label>
            <Input
              id={`nextdate-${lead.id}`}
              type="date"
              value={form.nextActionDate}
              onChange={(e) => setForm({ ...form, nextActionDate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`lastc-${lead.id}`}>Last contact</Label>
            <Input
              id={`lastc-${lead.id}`}
              type="date"
              value={form.lastContactDate}
              onChange={(e) => setForm({ ...form, lastContactDate: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor={`notes-${lead.id}`}>Our notes</Label>
            <Textarea
              id={`notes-${lead.id}`}
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
        </div>
        <Button size="sm" onClick={() => void saveTracking()} disabled={saving}>
          {saving ? "Saving…" : "Save tracking"}
        </Button>
      </section>

      {/* ------------------------------------------------------- contact log */}
      <section className="space-y-2">
        <SectionHeading>Contact log</SectionHeading>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`kind-${lead.id}`}>What happened</Label>
            <Select
              id={`kind-${lead.id}`}
              value={log.kind}
              onChange={(e) => setLog({ ...log, kind: e.target.value })}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor={`when-${lead.id}`}>When</Label>
            <Input
              id={`when-${lead.id}`}
              type="date"
              value={log.occurredAt}
              onChange={(e) => setLog({ ...log, occurredAt: e.target.value })}
            />
          </div>
          <div className="col-span-2">
            <Label htmlFor={`lognote-${lead.id}`}>Note</Label>
            <Textarea
              id={`lognote-${lead.id}`}
              rows={2}
              placeholder="What was said, what we owe them"
              value={log.note}
              onChange={(e) => setLog({ ...log, note: e.target.value })}
            />
          </div>
        </div>
        <Button size="sm" variant="secondary" onClick={() => void logTouch()} disabled={logging}>
          {logging ? "Logging…" : "Log contact"}
        </Button>

        {loadingLog ? (
          <p className="text-xs text-neutral-500">Loading log…</p>
        ) : activities.length === 0 ? (
          <p className="text-xs italic text-neutral-500">Nothing logged yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {activities.map((a) => (
              <li key={a.id} className="border-l-2 border-line pl-2.5 text-xs">
                <div className="font-semibold">
                  {kindLabel(a.kind)}
                  <span className="ml-1.5 font-normal text-neutral-500">{fmtDate(a.occurredAt)}</span>
                  {a.createdBy && (
                    <span className="ml-1.5 font-normal text-neutral-400">· {a.createdBy}</span>
                  )}
                </div>
                {a.note && (
                  <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-400">{a.note}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ intake answers */

/**
 * The intake answers, read back in the website form's own order and wording
 * (INQUIRY_ROWS is shared with the form and with the summary pushed to JobTread,
 * so all three always agree). Unanswered questions are left out rather than
 * shown blank — a two-minute phone call fills in three of these, not eleven.
 */
function InquiryPanel({ inquiry, onChanged }: { inquiry: Inquiry; onChanged: () => void }) {
  const [marking, setMarking] = useState(false);
  const answered = INQUIRY_ROWS.filter((row) => inquiry[row.key]);
  const unreviewed = inquiry.fromWebsite && !inquiry.reviewedAt;
  if (answered.length === 0 && inquiry.files.length === 0 && !inquiry.fromWebsite) return null;

  async function markReviewed() {
    setMarking(true);
    try {
      const res = await fetch("/api/leads/inquiries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inquiry.id, reviewed: true }),
      });
      if (res.ok) onChanged();
    } finally {
      setMarking(false);
    }
  }

  return (
    <section className="space-y-2">
      <SectionHeading
        trailing={
          inquiry.fromWebsite ? (
            unreviewed ? (
              <Button size="sm" variant="outline" onClick={() => void markReviewed()} disabled={marking}>
                {marking ? "Marking…" : "Mark reviewed"}
              </Button>
            ) : (
              <span className="text-[11px] text-neutral-500">
                Reviewed {fmtDate(inquiry.reviewedAt)}
                {inquiry.reviewedBy ? ` · ${inquiry.reviewedBy}` : ""}
              </span>
            )
          ) : undefined
        }
      >
        {inquiry.fromWebsite ? "Website inquiry" : "Inquiry"}
      </SectionHeading>

      {inquiry.fromWebsite && (
        <p className="text-[11px] text-neutral-500">
          Filed automatically from the website form
          {inquiry.sourceForm ? ` (${inquiry.sourceForm})` : ""} · received{" "}
          {fmtDate(inquiry.loggedAt)}
        </p>
      )}

      {inquiry.files.length > 0 && (
        <div className="text-xs">
          <span className="font-semibold text-neutral-600 dark:text-neutral-300">
            Files they attached:{" "}
          </span>
          {inquiry.files.map((f, i) => (
            <span key={f.url}>
              {i > 0 && ", "}
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {f.name}
              </a>
            </span>
          ))}
        </div>
      )}

      <dl className="space-y-1.5 text-xs">
        {answered.map((row) => (
          <div key={row.key}>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              {row.label}
            </dt>
            <dd className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
              {row.key === "startDate" || row.key === "targetDate"
                ? fmtDate(inquiry[row.key])
                : inquiry[row.key]}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* --------------------------------------------------------- local lead panel */

/**
 * Everything you can do to a lead that lives only here: push it to JobTread,
 * correct what was logged, or drop it if it was a mistake.
 *
 * The push is the only action on this page that writes to JobTread, and it
 * creates a customer in the live org, so it asks first. Two answers from the
 * server get special handling rather than being shown as plain errors:
 *  • a same-name customer already in JobTread — offered as "create anyway",
 *    because sometimes it really is a second project for a second Jack Warner.
 *  • a preview (a dry run, or the write gate being closed) — shown as the list
 *    of calls it WOULD make, with nothing sent.
 */
function LocalLeadPanel({ inquiry, onChanged }: { inquiry: Inquiry; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);
  const [plan, setPlan] = useState<{ label: string; query: unknown }[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  async function push(opts: { dryRun?: boolean; force?: boolean } = {}) {
    setBusy(true);
    setErr("");
    setOk("");
    setPlan(null);
    setWarnings([]);
    if (!opts.dryRun) setConfirming(false);
    try {
      const res = await fetch("/api/leads/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inquiryId: inquiry.id, ...opts }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Push failed");
        setDuplicates(json.needsForce ? (json.duplicates ?? []) : []);
        return;
      }
      setDuplicates([]);
      if (json.previewed) {
        setPlan(json.plan ?? []);
        setOk(
          json.writesEnabled
            ? "Preview only — nothing was sent to JobTread."
            : "Writes to JobTread are switched off, so nothing was sent. This is what it would do.",
        );
        return;
      }
      setWarnings(json.warnings ?? []);
      setOk("Customer created in JobTread.");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(fields: InquiryFields): Promise<string | null> {
    try {
      const res = await fetch("/api/leads/inquiries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: inquiry.id, ...fields }),
      });
      const json = await res.json();
      if (!res.ok) return json.error ?? "Could not save";
      setEditing(false);
      onChanged();
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "Network error";
    }
  }

  async function remove() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(`/api/leads/inquiries?id=${encodeURIComponent(inquiry.id)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? "Could not delete");
        return;
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Network error");
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  if (editing) {
    return (
      <section className="space-y-2">
        <SectionHeading>Edit lead</SectionHeading>
        <LeadIntakeForm
          // Only the answer fields — an Inquiry also carries provenance and
          // review state, which the form has no business holding.
          initial={Object.fromEntries(
            (Object.keys(BLANK_INQUIRY) as (keyof InquiryFields)[]).map((k) => [k, inquiry[k]]),
          )}
          submitLabel="Save changes"
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <SectionHeading>Not in JobTread yet</SectionHeading>

      {err && <Banner tone="error">{err}</Banner>}
      {ok && <Banner tone={plan ? "info" : "success"}>{ok}</Banner>}
      {warnings.length > 0 && (
        <Banner tone="warning">
          The customer was created, but:
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          Worth fixing by hand in JobTread.
        </Banner>
      )}

      {duplicates.length > 0 && (
        <Banner tone="warning">
          JobTread already has{" "}
          {duplicates.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ", "}
              <JtLink
                href={`https://app.jobtread.com/customers/${d.id}`}
                className="font-semibold underline"
              >
                {d.name}
              </JtLink>
            </span>
          ))}
          . Push anyway only if this is a different customer.
          <div className="mt-2">
            <Button size="sm" variant="danger" onClick={() => void push({ force: true })} disabled={busy}>
              Create anyway
            </Button>
          </div>
        </Banner>
      )}

      {plan && (
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-neutral-600 dark:text-neutral-300">
            {plan.length} call{plan.length === 1 ? "" : "s"} it would make
          </summary>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            {plan.map((step) => (
              <li key={step.label} className="text-neutral-600 dark:text-neutral-400">
                {step.label}
              </li>
            ))}
          </ol>
        </details>
      )}

      {confirming ? (
        <div className="space-y-2">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            This creates <span className="font-semibold">{inquiry.name}</span> as a customer in
            JobTread, at status “New Lead”, with these answers in its Notes. There&apos;s no undo
            from here — deleting a customer is a JobTread job.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void push()} disabled={busy}>
              {busy ? "Creating…" : "Yes, create the customer"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setConfirming(true)} disabled={busy}>
            Push to JobTread
          </Button>
          <Button size="sm" variant="outline" onClick={() => void push({ dryRun: true })} disabled={busy}>
            Preview
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={busy}>
            Edit
          </Button>
          {confirmingDelete ? (
            <>
              <Button size="sm" variant="danger" onClick={() => void remove()} disabled={busy}>
                Delete for good
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Keep
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              Delete
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="truncate text-neutral-700 dark:text-neutral-300" title={value}>
        {value}
      </dd>
    </div>
  );
}
