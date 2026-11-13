import { eq } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { homeLayouts } from "@/db/schema";
import { DEFAULT_LAYOUT, normalizeLayout, type HomeLayout } from "@/lib/homeWidgets";

/** Server-only read and write of `home_layouts`. A failed read is the default. */
export async function readHomeLayout(email: string): Promise<HomeLayout> {
  const key = email.trim().toLowerCase();
  if (!key) return DEFAULT_LAYOUT;
  try {
    await ensureDb();
    const [row] = await db.select().from(homeLayouts).where(eq(homeLayouts.email, key));
    return row ? normalizeLayout(JSON.parse(row.value)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export async function writeHomeLayout(email: string, layout: HomeLayout): Promise<void> {
  const key = email.trim().toLowerCase();
  const value = JSON.stringify(layout);
  const updatedAt = new Date().toISOString();
  await ensureDb();
  await db
    .insert(homeLayouts)
    .values({ email: key, value, updatedAt })
    .onConflictDoUpdate({ target: homeLayouts.email, set: { value, updatedAt } });
}
