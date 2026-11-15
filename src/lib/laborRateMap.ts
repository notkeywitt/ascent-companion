/** The job labor-rate map's table (server side). Rules are in lib/laborRateMatch. */
import { asc } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { jobCodeRates } from "@/db/schema";
import type { JobCodeRate } from "@/lib/laborRateMatch";

export async function listJobCodeRates(): Promise<JobCodeRate[]> {
  await ensureDb();
  const rows = await db.select().from(jobCodeRates).orderBy(asc(jobCodeRates.jobName), asc(jobCodeRates.costCode));
  return rows.map(({ jobId, jobName, costCode, payType }) => ({ jobId, jobName, costCode, payType }));
}

/** Add a row, or replace the pay type on the one already there for that job + code. */
export async function saveJobCodeRate(rate: JobCodeRate, updatedBy: string): Promise<void> {
  await ensureDb();
  const updatedAt = new Date().toISOString();
  await db
    .insert(jobCodeRates)
    .values({ ...rate, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: [jobCodeRates.jobId, jobCodeRates.costCode],
      set: { payType: rate.payType, jobName: rate.jobName, updatedAt, updatedBy },
    });
}
