/**
 * Check "digest-todos" (To-Do) — the office's own reminders, set via the digest
 * reply box (see src/app/api/digest/reply/route.ts) and stored in the
 * `digest_todos` table (src/db/schema.ts).
 *
 * This is the one check that reads the Companion's OWN database rather than an
 * external source — but it's still read-only from the check's point of view.
 * Nothing here writes; a todo is only ever created, snoozed, or completed by a
 * parsed reply. "Open" = status 'open', or 'snoozed' with its snooze date
 * already reached.
 */
import { desc, eq, or, and, lte } from "drizzle-orm";

import { db, ensureDb } from "@/db";
import { digestTodos } from "@/db/schema";
import { defineCheck, allClear, checkError, type CheckResult, type DigestItem } from "../types";
import type { DigestTodosConfig } from "../settings";

export const digestTodosCheck = defineCheck<DigestTodosConfig>({
  id: "digest-todos",
  title: "Reminders",
  category: "todo",
  enabled: true, // real value comes from settings.ts via the registry
  config: {} as DigestTodosConfig,

  async run({ config, today, log }): Promise<CheckResult> {
    let rows;
    try {
      await ensureDb();
      rows = await db
        .select()
        .from(digestTodos)
        .where(
          or(
            eq(digestTodos.status, "open"),
            and(eq(digestTodos.status, "snoozed"), lte(digestTodos.snoozeUntil, today)),
          ),
        )
        .orderBy(desc(digestTodos.createdAt))
        .limit(config.maxItems);
    } catch (e) {
      return checkError(`Couldn't read reminders: ${e instanceof Error ? e.message : String(e)}`);
    }
    log(`${rows.length} open reminder(s)`);

    if (rows.length === 0) {
      return allClear("No open reminders.");
    }
    const items: DigestItem[] = rows.map((r) => ({
      title: r.text,
      detail: r.snoozeUntil ? `Snoozed until ${r.snoozeUntil}` : undefined,
      date: r.snoozeUntil || undefined,
      group: "Reminders",
    }));
    return {
      status: "warning",
      items,
      summary: `${items.length} open reminder${items.length === 1 ? "" : "s"}.`,
    };
  },
});
