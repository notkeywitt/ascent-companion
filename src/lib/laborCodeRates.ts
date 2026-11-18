/** The Labor Rates Map's table (server side). Rules are in lib/laborRateMatch. */
import { and, eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { laborRatesMap } from "@/db/schema";
import type { CodeRate } from "@/lib/laborRateMatch";

export async function listCodeRates(): Promise<CodeRate[]> {
  await ensureDb();
  const rows = await db.select().from(laborRatesMap);
  return rows.map(({ jobId, costCode, hourlyRate }) => ({ jobId, costCode, hourlyRate }));
}

/** Set the rate for a job + code; a null rate clears the row. */
export async function saveCodeRate(
  jobId: string,
  costCode: string,
  hourlyRate: number | null,
  updatedBy: string,
): Promise<void> {
  await ensureDb();
  if (hourlyRate === null) {
    await db.delete(laborRatesMap).where(and(eq(laborRatesMap.jobId, jobId), eq(laborRatesMap.costCode, costCode)));
    return;
  }
  const updatedAt = new Date().toISOString();
  await db
    .insert(laborRatesMap)
    .values({ jobId, costCode, hourlyRate, updatedAt, updatedBy })
    .onConflictDoUpdate({
      target: [laborRatesMap.jobId, laborRatesMap.costCode],
      set: { hourlyRate, updatedAt, updatedBy },
    });
}
