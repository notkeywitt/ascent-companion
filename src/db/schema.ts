import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";

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
 * The signed-in email → JobTread identity link, cached out of the Employee
 * roster (Apps Script `timeEntryBootstrap`).
 *
 * WHY THIS TABLE EXISTS — it is a load-time fix, not new data. The roster is
 * the source of truth, but it lives behind the Apps Script web app, and ONE
 * round trip there costs ~3 s of pure Google overhead before the script runs
 * (measured 2026-08-26 with a rejected request). /employee-time used to pay
 * that three times on a single load — its bootstrap, its clock check, and the
 * leave balances — all asking the same question: "who is this person?". The
 * answer changes only when an admin re-links somebody, so it is cached here and
 * refreshed on a TTL (see lib/jtUserLink). A stale row is repaired by the
 * refresh, or immediately by an admin re-link.
 *
 * `employeeId` is the roster row's own id — it lets /api/time-off/me read
 * balances straight from this DB instead of pulling the roster to translate an
 * email.
 */
export const jtUserLinks = sqliteTable("jt_user_links", {
  email: text("email").primaryKey(), // lower-cased login email
  name: text("name").notNull().default(""), // the roster's display name
  jtUserId: text("jt_user_id").notNull().default(""), // "" = on the roster, not linked to JobTread
  jtUserName: text("jt_user_name").notNull().default(""),
  employeeId: text("employee_id").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(""), // ISO — drives the TTL refresh
});

export type JtUserLinkRow = typeof jtUserLinks.$inferSelect;

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
 * DB-editable layer on top of the hardcoded defaults in lib/digest/settings.ts
 * — lets an admin turn a check on/off or tune its config from /admin without a
 * redeploy. One row per check id; no row = use the hardcoded default
 * unchanged. `enabled` is nullable (null = no override, not "disabled").
 * `config` is a JSON-encoded PARTIAL override, merged key-by-key over that
 * check's default config (see mergeSettings in lib/digest/overrides.ts) — it
 * is never a wholesale replacement, so an admin edit to one field can't
 * accidentally blank out the rest.
 *
 * Unlike role_access, this is read FRESH on every digest run, not baked into
 * a session at sign-in — the digest's caller is a scheduler with no session
 * at all, so there is nothing to bake it into.
 */
export const digestSettingsOverrides = sqliteTable("digest_settings_overrides", {
  checkId: text("check_id").primaryKey(), // matches DigestCheck.id, e.g. "calendar-events"
  enabled: integer("enabled", { mode: "boolean" }),
  config: text("config"),
  updatedAt: text("updated_at").notNull().default(""),
});

export type DigestSettingsOverrideRow = typeof digestSettingsOverrides.$inferSelect;

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
  // "Needs review" — a companion-owned flag for a bill that needs work the app
  // can't do (a correction to a paid / invoiced / QuickBooks-pushed bill). The
  // note explains the issue. Distinct from `reviewed` above (which means "coding
  // looked at, done") — a bill can be both marked-reviewed AND flagged for a
  // billing correction. Surfaced in the Needs Review queue and as a bill chip.
  needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
  reviewNote: text("review_note").notNull().default(""), // free-text note about the issue
  reviewFlaggedAt: text("review_flagged_at").notNull().default(""), // ISO ts of the most recent flag
  reviewFlaggedBy: text("review_flagged_by").notNull().default(""), // signed-in email, if known
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

/**
 * Leads logged WITHOUT JobTread — the intake form from the public website
 * (ascentbuildingco.com/new-inquiry) filled in by us, for a lead that phoned,
 * walked in, or came through Casey. See src/lib/leadInquiry.ts for the question
 * set; every answer is stored as text, exactly as typed.
 *
 * This is the one lead record the Companion OWNS rather than mirrors. It exists
 * precisely so nothing has to be written to JobTread to start tracking a lead:
 * an inquiry row is a lead on the board immediately, keyed by its own `id`
 * (prefixed "inq_", so it can never collide with a JobTread account id), which
 * is what its `leads`/`lead_activities` rows key on too.
 *
 * On "Push to JobTread" a real customer account is created and its id lands in
 * `jt_account_id`. From that moment JobTread owns the lead: the board stops
 * rendering this row and shows the JobTread account instead (with these answers
 * joined back on for reference), and the tracking + contact-log rows are re-keyed
 * from `id` to the account id so no follow-up history is lost. A non-empty
 * `jt_account_id` is also the idempotency guard — it's what stops a second push
 * creating a duplicate customer.
 */
