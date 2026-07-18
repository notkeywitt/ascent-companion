import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";

/**
 * RFIs — companion-owned (JobTread has no RFI object). Linked to a JobTread job
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

/** Extra allowed sign-in emails (on top of the ALLOWED_EMAILS env founders). */
export const allowedUsers = sqliteTable("allowed_users", {
  email: text("email").primaryKey(),
  addedBy: text("added_by").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export type AllowedUser = typeof allowedUsers.$inferSelect;

/**
 * Companion-side per-bill workflow flags, keyed by JobTread document id:
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
