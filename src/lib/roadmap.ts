/**
 * Roadmap — the features proposed by the Drive survey of 2026-11-17 (what the
 * old Drive folders and tracking sheets did that the app does not do yet), and
 * the work left open when the plans in docs/plans/ closed on 2026-11-24.
 * The /roadmap page lists them; each person sets a priority per feature and
 * the list sorts by the total. Votes live in the companion DB (roadmap_votes).
 *
 * To mark a feature built, set `built` to the date it shipped. Do not reuse
 * or rename an id: votes are stored against it.
 */

import type { ChipTone } from "@/components/ui";

export type RoadmapClass = "compliance" | "money" | "projects" | "field" | "growth" | "fix";

export const CLASSES: Record<RoadmapClass, { label: string; tone: ChipTone }> = {
  compliance: { label: "Compliance", tone: "danger" },
  money: { label: "Money", tone: "success" },
  projects: { label: "Projects", tone: "info" },
  field: { label: "Safety & Fleet", tone: "warning" },
  growth: { label: "Sales & Reports", tone: "accent" },
  fix: { label: "Fix", tone: "neutral" },
};

export interface RoadmapFeature {
  id: string;
  title: string;
  cls: RoadmapClass;
  /** What the feature does, in one or two sentences. */
  what: string;
  /** Where the old system did it, and how live that work is. None for work
   *  left open by an earlier plan. */
  was?: string;
  /** Rough size: S = a day, M = a few days, L = a week or more. */
  size: "S" | "M" | "L";
  /** Date shipped, once built. */
  built?: string;
}