export const leadInquiries = sqliteTable("lead_inquiries", {
  id: text("id").primaryKey(), // "inq_<random>" — the board/tracking key until pushed
  name: text("name").notNull().default(""), // becomes the JT customer name
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  contactMethod: text("contact_method").notNull().default(""), // Phone | Text | Email
  residency: text("residency").notNull().default(""), // Full-time | Part-time | …
  address: text("address").notNull().default(""), // the form's "Project Location"
  services: text("services").notNull().default(""), // multi-select, comma-joined
  projectDetails: text("project_details").notNull().default(""),
  designStatus: text("design_status").notNull().default(""),
  budget: text("budget").notNull().default(""), // multi-select, comma-joined
  startDate: text("start_date").notNull().default(""), // YYYY-MM-DD
  targetDate: text("target_date").notNull().default(""), // YYYY-MM-DD
  leadSource: text("lead_source").notNull().default(""), // JT "Lead Source" option
  customerType: text("customer_type").notNull().default(""), // JT "Type" option
  notes: text("notes").notNull().default(""), // our intake notes
  /**
   * Provenance. A lead typed in by hand leaves these empty; one ingested from a
   * website form submission carries the Gmail message id it came from — which is
   * ALSO the de-duplication key (partial unique index, non-empty values only), so
   * re-scanning the mailbox can never file the same submission twice.
   */
  sourceMessageId: text("source_message_id").notNull().default(""),
  sourceForm: text("source_form").notNull().default(""), // which website form
  relatedFiles: text("related_files").notNull().default(""), // JSON [{name,url}]
  /** "" until someone has actually looked at an ingested submission. */
  reviewedAt: text("reviewed_at").notNull().default(""),
  reviewedBy: text("reviewed_by").notNull().default(""),
  jtAccountId: text("jt_account_id").notNull().default(""), // "" = not pushed yet
  pushedAt: text("pushed_at").notNull().default(""),
  pushedBy: text("pushed_by").notNull().default(""),
  createdBy: text("created_by").notNull().default(""), // signed-in email
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type LeadInquiry = typeof leadInquiries.$inferSelect;
export type NewLeadInquiry = typeof leadInquiries.$inferInsert;

/**
 * Tombstones for website submissions that were ingested and then DELETED off the
 * board. De-dup in the ingest keys on `source_message_id` in `lead_inquiries` —
 * but deleting an inquiry removes that row, and with it the guard, so the next
 * mailbox scan re-files the very submission someone just threw away. Recording
 * the message id here keeps it dismissed for good: the ingest skips any id
 * present in either table.
 */
export const leadInquiryDismissals = sqliteTable("lead_inquiry_dismissals", {
  sourceMessageId: text("source_message_id").primaryKey(),
  dismissedAt: text("dismissed_at").notNull(),
  dismissedBy: text("dismissed_by").notNull().default(""),
});

/**
 * Assistant-side "flag for review" marks on JobTread TIME ENTRIES — the labor
 * twin of `saved_bills.reviewed`. Set from Labor Review when an entry looks
 * wrong (wrong code, wrong hours, a day that needs asking about) and someone
 * has to come back to it.
 *
 * NOT a JobTread write: JT has no such field on a time entry, and inventing one
 * would fight the mirror. The flag is companion-owned workflow state only, so it
 * works regardless of the write gate. A row exists once an entry has ever been
 * flagged; un-flagging sets `flagged` false rather than deleting, so the last
 * flagged-by/at is still there.
 */
export const flaggedTimeEntries = sqliteTable("flagged_time_entries", {
  timeEntryId: text("time_entry_id").primaryKey(), // JobTread timeEntry id
  jobId: text("job_id").notNull().default(""), // so a job's flags load in one query
  flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
  flaggedAt: text("flagged_at").notNull().default(""), // ISO ts of the most recent flag
  flaggedBy: text("flagged_by").notNull().default(""), // signed-in email, if known
});

export type FlaggedTimeEntry = typeof flaggedTimeEntries.$inferSelect;

/**
 * Editable page copy — the on-screen text the office can reword without a
 * deploy, keyed by the ids in src/lib/copy.ts.
 *
 * Same override model as `role_access` above: the ENGLISH LIVES IN THE CODE
 * (the `text` field of each COPY entry) and a row here only ever overrides it.
 * An empty table means every page renders its built-in wording, so a wiped or
 * unreachable DB can never blank the UI — and deleting a row is how you revert
 * to the shipped text.
 *
 * Keys are validated against the registry on write, so a typo can't create a
 * dangling row the editor never shows again.
 */
export const pageCopy = sqliteTable("page_copy", {
  key: text("key").primaryKey(), // a COPY registry id, e.g. "home.dest.recode.label"
  value: text("value").notNull(), // the replacement text
  updatedAt: text("updated_at").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""), // signed-in email
});

export type PageCopyRow = typeof pageCopy.$inferSelect;

/**
 * Admin notices — short announcements an admin pushes to users, shown as a global
 * popup on whatever page the reader has open (the same mechanism as the
 * unmatched-vendor alert; see src/components/Notices.tsx). Companion-owned;
 * nothing to do with JobTread.
 *
 * Targeting is one row: `audienceType` is "all" | "role" | "user", and
 * `audienceValue` names the role ("field"/"office"/…) or the individual's email
 * when the type isn't "all" (empty for "all"). `tone` drives the popup's colour
 * ("info" | "warning" | "success"). `active` is the on/off switch — flip it off
 * to stop showing a notice without deleting it (and its read history).
 *
 * A notice is dismissed PER USER and stays gone: an acknowledgement writes a
 * `notice_reads` row, and the user-facing feed never returns a notice that reader
 * has a read row for. So re-activating an old notice won't re-nag people who
 * already saw it — deliberately; author a NEW notice to reach everyone again.
 */
export const notices = sqliteTable("notices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  tone: text("tone").notNull().default("info"), // "info" | "warning" | "success"
  audienceType: text("audience_type").notNull().default("all"), // "all" | "role" | "user"
  audienceValue: text("audience_value").notNull().default(""), // role name or email; "" for "all"
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull().default(""), // signed-in admin email
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Notice = typeof notices.$inferSelect;
export type NewNotice = typeof notices.$inferInsert;

/**
 * Per-user acknowledgement of a notice — the "seen it, don't show me again" mark.
 * One row per (notice, reader); its existence is the whole signal, so there's no
 * status column. Keyed on the pair, so a second dismiss is a harmless no-op.
 */
export const noticeReads = sqliteTable("notice_reads", {
  noticeId: integer("notice_id").notNull(),
  email: text("email").notNull(),
  readAt: text("read_at").notNull(),
});

export type NoticeRead = typeof noticeReads.$inferSelect;

/**
 * Bill search index — the local, instantly-searchable snapshot of every vendor
 * bill and its line items, backing the /bill-search page. Companion-owned CACHE,
 * never a source of truth: JobTread is authoritative for current bills and the
 * Google Sheet archive is the historical record. This table just makes "search
 * every bill and line for '2x4' or 'Preferred Plumbing' in under a second"
 * possible without paging JobTread live on every keystroke.
 *
 * TWO SOURCES, JOINED HERE (see src/lib/billSearch.ts):
 *  - `source='jobtread'` — swept straight from the live Pave API (all vendorBill
 *    statuses), keyed by `jtDocId`. This owns everything currently in JobTread.
 *  - `source='sheet'`    — the ONE-TIME seed of PRE-JobTread history out of the
 *    Expenditure/lineItem sheets (only rows NOT in JobTread, i.e. the sheet's
 *    `inJt=0`), keyed by `expId`. These have no JobTread document to open, so
 *    they display via their Drive PDF (`pdfFileId`) instead.
 * Splitting the two by "is it in JobTread?" is what avoids any dedup guesswork:
 * the sheet seed only supplies rows JobTread doesn't have. `expId`↔`externalId`
 * (stored as `invoiceId` on JT rows) is the safety net for the rare pre-JT row
 * later pushed into JobTread.
 *
 * The full-text index itself is a separate FTS5 virtual table (`bill_fts`),
 * created in raw SQL in db/index.ts — FTS5 has no Drizzle type, so it isn't
 * modelled here; this table + `billLineIndex` are the row store it points at.
 */
export const billIndex = sqliteTable("bill_index", {
  id: integer("id").primaryKey({ autoIncrement: true }), // also the bill_fts rowid
  source: text("source").notNull().default("jobtread"), // "jobtread" | "sheet"
  jtDocId: text("jt_doc_id").notNull().default(""), // JobTread document id ("" for pre-JT rows)
  expId: text("exp_id").notNull().default(""), // sheet ExpID ("" for JT-only rows)
  vendor: text("vendor").notNull().default(""), // display name — the "Preferred Plumbing" search target
  vendorId: text("vendor_id").notNull().default(""), // JobTread account id or sheet VendorID
  invoiceId: text("invoice_id").notNull().default(""), // vendor's own invoice # (JT externalId / sheet Invoice ID)
  billNumber: text("bill_number").notNull().default(""), // JobTread document number
  amount: real("amount").notNull().default(0), // pre-tax cost
  status: text("status").notNull().default(""), // JobTread status; "" for historical rows
  issueDate: text("issue_date").notNull().default(""), // YYYY-MM-DD
  jobId: text("job_id").notNull().default(""),
  jobName: text("job_name").notNull().default(""),
  customer: text("customer").notNull().default(""),
  csi: text("csi").notNull().default(""), // bill-level CSI, when the source has one
  pdfFileId: text("pdf_file_id").notNull().default(""), // Drive file id — pre-JT display link
  isSunset: integer("is_sunset", { mode: "boolean" }).notNull().default(false), // link to /payments
  updatedAt: text("updated_at").notNull().default(""), // ISO — last time this row was (re)indexed
});

export type BillIndexRow = typeof billIndex.$inferSelect;
export type NewBillIndexRow = typeof billIndex.$inferInsert;

/** One line item of an indexed bill — the "2x4" search target. */
export const billLineIndex = sqliteTable("bill_line_index", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  billId: integer("bill_id").notNull(), // → bill_index.id
  lineId: text("line_id").notNull().default(""), // JobTread costItem id or sheet LineItemID
  description: text("description").notNull().default(""),
  csi: text("csi").notNull().default(""),
  qty: real("qty").notNull().default(0),
  unitPrice: real("unit_price").notNull().default(0),
  amount: real("amount").notNull().default(0),
});

export type BillLineIndexRow = typeof billLineIndex.$inferSelect;
export type NewBillLineIndexRow = typeof billLineIndex.$inferInsert;

/**
 * Small key/value store for the bill-search index's own bookkeeping — the last
 * successful refresh time (drives the "rebuild when stale" trigger), the
 * in-flight refresh lock, and the one-time seed's progress cursor. Kept separate
 * from `schema_meta` (which holds the DDL fingerprint) so index bookkeeping and
 * schema versioning never collide.
 */
export const billIndexMeta = sqliteTable("bill_index_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
});

