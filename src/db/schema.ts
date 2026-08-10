import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

/**
 * RFIs — assistant-owned (JobTread has no RFI object). Linked to a JobTread job
 * by its id.
 */
export const rfis = sqliteTable("rfis", {
  id: integer("id").primaryKey({ autoIncrement: true }), // display "RFI #<id>"
  jobId: text("job_id").notNull(), // JobTread job id
  subject: text("subject").notNull(),
  question: text("question").notNull().default(""),
  status: text("status").notNull().default("open"), // open | answered | closed
  assignee: text("assignee").notNull().default(""), // vendor name
  dueDate: text("due_date").notNull().default(""), // YYYY-MM-DD
  dateSent: text("date_sent").notNull().default(""), // YYYY-MM-DD
  dateAnswered: text("date_answered").notNull().default(""), // YYYY-MM-DD
  answer: text("answer").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Rfi = typeof rfis.$inferSelect;
export type NewRfi = typeof rfis.$inferInsert;

/**
 * Feature requests — coworkers request panel updates. Global (not job-scoped).
 */
export const featureRequests = sqliteTable("feature_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  requester: text("requester").notNull().default(""),
  status: text("status").notNull().default("open"), // open | planned | done | declined
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type FeatureRequest = typeof featureRequests.$inferSelect;
export type NewFeatureRequest = typeof featureRequests.$inferInsert;

/**
 * Extra allowed sign-in emails (on top of the ALLOWED_EMAILS env founders).
 * Each member carries a role and optional per-user view overrides:
 *  - role:       "admin" | "office" | "lead" | "field" — the base view set (see lib/views).
 *  - viewsAllow: JSON string[] of view ids granted ON TOP of the role.
 *  - viewsDeny:  JSON string[] of view ids removed from the role.
 * Env founders are never in this table and are always treated as "admin".
 * New members added via /admin default to "field" (see the API); the column
 * default of "field" only backfills pre-existing rows created before roles
 * existed — re-grade those on /admin after deploy.
 */
export const allowedUsers = sqliteTable("allowed_users", {
  email: text("email").primaryKey(),
  addedBy: text("added_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  role: text("role").notNull().default("field"), // "admin" | "office" | "lead" | "field"
  viewsAllow: text("views_allow").notNull().default("[]"), // JSON string[]
  viewsDeny: text("views_deny").notNull().default("[]"), // JSON string[]
});

export type AllowedUser = typeof allowedUsers.$inferSelect;

/**
 * DB-editable layer on top of the hardcoded ROLE_VIEWS defaults in lib/views.ts
 * — lets an admin change what a whole role sees (not just one person) from
 * /admin. No row for a role = use the hardcoded default unchanged. "admin" is
 * never given a row here (see lib/views' roleBaseFor) so a bad edit can't lock
 * every admin out of the admin console.
 */
export const roleAccess = sqliteTable("role_access", {
  role: text("role").primaryKey(), // "office" | "lead" | "field"
  viewsAllow: text("views_allow").notNull().default("[]"), // JSON string[], on top of the hardcoded default
  viewsDeny: text("views_deny").notNull().default("[]"), // JSON string[], removed from the hardcoded default
  updatedAt: text("updated_at").notNull().default(""),
});

export type RoleAccessRow = typeof roleAccess.$inferSelect;

/**
 * Assistant-side per-bill workflow flags, keyed by JobTread document id:
 *  - saved:    the "Save" button was clicked and a line write succeeded (auto).
 *  - reviewed: the office explicitly marked the bill reviewed/done (a toggle).
 * Used to show indicators in the coding queue so it's clear at a glance which
 * draft bills have been worked. (Table name kept as "saved_bills" from when it
 * only tracked saves.)
 */
export const savedBills = sqliteTable("saved_bills", {
  docId: text("doc_id").primaryKey(), // JobTread vendorBill document id
  savedAt: text("saved_at").notNull().default(""), // ISO ts of most recent save; "" = never saved
  savedBy: text("saved_by").notNull().default(""), // email, if known
  reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false), // explicit "reviewed" toggle
  reviewedAt: text("reviewed_at").notNull().default(""), // ISO ts of most recent mark-reviewed
  reviewedBy: text("reviewed_by").notNull().default(""), // email, if known
});

export type SavedBill = typeof savedBills.$inferSelect;

/**
 * Sunset monthly statement payment cache, keyed by the sheet ExpID ("STMT-…").
 * The /payments view lists Sunset statements and shows what to type at the TSYS
 * hosted page. The payment header (account name, statement #, printed early-pay
 * discount, net) only exists on the statement PDF, so it's Gemini-extracted once
 * (via the listSunsetStatements/extractSunsetStatements Apps Script actions) and
 * cached here. `status`/`paidAt` are companion-owned workflow state — re-reading
 * a statement refreshes the extracted fields but must NEVER reset paid state.
 * Amounts are stored as-printed text to avoid float drift.
 */
export const sunsetStatements = sqliteTable("sunset_statements", {
  expId: text("exp_id").primaryKey(), // sheet ExpID, e.g. "STMT-1a2b3c4d"
  project: text("project").notNull().default(""),
  statementDate: text("statement_date").notNull().default(""), // YYYY-MM-DD or YYYY-MM
  pdfUrl: text("pdf_url").notNull().default(""), // Drive URL of the statement PDF
  accountName: text("account_name").notNull().default(""), // "ASCENT - <token>"
  statementNumber: text("statement_number").notNull().default(""), // top-right #
  total: text("total").notNull().default(""), // statement grand total
  discount: text("discount").notNull().default(""), // printed prompt discount
  net: text("net").notNull().default(""), // total - discount (what you pay)
  extractedAt: text("extracted_at").notNull().default(""), // "" = not yet Gemini'd
  status: text("status").notNull().default("unpaid"), // unpaid | paid
  paidAt: text("paid_at").notNull().default(""),
  paidBy: text("paid_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type SunsetStatement = typeof sunsetStatements.$inferSelect;

/**
 * PTO / sick-time accrual — assistant-owned (JobTread has no accrual object).
 * Four tables replace what TSheets did: policy config, per-person balances, an
 * append-only ledger the balances are reconstructable from, and self-service
 * time-off requests. Hours are stored as REAL. Worked hours (the accrual driver)
 * are read live from JobTread time entries — never stored here.
 *
 * One policy row per leave type ("sick", "pto"). `hoursPerHourWorked` is the
 * flat accrual rate (e.g. 1 hr per 30 worked = 0.0333). `tenureTiers` is an
 * empty array today (flat rate); populating it later with
 * [{ afterMonths, hoursPerHourWorked }, …] turns on tiered-by-tenure with no
 * migration. Caps of 0 mean "no cap".
 */
export const leavePolicies = sqliteTable("leave_policies", {
  leaveType: text("leave_type").primaryKey(), // "sick" | "pto"
  label: text("label").notNull().default(""), // display, e.g. "Sick Time"
  hoursPerHourWorked: text("hours_per_hour_worked").notNull().default("0"), // rate as text to avoid float drift
  annualCap: text("annual_cap").notNull().default("0"), // max hrs accrued/yr; 0 = none
  carryoverCap: text("carryover_cap").notNull().default("0"), // max hrs carried to next yr; 0 = none
  waitingDays: integer("waiting_days").notNull().default(0), // days after hire before usage allowed
  tenureTiers: text("tenure_tiers").notNull().default("[]"), // JSON [{afterMonths, hoursPerHourWorked}]
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull(),
});

export type LeavePolicy = typeof leavePolicies.$inferSelect;

/**
 * Current balance per employee × leave type. Employee is keyed by the roster
 * "Employee ID" (the stable anchor in the Employees sheet); jtUserId is cached
 * for the JobTread post. `accruedThroughPeriod` is the idempotency high-water
 * mark (last pay period accrual has run for, e.g. "2026-07-B"). Unique on
 * (employeeId, leaveType).
 */
export const leaveBalances = sqliteTable("leave_balances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: text("employee_id").notNull(),
  jtUserId: text("jt_user_id").notNull().default(""),
  leaveType: text("leave_type").notNull(), // "sick" | "pto"
  accrued: text("accrued").notNull().default("0"), // lifetime hrs accrued
  used: text("used").notNull().default("0"), // lifetime hrs taken
  balance: text("balance").notNull().default("0"), // current available hrs
  accruedThroughPeriod: text("accrued_through_period").notNull().default(""),
  updatedAt: text("updated_at").notNull(),
});

export type LeaveBalance = typeof leaveBalances.$inferSelect;

/**
 * Append-only ledger — the source of truth balances are rebuildable from.
 * `kind`: "accrual" (period grant), "taken" (leave used), "adjustment" (manual
 * correction / opening-balance import). `hours` is signed: + adds to balance,
 * − subtracts. `period` is the pay-period id for accrual rows (empty otherwise);
 * a partial unique index on (employeeId, leaveType, period) WHERE kind='accrual'
 * makes re-running accrual for a period a no-op. `jtEntryId` links a "taken" row
 * to the JobTread time entry it posted.
 */
export const leaveTransactions = sqliteTable("leave_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: text("employee_id").notNull(),
  leaveType: text("leave_type").notNull(),
  kind: text("kind").notNull(), // "accrual" | "taken" | "adjustment"
  hours: text("hours").notNull().default("0"), // signed
  period: text("period").notNull().default(""), // pay-period id for accrual rows
  note: text("note").notNull().default(""),
  jtEntryId: text("jt_entry_id").notNull().default(""), // linked JT time entry (taken)
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type LeaveTransaction = typeof leaveTransactions.$inferSelect;

/**
 * Self-service time-off requests. Field employees submit; office approves/denies.
 * On approval a JobTread time entry is created (gated) and its id stored in
 * `jtEntryId`, alongside a "taken" ledger row.
 */
export const leaveRequests = sqliteTable("leave_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: text("employee_id").notNull(),
  jtUserId: text("jt_user_id").notNull().default(""),
  leaveType: text("leave_type").notNull(),
  startDate: text("start_date").notNull().default(""), // YYYY-MM-DD
  endDate: text("end_date").notNull().default(""), // YYYY-MM-DD (== start for one day)
  hours: text("hours").notNull().default("0"), // total requested hrs
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending | approved | denied | cancelled
  decidedBy: text("decided_by").notNull().default(""),
  decidedAt: text("decided_at").notNull().default(""),
  jtEntryId: text("jt_entry_id").notNull().default(""), // JT time entry created on approval
  createdBy: text("created_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type LeaveRequest = typeof leaveRequests.$inferSelect;

/**
 * Append-only user activity log — powers the Admin → Activity dashboard (who
 * signs in and what they use). Three event kinds:
 *  - "login":  one row per successful Google sign-in (written server-side from
 *    NextAuth's signIn event, so it can't be spoofed by a client).
 *  - "view":   one row per in-app navigation (written by the /api/usage-track
 *    beacon; the email is taken from the session, never trusted from the body).
 *  - "coding": one row per bill-coding save to JobTread (written server-side by
 *    /api/code after a successful write; email from the session). `path` holds
 *    the coded bill's page (`/bill/<docId>`); `detail` holds a JSON array of the
 *    re-codes made (RecodeEntry[] — line, from, to); `viewId` is unused.
 * `viewId` is the gate view the path resolves to (see lib/views), handy for
 * "most-used features" rollups; `path` keeps the raw pathname. Old rows are
 * pruned on each login (see pruneUsageEvents), so the table stays bounded.
 */
export const usageEvents = sqliteTable("usage_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  kind: text("kind").notNull(), // "login" | "view" | "coding"
  path: text("path").notNull().default(""), // raw pathname (view + coding events)
  viewId: text("view_id").notNull().default(""), // resolved gate view id, if any
  detail: text("detail").notNull().default(""), // JSON RecodeEntry[] for coding events
  createdAt: text("created_at").notNull(), // ISO timestamp
});

export type UsageEvent = typeof usageEvents.$inferSelect;

/**
 * Labor-rate GROUPS — a group is usually a project ("Berger Bunkhouse", "Ferron").
 * A group's name is prepended to each of its rates when pushed to JobTread, so a
 * rate "Regular Pay" in group "Berger Bunkhouse" becomes the JobTread pay type
 * "Berger Bunkhouse - Regular Pay". The special GLOBAL group is virtual (group_id
 * 0, never a row here): its rates push with NO prefix (just "Regular Pay"). Real
 * groups get id >= 1.
 */
export const laborRateGroups = sqliteTable("labor_rate_groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // unique; prepended as "<name> - <rate>"
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type LaborRateGroup = typeof laborRateGroups.$inferSelect;

/**
 * Labor-rate catalog — assistant-owned list of named per-project pay rates, which
 * the /labor-rates page applies to employees. JobTread has NO central pay-type
 * catalog: a rate lives only on each membership's `timeEntryTypes` as a
 * `{name, hourlyRate}` copy with no id. So this table is the definition, and
 * "apply to employees" writes copies into each membership via updateMembership.
 *
 * `name` is the SHORT rate name (e.g. "Regular Pay", "Tile"). `groupId` points at
 * a labor_rate_groups row (or 0 = the virtual Global group). The JobTread pay-type
 * name pushed is the EFFECTIVE name = group ? `${group.name} - ${name}` : name —
 * computed at apply time, so renaming a group changes future pushes (existing JT
 * copies keep the old name until re-applied). Unique on (group_id, name).
 * `hourlyRate` stored as text to avoid float drift (Number() at the JT boundary).
 */
export const laborRateCatalog = sqliteTable("labor_rate_catalog", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // short rate name; unique within its group
  groupId: integer("group_id").notNull().default(0), // 0 = Global (no prefix)
  hourlyRate: text("hourly_rate").notNull().default("0"), // as text; Number() at the JT boundary
  sortOrder: integer("sort_order").notNull().default(0), // owner ordering within a group
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type LaborRate = typeof laborRateCatalog.$inferSelect;
export type NewLaborRate = typeof laborRateCatalog.$inferInsert;

/**
 * Lead tracking — the Companion's layer ON TOP of a JobTread "New Lead" customer.
 *
 * JobTread owns WHICH accounts are leads (the customer "Status" custom field —
 * see src/lib/leads.ts). It has nowhere to record what we're doing about one, so
 * the pipeline stage, the committed next action, and the last-contact date live
 * here, keyed by the JT account id. Nothing in this table is written back to
 * JobTread; a lead disappearing from the list means its Status changed in JT,
 * and its row here is simply left behind (harmless, and it comes back if the
 * Status is restored).
 *
 * Every date is a plain YYYY-MM-DD string, matching the rest of the schema.
 */
export const leads = sqliteTable("leads", {
  accountId: text("account_id").primaryKey(), // JobTread account id — the join key
  stage: text("stage").notNull().default("new"), // new | contacted | site_visit | estimating | proposal_sent
  nextAction: text("next_action").notNull().default(""), // what we owe this lead
  nextActionDate: text("next_action_date").notNull().default(""), // YYYY-MM-DD; past = overdue
  lastContactDate: text("last_contact_date").notNull().default(""), // YYYY-MM-DD; drives staleness
  estValue: text("est_value").notNull().default(""), // as text; Number() only for display
  notes: text("notes").notNull().default(""), // our working notes (JT's Notes field stays read-only)
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;

/**
 * The contact log for a lead — one row per touch (call, email, meeting, site
 * visit, or a bare note). Append-only from the UI's point of view.
 *
 * Logging a touch is also what advances `leads.last_contact_date`, so the
 * staleness aging on the page can never drift from the activity timeline.
 */
export const leadActivities = sqliteTable("lead_activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: text("account_id").notNull(), // JobTread account id
  kind: text("kind").notNull().default("note"), // call | email | meeting | site_visit | note
  note: text("note").notNull().default(""),
  occurredAt: text("occurred_at").notNull().default(""), // YYYY-MM-DD
  createdBy: text("created_by").notNull().default(""), // signed-in email
  createdAt: text("created_at").notNull(),
});

export type LeadActivity = typeof leadActivities.$inferSelect;
export type NewLeadActivity = typeof leadActivities.$inferInsert;