export const FEATURES: RoadmapFeature[] = [
  {
    id: "sub-coi",
    title: "Subcontractor insurance & W-9 register",
    cls: "compliance",
    what: "Each sub's liability expiry date, hold-harmless and W-9 on file, with a reminder email before expiry. Extends the COI dot on bill lists.",
    was: "Subcontractor Info and Vendor Insurance Certificate Audit sheets. 13 COIs filed by hand Oct 26 – Nov 6, 2026.",
    size: "M",
    built: "2026-11-20",
  },
  {
    id: "renewals",
    title: "Company renewals calendar",
    cls: "compliance",
    what: "One list of company renewals with due dates and a warning before each: bond, general liability, Progressive auto, reseller permit, business licence, contractor registration, AWB, APP review.",
    was: "Loose PDFs in Office Management (CBIC, Progressive, Business Licenses). No register of dates.",
    size: "S",
    built: "2026-11-20",
  },
  {
    id: "tax-reports",
    title: "Sales tax, L&I and 1099 reports",
    cls: "compliance",
    what: "Monthly sales tax collected for the DOR excise return, quarterly L&I hours by risk class, and year-end 1099 totals per vendor — from data the app already holds.",
    was: "WA DOR returns in Taxes, 2024 L&I Payroll Tax Liabilities (Q1–Q4 tabs), 1099-NEC List.",
    size: "M",
  },
  {
    id: "cert-roster",
    title: "First-aid / CPR certificate roster",
    cls: "compliance",
    what: "Each employee's first-aid and CPR cards with expiry dates, warned before they lapse.",
    was: "Card scans in Office Management (2025-11). No expiry tracking.",
    size: "S",
  },
  {
    id: "card-classify",
    title: "Credit-card charge classification",
    cls: "money",
    what: "Import the month's Capital One Spark charges and give each a job and cost code, the way Amazon import does.",
    was: "Costs to Classify – September 2026. Done by hand every month.",
    size: "M",
  },
  {
    id: "change-orders",
    title: "Change-order log",
    cls: "money",
    what: "A job's change orders — pending and approved — with the revised contract total and % increase.",
    was: "Tracking sheet change columns per month, and one signed Estimated Change Order doc per change (Berger).",
    size: "M",
    built: "2026-11-23",
  },
  {
    id: "client-budget",
    title: "Client budget report",
    cls: "money",
    what: "A printable report sent with each invoice: billed to date, budget remaining, % invoiced and cost to complete, by cost code.",
    was: "The 11×17 tracking-sheet PDF emailed with each invoice. Berger's sheet still edited Nov 2026.",
    size: "M",
    built: "2026-11-20",
  },
  {
    id: "deposit-balance",
    title: "Deposit balance per job",
    cls: "money",
    what: "Finish the deposits plan: deposit applied each month and the balance left, per job.",
    was: "The Deposit row on each tracking sheet, drawn down monthly.",
    size: "M",
    built: "2026-11-20",
  },
  {
    id: "overhead-bills",
    title: "Recurring overhead bills checklist",
    cls: "money",
    what: "Each month's overhead bills — auto-pay or by hand — ticked off as paid.",
    was: "The auto-pay vs manual-pay list in Ascent Office Manager Procedures.",
    size: "S",
  },
  {
    id: "profit",
    title: "Profit per job and division",
    cls: "growth",
    what: "Revenue less cost per job and per division (GC, Electrical), with office overhead shared out.",
    was: "2021 quarterly P&L sheets; the bookkeeper's 2025 ask for electrical profitability.",
    size: "L",
  },
  {
    id: "fee-forecast",
    title: "Billing forecast & cost to complete",
    cls: "growth",
    what: "Each job's expected billing by month and the estimated cost to complete each cost code.",
    was: "Estimated Fee Schedule sheets and the tracking sheet's Cost To Complete column.",
    size: "M",
  },
  {
    id: "sales-funnel",
    title: "Sales funnel & architect tracker",
    cls: "growth",
    what: "Lead stages (raw → qualified → design contract → build contract) with conversion rates, plus a list of architects and referral partners with last contact.",
    was: "Sales and Marketing doc (stages + KPIs), architect_cold_call_tracker sheet.",
    size: "M",
  },
  {
    id: "billing-rates",
    title: "Per-project billing rates",
    cls: "growth",
    what: "Each job's billing rate per labor type, checked against what was invoiced.",
    was: "Project_Rates tab and each tracking sheet's Service Cost Reference.",
    size: "S",
  },
  {
    id: "precon",
    title: "Preconstruction checklist",
    cls: "projects",
    what: "The 27-step precon checklist per job (DD review → estimate → contract → deposit → schedule), each with a status.",
    was: "Preconstruction Process Checklist sheet in every job folder.",
    size: "S",
    built: "2026-11-23",
  },
  {
    id: "bid-log",
    title: "Subcontractor bid log",
    cls: "projects",
    what: "Per job: which sub was asked to bid on what, when it was sent and received, and the file.",
    was: "RFP Tracking sheet in each job's Tracking Sheets folder.",
    size: "S",
  },
  {
    id: "permits",
    title: "Permits & inspections tracker",
    cls: "projects",
    what: "Each job's permits and inspections with dates and results, plus the combo inspection checklist beside the final punch list.",
    was: "Combo Inspection Checklist doc; permit numbers on change orders; Certifications folders.",
    size: "M",
  },
  {
    id: "selections",
    title: "Allowances & client decisions",
    cls: "projects",
    what: "Allowance vs actual per selection, and a log of client decisions with cost and schedule impact.",
    was: "Tile Budget Worksheet, allowance column, ZZ_Decisions table, Electrical Decisions docs.",
    size: "M",
  },
  {
    id: "meetings-photos",
    title: "Meeting notes & weekly photos",
    cls: "projects",
    what: "Weekly owner/architect meeting notes and a weekly photo log on the job's page.",
    was: "Meeting Notes and Photos (week of …) folders on recent jobs.",
    size: "M",
  },
  {
    id: "fleet",
    title: "Truck schedule & vehicle checks",
    cls: "field",
    what: "Book the trucks, log the weekly inspection, and warn when service is due by mileage.",
    was: "Ascent Shop Manager Procedures (“the truck schedule is the law”); Truck table in AppSheet.",
    size: "M",
  },
  {
    id: "safety-forms",
    title: "Safety inspections, JSAs & incidents",
    cls: "field",
    what: "Walk-around inspections, job safety analyses and incident reports on the phone, filed to Drive like safety meetings.",
    was: "Appendixes of the Ascent APP 2025; L&I Claims folder.",
    size: "M",
  },
  {
    id: "safety-dupes",
    title: "Duplicate safety meeting folders",
    cls: "fix",
    what: "Find out why Safety Meetings has two or three folders for one meeting date, and stop it.",
    was: "Two 2026-11-03 folders and three 2026-07-20 folders in Safety Meetings.",
    size: "S",
    built: "2026-11-20",
  },
  {
    id: "supplies",
    title: "Supplies on the Tools page",
    cls: "field",
    what: "A Supplies tab on Tools: name, unit, quantity on hand, reorder level, location, with plus and minus buttons. A supply under its reorder level shows in the warnings inbox and can open a requisition.",
    size: "M",
  },
  {
    id: "invoice-pdf-amount",
    title: "Check the amount on each backup PDF",
    cls: "money",
    what: "The invoice review reads the total printed on each vendor's backup PDF and flags a bill whose amount differs. Today it trusts the file name. Mostly Apps Script work.",
    size: "S",
  },
  {
    id: "page-folds",
    title: "Fewer pages: Find and People hubs",
    cls: "fix",
    what: "Fold the search pages and the people pages into two hubs, as the Jobs, Bills and Admin pages did. Old addresses redirect. Also: Vendors gets a bill-number box, and the Bill Archive reads a search handed to it.",
    size: "M",
  },
  {
    id: "payroll-period",
    title: "Payroll: each person's period total",
    cls: "money",
    what: "Payroll shows each employee's hours and pay for the pay period, and Time Sync checks the whole period, not the last 7 days.",
    size: "S",
  },
  {
    id: "bill-page-save",
    title: "Bill page: one Save, like the board",
    cls: "fix",
    what: "On the bill page, deleting or adding a line, a buyback and a void wait for Save Changes, as they do on the board. Today they write to JobTread at once. Changes a JobTread write: needs the owner's ok.",
    size: "S",
  },
  {
    id: "schedule-finished",
    title: "Schedule: finished tasks, and quiet moves",
    cls: "projects",
    what: "The Schedule page shows finished tasks too. Decide whether dragging a task notifies its assignees (JobTread does by default) and shifts the tasks that depend on it.",
    size: "S",
  },
  {
    id: "leads-timer",
    title: "Leads import on a timer",
    cls: "growth",
    what: "New leads come in on a timer, not when someone opens the Leads page. Needs a signed-in-free path for the timer: owner's ok.",
    size: "S",
  },
  {
    id: "sunset-lead-view",
    title: "Read-only Sunset bill for leads",
    cls: "fix",
    what: "A lead can open a Sunset bill and read it. Today the bill page is the coding editor, so leads do not get it.",
    size: "S",
  },
  {
    id: "expense-card",
    title: "Push as Expense: pick the card",
    cls: "money",
    what: "Push as Expense always posts to Capital One Sparks (271). 8 of 36 past expenses used another card. Decide whether the office picks the card.",
    size: "S",
  },
];

/** Priority choices, highest first. The score is what the list sorts by. */
export const PRIORITIES = [
  { score: 3, label: "Must" },
  { score: 2, label: "Should" },
  { score: 1, label: "Later" },
  { score: 0, label: "Skip" },
] as const;

export const FEATURE_IDS = new Set(FEATURES.map((f) => f.id));