export type BillIndexMetaRow = typeof billIndexMeta.$inferSelect;

/**
 * The Admin Daily Digest — ONE ROW PER DAY, keyed by the company-timezone date.
 *
 * `results` is the JSON array of each check's structured outcome (id, title,
 * category, status, summary, items), NOT rendered text. Storing the structure is
 * what lets the home screen re-render and re-group a digest generated hours
 * earlier, and what would let a later feature trend "uncaptured bills per week"
 * without re-running anything. `summary` is the single Gemini paragraph written
 * over those results; `summary_source` says whether Gemini actually answered or
 * the local fallback wrote it.
 *
 * "Refresh now" overwrites the row for the same date rather than appending, so a
 * day has exactly one digest no matter how many times it is regenerated. `log`
 * is the run log — which checks ran, when, and how they came out — kept with the
 * digest because a check that quietly stopped finding anything is the failure
 * mode this feature has to be debuggable against.
 *
 * See src/lib/digest/ for the checks themselves.
 */
export const dailyDigest = sqliteTable("daily_digest", {
  date: text("date").primaryKey(), // YYYY-MM-DD, company timezone
  generatedAt: text("generated_at").notNull(), // ISO timestamp of the run
  status: text("status").notNull().default("ok"), // ok | partial | error
  summary: text("summary").notNull().default(""), // the one-paragraph summary
  summarySource: text("summary_source").notNull().default("fallback"), // gemini | fallback
  results: text("results").notNull().default("[]"), // JSON StoredCheckResult[]
  durationMs: integer("duration_ms").notNull().default(0),
  log: text("log").notNull().default("[]"), // JSON string[]
});

