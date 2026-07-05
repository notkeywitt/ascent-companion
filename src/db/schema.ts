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