export type DailyDigestRow = typeof dailyDigest.$inferSelect;
export type NewDailyDigestRow = typeof dailyDigest.$inferInsert;

/**
 * The monthly client-invoice review's memory — what the office has already
 * ruled on, so a finding they overruled once stops coming back every month.
 *
 * `key` is the finding's stable identity (`findingKey` in lib/invoiceReview/
 * types.ts: kind|jobId|subject) and is the primary key, so ruling on the same
 * finding twice rewrites the note instead of stacking rows. A "job-kind" ruling
 * is stored under the wildcard key (kind|jobId|*) and covers every sibling
 * finding of that kind on that job.
 *
 * Lifting a ruling flips `active` rather than deleting the row, so "we decided
 * this was fine in August and changed our minds in October" stays on the record.
 * This is the ONLY thing the invoice review writes anywhere — it never touches
 * JobTread, Drive, or a number.
 */
export const invoiceReviewRulings = sqliteTable("invoice_review_rulings", {
  key: text("key").primaryKey(),
  kind: text("kind").notNull().default(""), // FindingKind
  jobId: text("job_id").notNull().default(""),
  scope: text("scope").notNull().default("finding"), // finding | job-kind
  reason: text("reason").notNull().default(""), // why the office overruled it
  createdBy: text("created_by").notNull().default(""), // signed-in email
  createdAt: text("created_at").notNull().default(""), // ISO
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export type InvoiceReviewRulingRow = typeof invoiceReviewRulings.$inferSelect;
export type NewInvoiceReviewRulingRow = typeof invoiceReviewRulings.$inferInsert;
